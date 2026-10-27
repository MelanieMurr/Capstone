import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { reconnectDelay, recoverCommands } from "./recovery";
import type { Command } from "./recovery";
const edit: Command = { type: "edit", requestId: "edit", changes: [] };
const undo: Command = { type: "undo", requestId: "undo" };
const capture: Command = { type: "capture", requestId: "capture" };
describe("reconnection recovery", () => {
  it("removes saved requests before replaying optimistic changes", () => {
    expect(Effect.runSync(recoverCommands([edit, undo, capture], ["edit"], false, true))).toEqual({ pending: [undo], notice: "" });
  });
  it("keeps unacknowledged edits and explains a lost server undo stack", () => {
    const recovered = Effect.runSync(recoverCommands([edit, undo], [], true, true));
    expect(recovered.pending).toEqual([edit]); expect(recovered.notice).toContain("Pending undo/redo");
  });
  it("does not replay a draft after edit permission is removed", () => {
    expect(() => Effect.runSync(recoverCommands([edit], [], false, false))).toThrow("retained for export");
    expect(Effect.runSync(recoverCommands([edit], ["edit"], false, false)).pending).toEqual([]);
  });
  it("backs off and caps retries instead of spinning", () => {
    expect([0, 1, 2, 50].map(reconnectDelay)).toEqual([500, 1000, 2000, 15000]);
  });
});
