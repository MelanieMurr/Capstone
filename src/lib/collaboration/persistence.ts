import { Effect } from "effect";
import * as Y from "yjs";
import { boardDocumentSchema } from "../board/model.ts";
import { readBoard, writeBoard } from "./shared-board.ts";

const MAX_BYTES = 10 * 1024 * 1024;
// PostgREST transports bytea as PostgreSQL hex; the column stores actual bytes.
export const decodeState = (value: unknown) => Effect.try({
  try: () => {
    if (typeof value !== "string" || value.length > 2 + MAX_BYTES * 2 || !/^\\x(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error();
    return Uint8Array.from(value.slice(2).match(/../g)!, (pair) => Number.parseInt(pair, 16));
  }, catch: () => new Error("The saved Yjs state is invalid or too large."),
});
export const persistBoard = (doc: Y.Doc, boardId: string) => Effect.gen(function* () {
  const snapshot = yield* readBoard(doc, boardId);
  const yjsState = yield* Effect.try({
    try: () => {
      const metadata = doc.getMap("board");
      if (metadata.get("boardId") !== boardId || metadata.get("schemaVersion") !== 1) throw new Error();
      const bytes = Y.encodeStateAsUpdate(doc);
      if (bytes.byteLength > MAX_BYTES) throw new Error();
      return "\\x" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }, catch: () => new Error("Could not encode the board's Yjs state within the storage limit."),
  });
  return { snapshot, yjsState };
});
export const restoreBoard = (boardId: string, snapshot: unknown, state: unknown) => Effect.gen(function* () {
  const doc = new Y.Doc({ gc: false });
  const program = Effect.gen(function* () {
    if (state === null || state === undefined) {
      const legacy = yield* Effect.try({
        try: () => boardDocumentSchema.parse(snapshot ?? { schemaVersion: 1, boardId, objects: [] }),
        catch: () => new Error("The saved board snapshot is invalid."),
      });
      if (legacy.boardId !== boardId) return yield* Effect.fail(new Error("Saved board identity mismatch."));
      yield* writeBoard(doc, legacy, "legacy-seed");
    } else {
      const update = yield* decodeState(state);
      yield* Effect.try({
        try: () => {
          Y.applyUpdate(doc, update, "restore");
          const metadata = doc.getMap("board");
          if (metadata.get("boardId") !== boardId || metadata.get("schemaVersion") !== 1) throw new Error();
          if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error();
        }, catch: () => new Error("Could not restore the saved Yjs document. No snapshot fallback was used."),
      });
    }
    yield* readBoard(doc, boardId);
    return doc;
  });
  return yield* Effect.catch(program, (error) => { doc.destroy(); return Effect.fail(error); });
});
