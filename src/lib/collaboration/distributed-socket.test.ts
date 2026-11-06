import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Effect } from "effect";
import { startDistributedSyncServer } from "../../../scripts/distributed-sync";
import { BoardAccessError } from "./distributed-board";
import type { DistributedStore } from "./distributed-board";
import type { PresenceStore } from "./distributed-store";
import type { Collaborator } from "./presence";
import { boardDocumentSchema } from "../board/model";
import { readBoard } from "./shared-board";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(check: () => boolean) { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) throw new Error("Protocol timeout"); await delay(10); } }
async function setup() {
  const boardId = randomUUID(), alice = randomUUID(), bob = randomUUID(), viewer = randomUUID(), stranger = randomUUID();
  let saved = { snapshot: boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [] }), yjsState: null as string | null, revision: 0 };
  const revoked = new Set<string>(), presence = new Map<string, { peer: Collaborator; until: number }>();
  const store: DistributedStore & PresenceStore = {
    async load(token, target) { if (revoked.has(token) || token === stranger || target !== boardId) throw new BoardAccessError("Access ended"); return { ...saved, canEdit: token !== viewer, user: { id: token, name: token } }; },
    async commit(_token, _board, revision, value) { if (revision !== saved.revision) return false; saved = { ...value, revision: revision + 1 }; return true; },
    async touch(_token, _board, peer) { presence.set(peer.id, { peer: structuredClone(peer), until: Date.now() + 45000 }); },
    async peers() { return [...presence.values()].filter((p) => p.until > Date.now()).map((p) => p.peer); },
    async remove(_token, id) { presence.delete(id); },
  };
  async function instance() {
    const service = startDistributedSyncServer(store, 0, ["http://127.0.0.1:3000"], "127.0.0.1", 30);
    const { http } = service; if (!http.listening) await once(http, "listening");
    cleanup.push(service.close);
    const address = http.address(); if (!address || typeof address === "string") throw new Error("No port");
    return address.port;
  }
  async function join(port: number, token: string, pendingRequests: string[] = []) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://127.0.0.1:3000" }), messages: any[] = [], doc = new Y.Doc();
    socket.on("message", (data) => { const frame = JSON.parse(data.toString()); messages.push(frame); if (frame.type === "state") Y.applyUpdate(doc, Buffer.from(frame.update, "base64")); });
    socket.on("error", () => {}); await once(socket, "open"); socket.send(JSON.stringify({ type: "join", token, boardId, pendingRequests }));
    await wait(() => messages.some((f) => ["state", "error"].includes(f.type)));
    cleanup.push(async () => { socket.terminate(); doc.destroy(); });
    return { socket, messages, board: () => Effect.runSync(readBoard(doc, boardId)), command: async (changes: unknown[], requestId = randomUUID()) => {
      socket.send(JSON.stringify({ type: "edit", requestId, changes })); await wait(() => messages.some((f) => f.requestId === requestId || f.type === "error")); return requestId;
    } };
  }
  const note = () => boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [{ id: randomUUID(), type: "sticky-note", text: "Shared" }] }).objects[0]!;
  return { boardId, alice, bob, viewer, stranger, revoked, presence, instance, join, note, saved: () => saved };
}
describe("distributed socket protocol", () => {
  it("delivers edits and presence between two independent servers, then resumes on another server", async () => {
    const f = await setup(), one = await f.instance(), two = await f.instance();
    const a = await f.join(one, f.alice), b = await f.join(two, f.bob);
    const id = await a.command([{ kind: "create", object: f.note() }]);
    await wait(() => b.board().objects.length === 1);
    await wait(() => a.messages.some((m) => m.type === "presence" && m.peers.some((p: Collaborator) => p.userId === f.bob)));
    a.socket.terminate(); const resumed = await f.join(two, f.alice, [id]);
    expect(resumed.messages[0]).toMatchObject({ historyReset: true, settled: [id] });
    expect(resumed.board().objects).toHaveLength(1);
  });
  it("rejects an unauthorized join and stops sending content after revocation", async () => {
    const f = await setup(), port = await f.instance(), stranger = await f.join(port, f.stranger);
    expect(stranger.messages[0]).toMatchObject({ type: "error", code: "access" });
    const a = await f.join(port, f.alice); f.revoked.add(f.alice);
    await wait(() => a.messages.some((m) => m.type === "error"));
    expect(a.messages.at(-1)).toMatchObject({ code: "access" });
  });
  it("blocks view-only writes and removes closed sockets from shared presence", async () => {
    const f = await setup(), port = await f.instance(), viewer = await f.join(port, f.viewer);
    expect(viewer.messages[0]).toMatchObject({ canEdit: false });
    await viewer.command([{ kind: "create", object: f.note() }]);
    expect(viewer.messages.some((m) => m.type === "error" && m.code === "access")).toBe(true);
    expect(f.saved().snapshot.objects).toHaveLength(0);
    await wait(() => f.presence.size === 0);
  });
});
