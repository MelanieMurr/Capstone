"use client";
import { useEffect, useState } from "react";
import { Effect } from "effect";
import { boardInputSchema, boardRowSchema } from "../../lib/foundation/contracts";
import type { BoardRow } from "../../lib/foundation/contracts";
import { z } from "zod";
export default function Dashboard({ userId, email }: { userId: string; email: string }) {
  const [boards, setBoards] = useState<BoardRow[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [title, setTitle] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null); const [rename, setRename] = useState(""); const [deleteId, setDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) { window.location.assign("/login"); throw new Error("Your session ended. Please sign in again."); }
    if (!response.ok) throw new Error(data.error || "Could not complete the request."); return data;
  }
  async function load() {
    setLoading(true); setError("");
    await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => z.array(boardRowSchema).parse(await request("/api/boards")), catch: (cause) => new Error(cause instanceof Error ? cause.message : "Could not load boards.") }), { onFailure: (cause) => setError(cause.message), onSuccess: setBoards }));
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    await Effect.runPromise(Effect.match(Effect.tryPromise({ try: work, catch: (cause) => new Error(cause instanceof Error ? cause.message : "Could not complete the request.") }), { onFailure: (cause) => setError(cause.message), onSuccess: () => {} }));
    setBusy(false);
  }
  return <main className="dashboard-page"><header className="dashboard-header"><a className="account-brand" href="/">CoCanvas<span>•</span></a><div><span>{email}</span><button className="button" disabled={busy} onClick={() => action(async () => { await request("/api/auth/signout", "POST", {}); window.location.assign("/login"); })}>Sign out</button></div></header>
    <div className="dashboard-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>A little space. A lot of possibility.</h1><p>Your private boards and the ones shared with you.</p></div><a className="button" href="/prototypes">Prototype lab ↗</a></div>
    <form className="new-board-form" onSubmit={(event) => { event.preventDefault(); void action(async () => { const input = boardInputSchema.safeParse({ title }); if (!input.success) throw new Error("Use a board title of 1–120 characters."); await request("/api/boards", "POST", input.data); setTitle(""); await load(); }); }}><label htmlFor="new-board">Start something new</label><div><input id="new-board" aria-label="New board title" maxLength={120} placeholder="Give your next idea a name…" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /><button className="button primary" disabled={busy || !title.trim()}>Create board</button></div></form>
    <div className="board-list-heading"><h2>Your boards</h2><input aria-label="Search boards" placeholder="Search your boards…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <div role="alert" className="dashboard-error">{error} <button className="button" disabled={busy} onClick={load}>Try again</button></div>}
    {loading ? <p role="status">Loading your boards…</p> : <>
      {!boards.length && !error && <section className="dashboard-empty"><span>▧</span><h2>Your next great idea starts here.</h2><p>Create your first board above.</p></section>}
      {!!boards.length && !boards.some((board) => board.title.toLowerCase().includes(query.toLowerCase())) && <p>No boards match your search.</p>}
      <div className="board-grid">{boards.filter((board) => board.title.toLowerCase().includes(query.toLowerCase())).map((board, index) => <article key={board.id} className="board-card"><a href={`/boards/${board.id}`} aria-label={`Open ${board.title}`} className={`board-cover cover-${index % 3}`}><span /><span /><span /></a><div className="board-card-content"><span className="eyebrow">{board.owner_id === userId ? "OWNED BY YOU" : "SHARED WITH YOU"}</span><h3><a href={`/boards/${board.id}`}>{board.title}</a></h3><p>Created {new Date(board.created_at).toLocaleDateString()}</p>
        {renameId === board.id ? <form onSubmit={(event) => { event.preventDefault(); void action(async () => { const input = boardInputSchema.safeParse({ title: rename }); if (!input.success) throw new Error("Use a board title of 1–120 characters."); await request(`/api/boards/${board.id}`, "PATCH", input.data); setRenameId(null); await load(); }); }}><input aria-label="Rename board title" value={rename} maxLength={120} onChange={(event) => setRename(event.target.value)} disabled={busy} /><div className="prototype-controls"><button className="button primary" disabled={busy}>Save name</button><button className="button" type="button" disabled={busy} onClick={() => setRenameId(null)}>Cancel</button></div></form> : <div className="board-card-actions"><a className="button" href={`/boards/${board.id}`}>Open board</a>{board.owner_id === userId && <><button className="button" disabled={busy} aria-label={`Rename ${board.title}`} onClick={() => { setRenameId(board.id); setRename(board.title); setDeleteId(null); }}>Rename</button><button className="button" disabled={busy} aria-label={`Delete ${board.title}`} onClick={() => { setDeleteId(board.id); setRenameId(null); }}>Delete</button></>}</div>}
        {deleteId === board.id && <div className="delete-confirm"><p>Delete this board and its saved content? This cannot be undone.</p><button className="button danger" disabled={busy} onClick={() => action(async () => { await request(`/api/boards/${board.id}`, "DELETE"); setDeleteId(null); await load(); })}>Confirm delete</button><button className="button" disabled={busy} onClick={() => setDeleteId(null)}>Keep board</button></div>}
      </div></article>)}</div>
    </>}
  </main>;
}
