import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { WebSocket } from "ws";
import { z } from "zod";
import { BoardAccessError, openDistributedBoard } from "./distributed-board.ts";
import type { DistributedBoard, DistributedStore } from "./distributed-board.ts";
import type { PresenceStore } from "./distributed-store.ts";
import { changeSchema } from "./shared-board.ts";
import { collaboratorColor, cursorSchema } from "./presence.ts";
import type { Collaborator } from "./presence.ts";

const frameSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("join"), boardId: z.uuid(), token: z.string().min(1).max(16384), sessionId: z.uuid().optional(), pendingRequests: z.array(z.uuid()).max(2000).default([]) }),
  z.strictObject({ type: z.literal("edit"), requestId: z.uuid(), changes: z.array(changeSchema).max(2000) }),
  z.strictObject({ type: z.enum(["undo", "redo", "capture"]), requestId: z.uuid() }),
  z.strictObject({ type: z.literal("cursor"), cursor: cursorSchema }),
]);
/** Each socket has a bounded serial queue; shared storage coordinates different instances. */
export function attachDistributedSocket(socket: WebSocket, store: DistributedStore & PresenceStore, pollMs = 1000) {
  let board: DistributedBoard | undefined, token = "", boardId = "", peer: Collaborator | undefined;
  let closed = false, queued = 0, alive = true, lastPresence = 0, lastCursor = 0;
  let queue = Promise.resolve();
  let finished!: () => void;
  const drained = new Promise<void>((resolve) => { finished = resolve; });
  const send = (value: unknown) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 12 * 1024 * 1024) { socket.close(1013, "Slow connection; reconnect"); return; }
    socket.send(JSON.stringify(value));
  };
  function fail(error: unknown) {
    if (closed) return;
    const denied = error instanceof BoardAccessError;
    send({ type: "error", code: denied ? "access" : "retry", message: denied ? error.message : "Shared connection interrupted. Reconnecting with unsent edits retained…" });
    socket.close(denied ? 1008 : 1013);
  }
  function enqueue(work: () => Promise<void>) {
    if (closed) return;
    if (++queued > 64) { queued--; fail(new Error("Too many pending frames.")); return; }
    queue = queue.then(async () => {
      if (!closed) await Effect.runPromise(Effect.match(Effect.tryPromise({ try: work, catch: (e) => e }), { onSuccess: () => undefined, onFailure: fail }));
    }).finally(() => { queued--; });
  }
  const joinTimeout = setTimeout(() => socket.close(1008, "Join required"), 5000);
  const lifetime = setTimeout(() => socket.close(1001, "Renew connection"), 240000);
  const heartbeat = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    alive = false; socket.ping();
  }, 15000);
  socket.on("pong", () => { alive = true; });
  const poll = setInterval(() => {
    // Never build a polling backlog while a slow database call is in progress.
    if (!board || queued || closed) return;
    enqueue(async () => {
      const update = await Effect.runPromise(board!.poll());
      if (update) send(update);
      if (!peer) return;
      if (Date.now() - lastPresence > 10000) { await store.touch(token, boardId, peer); lastPresence = Date.now(); }
      send({ type: "presence", peers: (await store.peers(token, boardId)).filter((p) => p.id !== peer!.id) });
    });
  }, pollMs);
  socket.on("message", (bytes, binary) => enqueue(async () => {
    if (binary || Buffer.byteLength(bytes.toString()) > 256 * 1024) throw new BoardAccessError("Invalid sync frame.");
    const parsed = frameSchema.safeParse(JSON.parse(bytes.toString()));
    if (!parsed.success) throw new BoardAccessError("Invalid sync request.");
    const frame = parsed.data;
    if (frame.type === "join") {
      if (board) throw new BoardAccessError("Already joined.");
      token = frame.token; boardId = frame.boardId;
      const opened = await Effect.runPromise(openDistributedBoard(store, token, boardId));
      if (closed) { opened.close(); return; }
      board = opened; clearTimeout(joinTimeout);
      peer = { id: randomUUID(), userId: board.user.id, name: board.user.name, color: collaboratorColor(board.user.id), cursor: null };
      await store.touch(token, boardId, peer); lastPresence = Date.now();
      send(board.initial(frame.pendingRequests));
      return;
    }
    if (!board || !peer) throw new BoardAccessError("Join first.");
    if (frame.type === "cursor") {
      // Presence is deliberately coarser than the local renderer to bound DB writes.
      if (frame.cursor !== null && Date.now() - lastCursor < 250) return;
      const update = await Effect.runPromise(board.poll()); // Recheck authorization before publishing presence.
      if (update) send(update);
      peer.cursor = frame.cursor; lastCursor = Date.now();
      await store.touch(token, boardId, peer); lastPresence = Date.now();
    } else send(await Effect.runPromise(board.command(frame)));
  }));
  socket.on("error", () => {});
  socket.on("close", () => {
    closed = true; clearTimeout(lifetime); clearInterval(poll); clearInterval(heartbeat); clearTimeout(joinTimeout);
    // Let an accepted command finish; its receipt settles an acknowledgement lost on close.
    void queue.then(async () => {
      board?.close();
      if (peer) await Effect.runPromise(Effect.match(Effect.tryPromise({ try: () => store.remove(token, peer!.id), catch: () => new Error("Presence cleanup deferred to expiry.") }), { onSuccess: () => undefined, onFailure: () => undefined }));
    }).finally(finished);

  });
  return drained;
}
