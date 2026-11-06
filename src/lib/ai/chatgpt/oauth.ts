import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import type { webcrypto } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { AppError } from "../../foundation/contracts";
import { consumePending, hash, hostId, loadAccounts, removePrivate, saveAccounts, savePrivate, withLock } from "./store";
import type { Registration } from "./store";
type JsonWebKey = webcrypto.JsonWebKey;

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const OAUTH_COOKIE = "cocanvas_chatgpt_oauth";
const random = () => randomBytes(32).toString("base64url");
export const equal = (left: string, right: string) => Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
export const connectionError = (error: unknown) => error instanceof AppError ? error : new AppError("ChatGPT connection failed. Try connecting again. Your existing account has not been replaced.", 502);
const transactionSchema = z.object({
  userId: z.uuid(), state: z.string(), nonce: z.string(), verifier: z.string(), redirectUri: z.url(), returnTo: z.string(),
  clientId: z.string(), accountId: z.string().optional(), expiresAt: z.number(),
});
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1), id_token: z.string().min(1).optional(), refresh_token: z.string().min(1).optional(),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"), expires_in: z.number().int().positive(),
  scope: z.string(), earliest_refresh_at: z.number().optional(),
});
const discoverySchema = z.object({
  issuer: z.literal(ISSUER), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(), revocation_endpoint: z.url(),
});
let discoveryCache: { until: number; value: z.infer<typeof discoverySchema> } | undefined;
let keysCache: { until: number; keys: (JsonWebKey & { kid?: string; use?: string; alg?: string })[] } | undefined;

export async function discovery() {
  if (discoveryCache && discoveryCache.until > Date.now()) return discoveryCache.value;
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, { cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new AppError("OpenAI sign-in is temporarily unavailable.", 503);
  const value = discoverySchema.parse(await response.json());
  for (const endpoint of [value.authorization_endpoint, value.token_endpoint, value.jwks_uri, value.revocation_endpoint]) {
    if (new URL(endpoint).origin !== ISSUER) throw new Error("Unexpected OAuth endpoint");
  }
  discoveryCache = { value, until: Date.now() + 600_000 };
  return value;
}

async function signingKey(kid: string) {
  let key = keysCache?.until && keysCache.until > Date.now() ? keysCache.keys.find((item) => item.kid === kid) : undefined;
  if (!key) {
    const config = await discovery();
    const response = await fetch(config.jwks_uri, { cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new AppError("Could not verify ChatGPT identity. Try again later.", 503);
    const parsed = z.object({ keys: z.array(z.record(z.string(), z.unknown())).max(100) }).parse(await response.json());
    keysCache = { until: Date.now() + 600_000, keys: parsed.keys as (JsonWebKey & { kid?: string; use?: string; alg?: string })[] };
    key = keysCache.keys.find((item) => item.kid === kid);
  }
  if (!key || key.kty !== "RSA" || (key.use && key.use !== "sig") || (key.alg && key.alg !== "RS256")) throw new Error("Invalid signing key");
  const publicKey = createPublicKey({ key, format: "jwk" });
  if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Weak signing key");
  return publicKey;
}

/** Discovery advertises RS256 only. Never accept an algorithm supplied by the token. */
export async function verifyIdentity(token: string, clientId: string, nonce: string | undefined, accessToken: string) {
  if (token.length > 32_000) throw new Error("Oversized ID token");
  const pieces = token.split(".");
  if (pieces.length !== 3 || pieces.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid ID token");
  const header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1), crit: z.never().optional() }).parse(JSON.parse(Buffer.from(pieces[0]!, "base64url").toString("utf8")));
  const valid = verify("RSA-SHA256", Buffer.from(`${pieces[0]}.${pieces[1]}`), await signingKey(header.kid), Buffer.from(pieces[2]!, "base64url"));
  if (!valid) throw new Error("Invalid signature");
  const claims = z.object({
    iss: z.literal(ISSUER), sub: z.string().min(1), aud: z.union([z.string(), z.array(z.string()).min(1)]),
    exp: z.number().int(), iat: z.number().int(), nbf: z.number().int().optional(), nonce: z.string().optional(),
    azp: z.string().optional(), email: z.string().max(254).optional(), name: z.string().max(200).optional(), at_hash: z.string().optional(),
  }).parse(JSON.parse(Buffer.from(pieces[1]!, "base64url").toString("utf8")));
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Date.now() / 1000;
  if (!audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || claims.exp < now - 5 || claims.iat > now + 5 || (claims.nbf !== undefined && claims.nbf > now + 5) || (nonce !== undefined && (!claims.nonce || !equal(claims.nonce, nonce)))) throw new Error("Invalid ID token claims");
  if (claims.at_hash && !equal(claims.at_hash, createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url"))) throw new Error("Access token mismatch");
  return claims;
}

export class TokenExchangeError extends AppError {
  constructor(public readonly code: string, status: number) {
    super("ChatGPT authorization could not be renewed. Reconnect if your session has expired, or try again later.", status >= 500 ? 503 : 401);
  }
}
export async function exchange(fields: Record<string, string>) {
  const config = await discovery();
  const response = await fetch(config.token_endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...fields, resource: RESOURCE }), signal: AbortSignal.timeout(15_000), redirect: "error",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.union([z.string(), z.object({ code: z.string() })]) }).safeParse(body);
    const code = parsed.success ? (typeof parsed.data.error === "string" ? parsed.data.error : parsed.data.error.code) : "unavailable";
    throw new TokenExchangeError(code, response.status);
  }
  return tokenResponseSchema.parse(body);
}

