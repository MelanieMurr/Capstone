import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { evaluationNotes, fixtureResult } from "./evaluation";
import { evaluateWithLocalCodex } from "./local-codex";
vi.mock("./local-codex", () => ({ evaluateWithLocalCodex: vi.fn() }));
const provider = vi.mocked(evaluateWithLocalCodex);
beforeEach(() => { vi.resetModules(); vi.stubEnv("NODE_ENV", "development"); });
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });
const request = (url = "http://localhost:3000/api/prototypes/ai", headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ notes: evaluationNotes, prompt: "grounded" }) });
describe("local AI route boundaries", () => {
  it("does not execute the CLI in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("../../app/api/prototypes/ai/route");
    expect((await POST(request())).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects remote hosts and cross-origin requests before execution", async () => {
    const { POST } = await import("../../app/api/prototypes/ai/route");
    expect((await POST(request("https://example.com/api/prototypes/ai"))).status).toBe(403);
    expect((await POST(request(undefined, { Origin: "https://example.com" }))).status).toBe(403);
    expect((await POST(request(undefined, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects invalid data before execution", async () => {
    const { POST } = await import("../../app/api/prototypes/ai/route");
    expect((await POST(new Request("http://localhost/api/prototypes/ai", { method: "POST", body: "invalid" }))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("returns the subscription provider response without requiring any API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    provider.mockReturnValue(Effect.succeed({ result: fixtureResult, model: "Codex CLI default", usage: null, prompt: "grounded", source: "local-codex-cli", authentication: "chatgpt" }));
    const { POST } = await import("../../app/api/prototypes/ai/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).source).toBe("local-codex-cli");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("returns provider failures with no substitute fixture or API request", async () => {
    provider.mockReturnValue(Effect.fail(new Error("Codex subscription limit")));
    const { POST } = await import("../../app/api/prototypes/ai/route");
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Codex subscription limit" });
  });
});
