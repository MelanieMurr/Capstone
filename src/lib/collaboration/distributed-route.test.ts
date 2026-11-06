import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), upgrade: vi.fn(), store: vi.fn() }));
vi.mock("@vercel/functions", () => ({ upgradeWebSocket: mocks.upgrade }));
vi.mock("../foundation/services", () => ({ authenticated: mocks.authenticated }));
vi.mock("../supabase/server", () => ({ supabaseServer: async () => ({}) }));
vi.mock("./distributed-store", () => ({ distributedSupabaseStore: mocks.store }));
import { Effect } from "effect";
import { GET } from "../../app/api/boards/sync/route";
import { AppError } from "../foundation/contracts";
const request = (headers: Record<string, string> = {}) => new Request("https://canvas.example/api/boards/sync", { headers: { host: "canvas.example", origin: "https://canvas.example", upgrade: "websocket", ...headers } });
beforeEach(() => { vi.clearAllMocks(); mocks.authenticated.mockReturnValue(Effect.succeed({ id: "user" })); mocks.upgrade.mockResolvedValue(new Response(null, { status: 204 })); mocks.store.mockReturnValue({}); });
describe("Vercel WebSocket upgrade boundary", () => {
  it("requires an actual upgrade", async () => {
    expect((await GET(request({ upgrade: "http" }))).status).toBe(426); expect(mocks.upgrade).not.toHaveBeenCalled();
  });
  it("rejects missing and foreign origins before allocating sockets", async () => {
    expect((await GET(request({ origin: "https://attacker.example" }))).status).toBe(403);
    expect((await GET(request({ origin: "" }))).status).toBe(403); expect(mocks.upgrade).not.toHaveBeenCalled();
  });
  it("requires CoCanvas authentication before upgrading", async () => {
    mocks.authenticated.mockReturnValue(Effect.fail(new AppError("Sign in required", 401)));
    expect((await GET(request())).status).toBe(401); expect(mocks.upgrade).not.toHaveBeenCalled();
  });
  it("upgrades authenticated same-origin requests with a bounded payload", async () => {
    expect((await GET(request())).status).toBe(204); expect(mocks.upgrade).toHaveBeenCalledWith(expect.any(Function), { maxPayload: 256 * 1024 });
  });
  it("returns a recoverable unavailable response when the runtime cannot upgrade", async () => {
    mocks.upgrade.mockRejectedValue(new Error("Unsupported runtime details"));
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("Unsupported runtime details");
  });
});
