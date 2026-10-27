"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import * as Y from "yjs";
import { z } from "zod";
import type { BoardDocument } from "../board/model";
import { changesBetween, projectChanges, readBoard } from "./shared-board";
import { collaboratorSchema, cursorSchema } from "./presence";
import type { Collaborator, Cursor } from "./presence";
import { reconnectDelay, recoverCommands } from "./recovery";
import type { Command } from "./recovery";

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), update: z.string(), requestId: z.string().optional(), canEdit: z.boolean(), canUndo: z.boolean(), canRedo: z.boolean(), settled: z.array(z.uuid()).optional(), historyReset: z.boolean().optional() }),
  z.object({ type: z.literal("ack"), requestId: z.string(), canUndo: z.boolean(), canRedo: z.boolean() }),
  z.object({ type: z.literal("error"), code: z.string().optional(), message: z.string() }),
  z.object({ type: z.literal("presence"), peers: z.array(collaboratorSchema).max(1000) }),
]);
export type LiveBoard = {
  document: BoardDocument | null; collaborators: Collaborator[]; cursor: (point: Cursor) => void;
  connected: boolean; canEdit: boolean; canUndo: boolean; canRedo: boolean; status: string;
  edit: (before: BoardDocument, next: BoardDocument) => Effect.Effect<BoardDocument, Error>;
  undo: () => void; redo: () => void; capture: () => void;
};
const failure = (cause: unknown) => cause instanceof Error ? cause : new Error("Shared board connection failed.");
const initial = () => ({ document: null as BoardDocument | null, collaborators: [] as Collaborator[], connected: false, canEdit: false, canUndo: false, canRedo: false, status: "Connecting to shared board…" });
export function useSharedBoard(boardId: string): LiveBoard {
  const [view, setView] = useState(initial);
  const controller = useRef<{ edit: LiveBoard["edit"]; control: (type: "undo" | "redo" | "capture") => void; cursor: (point: Cursor) => void } | null>(null);
  useEffect(() => {
    let doc = new Y.Doc();
    const sessionId = crypto.randomUUID();
    let pending: Command[] = [];
    let socket: WebSocket | undefined, authAbort: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined, joinTimer: ReturnType<typeof setTimeout> | undefined, cursorTimer: ReturnType<typeof setTimeout> | undefined;
    let latestCursor: Cursor = null, active = true, stopped = false, connected = false, editable = false;
    let inFlight: string | null = null, generation = 0, attempts = 0, joinedBefore = false, notice = "";
    function fatal(cause: unknown) {
      if (!active || stopped) return;
      stopped = true; connected = false; generation++;
      clearTimeout(retryTimer); clearTimeout(joinTimer); clearTimeout(cursorTimer); authAbort?.abort(); socket?.close();
      setView((old) => ({ ...old, connected: false, collaborators: [], status: `${failure(cause).message} Edits paused. Export a copy before reloading.` }));
    }
    function retry(cause: unknown, attempt: number) {
      if (!active || stopped || attempt !== generation) return;
      connected = false; inFlight = null; generation++;
      clearTimeout(joinTimer); clearTimeout(cursorTimer); clearTimeout(retryTimer); authAbort?.abort(); socket?.close();
      const delay = reconnectDelay(attempts++);
      setView((old) => ({ ...old, connected: false, collaborators: [], status: `${failure(cause).message} Reconnecting in ${delay / 1000}s… Unsent edits retained.` }));
      retryTimer = setTimeout(connect, delay);
    }
    function project() {
      return Effect.gen(function* () {
        let result = yield* readBoard(doc, boardId);
        for (const command of pending) if (command.type === "edit") result = yield* projectChanges(result, command.changes);
        return result;
      });
    }
    function pump() {
      if (!connected || inFlight || !pending.length || socket?.readyState !== WebSocket.OPEN) return;
      inFlight = pending[0]!.requestId;
      Effect.runSync(Effect.match(Effect.try({ try: () => socket!.send(JSON.stringify(pending[0])), catch: failure }), { onSuccess: () => undefined, onFailure: (error) => retry(error, generation) }));
    }
    function publish() {
      const document = Effect.runSync(project());
      setView((old) => ({ ...old, document, status: `${pending.length ? "Saving shared edits…" : editable ? "Live · shared changes saved" : "Live · view-only board"}${notice ? ` · ${notice}` : ""}` }));
      pump(); return document;
    }
    function enqueue(command: Command) {
      if (!connected || !editable) throw new Error("The shared board is reconnecting or view-only.");
      notice = "";
      const tail = pending.at(-1);
      if (command.type === "edit" && tail?.type === "edit" && tail.requestId !== inFlight && tail.changes.length + command.changes.length <= 2000) tail.changes.push(...command.changes);
      else pending.push(command);
      return publish();
    }
    controller.current = {
      edit: (before, next) => Effect.gen(function* () {
        const changes = yield* changesBetween(before, next);
        if (!changes.length) return yield* project();
        return yield* Effect.try({ try: () => enqueue({ type: "edit", requestId: crypto.randomUUID(), changes }), catch: failure });
      }),
      control: (type) => {
        if (!connected || !editable) return;
        Effect.runSync(Effect.match(Effect.try({ try: () => enqueue({ type, requestId: crypto.randomUUID() }), catch: failure }), { onSuccess: () => undefined, onFailure: fatal }));
      },
      cursor: (point) => {
        Effect.runSync(Effect.match(Effect.try({ try: () => {
          latestCursor = cursorSchema.parse(point);
          if (!connected || socket?.readyState !== WebSocket.OPEN) return;
          const send = () => {
            cursorTimer = undefined;
            if (connected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cursor", cursor: latestCursor }));
          };
          if (point === null) { clearTimeout(cursorTimer); send(); }
          else if (!cursorTimer) cursorTimer = setTimeout(() => Effect.runSync(Effect.match(Effect.try({ try: send, catch: failure }), { onSuccess: () => undefined, onFailure: (error) => retry(error, generation) })), 100);
        }, catch: failure }), { onSuccess: () => undefined, onFailure: (error) => retry(error, generation) }));
      },
    };
    function connect() {
      if (!active || stopped) return;
      clearTimeout(retryTimer);
      const attempt = ++generation;
      authAbort?.abort(); clearTimeout(joinTimer); socket?.close();
      authAbort = new AbortController();
      const authorization = authAbort;
      const authTimeout = setTimeout(() => authorization.abort(), 10_000);
      const work = Effect.tryPromise({ try: async () => {
        // A fresh cookie-aware request refreshes the Supabase token on every retry.
        const response = await fetch(`/api/boards/${boardId}/sync-session`, { method: "POST", signal: authorization.signal });
        const body = await response.json();
        if (!active || stopped || attempt !== generation) return;
        if ([401, 403, 404].includes(response.status)) { fatal(new Error(body.error || "Board access ended. Sign in again.")); return; }
        if (!response.ok) throw new Error(body.error || "Could not authorize this board.");
        const { token } = z.object({ token: z.string().min(1) }).parse(body);
        const current = new WebSocket(process.env.NEXT_PUBLIC_BOARD_SYNC_URL || "ws://127.0.0.1:1235"); socket = current;
        let first = true;
        joinTimer = setTimeout(() => retry(new Error("Shared board connection timed out."), attempt), 12_000);
        current.onopen = () => {
          if (!active || attempt !== generation) { current.close(); return; }
          Effect.runSync(Effect.match(Effect.try({ try: () => current.send(JSON.stringify({ type: "join", boardId, token, sessionId, pendingRequests: pending.map((command) => command.requestId) })), catch: failure }), { onSuccess: () => undefined, onFailure: (error) => retry(error, attempt) }));
        };
        current.onmessage = (event) => {
          if (!active || stopped || attempt !== generation) return;
          Effect.runSync(Effect.match(Effect.try({ try: () => {
            const message = messageSchema.parse(JSON.parse(event.data));
            if (message.type === "error") { if (message.code === "join") retry(new Error("Could not join the shared board."), attempt); else fatal(new Error(message.message)); return; }
            if (message.type === "presence") { setView((old) => ({ ...old, collaborators: message.peers })); return; }
            if (message.type === "state") {
              const update = Uint8Array.from(atob(message.update), (character) => character.charCodeAt(0));
              if (first) {
                const recovered = Effect.runSync(recoverCommands(pending, message.settled ?? [], !!message.historyReset, message.canEdit));
                pending = recovered.pending; notice = joinedBefore ? recovered.notice : "";
                doc.destroy(); doc = new Y.Doc(); inFlight = null;
                first = false; joinedBefore = true; attempts = 0; clearTimeout(joinTimer);
              }
              Y.applyUpdate(doc, update, "server"); connected = true; editable = message.canEdit;
            }
            if (message.requestId && message.requestId === inFlight) { pending.shift(); inFlight = null; }
            setView((old) => ({ ...old, connected, canEdit: editable, canUndo: message.canUndo, canRedo: message.canRedo }));
            publish();
          }, catch: failure }), { onSuccess: () => undefined, onFailure: fatal }));
        };
        current.onerror = () => retry(new Error("Cannot reach the board sync server."), attempt);
        current.onclose = () => retry(new Error("Shared board disconnected."), attempt);
      }, catch: failure });
      void Effect.runPromise(Effect.match(work, { onSuccess: () => undefined, onFailure: (error) => retry(error, attempt) })).finally(() => clearTimeout(authTimeout));
    }
    function online() { if (!connected && !stopped) { clearTimeout(retryTimer); connect(); } }
    const blur = () => controller.current?.cursor(null);
    setView(initial()); connect();
    window.addEventListener("online", online); window.addEventListener("blur", blur);
    return () => {
      active = false; generation++; clearTimeout(retryTimer); clearTimeout(joinTimer); clearTimeout(cursorTimer); authAbort?.abort();
      window.removeEventListener("online", online); window.removeEventListener("blur", blur);
      controller.current = null; socket?.close(); doc.destroy();
    };
  }, [boardId]);
  return { ...view, cursor: (point) => controller.current?.cursor(point), edit: (before, next) => controller.current?.edit(before, next) ?? Effect.fail(new Error("Shared board is connecting.")), undo: () => controller.current?.control("undo"), redo: () => controller.current?.control("redo"), capture: () => controller.current?.control("capture") };
}
