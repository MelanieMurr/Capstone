import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluationNotes, fixtureResult } from "../evaluation";

const user = "30000000-0000-4000-8000-000000000001", otherUser = "30000000-0000-4000-8000-000000000002";
const clientId = "oaiapp_test_client";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
let folder: string;
let oauth: typeof import("./oauth");
let store: typeof import("./store");
let service: typeof import("./service");
let nonce = "", subject = "subject-one", scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
let tokens = 0, responses = 0, tokenFailure = "", streamFailure = "", apiStatus = 200, revokeFails = false;
let lastTokenFields: URLSearchParams, lastInference: Record<string, unknown>, lastAuthorization = "";
const net = vi.fn();
function signed(claims: Record<string, unknown> = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", sub: subject, aud: clientId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, nonce, email: "same@example.test", ...claims })).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), pair.privateKey).toString("base64url")}`;
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  folder = await mkdtemp(join(tmpdir(), "cocanvas-chatgpt-test-"));
  vi.stubEnv("COCANVAS_CHATGPT_DIR", folder);
  tokens = 0; responses = 0; nonce = ""; subject = "subject-one"; tokenFailure = ""; streamFailure = ""; apiStatus = 200; revokeFails = false;
  scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  oauth = await import("./oauth"); store = await import("./store"); service = await import("./service");
  net.mockReset();
  net.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("openid-configuration")) return Response.json({ issuer: oauth.ISSUER, authorization_endpoint: `${oauth.ISSUER}/api/accounts/authorize`, token_endpoint: `${oauth.ISSUER}/api/accounts/oauth/token`, jwks_uri: `${oauth.ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${oauth.ISSUER}/api/accounts/oauth/revoke` });
    if (url.endsWith("jwks.json")) return Response.json({ keys: [jwk] });
    if (url.endsWith("oauth/token")) {
      tokens++;
      lastTokenFields = new URLSearchParams(init?.body as string);
      if (tokenFailure) return Response.json({ error: tokenFailure }, { status: tokenFailure === "temporary" ? 503 : 400 });
      return Response.json({ access_token: `access-${tokens}`, refresh_token: `refresh-${tokens}`, id_token: signed(), token_type: "Bearer", expires_in: 3600, scope: scopes });
    }
    if (url.endsWith("oauth/revoke")) return new Response(null, { status: revokeFails ? 503 : 200 });
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "account-model", display_name: "Account model", visibility: "list" }, { slug: "hidden-model", display_name: "Hidden", visibility: "hidden" }] });
    if (url.endsWith("/responses")) {
      responses++;
      lastInference = JSON.parse(init!.body as string); lastAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      if (apiStatus !== 200) return Response.json({ error: { code: "subscription_sharing_user_not_eligible", message: "Not eligible", type: "permission_error", param: null } }, { status: apiStatus, headers: { "x-request-id": "test-request" } });
      const events = [{ type: "response.output_text.delta", delta: JSON.stringify(fixtureResult) }];
      const terminal = streamFailure === "interrupted" ? [] : [streamFailure ? { type: "response.failed", response: { id: "resp_test", error: { code: streamFailure } } } : { type: "response.completed", response: { id: "resp_test", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
      return new Response([...events, ...terminal].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  });
  vi.stubGlobal("fetch", net);
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(folder, { recursive: true, force: true }); });
async function begin(accountId?: string) {
  const result = await Effect.runPromise(oauth.beginConnection(user, "http://127.0.0.1:3000", "/dashboard", accountId));
  nonce = new URL(result.authorization).searchParams.get("nonce")!;
  return result;
}
function callback(state: string, returned = clientId) {
  return new URL(`http://127.0.0.1:3000/auth/callback?${new URLSearchParams({ state, code: "test-code", client_id: returned })}`);
}
async function connected() {
  const pending = await begin();
  await Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state));
  const accounts = await store.loadAccounts(user);
  return accounts.accounts.find((account) => account.id === accounts.activeId)!;
}
async function ready() {
  const account = await connected();
  await Effect.runPromise(service.selectModel(user, "account-model"));
  return { notes: evaluationNotes, operation: "summary", prompt: "grounded", provider: "chatgpt", connectionId: account.id, model: "account-model" };
}
async function expire() {
  const accounts = await store.loadAccounts(user);
  accounts.accounts[0]!.tokens!.expires_at = Date.now() - 1000;
  await store.saveAccounts(user, accounts);
}

