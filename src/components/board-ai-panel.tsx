"use client";

import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { BoardDocument } from "../lib/board/model";
import { operationSchema } from "../lib/ai/evaluation";
import type { AIOperation, AIResult } from "../lib/ai/evaluation";
import { requestBoardAI } from "../lib/ai/board-request";
import type { SubmittedNote } from "../lib/ai/categorization";

type Preview = { operation: AIOperation; notes: SubmittedNote[]; result: AIResult };
const labels = { categorize: "categorization", summary: "summary", "action-items": "action items" };

export default function BoardAIPanel({ board, onConfirmResult }: {
  board: BoardDocument;
  onConfirmResult: (operation: AIOperation, input: unknown, notes: SubmittedNote[]) => Effect.Effect<void, Error>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [operation, setOperation] = useState<AIOperation>("summary");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const notes = board.objects.filter((object) => object.type === "sticky-note");
  const selectedCount = notes.filter((note) => selectedIds.includes(note.id)).length;
  function clearPreview() { setPreview(null); setMessage(""); setFailed(false); }
  async function submit() {
    if (inFlight.current) return;
    const attempt = ++generation.current;
    inFlight.current = true; setBusy(true); clearPreview();
    setMessage("Sending your selected notes to local Codex…");
    const chosen = operation;
    try {
      await Effect.runPromise(Effect.match(requestBoardAI(board, selectedIds, chosen), {
        onFailure: (error) => { if (attempt === generation.current) { setFailed(true); setMessage(error.message); } },
        onSuccess: ({ result, notes: submitted }) => {
          if (attempt !== generation.current) return;
          setPreview({ operation: chosen, notes: submitted, result });
          setMessage("Response validated. Review before confirming; your board has not changed.");
        },
      }));
    } finally { inFlight.current = false; if (attempt === generation.current) setBusy(false); }
  }
  function confirm() {
    if (inFlight.current || !preview) return;
    inFlight.current = true;
    try {
      Effect.runSync(Effect.match(onConfirmResult(preview.operation, preview.result, preview.notes), {
        onFailure: (error) => { setFailed(true); setMessage(error.message); },
        onSuccess: () => { setPreview(null); setFailed(false); setMessage("AI content added below your existing objects. Check board status for saving and synchronization."); },
      }));
    } finally { inFlight.current = false; }
  }
  return <section className="panel-content">
    <span className="eyebrow">YOUR BOARD ASSISTANT</span><h2>Explore your notes</h2>
    <p>Choose sticky notes and an operation. Results are previews until you confirm. Uses local Codex on this computer.</p>
    <fieldset disabled={busy}>
      <legend>Select sticky notes</legend>
      {!notes.length && <p>Add a sticky note to get started.</p>}
      {notes.map((note) => <label key={note.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12, overflowWrap: "anywhere" }}>
        <input type="checkbox" checked={selectedIds.includes(note.id)} aria-label={`Include note: ${note.text.trim() || "Empty note"}`} onChange={() => {
          setSelectedIds((ids) => ids.includes(note.id) ? ids.filter((id) => id !== note.id) : [...ids, note.id]); clearPreview();
        }} /><span>{note.text.trim() || "Empty note"}</span>
      </label>)}
      <p>{selectedCount} selected · Maximum 20 notes</p>
      <button type="button" className="button" onClick={() => { setSelectedIds([]); clearPreview(); }}>Clear selection</button>
      <label className="field">AI operation<select value={operation} onChange={(event) => {
        Effect.runSync(Effect.match(Effect.try({ try: () => operationSchema.parse(event.target.value), catch: () => new Error("Choose a valid operation.") }), {
          onSuccess: (value) => { setOperation(value); clearPreview(); }, onFailure: (error) => { setFailed(true); setMessage(error.message); },
        }));
      }}><option value="categorize">Categorize notes</option><option value="summary">Generate summary</option><option value="action-items">Generate action items</option></select></label>
      <button type="button" className="button primary" onClick={submit}>{busy ? "Working…" : "Run AI request"}</button>
    </fieldset>
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    {preview && <section aria-label="AI response"><h3>Review {labels[preview.operation]}</h3>
      <p>Based on {preview.notes.length} submitted notes. Later source changes require a new request.</p>
      {preview.operation === "summary" && <p style={{ whiteSpace: "pre-wrap" }}>{preview.result.summary}</p>}
      {preview.operation === "categorize" && <><p>Confirmation creates headings and categorized copies. Original notes stay unchanged.</p><ul>{preview.result.categories.map((category, index) => <li key={index}><strong>{category.name}</strong><ul>{category.noteIds.map((id) => <li key={id}>{preview.notes.find((note) => note.id === id)?.text}</li>)}</ul></li>)}</ul></>}
      {preview.operation === "action-items" && (preview.result.actionItems.length ? <ul>{preview.result.actionItems.map((item, index) => <li key={index}>{item.text}<small style={{ display: "block" }}>Sources: {item.sourceNoteIds.map((id) => preview.notes.find((note) => note.id === id)?.text).join(" · ")}</small></li>)}</ul> : <p>No supported action items were found.</p>)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="button primary" disabled={busy || (preview.operation === "action-items" && !preview.result.actionItems.length)} onClick={confirm}>Confirm {labels[preview.operation]}</button>
        <button type="button" className="button" disabled={busy} onClick={() => { clearPreview(); setMessage("Cancelled. Your board was not changed."); }}>Cancel</button>
      </div>
    </section>}
  </section>;
}
