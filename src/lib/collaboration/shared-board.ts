import { Effect } from "effect";
import * as Y from "yjs";
import { z } from "zod";
import { boardDocumentSchema, boardObjectSchema } from "../board/model.ts";
import type { BoardDocument, BoardObject } from "../board/model.ts";

export const changeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("create"), object: boardObjectSchema }),
  z.strictObject({ kind: z.literal("patch"), id: z.uuid(), patch: z.record(z.string(), z.unknown()) }),
  z.strictObject({ kind: z.literal("delete"), id: z.uuid() }),
]);
export type Change = z.infer<typeof changeSchema>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const safe = <A>(work: () => A) => Effect.try({ try: work, catch: () => new Error("Invalid shared-board operation.") });

function clean(boardId: string, objects: BoardObject[]): BoardDocument {
  const targets = new Set(objects.filter((o) => o.type !== "connector").map((o) => o.id));
  return boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: objects.filter((o) => o.type !== "connector" ||
    [o.start, o.end].every((end) => end.kind === "free" || targets.has(end.objectId))) });
}
function rawObjects(doc: Y.Doc): BoardObject[] {
  return [...doc.getMap<Y.Map<unknown>>("objects")].map(([id, map]) => {
    if (!(map instanceof Y.Map) || map.get("id") !== id) throw new Error("Invalid shared object.");
    return boardObjectSchema.parse(map.toJSON());
  }).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}
export const readBoard = (doc: Y.Doc, boardId: string) => safe(() => clean(boardId, rawObjects(doc)));

// Compare the snapshot that an operation STARTED with to its proposed result.
// Do not compare a stale result with a newer remote snapshot.
export const changesBetween = (before: BoardDocument, after: BoardDocument) => safe(() => {
  boardDocumentSchema.parse(before); boardDocumentSchema.parse(after);
  if (before.boardId !== after.boardId) throw new Error("Board mismatch.");
  const old = new Map(before.objects.map((o) => [o.id, o]));
  const next = new Map(after.objects.map((o) => [o.id, o]));
  const changes: Change[] = [];
  for (const id of old.keys()) if (!next.has(id)) changes.push({ kind: "delete", id });
  for (const object of after.objects) {
    const previous = old.get(object.id);
    if (!previous) { changes.push({ kind: "create", object }); continue; }
    if (previous.type !== object.type) throw new Error("Object types are immutable.");
    const patch = Object.fromEntries(Object.entries(object).filter(([key, value]) => key !== "id" && key !== "type" && !same(value, previous[key as keyof BoardObject])));
    if (Object.keys(patch).length) changes.push({ kind: "patch", id: object.id, patch });
  }
  return changes;
});

// This also supplies the browser's optimistic preview while a request is pending.
export const projectChanges = (board: BoardDocument, input: Change[]) => safe(() => {
  const changes = z.array(changeSchema).max(2000).parse(input);
  const objects = new Map(board.objects.map((o) => [o.id, o]));
  for (const change of changes) {
    if (change.kind === "delete") objects.delete(change.id);
    else if (change.kind === "create") {
      if (objects.has(change.object.id)) throw new Error("Duplicate object ID.");
      objects.set(change.object.id, change.object);
    } else {
      if ("id" in change.patch || "type" in change.patch) throw new Error("Immutable identity.");
      const previous = objects.get(change.id);
      // A late edit must not resurrect an object another user deleted.
      if (previous) objects.set(change.id, boardObjectSchema.parse({ ...previous, ...change.patch }));
    }
  }
  return clean(board.boardId, [...objects.values()]);
});

export const writeBoard = (doc: Y.Doc, next: BoardDocument, origin: unknown) => safe(() => {
  boardDocumentSchema.parse(next);
  const metadata = doc.getMap("board");
  if (metadata.has("boardId") && metadata.get("boardId") !== next.boardId) throw new Error("Board mismatch.");
  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const ids = new Set(next.objects.map((o) => o.id));
  doc.transact(() => {
    if (metadata.get("boardId") !== next.boardId) metadata.set("boardId", next.boardId);
    if (metadata.get("schemaVersion") !== 1) metadata.set("schemaVersion", 1);
    for (const id of objects.keys()) if (!ids.has(id)) objects.delete(id);
    for (const object of next.objects) {
      let map = objects.get(object.id);
      if (!map) { map = new Y.Map<unknown>(); objects.set(object.id, map); }
      for (const [key, value] of Object.entries(object)) if (!same(map.get(key), value)) map.set(key, value);
    }
  }, origin);
});

export const applyChanges = (doc: Y.Doc, boardId: string, changes: Change[], origin: unknown) => Effect.gen(function* () {
  const before = yield* readBoard(doc, boardId);
  const next = yield* projectChanges(before, changes);
  yield* writeBoard(doc, next, origin);
  return next;
});