export const beginConnection = (userId: string, origin: string, returnTo: string, accountId?: string, enablePlan = false) => Effect.tryPromise({
  try: async () => {
    const local = new URL(origin);
    if (local.protocol !== "http:" || local.hostname !== "127.0.0.1") throw new AppError("Open CoCanvas at http://127.0.0.1:3000 and sign in before connecting ChatGPT. OpenAI requires a 127.0.0.1 callback.", 400);
    const host = await hostId();
    const config = await discovery();
    return withLock(userId, async () => {
      const store = await loadAccounts(userId);
      const account = accountId ? store.accounts.find((item) => item.id === accountId) : undefined;
      if (accountId && !account) throw new AppError("ChatGPT account not found.", 404);
      if (store.accounts.length >= 20 && !account) throw new AppError("This local profile already has 20 ChatGPT registrations.", 400);
      const state = random(), nonce = random(), verifier = random();
      const redirectUri = `${local.origin}/auth/callback`;
      const clientId = account?.client_id ?? store.retryClientId ?? "dynamic_agent_client";
      const safePath = /^\/boards\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : returnTo === "/" ? "/" : "/dashboard";
      const transaction = { userId, state, nonce, verifier, redirectUri, returnTo: safePath, clientId, ...(account ? { accountId: account.id } : {}), expiresAt: Date.now() + 600_000 };
      if (store.pendingState) await removePrivate(`pending-${hash(store.pendingState)}.json`);
      await savePrivate(`pending-${hash(state)}.json`, transaction);
      store.pendingState = state;
      await saveAccounts(userId, store);
      const authorization = new URL(config.authorization_endpoint);
      authorization.search = new URLSearchParams({ client_id: clientId, ext_agent_host_id: host, response_type: "code", redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
      if (clientId === "dynamic_agent_client") authorization.searchParams.set("agent_name_hint", "CoCanvas");
      if (account?.tokens?.id_token) authorization.searchParams.set("id_token_hint", account.tokens.id_token);
      if (account?.email) authorization.searchParams.set("login_hint", account.email);
      if (enablePlan) authorization.searchParams.set("prompt", "consent");
      return { authorization: authorization.toString(), state };
    });
  }, catch: connectionError,
});

export const finishConnection = (userId: string, callback: URL, browserState?: string) => Effect.tryPromise({
  try: async () => {
    const state = callback.searchParams.get("state");
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browserState || !equal(state, browserState)) throw new AppError("Invalid ChatGPT sign-in state. Start a new connection.", 400);
    const pending = transactionSchema.parse(await consumePending(state));
    if (pending.userId !== userId || pending.expiresAt < Date.now() || !equal(pending.state, state) || `${callback.origin}${callback.pathname}` !== pending.redirectUri) throw new AppError("ChatGPT sign-in expired or belongs to another session. Start again.", 400);
    const code = callback.searchParams.get("code");
    const returnedClient = callback.searchParams.get("client_id");
    const clientId = pending.clientId === "dynamic_agent_client" ? returnedClient : pending.clientId;
    return withLock(userId, async () => {
      const store = await loadAccounts(userId);
      if (store.pendingState !== state) throw new AppError("This ChatGPT sign-in was cancelled or replaced. Start again.", 400);
      delete store.pendingState;
      await saveAccounts(userId, store);
      if (callback.searchParams.has("error")) return { returnTo: pending.returnTo, status: "declined" as const };
      if (!code || code.length > 5000 || !clientId || clientId === "dynamic_agent_client" || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (pending.clientId !== "dynamic_agent_client" && returnedClient && returnedClient !== pending.clientId)) throw new AppError("ChatGPT registration was incomplete or returned a different client. Start again.", 400);
      // If code redemption fails, reuse the issued registration on the next fresh
      // authorization. This is not yet a verified identity or an active account.
      if (!pending.accountId) { store.retryClientId = clientId; await saveAccounts(userId, store); }
      const tokens = await exchange({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri });
      if (!tokens.id_token) throw new Error("Missing ID token");
      const identity = await verifyIdentity(tokens.id_token, clientId, pending.nonce, tokens.access_token);
      const prior = pending.accountId ? store.accounts.find((item) => item.id === pending.accountId) : undefined;
      if (pending.accountId && (!prior || prior.subject !== identity.sub || prior.client_id !== clientId)) throw new AppError("The ChatGPT account did not match the selected registration. The active connection was preserved.", 400);
      const id = hash(`${identity.iss}\n${clientId}\n${identity.sub}`);
      const existing = store.accounts.find((item) => item.id === id);
      const record: Registration = {
        id, issuer: ISSUER, subject: identity.sub, client_id: clientId,
        ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}),
        model: existing?.model ?? null, welcomeSeen: existing?.welcomeSeen ?? false,
        tokens: { ...tokens, id_token: tokens.id_token, expires_at: Date.now() + tokens.expires_in * 1000, scopes: tokens.scope.split(/\s+/).filter(Boolean) },
      };
      store.accounts = [...store.accounts.filter((item) => item.id !== id), record];
      store.activeId = id;
      delete store.retryClientId;
      await saveAccounts(userId, store);
      return { returnTo: pending.returnTo, status: tokens.scope.split(/\s+/).includes(PLAN_SCOPE) ? "connected" as const : "permission" as const };
    });
  }, catch: connectionError,
});
