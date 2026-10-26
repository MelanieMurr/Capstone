import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Y from "yjs";
import { boardDocumentSchema } from "../board/model";
import { connectObjects, deleteObject, patchObject } from "../board/operations";
import { applyChanges, changesBetween, readBoard, writeBoard } from "./shared-board";
const boardId = "50000000-0000-4000-8000-000000000001";
const noteId = "50000000-0000-4000-8000-000000000002";
const shapeId = "50000000-0000-4000-8000-000000000003";
const run = <A,>(program: Effect.Effect<A, Error>) => Effect.runSync(program);
const board = () => boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [
  { id: noteId, type: "sticky-note", text: "Hello", x: 10 },
  { id: shapeId, type: "shape", text: "A shape" },
] });
function seeded() { const doc = new Y.Doc(); run(writeBoard(doc, board(), "seed")); return doc; }
describe("shared board", () => {
  it("round-trips the existing board model into nested maps", () => {
    const doc = seeded(); expect(run(readBoard(doc, boardId))).toEqual(board());
    expect(doc.getMap("objects").get(noteId)).toBeInstanceOf(Y.Map); doc.destroy();
  });
  it("sends only fields the user actually changed", () => {
    const before = board(); const next = run(patchObject(before, noteId, { x: 180 }));
    expect(run(changesBetween(before, next))).toEqual([{ kind: "patch", id: noteId, patch: { x: 180 } }]);
  });
  it("preserves another user's text when applying a move from a stale snapshot", () => {
    const doc = seeded(); const before = board();
    run(applyChanges(doc, boardId, [{ kind: "patch", id: noteId, patch: { text: "Remote text" } }], "alice"));
    const moved = run(patchObject(before, noteId, { x: 250, width: 340 }));
    run(applyChanges(doc, boardId, run(changesBetween(before, moved)), "bob"));
    expect(run(readBoard(doc, boardId)).objects[0]).toMatchObject({ text: "Remote text", x: 250, width: 340 }); doc.destroy();
  });
  it("deletes attachments and never resurrects a deleted target from a late patch", () => {
    const doc = seeded(); const linked = run(connectObjects(board(), noteId, shapeId));
    run(writeBoard(doc, linked, "link"));
    const removed = run(deleteObject(linked, noteId));
    run(applyChanges(doc, boardId, run(changesBetween(linked, removed)), "delete"));
    run(applyChanges(doc, boardId, [{ kind: "patch", id: noteId, patch: { text: "Too late" } }], "late"));
    expect(run(readBoard(doc, boardId)).objects.map((o) => o.id)).toEqual([shapeId]); doc.destroy();
  });
  it("rejects invalid edits before touching shared state", () => {
    const doc = seeded();
    for (const patch of [{ width: -3 }, { id: shapeId }, { type: "shape" }, { unexpected: true }]) {
      expect(() => run(applyChanges(doc, boardId, [{ kind: "patch", id: noteId, patch }], "invalid"))).toThrow();
    }
    expect(run(readBoard(doc, boardId))).toEqual(board()); doc.destroy();
  });
  it("delivers an incremental update without replacing the whole document", () => {
    const server = seeded(), browser = new Y.Doc(); Y.applyUpdate(browser, Y.encodeStateAsUpdate(server));
    const vector = Y.encodeStateVector(browser);
    run(applyChanges(server, boardId, [{ kind: "patch", id: noteId, patch: { text: "Changed" } }], "edit"));
    const update = Y.encodeStateAsUpdate(server, vector); Y.applyUpdate(browser, update); Y.applyUpdate(browser, update);
    expect(run(readBoard(browser, boardId))).toEqual(run(readBoard(server, boardId))); server.destroy(); browser.destroy();
  });
  it("scopes undo to a connection's changes", () => {
    const doc = seeded(), alice = {}, bob = {};
    const undo = new Y.UndoManager(doc.getMap("objects"), { trackedOrigins: new Set([alice]) });
    run(applyChanges(doc, boardId, [{ kind: "patch", id: noteId, patch: { x: 80 } }], alice));
    run(applyChanges(doc, boardId, [{ kind: "patch", id: noteId, patch: { text: "Bob's text" } }], bob));
    undo.undo(); expect(run(readBoard(doc, boardId)).objects[0]).toMatchObject({ x: 10, text: "Bob's text" }); undo.destroy(); doc.destroy();
  });
});