describe("local ChatGPT OAuth", () => {
  it("uses fresh state, nonce and PKCE with a stable host and exact loopback callback", async () => {
    const first = await begin(), second = await begin();
    const a = new URL(first.authorization), b = new URL(second.authorization);
    expect(a.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(a.searchParams.get("agent_name_hint")).toBe("CoCanvas");
    expect(a.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/auth/callback");
    expect(a.searchParams.get("ext_agent_host_id")).toBe(b.searchParams.get("ext_agent_host_id"));
    expect(first.state).not.toBe(second.state); expect(a.searchParams.get("nonce")).not.toBe(b.searchParams.get("nonce"));
    const pending = await store.readPrivate(`pending-${store.hash(second.state)}.json`) as { verifier: string };
    expect(b.searchParams.get("code_challenge")).toBe(createHash("sha256").update(pending.verifier).digest("base64url"));
    expect(b.searchParams.get("code_challenge_method")).toBe("S256");
    expect(b.searchParams.has("client_secret")).toBe(false);
    await expect(Effect.runPromise(oauth.beginConnection(user, "http://localhost:3000", "/dashboard"))).rejects.toThrow("127.0.0.1");
  });
  it("stores verified identity and credentials privately and returns no tokens to the UI", async () => {
    const account = await connected();
    expect(account.subject).toBe(subject); expect(account.client_id).toBe(clientId);
    expect(lastTokenFields.get("client_id")).toBe(clientId);
    expect(lastTokenFields.get("redirect_uri")).toBe("http://127.0.0.1:3000/auth/callback");
    expect(lastTokenFields.get("resource")).toBe(oauth.RESOURCE);
    expect(lastTokenFields.has("client_secret")).toBe(false);
    const status = await Effect.runPromise(service.connectionStatus(user));
    expect(status.accounts[0]!.planEnabled).toBe(true);
    const publicData = JSON.stringify(status);
    for (const secret of ["access-1", "refresh-1", "id_token", subject]) expect(publicData).not.toContain(secret);
    expect((await stat(join(folder, `user-${store.hash(user)}.json`))).mode & 0o777).toBe(0o600);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await Effect.runPromise(service.connectionStatus(otherUser))).accounts).toEqual([]);
  });
  it("reuses issued clients and retained identity hints for returning sign-in", async () => {
    const account = await connected();
    const pending = await begin(account.id);
    const url = new URL(pending.authorization);
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.has("agent_name_hint")).toBe(false);
    expect(url.searchParams.get("id_token_hint")).toBe(account.tokens!.id_token);
    const returned = callback(pending.state); returned.searchParams.delete("client_id");
    await Effect.runPromise(oauth.finishConnection(user, returned, pending.state));
    expect((await store.loadAccounts(user)).accounts).toHaveLength(1);
  });
  it("keeps the newly issued client for a fresh authorization after invalid_grant", async () => {
    const pending = await begin(); tokenFailure = "invalid_grant";
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state))).rejects.toThrow();
    expect((await store.loadAccounts(user)).accounts).toHaveLength(0);
    const retry = new URL((await begin()).authorization);
    expect(retry.searchParams.get("client_id")).toBe(clientId);
    expect(retry.searchParams.has("agent_name_hint")).toBe(false);
  });
  it("rejects wrong browser state, replay, expired transactions and changed client IDs", async () => {
    let pending = await begin();
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), "wrong"))).rejects.toThrow();
    expect(tokens).toBe(0);
    await Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state));
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state))).rejects.toThrow();
    expect(tokens).toBe(1);
    const account = (await store.loadAccounts(user)).accounts[0]!;
    pending = await begin(account.id);
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state, "oaiapp_wrong"), pending.state))).rejects.toThrow();
    expect(tokens).toBe(1);
    pending = await begin(account.id);
    const name = `pending-${store.hash(pending.state)}.json`;
    const record = await store.readPrivate(name) as Record<string, unknown>;
    await store.savePrivate(name, { ...record, expiresAt: 0 });
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state))).rejects.toThrow();
    expect(tokens).toBe(1);
  });
  it("preserves the active account after failed identity validation or declined consent", async () => {
    const account = await connected();
    let pending = await begin(account.id);
    subject = "different-account";
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state))).rejects.toThrow("did not match");
    expect((await store.loadAccounts(user)).accounts[0]!.tokens!.access_token).toBe("access-1");
    pending = await begin();
    const declined = callback(pending.state); declined.searchParams.set("error", "access_denied");
    expect((await Effect.runPromise(oauth.finishConnection(user, declined, pending.state))).status).toBe("declined");
    expect((await store.loadAccounts(user)).activeId).toBe(account.id);
  });
  it("rejects invalid signature, issuer, audience, expiration and nonce", async () => {
    const pending = await begin();
    for (const override of [{ iss: "https://attacker.test" }, { aud: "wrong-client" }, { exp: 0 }, { nonce: "wrong" }, { iat: Math.floor(Date.now() / 1000) + 60 }, { aud: [clientId, "other"] }, { at_hash: "wrong" }]) {
      await expect(oauth.verifyIdentity(signed(override), clientId, nonce, "access-1")).rejects.toThrow();
    }
    const original = signed(), parts = original.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "forged" })).toString("base64url");
    await expect(oauth.verifyIdentity(parts.join("."), clientId, nonce, "access-1")).rejects.toThrow();
    await expect(oauth.verifyIdentity(`${Buffer.from('{"alg":"none","kid":"test-key"}').toString("base64url")}.${original.split(".")[1]}.fake`, clientId, nonce, "access-1")).rejects.toThrow();
    expect(tokens).toBe(0); expect(pending.state).toBeTruthy();
  });
  it("keeps registrations with the same email separate and filters account models", async () => {
    const first = await connected();
    subject = "subject-two";
    const second = await connected();
    expect(second.id).not.toBe(first.id);
    expect((await store.loadAccounts(user)).accounts).toHaveLength(2);
    await Effect.runPromise(service.updateConnection(user, "select", first.id));
    expect((await Effect.runPromise(service.connectionStatus(user))).activeId).toBe(first.id);
    expect(await Effect.runPromise(service.availableModels(user))).toEqual([{ slug: "account-model", display_name: "Account model" }]);
    await expect(Effect.runPromise(service.selectModel(user, "hidden-model"))).rejects.toThrow();
  });
  it("retains sign-in but blocks inference when plan permission was not granted", async () => {
    scopes = "openid profile email";
    await connected();
    const status = await Effect.runPromise(service.connectionStatus(user));
    expect(status.accounts[0]!.connected).toBe(true); expect(status.accounts[0]!.planEnabled).toBe(false);
    await expect(Effect.runPromise(service.availableModels(user))).rejects.toThrow("permission is disabled");
    expect(responses).toBe(0);
  });
  it("serializes rotating refreshes and saves the replacement across subsequent requests", async () => {
    await connected(); await expire();
    await Promise.all([Effect.runPromise(service.availableModels(user)), Effect.runPromise(service.availableModels(user))]);
    expect(tokens).toBe(2);
    expect(lastTokenFields.get("grant_type")).toBe("refresh_token");
    expect(lastTokenFields.get("refresh_token")).toBe("refresh-1");
    expect(lastTokenFields.get("client_id")).toBe(clientId); expect(lastTokenFields.has("scope")).toBe(false);
    expect((await store.loadAccounts(user)).accounts[0]!.tokens!.refresh_token).toBe("refresh-2");
  });
  it("preserves tokens on transient refresh failure, clears terminal failures, and retains the registration", async () => {
    const account = await connected(); await expire();
    tokenFailure = "temporary";
    await expect(Effect.runPromise(service.availableModels(user))).rejects.toThrow();
    expect((await store.loadAccounts(user)).accounts[0]!.tokens).toBeDefined();
    tokenFailure = "invalid_grant";
    await expect(Effect.runPromise(service.availableModels(user))).rejects.toThrow("expired or was disconnected");
    const saved = (await store.loadAccounts(user)).accounts[0]!;
    expect(saved.tokens).toBeUndefined(); expect(saved.client_id).toBe(account.client_id);
  });
  it("revokes on disconnect, clears all tokens and pending sign-ins, and reuses registration without hints", async () => {
    const account = await connected(); const pending = await begin(account.id);
    await Effect.runPromise(service.updateConnection(user, "disconnect", account.id));
    expect((await store.loadAccounts(user)).accounts[0]!.tokens).toBeUndefined();
    expect(net.mock.calls.some(([url]) => String(url).endsWith("oauth/revoke"))).toBe(true);
    await expect(Effect.runPromise(oauth.finishConnection(user, callback(pending.state), pending.state))).rejects.toThrow();
    const returning = await begin(account.id);
    expect(new URL(returning.authorization).searchParams.has("id_token_hint")).toBe(false);
    expect(new URL(returning.authorization).searchParams.get("client_id")).toBe(clientId);
  });
  it("warns when local disconnect cannot confirm remote revocation", async () => {
    const account = await connected(); revokeFails = true;
    expect((await Effect.runPromise(service.updateConnection(user, "disconnect", account.id))).message).toContain("not confirmed");
    expect((await store.loadAccounts(user)).accounts[0]!.tokens).toBeUndefined();
  });
});

