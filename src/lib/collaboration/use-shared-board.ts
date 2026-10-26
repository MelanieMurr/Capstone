"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import * as Y from "yjs";
import { z } from "zod";
import type { BoardDocument } from "../board/model";
import { changesBetween, projectChanges, readBoard } from "./shared-board";
import { collaboratorSchema, cursorSchema } from "./presence";
import type { Collaborator, Cursor } from "./presence";
import type { Change } from "./shared-board";

type Command = { type: "edit"; requestId: string; changes: Change[] } | { type: "undo" | "redo" | "capture"; requestId: string };
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), update: z.string(), requestId: z.string().optional(), canEdit: z.boolean(), canUndo: z.boolean(), canRedo: z.boolean() }),
  z.object({ type: z.literal("ack"), requestId: z.string(), canUndo: z.boolean(), canRedo: z.boolean() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("presence"), peers: z.array(collaboratorSchema).max(1000) }),
]);
export type LiveBoard = {
  document: BoardDocument | null;
  collaborators: Collaborator[];
  cursor: (point: Cursor) => void;
  connected: boolean;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  status: string;
  edit: (before: BoardDocument, next: BoardDocument) => Effect.Effect<BoardDocument, Error>;
  undo: () => void;
  redo: () => void;
  capture: () => void;
};
const failure = (cause: unknown) => cause instanceof Error ? cause : new Error("Shared board connection failed.");

export function useSharedBoard(boardId: string): LiveBoard {
  const [view, setView] = useState({ document: null as BoardDocument | null, collaborators: [] as Collaborator[], connected: false, canEdit: false, canUndo: false, canRedo: false, status: "Connecting to shared board…" });
  const controller = useRef<{ edit: LiveBoard["edit"]; control: (type: "undo" | "redo" | "capture") => void; cursor: (point: Cursor) => void } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const pending: Command[] = [];
    let socket: WebSocket | undefined;
    let cursorTimer: ReturnType<typeof setTimeout> | undefined;
    let latestCursor: Cursor = null;
    let active = true, stopped = false, connected = false, editable = false, inFlight: string | null = null;
    function stop(cause: unknown) {
      if (!active || stopped) return;
      stopped = true; connected = false;
      setView((old) => ({ ...old, connected: false, collaborators: [], status: `${failure(cause).message} Edits paused. Export a copy before reloading.` }));
      socket?.close();
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
      const command = pending[0]!;
      socket.send(JSON.stringify(command));
      inFlight = command.requestId;
    }
    function publish() {
      const document = Effect.runSync(project());
      setView((old) => ({ ...old, document, status: pending.length ? "Saving shared edits…" : editable ? "Live · shared changes saved" : "Live · view-only board" }));
      pump();
      return document;
    }
    function enqueue(command: Command) {
      if (!connected || !editable) throw new Error("The shared board is not ready for editing.");
      const tail = pending.at(-1);
      // Coalesce only commands that have not been sent. Never change an in-flight request.
      if (command.type === "edit" && tail?.type === "edit" && tail.requestId !== inFlight && tail.changes.length + command.changes.length <= 2000) tail.changes.push(...command.changes);
      else pending.push(command);
      return publish();
    }
    const edit: LiveBoard["edit"] = (before, next) => Effect.gen(function* () {
      const changes = yield* changesBetween(before, next);
      if (!changes.length) return yield* project();
      return yield* Effect.try({ try: () => enqueue({ type: "edit", requestId: crypto.randomUUID(), changes }), catch: failure });
    });
    controller.current = { edit, cursor: (point) => {
      Effect.runSync(Effect.match(Effect.try({ try: () => {
        latestCursor = cursorSchema.parse(point);
        if (!connected || socket?.readyState !== WebSocket.OPEN) return;
        const send = () => {
          cursorTimer = undefined;
          if (connected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cursor", cursor: latestCursor }));
        };
        if (point === null) { clearTimeout(cursorTimer); send(); }
        else if (!cursorTimer) cursorTimer = setTimeout(() => {
          Effect.runSync(Effect.match(Effect.try({ try: send, catch: failure }), { onSuccess: () => undefined, onFailure: stop }));
        }, 100);
      }, catch: failure }), { onSuccess: () => undefined, onFailure: stop }));
    }, control: (type) => {
      Effect.runSync(Effect.match(Effect.try({ try: () => enqueue({ type, requestId: crypto.randomUUID() }), catch: failure }), { onSuccess: () => undefined, onFailure: stop }));
    } };
    setView({ document: null, collaborators: [], connected: false, canEdit: false, canUndo: false, canRedo: false, status: "Connecting to shared board…" });
    const connect = Effect.tryPromise({ try: async () => {
      const response = await fetch(`/api/boards/${boardId}/sync-session`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not authorize this board.");
      const { token } = z.object({ token: z.string().min(1) }).parse(body);
      if (!active) return;
      socket = new WebSocket(process.env.NEXT_PUBLIC_BOARD_SYNC_URL || "ws://127.0.0.1:1235");
      socket.onopen = () => {
        Effect.runSync(Effect.match(Effect.try({ try: () => socket!.send(JSON.stringify({ type: "join", boardId, token })), catch: failure }), { onSuccess: () => undefined, onFailure: stop }));
      };
      socket.onmessage = (event) => {
        if (!active || stopped) return;
        Effect.runSync(Effect.match(Effect.try({ try: () => {
          const message = messageSchema.parse(JSON.parse(event.data));
          if (message.type === "error") throw new Error(message.message);
          if (message.type === "presence") { setView((old) => ({ ...old, collaborators: message.peers })); return; }
          if (message.type === "state") {
            const update = Uint8Array.from(atob(message.update), (character) => character.charCodeAt(0));
            Y.applyUpdate(doc, update, "server");
            connected = true; editable = message.canEdit;
          }
          if (message.requestId && message.requestId === inFlight) { pending.shift(); inFlight = null; }
          setView((old) => ({ ...old, connected, canEdit: editable, canUndo: message.canUndo, canRedo: message.canRedo }));
          publish();
        }, catch: failure }), { onSuccess: () => undefined, onFailure: stop }));
      };
      socket.onerror = () => stop(new Error("Cannot reach the board sync server."));
      socket.onclose = () => stop(new Error("Shared board disconnected."));
    }, catch: failure });
    void Effect.runPromise(Effect.match(connect, { onSuccess: () => undefined, onFailure: stop }));
    const blur = () => controller.current?.cursor(null);
    window.addEventListener("blur", blur);
    return () => { clearTimeout(cursorTimer); window.removeEventListener("blur", blur); active = false; controller.current = null; socket?.close(); doc.destroy(); };
  }, [boardId]);
  return {
    ...view,
    cursor: (point) => controller.current?.cursor(point),
    edit: (before, next) => controller.current?.edit(before, next) ?? Effect.fail(new Error("Shared board is connecting.")),
    undo: () => controller.current?.control("undo"),
    redo: () => controller.current?.control("redo"),
    capture: () => controller.current?.control("capture"),
  };
}
