import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { readJSON } from "./http";
function streamed(chunks: string[], onCancel?: () => void) {
  const encoder = new TextEncoder(); let index = 0;
  return new Request("http://localhost/api/test", { method: "POST", body: new ReadableStream({
    pull(controller) { if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++])); else controller.close(); },
    cancel() { onCancel?.(); },
  }, { highWaterMark: 0 }), duplex: "half" } as RequestInit);
}
describe("bounded JSON request parsing", () => {
  it("parses valid chunked JSON with split UTF-8 bytes", async () => {
    const bytes = new TextEncoder().encode('{"text":"é"}');
    const request = new Request("http://localhost", { method: "POST", body: new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), duplex: "half" } as RequestInit);
    expect(await Effect.runPromise(readJSON(request, bytes.length))).toEqual({ text: "é" });
  });
  it("rejects oversized declared lengths before reading", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "{}", headers: { "Content-Length": "100" } });
    await expect(Effect.runPromise(readJSON(request, 20))).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });
  it("stops and cancels oversized chunked bodies even without a length header", async () => {
    let cancelled = false;
    const request = streamed(['{"text":"', 'a'.repeat(40), 'more data'], () => { cancelled = true; });
    await expect(Effect.runPromise(readJSON(request, 20))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it("counts bytes rather than characters", async () => {
    await expect(Effect.runPromise(readJSON(streamed(['"ééé"']), 6))).rejects.toMatchObject({ status: 413 });
  });
  it.each(['{"missing":', 'not JSON', ''])("rejects invalid JSON: %s", async (body) => {
    await expect(Effect.runPromise(readJSON(new Request("http://localhost", { method: "POST", body })))).rejects.toMatchObject({ status: 400 });
  });
});