describe("subscription SDK inference", () => {
  it("uses only the selected OAuth token, streams Responses, and validates completed output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "must-not-be-used"); vi.stubEnv("OPENAI_BASE_URL", "https://wrong.test");
    const input = await ready();
    const { evaluateWithChatGPT } = await import("./inference");
    const result = await Effect.runPromise(evaluateWithChatGPT(user, input));
    expect(result.result).toEqual(fixtureResult);
    expect(result.source).toBe("local-chatgpt-subscription");
    expect(lastAuthorization).toBe("Bearer access-1");
    expect(lastInference.store).toBe(false); expect(lastInference.stream).toBe(true);
    expect(Array.isArray(lastInference.input)).toBe(true); expect(lastInference.model).toBe("account-model");
    for (const field of ["temperature", "max_output_tokens", "previous_response_id", "background", "prompt", "conversation"]) expect(lastInference).not.toHaveProperty(field);
    expect(responses).toBe(1);
  });
  it.each(["interrupted", "subscription_sharing_usage_limit_exceeded"])("rejects %s streams and never returns partial results", async (failure) => {
    const input = await ready(); streamFailure = failure;
    const { evaluateWithChatGPT } = await import("./inference");
    await expect(Effect.runPromise(evaluateWithChatGPT(user, input))).rejects.toThrow(failure === "interrupted" ? "before completion" : "usage limit");
    expect(responses).toBe(1);
  });
  it("preserves provider eligibility failures without changing billing or retrying", async () => {
    const input = await ready(); apiStatus = 403;
    const { evaluateWithChatGPT } = await import("./inference");
    await expect(Effect.runPromise(evaluateWithChatGPT(user, input))).rejects.toMatchObject({ status: 403, code: "subscription_sharing_user_not_eligible", requestId: "test-request" });
    expect(responses).toBe(1);
  });
  it("rejects stale account/model choices before any inference", async () => {
    const input = await ready();
    const { evaluateWithChatGPT } = await import("./inference");
    await expect(Effect.runPromise(evaluateWithChatGPT(user, { ...input, connectionId: "a".repeat(64) }))).rejects.toThrow("account or model changed");
    expect(responses).toBe(0);
  });
});
