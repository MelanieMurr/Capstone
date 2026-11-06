import { Effect } from "effect";
import * as Y from "yjs";
import type { BoardDocument } from "../board/model.ts";
import { applyChanges, readBoard, writeBoard } from "./shared-board.ts";
import { persistBoard, restoreBoard } from "./persistence.ts";
import type { Command } from "./recovery.ts";

export type StoredBoard = { snapshot: unknown; yjsState: string | null; revision: number; canEdit: boolean; user: { id: string; name: string } };
export type DistributedStore = {
  load: (token: string, boardId: string) => Promise<StoredBoard>;
  commit: (token: string, boardId: string, revision: number, value: { snapshot: BoardDocument; yjsState: string }) => Promise<boolean>;
};
export class BoardAccessError extends Error {}
export class BoardBusyError extends Error {}
const attempt = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: work, catch: (error) => error instanceof Error ? error : new Error("Shared board request failed.") });
const run = Effect.runPromise;

/** A connection-local view, never an authoritative room. PostgreSQL owns revision order. */
export function openDistributedBoard(store: DistributedStore, token: string, boardId: string) {
  return attempt(async () => {
    // Give legacy JSON boards one durable Yjs identity before independent readers join.
    let saved = await store.load(token, boardId);
    for (let retry = 0; saved.yjsState === null; retry++) {
      if (retry >= 8) throw new BoardBusyError("Board is busy. Reconnecting…");
      if (!saved.canEdit) break; // A viewer can read legacy content; cannot migrate it.
      const seed = await run(restoreBoard(boardId, saved.snapshot, null));
      try { await store.commit(token, boardId, saved.revision, await run(persistBoard(seed, boardId))); }
      finally { seed.destroy(); }
      saved = await store.load(token, boardId);
    }
    let doc = await run(restoreBoard(boardId, saved.snapshot, saved.yjsState));
    let revision = saved.revision, editable = saved.canEdit, closed = false, resetDocument = false;
    const user = saved.user;
    const ownOrigin = {};
    let undo = new Y.UndoManager(doc.getMap("objects"), { trackedOrigins: new Set([ownOrigin]) });
    function disposeHistory() { undo.destroy(); doc.destroy(); }
    async function replace(value: StoredBoard) {
      const replacement = await run(restoreBoard(boardId, value.snapshot, value.yjsState));
      disposeHistory(); doc = replacement;
      undo = new Y.UndoManager(doc.getMap("objects"), { trackedOrigins: new Set([ownOrigin]) });
      revision = value.revision; editable = value.canEdit; resetDocument = true;
    }
    async function refresh(value: StoredBoard) {
      if (closed) throw new Error("Connection closed.");
      if (value.user.id !== user.id) throw new BoardAccessError("Board identity changed.");
      if (value.revision !== revision) {
        // Legacy seed IDs differ between readers. Adopt the first durable seed exactly.
        if (saved.yjsState === null && value.yjsState !== null) await replace(value);
        else {
          const remote = await run(restoreBoard(boardId, value.snapshot, value.yjsState));
          try { Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "remote"); }
          finally { remote.destroy(); }
        }
      }
      revision = value.revision; editable = value.canEdit; saved = value;
    }
    const state = (extra: Record<string, unknown> = {}) => {
      const reset = resetDocument; resetDocument = false;
      return { type: "state" as const,
      update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"), canEdit: editable,
      canUndo: editable && undo.canUndo(), canRedo: editable && undo.canRedo(), ...(reset ? { resetDocument: true } : {}), ...extra };
    };
    return {
      user,
      initial: (pending: string[]) => state({ historyReset: true, settled: pending.filter((id) => doc.getMap<string>("receipts").get(id) === user.id) }),
      poll: () => attempt(async () => {
        const latest = await store.load(token, boardId);
        const changed = latest.revision !== revision || latest.canEdit !== editable;
        await refresh(latest); return changed ? state() : null;
      }),
      command: (command: Command) => attempt(async () => {
        let undoUpdate: Uint8Array | undefined;
        for (let retry = 0; retry < 8; retry++) {
          const latest = await store.load(token, boardId);
          await refresh(latest);
          if (!latest.canEdit) throw new BoardAccessError("You no longer have edit access.");
          if (command.type === "capture") { undo.stopCapturing(); return state({ requestId: command.requestId }); }
          const receipt = doc.getMap<string>("receipts").get(command.requestId);
          if (receipt) {
            if (receipt !== user.id) throw new BoardAccessError("Request identity mismatch.");
            // A second instance may have committed the same undo while our CAS waited.
            if (undoUpdate) await replace(latest);
            return state({ requestId: command.requestId, ...(undoUpdate ? { historyReset: true } : {}) });
          }
          if (command.type !== "edit" && !undoUpdate) {
            const vector = Y.encodeStateVector(doc);
            if (command.type === "undo") undo.undo(); else undo.redo();
            undoUpdate = Y.encodeStateAsUpdate(doc, vector);
          }
          const candidate = await run(restoreBoard(boardId, latest.snapshot, latest.yjsState));
          try {
            const vector = Y.encodeStateVector(candidate);
            if (command.type === "edit") await run(applyChanges(candidate, boardId, command.changes, "candidate"));
            else Y.applyUpdate(candidate, undoUpdate!, "undo-candidate");
            // Keep connector cleanup and validation identical to the existing service.
            await run(writeBoard(candidate, await run(readBoard(candidate, boardId)), "reconcile"));
            candidate.getMap<string>("receipts").set(command.requestId, user.id);
            const value = await run(persistBoard(candidate, boardId));
            if (!await store.commit(token, boardId, latest.revision, value)) continue;
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(candidate, vector), command.type === "edit" ? ownOrigin : "committed");
            revision = latest.revision + 1; saved = { ...latest, ...value, revision };
            return state({ requestId: command.requestId });
          } finally { candidate.destroy(); }
        }
        // A reconnect checks durable receipts before retrying, including ambiguous saves.
        throw new BoardBusyError("Board is busy. Reconnecting with unsent edits retained…");
      }),
      close: () => { if (!closed) { closed = true; disposeHistory(); } },
    };
  });
}
export type DistributedBoard = Effect.Success<ReturnType<typeof openDistributedBoard>>;
