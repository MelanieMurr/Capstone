import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import * as Y from "yjs";
import { z } from "zod";
import { applyChanges, changeSchema, readBoard, writeBoard } from "../src/lib/collaboration/shared-board.ts";
import type { BoardDocument } from "../src/lib/board/model.ts";

import { persistBoard, restoreBoard } from "../src/lib/collaboration/persistence.ts";
import { collaboratorColor, cursorSchema } from "../src/lib/collaboration/presence.ts";
import type { Collaborator } from "../src/lib/collaboration/presence.ts";

type Access = { snapshot: unknown; revision: number; yjsState: string | null; canEdit: boolean; user: { id: string; name: string } };
type Backend = {
  access(token: string, boardId: string): Promise<Access>;
  save(token: string, boardId: string, snapshot: BoardDocument, revision: number, yjsState: string): Promise<void>;
};
const requestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("join"), boardId: z.uuid(), token: z.string().min(1) }),
  z.strictObject({ type: z.literal("edit"), requestId: z.uuid(), changes: z.array(changeSchema).max(2000) }),
  z.strictObject({ type: z.enum(["undo", "redo", "capture"]), requestId: z.uuid() }),
  z.strictObject({ type: z.literal("cursor"), cursor: cursorSchema }),
]);
type Room = { doc: Y.Doc; revision: number; peers: Set<Peer>; queue: Promise<void>; failed: boolean };
type Peer = { socket: WebSocket; token: string; boardId: string; room: Room; undo: Y.UndoManager; canEdit: boolean; presence: Collaborator; checkedAt: number; lastCursor: number };

// Exporting the factory makes the room protocol testable without real accounts.
export function startSyncServer(backend: Backend, port = 1235, origins = ["http://127.0.0.1:3000", "http://localhost:3000"]) {
  const http = createServer((_req, res) => { res.writeHead(200); res.end("CoCanvas board sync"); });
  const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
  const rooms = new Map<string, Promise<Room>>();
  const send = (socket: WebSocket, data: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
  const run = (work: () => Promise<void>, failure: () => void) => Effect.runPromise(Effect.match(Effect.tryPromise({ try: work, catch: () => new Error("Sync operation failed.") }), { onSuccess: () => {}, onFailure: failure }));
  function failRoom(boardId: string, room: Room) {
    room.failed = true;
    rooms.delete(boardId);
    for (const peer of room.peers) { send(peer.socket, { type: "error", message: "Shared saving stopped. Export a copy and reload." }); peer.socket.close(1011); peer.undo.destroy(); }
    room.peers.clear(); room.doc.destroy();
  }
  function enqueue(room: Room, work: () => Promise<void>, failed: () => void) {
    room.queue = room.queue.then(() => run(async () => { if (!room.failed) await work(); }, failed));
  }
  async function authorize(peer: Peer, force = false) {
    if (force || Date.now() - peer.checkedAt > 5000) {
      const access = await backend.access(peer.token, peer.boardId);
      peer.canEdit = access.canEdit; peer.checkedAt = Date.now();
    }
  }
  async function presence(room: Room) {
    const peers = [...room.peers].filter((peer) => peer.socket.readyState === WebSocket.OPEN);
    const allowed: Peer[] = [];
    for (const peer of peers) {
      try { await authorize(peer); allowed.push(peer); }
      catch { peer.socket.close(1008, "Access expired or removed"); }
    }
    for (const peer of allowed) send(peer.socket, { type: "presence", peers: allowed.filter((other) => other !== peer).map((other) => other.presence) });
  }
  async function broadcast(room: Room, update: Uint8Array, actor?: Peer, requestId?: string) {
    for (const peer of [...room.peers]) {
      try {
        // Recheck membership before sending more private board content.
        await authorize(peer, true);
        send(peer.socket, { type: "state", update: Buffer.from(update).toString("base64"),
          requestId: peer === actor ? requestId : undefined, canEdit: peer.canEdit,
          canUndo: peer.undo.canUndo(), canRedo: peer.undo.canRedo() });
      } catch { peer.socket.close(1008, "Access expired or removed"); }
    }
  }
  wss.on("connection", (socket, request) => {
    if (!request.headers.origin || !origins.includes(request.headers.origin)) { socket.close(1008, "Origin rejected"); return; }
    let alive = true;
    socket.on("pong", () => { alive = true; });
    const heartbeat = setInterval(() => {
      void run(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!alive) { socket.terminate(); return; }
        alive = false; socket.ping();
      }, () => socket.terminate());
    }, 15000);
    let peer: Peer | undefined;
    let joining = false;
    const timeout = setTimeout(() => socket.close(1008, "Join required"), 5000);
    socket.on("error", () => {});
    socket.on("message", (bytes, binary) => {
      void run(async () => {
        if (binary) throw new Error("JSON messages required.");
        const frame = requestSchema.parse(JSON.parse(bytes.toString()));
        if (frame.type === "join") {
          if (peer || joining) throw new Error("Already joined.");
          joining = true;
          const access = await backend.access(frame.token, frame.boardId);
          if (!rooms.has(frame.boardId)) {
            const loading = (async () => {
              const doc = await Effect.runPromise(restoreBoard(frame.boardId, access.snapshot, access.yjsState));
              return { doc, revision: access.revision, peers: new Set<Peer>(), queue: Promise.resolve(), failed: false };
            })();
            rooms.set(frame.boardId, loading);
            void loading.catch(() => { if (rooms.get(frame.boardId) === loading) rooms.delete(frame.boardId); });
          }
          const room = await rooms.get(frame.boardId)!;
          if (room.failed) throw new Error("Room unavailable; reload.");
          const origin = {}; // A unique tracked origin for this connection.
          const undo = new Y.UndoManager(room.doc.getMap("objects"), { trackedOrigins: new Set([origin]) });
          peer = Object.assign(origin, { socket, token: frame.token, boardId: frame.boardId, room, undo, canEdit: access.canEdit,
            presence: { id: randomUUID(), userId: access.user.id, name: access.user.name, color: collaboratorColor(access.user.id), cursor: null }, checkedAt: Date.now(), lastCursor: 0 });
          clearTimeout(timeout);
          const joined = peer;
          enqueue(room, async () => {
            if (socket.readyState !== WebSocket.OPEN) { undo.destroy(); return; }
            room.peers.add(joined);
            send(socket, { type: "state", update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64"), canEdit: joined.canEdit, canUndo: false, canRedo: false });
            await presence(room);
          }, () => failRoom(frame.boardId, room));
          return;
        }
        const current = peer;
        if (!current) throw new Error("Join first.");
        enqueue(current.room, async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (frame.type === "cursor") {
            if (frame.cursor && Date.now() - current.lastCursor < 75) return;
            await authorize(current);
            current.lastCursor = Date.now(); current.presence.cursor = frame.cursor;
            await presence(current.room); return;
          }
          await authorize(current, true);
          if (!current.canEdit) { send(socket, { type: "error", message: "You no longer have edit access. Reload the board." }); socket.close(1008); return; }
          if (frame.type === "capture") {
            current.undo.stopCapturing();
            send(socket, { type: "ack", requestId: frame.requestId, canUndo: current.undo.canUndo(), canRedo: current.undo.canRedo() });
            return;
          }
          const vector = Y.encodeStateVector(current.room.doc);
          if (frame.type === "edit") await Effect.runPromise(applyChanges(current.room.doc, current.boardId, frame.changes, current));
          else if (frame.type === "undo") current.undo.undo();
          else current.undo.redo();
          // Undo/concurrent deletion can leave a dangling attachment; remove it.
          const snapshot = await Effect.runPromise(readBoard(current.room.doc, current.boardId));
          await Effect.runPromise(writeBoard(current.room.doc, snapshot, "reconcile"));
          const stored = await Effect.runPromise(persistBoard(current.room.doc, current.boardId));
          await backend.save(current.token, current.boardId, stored.snapshot, current.room.revision, stored.yjsState);
          current.room.revision += 1;
          await broadcast(current.room, Y.encodeStateAsUpdate(current.room.doc, vector), current, frame.requestId);
        }, () => failRoom(current.boardId, current.room));
      }, () => { send(socket, { type: "error", message: "Invalid or unauthorized sync request." }); socket.close(1008); });
    });
    socket.on("close", () => {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (!peer) return;
      const gone = peer;
      enqueue(gone.room, async () => {
        gone.room.peers.delete(gone); gone.undo.destroy();
        await presence(gone.room);
        // Keep the room document until shutdown; a later visitor reuses its history.
      }, () => failRoom(gone.boardId, gone.room));
    });
  });
  http.listen(port, "127.0.0.1");
  return { http, wss, close: () => new Promise<void>((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => http.close(() => {
      void Promise.all([...rooms.values()].map(async (loading) => { const room = await loading; await room.queue; for (const peer of room.peers) peer.undo.destroy(); room.doc.destroy(); })).then(() => resolve());
    }));
  }) };
}

