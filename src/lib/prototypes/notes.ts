import { Effect } from "effect";
import * as Y from "yjs";
import { stickyNoteSchema } from "../board/model";
import type { StickyNote } from "../board/model";

export function readNotes(doc: Y.Doc): StickyNote[] {
  const result: StickyNote[] = [];
  doc.getMap<Y.Map<unknown>>("objects").forEach((map, id) => {
    if (!(map instanceof Y.Map)) return;
    const raw = map.toJSON();
    // Strip the grouped Yjs fields before strict validation.
    const { position, size, ...properties } = raw;
    const note = stickyNoteSchema.safeParse({ ...properties, id, ...position, ...size });
    if (note.success) result.push(note.data);
  });
  return result.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}

export function writeNote(doc: Y.Doc, input: unknown) {
  return Effect.try({
    try: () => {
      const note = stickyNoteSchema.parse(input);
      const { x, y, width, height, ...properties } = note;
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries({ ...properties, position: { x, y }, size: { width, height } })) map.set(key, value);
      doc.getMap<Y.Map<unknown>>("objects").set(note.id, map);
      return note.id;
    },
    catch: () => new Error("The note is invalid. Check its size, text, and color."),
  });
}

export function patchNote(doc: Y.Doc, id: string, patch: Partial<StickyNote>) {
  return Effect.try({
    try: () => {
      const previous = readNotes(doc).find((note) => note.id === id);
      const map = doc.getMap<Y.Map<unknown>>("objects").get(id);
      if (!previous || !map) throw new Error("This note was deleted.");
      const next = stickyNoteSchema.parse({ ...previous, ...patch, id, type: "sticky-note" });
      doc.transact(() => {
        if (next.x !== previous.x || next.y !== previous.y) map.set("position", { x: next.x, y: next.y });
        if (next.width !== previous.width || next.height !== previous.height) map.set("size", { width: next.width, height: next.height });
        for (const key of ["text", "backgroundColor", "rotation", "zIndex"] as const) {
          if (next[key] !== previous[key]) map.set(key, next[key]);
        }
      });
    },
    catch: () => new Error("Could not update the note. It may have been deleted or contain invalid values."),
  });
}

export const deleteNote = (doc: Y.Doc, id: string) => Effect.sync(() => {
  doc.getMap("objects").delete(id);
});
