"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { z } from "zod";
import { commentActionSchema, commentResponseSchema } from "../lib/comments/contracts";
import type { NoteComment } from "../lib/comments/contracts";
const errorMessage = (error: unknown) => error instanceof Error ? error : new Error("Comments are unavailable.");
export function commentRequest(path: string, input?: unknown, signal?: AbortSignal) {
  return Effect.tryPromise({ try: async () => {
    const response = await fetch(path, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      ...(input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not complete the comment request.");
    return body as unknown;
  }, catch: errorMessage });
}
export function useNoteComments(boardId?: string, noteId?: string) {
  const [comments, setComments] = useState<NoteComment[]>([]), [counts, setCounts] = useState<Record<string, number>>({});
  const [viewerId, setViewerId] = useState(""), [reviewerId, setReviewerId] = useState<string | null>(null);
  const [error, setError] = useState(""), [hasMore, setHasMore] = useState(false), [page, setPage] = useState(0);
  const refreshLatest = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { setPage(0); }, [boardId, noteId]);
  useEffect(() => { setCounts({}); }, [boardId]);
  useEffect(() => {
    setComments([]); setReviewerId(null); setError("");
    if (!boardId) { setCounts({}); return; }
    let active = true, running = false;
    const abort = new AbortController();
    const endpoint = `/api/boards/${boardId}/comments`;
    async function refresh() {
      if (running || !active) return; running = true;
      await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
        const overview = await Effect.runPromise(commentRequest(`${endpoint}?summary=1`, undefined, abort.signal));
        const parsed = z.object({ counts: z.record(z.uuid(), z.number().int().nonnegative()) }).parse(overview);
        const detail = noteId ? commentResponseSchema.parse(await Effect.runPromise(commentRequest(`${endpoint}?noteId=${noteId}&offset=${page * 100}`, undefined, abort.signal))) : null;
        if (!active) return;
        setCounts(parsed.counts); setComments(detail?.comments ?? []); setReviewerId(detail?.reviewerId ?? null);
        setViewerId(detail?.viewerId ?? ""); setHasMore(detail?.hasMore ?? false); setError("");
      }, catch: errorMessage }), { onSuccess: () => undefined, onFailure: (cause) => {
        if (active) { setCounts({}); setComments([]); setReviewerId(null); setError(cause.message); }
      } }));
      running = false;
    }
    refreshLatest.current = refresh; void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; abort.abort(); clearInterval(timer); };
  }, [boardId, noteId, page]);
  const submit = (input: unknown) => Effect.gen(function* () {
    if (!boardId) return yield* Effect.fail(new Error("Open a saved board to comment."));
    const action = yield* Effect.try({ try: () => commentActionSchema.parse(input), catch: () => new Error("Use a comment of 1–2,000 characters.") });
    yield* commentRequest(`/api/boards/${boardId}/comments`, action);
    yield* Effect.promise(() => refreshLatest.current());
  });
  return { comments, counts, viewerId, reviewerId, error, hasMore, page, setPage, submit };
}
export default function NoteComments({ noteId, model }: { noteId: string; model: ReturnType<typeof useNoteComments> }) {
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const pending = useRef<{ id: string; body: string } | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function act(program: Effect.Effect<void, Error>, success: () => void) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage("");
    await Effect.runPromise(Effect.match(program, { onSuccess: () => { if (mounted.current) success(); }, onFailure: (error) => { if (mounted.current) setMessage(error.message); } }));
    inFlight.current = false;
    if (mounted.current) setBusy(false);
  }
  return <section className="panel-content note-comments" aria-label="Sticky note comments">
    <p>Comments need this note’s author’s approval. If that teammate no longer has board access, the board owner reviews them.</p>
    <p>Pending and rejected comments are visible only to their writer and reviewer. Approved comments are visible to board members.</p>
    {model.error && <p role="alert">{model.error}</p>}
    <form onSubmit={(event) => { event.preventDefault();
      void act(Effect.gen(function* () {
        const trimmed = body.trim();
        const request = yield* Effect.try({ try: () => {
          if (!pending.current || pending.current.body !== trimmed) pending.current = { id: crypto.randomUUID(), body: trimmed };
          return pending.current;
        }, catch: () => new Error("Could not prepare the comment.") });
        yield* model.submit({ action: "create", id: request.id, noteId, body: request.body });
      }), () => { pending.current = null; setBody(""); setMessage("Comment submitted for approval."); });
    }}>
      <label className="field">Your comment<textarea autoFocus aria-describedby="comment-keyboard-hint" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!inFlight.current && body.trim()) event.currentTarget.form?.requestSubmit(); } }} aria-label="Your comment" value={body} maxLength={2000} required disabled={busy} onChange={(event) => setBody(event.target.value)} /></label>
      <small id="comment-keyboard-hint">Enter to submit · Shift+Enter for a new line</small>
      <button className="button primary" disabled={busy || !body.trim()}>Submit comment</button>
    </form>
    {message && <p role="status">{message}</p>}
    <div className="comment-history" tabIndex={0} role="region" aria-label="Previous comments">
    {!model.comments.length && !model.error && <p>No visible comments on this page.</p>}
    <ul className="comment-list">{model.comments.map((comment) => <li key={comment.id}>
      <strong>{comment.author_name}</strong><small>{new Date(comment.created_at).toLocaleString()} · {comment.status}</small>
      <p className="comment-body">{comment.body}</p>
      {comment.status === "pending" && model.reviewerId === model.viewerId && <div className="comment-actions">{(["approved", "rejected"] as const).map((status) => <button className="button" key={status} disabled={busy} onClick={() => { void act(model.submit({ action: "review", id: comment.id, status }), () => setMessage(status === "approved" ? "Comment approved." : "Comment rejected.")); }}>{status === "approved" ? "Approve" : "Reject"}</button>)}</div>}
    </li>)}</ul>
    </div>
    <nav aria-label="Comment pages"><button className="button" disabled={busy || model.page === 0} onClick={() => model.setPage((page) => Math.max(0, page - 1))}>Newer comments</button><button className="button" disabled={busy || !model.hasMore} onClick={() => model.setPage((page) => page + 1)}>Older comments</button></nav>
  </section>;
}
