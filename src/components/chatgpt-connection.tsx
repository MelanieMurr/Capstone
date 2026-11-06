"use client";

import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { z } from "zod";
import { connectionSchema, modelSchema } from "../lib/ai/chatgpt/contracts";
import type { ChatGPTConnection, ChatGPTModel } from "../lib/ai/chatgpt/contracts";

export type ChatGPTSelection = { connectionId: string; model: string };
export function connectionRequest(input?: unknown, models = false, signal?: AbortSignal) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`/api/chatgpt${models ? "?models=1" : ""}`, {
        ...(input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}),
        cache: "no-store", signal: signal ?? AbortSignal.timeout(30_000),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(body);
        throw new Error(failure.success ? failure.data.error : "ChatGPT connection request failed.");
      }
      return body;
    }, catch: (error) => error instanceof Error ? error : new Error("ChatGPT connection request failed."),
  });
}

function PlanWelcome({ dismiss, busy }: { dismiss: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    Effect.runSync(Effect.ignore(Effect.try(() => dialog.current?.showModal())));
    return () => { dialog.current?.close(); };
  }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <h2>You’re using your ChatGPT plan</h2>
    <p>Eligible AI requests in CoCanvas use your ChatGPT plan or credits balance. Manage access and usage limits in ChatGPT settings.</p>
    <button autoFocus type="button" className="button primary" disabled={busy} onClick={dismiss}>Got it</button>
  </dialog>;
}

