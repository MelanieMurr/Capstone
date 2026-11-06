import { Effect } from "effect";
import { z } from "zod";
import { AppError } from "../../foundation/contracts";
import { modelSchema } from "./contracts";
import { connectionError, discovery, exchange, PLAN_SCOPE, RESOURCE, TokenExchangeError, verifyIdentity } from "./oauth";
import { hash, loadAccounts, removePrivate, saveAccounts, withLock } from "./store";
import type { AccountStore, Registration } from "./store";

const unusable = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
async function renew(userId: string, store: AccountStore, account: Registration) {
  const current = account.tokens;
  if (!current) throw new AppError("Continue with ChatGPT to reconnect this account.", 401);
  if (current.expires_at > Date.now() + 60_000) return current;
  if (current.earliest_refresh_at && current.earliest_refresh_at * 1000 > Date.now()) {
    if (current.expires_at > Date.now()) return current;
    throw new AppError("ChatGPT access cannot be renewed yet. Try again later.", 503);
  }
  if (!current.refresh_token) throw new AppError("Continue with ChatGPT to renew this account's authorization.", 401);
  try {
    const fresh = await exchange({ grant_type: "refresh_token", client_id: account.client_id, refresh_token: current.refresh_token });
    // A replacement is required: never keep using an already rotated refresh token.
    if (!fresh.refresh_token) throw new Error("Missing rotating refresh token");
    if (fresh.id_token) {
      const identity = await verifyIdentity(fresh.id_token, account.client_id, undefined, fresh.access_token);
      if (identity.sub !== account.subject) throw new Error("Renewed identity mismatch");
    }
    account.tokens = {
      access_token: fresh.access_token, refresh_token: fresh.refresh_token, id_token: fresh.id_token ?? current.id_token,
      expires_at: Date.now() + fresh.expires_in * 1000, scopes: fresh.scope.split(/\s+/).filter(Boolean),
      ...(fresh.earliest_refresh_at !== undefined ? { earliest_refresh_at: fresh.earliest_refresh_at } : {}),
    };
    await saveAccounts(userId, store);
    return account.tokens;
  } catch (error) {
    if (error instanceof TokenExchangeError && unusable.has(error.code)) {
      delete account.tokens;
      await saveAccounts(userId, store);
      throw new AppError("This ChatGPT session expired or was disconnected. Continue with ChatGPT to reconnect.", 401);
    }
    throw error;
  }
}

export const withActiveAccount = <A>(userId: string, work: (account: Registration, accessToken: string) => Promise<A>) => Effect.tryPromise({
  try: () => withLock(userId, async () => {
    const store = await loadAccounts(userId);
    const account = store.accounts.find((item) => item.id === store.activeId);
    if (!account) throw new AppError("Connect your ChatGPT account before running an AI request.", 401);
    const tokens = await renew(userId, store, account);
    if (!tokens.scopes.includes(PLAN_SCOPE)) throw new AppError("ChatGPT plan permission is disabled. Choose Enable ChatGPT plan and approve access.", 403);
    return work(account, tokens.access_token);
  }), catch: connectionError,
});

export const connectionStatus = (userId: string) => Effect.tryPromise({
  try: () => withLock(userId, async () => {
    const store = await loadAccounts(userId);
    return {
      activeId: store.activeId,
      accounts: store.accounts.map((account, index) => ({
        id: account.id, label: `${account.email || account.name || "ChatGPT account"} · ${index + 1} (${account.client_id.slice(-6)})`,
        connected: !!account.tokens, planEnabled: account.tokens?.scopes.includes(PLAN_SCOPE) ?? false,
        model: account.model, welcomeSeen: account.welcomeSeen,
      })),
    };
  }), catch: connectionError,
});

export async function fetchModels(accessToken: string) {
  const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new AppError(response.status === 401 ? "ChatGPT did not accept this session. Reconnect the selected account." : `ChatGPT model catalog is unavailable (${response.status}). Check plan access or try again later.`, response.status);
  const body = z.object({ models: z.array(modelSchema.extend({ visibility: z.string() })) }).parse(await response.json());
  return body.models.filter((model) => model.visibility === "list").map(({ slug, display_name }) => ({ slug, display_name }));
}
export const availableModels = (userId: string) => withActiveAccount(userId, (_account, token) => fetchModels(token));
export const selectModel = (userId: string, model: string) => withActiveAccount(userId, async (account, token) => {
  const models = await fetchModels(token);
  if (!models.some((item) => item.slug === model)) throw new AppError("Choose a model available to this ChatGPT account.", 400);
  // withActiveAccount owns the user lock, so no other request can switch accounts here.
  const store = await loadAccounts(userId);
  const selected = store.accounts.find((item) => item.id === account.id)!;
  selected.model = model;
  await saveAccounts(userId, store);
  return { model };
});

export const updateConnection = (userId: string, action: "select" | "disconnect" | "welcome", accountId?: string) => Effect.tryPromise({
  try: () => withLock(userId, async () => {
    const store = await loadAccounts(userId);
    const account = store.accounts.find((item) => item.id === (accountId ?? store.activeId));
    if (!account) throw new AppError("ChatGPT account not found.", 404);
    let message = "ChatGPT account selected.";
    if (action === "select") store.activeId = account.id;
    if (action === "welcome") account.welcomeSeen = true;
    if (action === "disconnect") {
      if (store.pendingState) await removePrivate(`pending-${hash(store.pendingState)}.json`);
      delete store.pendingState;
      let revoked = !account.tokens?.refresh_token;
      if (account.tokens?.refresh_token) {
        try {
          const config = await discovery();
          // One bounded retry for transient revocation failures; tokens are always cleared locally.
          for (let attempt = 0; attempt < 2; attempt++) {
            const result = await fetch(config.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: account.tokens.refresh_token, token_type_hint: "refresh_token", client_id: account.client_id }), signal: AbortSignal.timeout(5000), redirect: "error" }).catch(() => null);
            if (result?.status === 200) { revoked = true; break; }
            if (result && result.status < 500) break;
            if (!attempt) await new Promise((done) => setTimeout(done, 250));
          }
        } catch { /* Finish local sign-out even when discovery is unavailable. */ }
      }
      delete account.tokens;
      message = revoked ? "ChatGPT disconnected. Saved registration retained for reconnecting." : "Disconnected locally. Remote revocation was not confirmed; disconnect CoCanvas in ChatGPT Settings as well.";
    }
    await saveAccounts(userId, store);
    return { message };
  }), catch: connectionError,
});
