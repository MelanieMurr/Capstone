import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../foundation/contracts";
import { authenticated } from "../../foundation/services";
import { supabaseServer } from "../../supabase/server";
import { beginConnection, finishConnection } from "./oauth";
import { connectionStatus, availableModels, selectModel, updateConnection } from "./service";
import { GET, POST } from "../../../app/api/chatgpt/route";
import { GET as callback } from "../../../app/auth/callback/route";

const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("../../foundation/services", () => ({ authenticated: vi.fn() }));
vi.mock("../../supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("./oauth", () => ({ beginConnection: vi.fn(), finishConnection: vi.fn(), OAUTH_COOKIE: "cocanvas_chatgpt_oauth" }));
vi.mock("./service", () => ({ connectionStatus: vi.fn(), availableModels: vi.fn(), selectModel: vi.fn(), updateConnection: vi.fn() }));
const user = "30000000-0000-4000-8000-000000000001";
const request = (data?: unknown, origin = "http://127.0.0.1:3000") => new Request(`${origin}/api/chatgpt`, data ? { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data) } : {});
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.mocked(supabaseServer).mockResolvedValue({} as Awaited<ReturnType<typeof supabaseServer>>);
  vi.mocked(authenticated).mockReturnValue(Effect.succeed({ id: user } as Awaited<ReturnType<Awaited<ReturnType<typeof supabaseServer>>["auth"]["getUser"]>>["data"]["user"] & {}));
  vi.mocked(connectionStatus).mockReturnValue(Effect.succeed({ activeId: null, accounts: [] }));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("local subscription route access", () => {
  it("requires verified CoCanvas authentication before reading or connecting subscriptions", async () => {
    vi.mocked(authenticated).mockReturnValue(Effect.fail(new AppError("Please sign in.", 401)));
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request({ action: "connect", returnTo: "/dashboard" }))).status).toBe(401);
    expect(beginConnection).not.toHaveBeenCalled(); expect(connectionStatus).not.toHaveBeenCalled();
  });
  it("rejects production, remote URL/Host and cross-origin mutations before auth or disk access", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    expect((await GET(request(undefined, "https://example.test"))).status).toBe(403);
    const host = request(); host.headers.set("host", "example.test");
    expect((await GET(host)).status).toBe(403);
    const cross = request({ action: "welcome" }); cross.headers.set("origin", "https://example.test");
    expect((await POST(cross)).status).toBe(403);
    expect(authenticated).not.toHaveBeenCalled(); expect(connectionStatus).not.toHaveBeenCalled();
  });
  it("binds starts to a verified user and an HttpOnly, Lax, short-lived callback cookie", async () => {
    vi.mocked(beginConnection).mockReturnValue(Effect.succeed({ authorization: "https://auth.openai.com/api/accounts/authorize", state: "pending-state" }));
    const response = await POST(request({ action: "connect", returnTo: "/dashboard" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(beginConnection).toHaveBeenCalledWith(user, "http://127.0.0.1:3000", "/dashboard", undefined, undefined);
    expect(jar.set).toHaveBeenCalledWith("cocanvas_chatgpt_oauth", "pending-state", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/auth/callback", maxAge: 600 }));
    expect(await response.json()).toEqual({ authorization: "https://auth.openai.com/api/accounts/authorize" });
  });
  it("rejects oversized bodies before a connection begins", async () => {
    expect((await POST(new Request("http://127.0.0.1:3000/api/chatgpt", { method: "POST", body: "x".repeat(2001) }))).status).toBe(413);
    expect(beginConnection).not.toHaveBeenCalled();
  });
  it("delegates account/model operations only for the authenticated user", async () => {
    vi.mocked(availableModels).mockReturnValue(Effect.succeed([]));
    expect((await GET(new Request("http://127.0.0.1:3000/api/chatgpt?models=1"))).status).toBe(200);
    expect(availableModels).toHaveBeenCalledWith(user);
    vi.mocked(selectModel).mockReturnValue(Effect.succeed({ model: "selected" }));
    await POST(request({ action: "model", model: "selected" }));
    expect(selectModel).toHaveBeenCalledWith(user, "selected");
    vi.mocked(updateConnection).mockReturnValue(Effect.succeed({ message: "done" }));
    await POST(request({ action: "disconnect", accountId: "account" }));
    expect(updateConnection).toHaveBeenCalledWith(user, "disconnect", "account");
  });
  it("removes the callback cookie at its original path, strips OAuth parameters, and disables caching/referrers", async () => {
    jar.get.mockReturnValue({ value: "browser-state" });
    vi.mocked(finishConnection).mockReturnValue(Effect.succeed({ returnTo: "/dashboard", status: "connected" }));
    const response = await callback(new Request("http://127.0.0.1:3000/auth/callback?code=private-code&state=browser-state"));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("http://127.0.0.1:3000/dashboard?chatgpt=connected");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(jar.set).toHaveBeenCalledWith("cocanvas_chatgpt_oauth", "", expect.objectContaining({ path: "/auth/callback", maxAge: 0 }));
  });
});
