import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { boardDocumentSchema } from "../board/model";
import { openDistributedBoard, BoardAccessError, BoardBusyError } from "./distributed-board";
import type { DistributedStore } from "./distributed-board";
import { restoreBoard } from "./persistence";
import { readBoard } from "./shared-board";
const run = Effect.runPromise;
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
async function setup() {
  const boardId = randomUUID(), objectId = randomUUID(), alice = randomUUID(), bob = randomUUID();
  let stored = { snapshot: boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [{ id: objectId, type: "sticky-note", text: "Initial" }] }), revision: 0, yjsState: null as string | null };
  let conflicts = 0, reject = false, denied = false, editable = true, ambiguous = false;
  const store: DistributedStore = {
    async load(token) { if (denied) throw new BoardAccessError("Access ended"); return { ...structuredClone(stored), canEdit: editable, user: { id: token, name: token } }; },
    async commit(_token, _boardId, revision, value) {
      if (reject || revision !== stored.revision) { conflicts++; return false; }
      stored = { ...value, revision: revision + 1 };
      if (ambiguous) { ambiguous = false; throw new Error("Connection lost after save"); }
      return true;
    },
  };
  async function open(user = alice) { const connection = await run(openDistributedBoard(store, user, boardId)); cleanup.push(connection.close); return connection; }
  const edit = (patch: Record<string, unknown>, requestId = randomUUID()) => ({ type: "edit" as const, requestId, changes: [{ kind: "patch" as const, id: objectId, patch }] });
  return { boardId, objectId, alice, bob, store, open, edit, stored: () => stored, conflicts: () => conflicts,
    reject: () => { reject = true; }, deny: () => { denied = true; }, viewOnly: () => { editable = false; }, allowEdit: () => { editable = true; }, ambiguous: () => { ambiguous = true; } };
}
async function contents(f: Awaited<ReturnType<typeof setup>>) {
  const stored = f.stored(), doc = await run(restoreBoard(f.boardId, stored.snapshot, stored.yjsState));
  try { return await run(readBoard(doc, f.boardId)); } finally { doc.destroy(); }
}
describe("distributed Yjs board connections", () => {
  it("initializes a legacy board with one durable seed across simultaneous joins", async () => {
    const f = await setup(); await Promise.all([f.open(), f.open(f.bob)]);
    expect(f.stored().revision).toBe(1); expect((await contents(f)).objects).toHaveLength(1);
  });
  it("replaces an ephemeral viewer seed when the first durable Yjs state is saved", async () => {
    const f = await setup(); f.viewOnly(); const viewer = await f.open();
    expect(f.stored().yjsState).toBeNull(); f.allowEdit(); const editor = await f.open(f.bob);
    await run(editor.command(f.edit({ text: "Durable seed" }))); f.viewOnly();
    expect(await run(viewer.poll())).toMatchObject({ resetDocument: true, canEdit: false });
  });
  it("preserves distinct creations from six independent writers", async () => {
    const f = await setup(), connections = await Promise.all(Array.from({ length: 6 }, () => f.open()));
    const revision = f.stored().revision;
    await Promise.all(connections.map((connection, i) => run(connection.command({ type: "edit", requestId: randomUUID(), changes: [{ kind: "create", object: boardDocumentSchema.parse({ schemaVersion: 1, boardId: f.boardId, objects: [{ id: randomUUID(), type: "sticky-note", text: `Writer ${i}` }] }).objects[0]! }] }))));
    expect((await contents(f)).objects).toHaveLength(7); expect(f.stored().revision).toBe(revision + 6);
  });
  it("retries CAS collisions and converges across independent instances", async () => {
    const f = await setup(), a = await f.open(), b = await f.open(f.bob);
    await Promise.all([run(a.command(f.edit({ x: 120 }))), run(b.command(f.edit({ text: "Bob" })))]);
    expect(f.conflicts()).toBeGreaterThan(0);
    expect((await contents(f)).objects[0]).toMatchObject({ x: 120, text: "Bob" });
    expect(await run(a.poll())).not.toBeNull();
    expect((await run(b.poll()))?.type ?? "state").toBe("state");
  });
  it("undoes only the connection's changes after another user edits the same object", async () => {
    const f = await setup(), a = await f.open(), b = await f.open(f.bob);
    await run(a.command(f.edit({ x: 120 }))); await run(b.command(f.edit({ text: "Bob" })));
    await run(a.command({ type: "undo", requestId: randomUUID() }));
    expect((await contents(f)).objects[0]).toMatchObject({ x: 0, text: "Bob" });
    await run(a.command({ type: "redo", requestId: randomUUID() }));
    expect((await contents(f)).objects[0]).toMatchObject({ x: 120, text: "Bob" });
  });
  it("keeps a later remote edit to the same field when undoing", async () => {
    const f = await setup(), a = await f.open(), b = await f.open(f.bob);
    await run(a.command(f.edit({ x: 120 }))); await run(b.command(f.edit({ x: 240 })));
    await run(a.command({ type: "undo", requestId: randomUUID() }));
    expect((await contents(f)).objects[0]?.x).toBe(240);
  });
  it("retries undo against a simultaneous remote save without reverting remote text", async () => {
    const f = await setup(), a = await f.open(), b = await f.open(f.bob);
    await run(a.command(f.edit({ x: 120 })));
    await Promise.all([run(b.command(f.edit({ text: "Concurrent Bob" }))), run(a.command({ type: "undo", requestId: randomUUID() }))]);
    expect((await contents(f)).objects[0]).toMatchObject({ x: 0, text: "Concurrent Bob" });
  });
  it("does not apply the same command twice when two instances receive it", async () => {
    const f = await setup(), a = await f.open(), b = await f.open(); const command = f.edit({ x: 300 });
    const revision = f.stored().revision;
    await Promise.all([run(a.command(command)), run(b.command(command))]);
    expect(f.stored().revision).toBe(revision + 1); expect((await contents(f)).objects[0]?.x).toBe(300);
  });
  it("settles ambiguous saves after reconnect without replay and explains lost undo history", async () => {
    const f = await setup(), a = await f.open(), command = f.edit({ text: "Saved" }); f.ambiguous();
    await expect(run(a.command(command))).rejects.toThrow("Connection lost"); a.close();
    const resumed = await f.open();
    expect(resumed.initial([command.requestId])).toMatchObject({ historyReset: true, settled: [command.requestId], canUndo: false });
    const revision = f.stored().revision; await run(resumed.command(command)); expect(f.stored().revision).toBe(revision);
  });
  it("never silently overwrites a board after exhausting revision retries", async () => {
    const f = await setup(), a = await f.open(); f.reject();
    await expect(run(a.command(f.edit({ x: 55 })))).rejects.toBeInstanceOf(BoardBusyError);
    expect((await contents(f)).objects[0]?.x).toBe(0);
  });
  it("rejects revoked and view-only users without saving", async () => {
    const f = await setup(), a = await f.open(); const revision = f.stored().revision; f.viewOnly();
    expect(await run(a.poll())).toMatchObject({ canEdit: false });
    await expect(run(a.command(f.edit({ x: 50 })))).rejects.toBeInstanceOf(BoardAccessError);
    f.deny(); await expect(run(a.poll())).rejects.toBeInstanceOf(BoardAccessError); expect(f.stored().revision).toBe(revision);
  });
});
