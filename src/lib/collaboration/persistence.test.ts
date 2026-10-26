import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Y from "yjs";
import { boardDocumentSchema } from "../board/model";
import { connectObjects, deleteObject } from "../board/operations";
import { applyChanges, readBoard } from "./shared-board";
import { decodeState, persistBoard, restoreBoard } from "./persistence";
const id = "80000000-0000-4000-8000-000000000001", note = "80000000-0000-4000-8000-000000000002", shape = "80000000-0000-4000-8000-000000000003";
const text = "80000000-0000-4000-8000-000000000004";
const run = <A,>(p: Effect.Effect<A, Error>) => Effect.runSync(p);
const fixture = () => run(connectObjects(boardDocumentSchema.parse({ schemaVersion: 1, boardId: id, objects: [
  { id: note, type: "sticky-note", text: "Unicode 🌱\nA note", x: 150, y: -20, width: 240, height: 170 },
  { id: shape, type: "shape", shapeType: "ellipse", text: "Shape label", x: 600, y: 240, rotation: 30 },
  { id: text, type: "text", content: "Standalone", fontSize: 28, x: -70, y: 300 },
] }), note, shape));
describe("binary board persistence", () => {
  it("restores all object types, identities, geometry, labels and relationships without a JSON snapshot", () => {
    const doc = run(restoreBoard(id, fixture(), null)); const before = run(readBoard(doc, id));
    const stored = run(persistBoard(doc, id)), vector = Y.encodeStateVector(doc); doc.destroy();
    const reopened = run(restoreBoard(id, null, stored.yjsState));
    expect(run(readBoard(reopened, id))).toEqual(before);
    expect(Y.encodeStateVector(reopened)).toEqual(vector); reopened.destroy();
  });
  it("retains Yjs struct identities and deletion history across saves, rather than reseeding maps", () => {
    const doc = run(restoreBoard(id, fixture(), null));
    const replica = new Y.Doc({ gc: false }); Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    const removed = run(deleteObject(run(readBoard(doc, id)), text));
    run(applyChanges(doc, id, [{ kind: "delete", id: text }], "delete"));
    const original = run(persistBoard(doc, id)); doc.destroy();
    const reopened = run(restoreBoard(id, fixture(), original.yjsState)); // A stale snapshot must not win.
    expect(run(readBoard(reopened, id))).toEqual(removed);
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(replica)); // Old replica must not resurrect deleted text.
    expect(run(readBoard(reopened, id)).objects.some((o) => o.id === text)).toBe(false);
    const vector = Y.encodeStateVector(reopened);
    run(applyChanges(reopened, id, [{ kind: "patch", id: note, patch: { x: 340 } }], "move"));
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(reopened, vector));
    expect(run(readBoard(replica, id))).toEqual(run(readBoard(reopened, id)));
    reopened.destroy(); replica.destroy();
  });
  it("uses binary as authoritative even when the snapshot is absent or stale", () => {
    const doc = run(restoreBoard(id, fixture(), null)); const stored = run(persistBoard(doc, id)); doc.destroy();
    const restored = run(restoreBoard(id, { invalid: true }, stored.yjsState));
    expect(run(readBoard(restored, id))).toEqual(stored.snapshot); restored.destroy();
  });
  it("fails clearly on corrupt, truncated, or mismatched binary without falling back to JSON", () => {
    for (const bad of ["", "\\x", "\\x0", "\\xzz", "\\xff", "\\x0000"]) expect(() => run(restoreBoard(id, fixture(), bad))).toThrow();
    const doc = run(restoreBoard(id, fixture(), null)); const stored = run(persistBoard(doc, id)); doc.destroy();
    expect(() => run(restoreBoard(note, fixture(), stored.yjsState))).toThrow("restore");
    expect(() => run(decodeState("\\x" + "00".repeat(10 * 1024 * 1024 + 1)))).toThrow("too large");
  });
  it("continues accepting edits after several full binary restoration cycles", () => {
    const initial = run(restoreBoard(id, fixture(), null));
    let stored = run(persistBoard(initial, id)); initial.destroy();
    for (let i = 0; i < 3; i++) {
      const doc = run(restoreBoard(id, null, stored.yjsState));
      run(applyChanges(doc, id, [{ kind: "patch", id: note, patch: { text: `Cycle ${i}` } }], "edit"));
      stored = run(persistBoard(doc, id)); doc.destroy();
    }
    expect(stored.snapshot.objects.find((o) => o.id === note)).toMatchObject({ text: "Cycle 2" });
  });
});
