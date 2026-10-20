import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import * as Y from "yjs";
import { deleteNote, patchNote, readNotes, writeNote } from "./notes";
const id = "30000000-0000-4000-8000-000000000001";
describe("prototype notes", () => {
  it("validates edits and supports creation and deletion", () => {
    const doc = new Y.Doc();
    try {
      Effect.runSync(writeNote(doc, { id, type: "sticky-note", text: "Initial" }));
      Effect.runSync(patchNote(doc, id, { x: 125, width: 320, text: "Edited" }));
      expect(readNotes(doc)[0]).toMatchObject({ id, x: 125, width: 320, text: "Edited" });
      const before = JSON.stringify(readNotes(doc));
      const failed = Effect.runSync(Effect.match(patchNote(doc, id, { width: -1 }), { onFailure: () => true, onSuccess: () => false }));
      expect(failed).toBe(true);
      expect(JSON.stringify(readNotes(doc))).toBe(before);
      Effect.runSync(deleteNote(doc, id));
      expect(readNotes(doc)).toEqual([]);
    } finally { doc.destroy(); }
  });
  it("preserves concurrent changes to separate notes and separate fields on one note", () => {
    const alice = new Y.Doc(), bob = new Y.Doc();
    const secondId = "30000000-0000-4000-8000-000000000002";
    try {
      Effect.runSync(writeNote(alice, { id, type: "sticky-note", text: "One" }));
      Effect.runSync(writeNote(alice, { id: secondId, type: "sticky-note", text: "Two" }));
      Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
      Effect.runSync(patchNote(alice, id, { x: 200, y: 90 }));
      Effect.runSync(patchNote(bob, id, { text: "Bob text" }));
      Effect.runSync(patchNote(bob, secondId, { width: 300 }));
      const a = Y.encodeStateAsUpdate(alice), b = Y.encodeStateAsUpdate(bob);
      Y.applyUpdate(alice, b); Y.applyUpdate(bob, a);
      expect(readNotes(alice)).toEqual(readNotes(bob));
      expect(readNotes(alice).find((item) => item.id === id)).toMatchObject({ x: 200, y: 90, text: "Bob text" });
      expect(readNotes(alice).find((item) => item.id === secondId)?.width).toBe(300);
      Effect.runSync(deleteNote(alice, id));
      Effect.runSync(patchNote(bob, id, { text: "Late edit" }));
      const deleted = Y.encodeStateAsUpdate(alice), edited = Y.encodeStateAsUpdate(bob);
      Y.applyUpdate(alice, edited); Y.applyUpdate(bob, deleted);
      expect(readNotes(alice).some((note) => note.id === id)).toBe(false);
      expect(readNotes(alice)).toEqual(readNotes(bob));
    } finally { alice.destroy(); bob.destroy(); }
  });
});