export default function ChatGPTConnectionPanel({ onChange, disabled = false }: { onChange: (selection: ChatGPTSelection | null) => void; disabled?: boolean }) {
  const [connection, setConnection] = useState<ChatGPTConnection | null>(null);
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loopbackUrl, setLoopbackUrl] = useState<string | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const active = connection?.accounts.find((account) => account.id === connection.activeId);

  function refresh(signal?: AbortSignal) {
    const attempt = ++generation.current;
    onChange(null);
    return Effect.gen(function* () {
      const raw = yield* connectionRequest(undefined, false, signal);
      const status = yield* Effect.try({ try: () => connectionSchema.parse(raw), catch: () => new Error("Invalid ChatGPT connection status.") });
      if (attempt !== generation.current) return;
      setConnection(status); setModels([]);
      const selected = status.accounts.find((account) => account.id === status.activeId);
      if (!selected?.connected || !selected.planEnabled) return;
      const catalog = yield* connectionRequest(undefined, true, signal);
      const parsed = yield* Effect.try({ try: () => z.object({ models: z.array(modelSchema) }).parse(catalog).models, catch: () => new Error("Invalid ChatGPT model catalog.") });
      if (attempt !== generation.current) return;
      setModels(parsed);
      if (selected.model && parsed.some((model) => model.slug === selected.model)) onChange({ connectionId: selected.id, model: selected.model });
    });
  }
  useEffect(() => {
    Effect.runSync(Effect.match(Effect.try({
      try: () => {
        if (window.location.hostname !== "localhost" && window.location.hostname !== "[::1]") return null;
        const target = new URL(window.location.href);
        target.hostname = "127.0.0.1"; target.search = ""; target.hash = "";
        return target.toString();
      }, catch: () => new Error("Could not determine the local sign-in address."),
    }), { onSuccess: setLoopbackUrl, onFailure: (cause) => setError(cause.message) }));
    const controller = new AbortController();
    void Effect.runPromise(Effect.match(refresh(controller.signal), { onSuccess: () => {}, onFailure: (cause) => { if (!controller.signal.aborted) setError(cause.message); } }));
    return () => { generation.current++; controller.abort(); onChange(null); };
    // onChange is the stable React state setter supplied by the board panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  async function run(action?: unknown) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    onChange(null);
    try {
      await Effect.runPromise(Effect.match(Effect.gen(function* () {
        if (action) {
          const result = yield* connectionRequest(action);
          const feedback = z.object({ message: z.string().optional() }).safeParse(result);
          if (feedback.success && feedback.data.message) setMessage(feedback.data.message);
        }
        yield* refresh();
      }), { onSuccess: () => {}, onFailure: (cause) => setError(cause.message) }));
    } finally { running.current = false; setBusy(false); }
  }
  async function connect(accountId?: string, enablePlan = false) {
    if (running.current || disabled || loopbackUrl) return;
    running.current = true; setBusy(true); setError("");
    try {
      await Effect.runPromise(Effect.match(Effect.gen(function* () {
        const result = yield* connectionRequest({ action: "connect", returnTo: window.location.pathname, ...(accountId ? { accountId } : {}), enablePlan });
        yield* Effect.try({
          try: () => {
            const target = new URL(z.object({ authorization: z.url() }).parse(result).authorization);
            if (target.origin !== "https://auth.openai.com") throw new Error("Unexpected sign-in destination.");
            window.location.assign(target.toString());
          }, catch: () => new Error("Could not open ChatGPT sign-in. Try again."),
        });
      }), { onSuccess: () => {}, onFailure: (cause) => setError(cause.message) }));
    } finally { running.current = false; setBusy(false); }
  }
  return <section aria-label="ChatGPT connection" style={{ borderBottom: "1px solid var(--border, #ddd)", paddingBottom: 16, marginBottom: 16 }}>
    <h3>Use your ChatGPT plan</h3>
    <p>Connect ChatGPT for eligible AI requests on this computer. First <a href="/dashboard">sign in to your CoCanvas account</a> to keep boards and subscriptions separate.</p>
    {loopbackUrl && <p>ChatGPT requires the 127.0.0.1 address. <a href={loopbackUrl}>Open this board at 127.0.0.1</a> and sign in to CoCanvas there once; your browser keeps localhost and 127.0.0.1 logins separate.</p>}
    <fieldset disabled={busy || disabled}>
      {!!connection?.accounts.length && <label className="field">ChatGPT account<select aria-label="ChatGPT account" value={connection.activeId ?? ""} onChange={(event) => void run({ action: "select", accountId: event.target.value })}>
        {connection.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}{account.connected ? "" : " · disconnected"}</option>)}
      </select></label>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="button" disabled={!!loopbackUrl} data-oai-siwc-button onClick={() => void connect(active?.id)}>Continue with ChatGPT</button>
        {!!connection?.accounts.length && <button type="button" className="button" disabled={!!loopbackUrl} data-oai-siwc-button onClick={() => void connect()}>Add ChatGPT account</button>}
        {active?.connected && <button type="button" className="button" onClick={() => void run({ action: "disconnect", accountId: active.id })}>Disconnect ChatGPT</button>}
        <button type="button" className="button" onClick={() => void run()}>Refresh connection</button>
      </div>
      {active?.connected && !active.planEnabled && <><p>This account is connected, but ChatGPT plan use was not authorized.</p><button type="button" className="button" disabled={!!loopbackUrl} onClick={() => void connect(active.id, true)}>Enable ChatGPT plan</button></>}
      {active?.connected && active.planEnabled && <>
        <p>Using ChatGPT plan · {active.label}</p>
        <label className="field">ChatGPT model<select aria-label="ChatGPT model" value={models.some((model) => model.slug === active.model) ? active.model ?? "" : ""} onChange={(event) => void run({ action: "model", model: event.target.value })}>
          <option value="" disabled>Choose an available model</option>
          {models.map((model) => <option key={model.slug} value={model.slug}>{model.display_name}</option>)}
        </select></label>
        {!models.length && <p>No model choices loaded. Refresh the connection to try again.</p>}
      </>}
    </fieldset>
    <p><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage</a></p>
    {busy && <p role="status">Updating ChatGPT connection…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {active?.connected && active.planEnabled && !active.welcomeSeen && <PlanWelcome busy={busy} dismiss={() => void run({ action: "welcome" })} />}
  </section>;
}