export function supabaseBackend(): Backend {
  const url = z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = z.string().min(1).parse(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const client = (token: string) => createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async access(token, boardId) {
      const db = client(token);
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth.user) throw new Error("Sign in required.");
      const { data: board, error } = await db.from("boards").select("owner_id").eq("id", boardId).maybeSingle();
      if (error || !board) throw new Error("Board access denied.");
      let canEdit = board.owner_id === auth.user.id;
      if (!canEdit) {
        const { data: member, error: memberError } = await db.from("board_collaborators").select("permission").eq("board_id", boardId).eq("user_id", auth.user.id).maybeSingle();
        if (memberError) throw memberError;
        canEdit = member?.permission === "editor";
      }
      const { data: stored, error: storedError } = await db.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", boardId).single();
      if (storedError || !stored) throw new Error("Board load failed.");
      return { snapshot: stored.snapshot, revision: Number(stored.revision), yjsState: stored.yjs_state, canEdit,
        user: { id: auth.user.id, name: String(auth.user.user_metadata?.display_name || auth.user.email?.split("@")[0] || "Collaborator").slice(0, 40) } };
    },
    async save(token, boardId, snapshot, revision, yjsState) {
      const { data, error } = await client(token).from("board_documents").update({ snapshot, yjs_state: yjsState, schema_version: 1, revision: revision + 1 }).eq("board_id", boardId).eq("revision", revision).select("revision");
      if (error || data?.length !== 1) throw new Error("Shared save conflicted or failed.");
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Effect.runSync(Effect.match(Effect.try({
    try: () => startSyncServer(supabaseBackend()),
    catch: () => new Error("Check the Supabase environment settings before starting board sync."),
  }), {
    onFailure: (error) => { console.error(error.message); process.exitCode = 1; },
    onSuccess: (service) => {
      service.http.on("listening", () => console.log("Board sync: ws://127.0.0.1:1235"));
      service.http.on("error", () => { console.error("Board sync could not listen on port 1235."); process.exitCode = 1; });
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
        void Effect.runPromise(Effect.match(Effect.tryPromise({ try: service.close, catch: () => new Error("Sync shutdown failed.") }), {
          onSuccess: () => process.exit(0), onFailure: () => process.exit(1),
        }));
      });
    },
  }));
}
