"use client";
import { useState } from "react";
import { Effect } from "effect";
import { accessInputSchema } from "../../lib/foundation/contracts";
export default function BoardSharing({ id, isOwner }: { id: string; isOwner: boolean }) {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"viewer" | "editor">("editor");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  if (!isOwner) return <p>Only the board owner can grant access to other people.</p>;
  return <form className="board-sharing" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    void Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
      const input = accessInputSchema.parse({ email, permission });
      const response = await fetch(`/api/boards/${id}/collaborators`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not grant access. Try again.");
      return result.message as string;
    }, catch: (cause) => new Error(cause instanceof Error ? cause.message : "Could not grant access. Check your connection.") }), {
      onFailure: (cause) => { setError(true); setMessage(cause.message); },
      onSuccess: (value) => { setError(false); setMessage(value); setEmail(""); },
    })).finally(() => setBusy(false));
  }}>
    <label className="field">Registered email<input aria-label="Collaborator email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} autoComplete="off" /></label>
    <label className="field">Permission<select aria-label="Collaborator permission" value={permission} onChange={(event) => setPermission(event.target.value as "viewer" | "editor")} disabled={busy}><option value="editor">Editor — can change this board</option><option value="viewer">Viewer — can read this board</option></select></label>
    <button className="button primary" type="submit" disabled={busy}>{busy ? "Granting access…" : "Grant access"}</button>
    {message && <p role={error ? "alert" : "status"}>{message}</p>}
    <p className="muted">They must already have a CoCanvas account. Access is available immediately; no email invitation is sent. Granting again updates their permission.</p>
  </form>;
}
