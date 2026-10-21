"use client";
import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import Workspace from "../workspace";
import type { BoardDocument } from "../../lib/board/model";
export default function SavedBoard({ id, title, document, revision, canEdit }: { id: string; title: string; document: BoardDocument; revision: number; canEdit: boolean }) {
  const [status, setStatus] = useState(canEdit ? "Saved to your account" : "View-only board");
  const version = useRef(revision); const saving = useRef(false); const blocked = useRef(false);
  const pending = useRef<BoardDocument | null>(null); const last = useRef(JSON.stringify(document));
  const persist = useCallback((next: BoardDocument) => {
    if (!canEdit || JSON.stringify(next) === last.current) return;
    pending.current = next;
    if (saving.current || blocked.current) return;
    saving.current = true;
    void (async () => {
      while (pending.current && !blocked.current) {
        const snapshot = pending.current; pending.current = null; setStatus("Saving to your account…");
        await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
          const response = await fetch(`/api/boards/${id}/document`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: snapshot, revision: version.current }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save this board.");
          return result.revision as number;
        }, catch: (cause) => new Error(cause instanceof Error ? cause.message : "Could not save. Check your connection.") }), {
          onFailure: (cause) => { blocked.current = true; setStatus(`Not saved: ${cause.message} Export a copy before reloading.`); },
          onSuccess: (value) => { version.current = value; last.current = JSON.stringify(snapshot); setStatus("Saved to your account"); },
        }));
      }
      saving.current = false;
    })();
  }, [id, canEdit]);
  return <Workspace initialDocument={document} identity={{ id, title }} onDocumentChange={persist} readOnly={!canEdit} remoteStatus={status} />;
}
