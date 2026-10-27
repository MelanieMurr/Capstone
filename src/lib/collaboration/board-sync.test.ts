import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Effect } from "effect";
import { startSyncServer } from "../../../scripts/board-sync";
import { boardDocumentSchema } from "../board/model";
import type { BoardDocument } from "../board/model";
import { readBoard } from "./shared-board";
const a = "60000000-0000-4000-8000-000000000001", b = "60000000-0000-4000-8000-000000000002";
const objectId = "60000000-0000-4000-8000-000000000003";
const empty = (boardId: string) => boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [] });
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const stored = new Map([a, b].map((id) => [id, { snapshot: empty(id), revision: 0, yjsState: null as string | null }]));
  const backend: Parameters<typeof startSyncServer>[0] = {
    async access(token, id) {
      if (!["alice", "bob", "viewer"].includes(token) || !stored.has(id) || (id === b && token !== "alice")) throw new Error("Denied");
      return { ...stored.get(id)!, canEdit: token !== "viewer", user: { id: token === "alice" ? a : b, name: token } };
    },
    async save(_token, id, snapshot, revision, yjsState) {
      if (stored.get(id)?.revision !== revision) throw new Error("Conflict");
      stored.set(id, { snapshot, revision: revision + 1, yjsState });
    },
  };
  let service = startSyncServer(backend, 0);
  cleanup.push(() => service.close());
  if (!service.http.listening) await once(service.http, "listening");
  let address = service.http.address(); if (!address || typeof address === "string") throw new Error("No port");
  async function join(token: string, boardId: string, options: { sessionId?: string; pendingRequests?: string[] } = {}) {
    const socket = new WebSocket(`ws://127.0.0.1:${address && typeof address !== "string" ? address.port : 0}`, { origin: "http://127.0.0.1:3000" });
    const doc = new Y.Doc(); const messages: any[] = []; // Protocol fixture deliberately inspects raw frames.
    socket.on("message", (bytes) => { const frame = JSON.parse(bytes.toString()); messages.push(frame); if (frame.type === "state") Y.applyUpdate(doc, Buffer.from(frame.update, "base64")); });
    await once(socket, "open"); socket.send(JSON.stringify({ type: "join", token, boardId, ...options }));
    async function wait(predicate: (frame: any) => boolean) {
      const deadline = Date.now() + 2000;
      while (!messages.some(predicate)) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for protocol frame");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return messages.find(predicate);
    }
    return { socket, doc, messages, wait, board: () => Effect.runSync(readBoard(doc, boardId)), command: async (type: string, changes?: unknown[]) => {
      const requestId = crypto.randomUUID(); socket.send(JSON.stringify({ type, requestId, ...(changes ? { changes } : {}) }));
      return wait((frame) => frame.requestId === requestId);
    } };
  }
  return { join, stored, backend, restart: async () => {
    await service.close(); service = startSyncServer(backend, 0);
    if (!service.http.listening) await once(service.http, "listening");
    address = service.http.address();
  } };
}
describe("authenticated board-room protocol", () => {
  it("syncs create/edit/move/resize/delete in both directions and isolates boards", async () => {
    const { join, stored } = await setup(); const alice = await join("alice", a), bob = await join("bob", a), other = await join("alice", b);
    await Promise.all([alice, bob, other].map((peer) => peer.wait((f) => f.type === "state")));
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id: objectId, type: "sticky-note", text: "First" }] }).objects[0]!;
    await alice.command("edit", [{ kind: "create", object: note }]);
    await bob.wait(() => bob.board().objects.length === 1);
    await bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "From Bob", x: 240, width: 320, height: 220 } }]);
    await alice.wait(() => alice.board().objects[0]?.x === 240);
    expect(alice.board().objects[0]).toMatchObject({ text: "From Bob", x: 240, width: 320, height: 220 });
    await alice.command("capture"); await alice.command("edit", [{ kind: "patch", id: objectId, patch: { y: 95 } }]);
    await alice.command("undo"); expect(alice.board().objects[0]).toMatchObject({ y: 0, text: "From Bob", x: 240 });
    await bob.command("edit", [{ kind: "delete", id: objectId }]);
    await alice.wait(() => alice.board().objects.length === 0);
    expect(other.board()).toEqual(empty(b)); expect(other.messages.filter((f) => f.type === "state")).toHaveLength(1);
    expect(stored.get(a)?.snapshot.objects).toHaveLength(0); expect(stored.get(a)?.revision).toBe(5);
  });
  it("preserves simultaneous object creation and edits to different objects", async () => {
    const { join } = await setup(); const alice = await join("alice", a), bob = await join("bob", a);
    await Promise.all([alice, bob].map((peer) => peer.wait((f) => f.type === "state")));
    const secondId = "60000000-0000-4000-8000-000000000004";
    const note = (id: string) => boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id, type: "sticky-note" }] }).objects[0]!;
    await Promise.all([alice.command("edit", [{ kind: "create", object: note(objectId) }]), bob.command("edit", [{ kind: "create", object: note(secondId) }])]);
    await Promise.all([alice.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Alice" } }]), bob.command("edit", [{ kind: "patch", id: secondId, patch: { text: "Bob" } }])]);
    await alice.wait(() => JSON.stringify(alice.board()) === JSON.stringify(bob.board()));
    expect(alice.board().objects).toEqual(expect.arrayContaining([expect.objectContaining({ id: objectId, text: "Alice" }), expect.objectContaining({ id: secondId, text: "Bob" })]));
  });
  it("merges different fields, converges on same-field conflicts, and does not resurrect deleted objects", async () => {
    const { join, stored } = await setup(); const alice = await join("alice", a), bob = await join("bob", a);
    await Promise.all([alice, bob].map((peer) => peer.wait((f) => f.type === "state")));
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id: objectId, type: "sticky-note" }] }).objects[0]!;
    await alice.command("edit", [{ kind: "create", object: note }]); await bob.wait(() => bob.board().objects.length === 1);
    await Promise.all([alice.command("edit", [{ kind: "patch", id: objectId, patch: { x: 190, width: 280 } }]), bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Independent text" } }])]);
    await alice.wait(() => JSON.stringify(alice.board()) === JSON.stringify(bob.board()));
    expect(alice.board().objects[0]).toMatchObject({ x: 190, width: 280, text: "Independent text" });
    await Promise.all([alice.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Same field A" } }]), bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Same field B" } }])]);
    await alice.wait(() => JSON.stringify(alice.board()) === JSON.stringify(bob.board()));
    expect(["Same field A", "Same field B"]).toContain((alice.board().objects[0] as { text: string }).text);
    expect(alice.board()).toEqual(stored.get(a)?.snapshot);
    await alice.command("edit", [{ kind: "delete", id: objectId }]);
    await bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Late stale edit" } }]);
    await alice.wait(() => JSON.stringify(alice.board()) === JSON.stringify(bob.board())); expect(alice.board().objects).toHaveLength(0);
  });
  it("announces join, cursor, cursor hiding and leave only within the board", async () => {
    const { join, stored } = await setup(); const alice = await join("alice", a), other = await join("alice", b);
    await Promise.all([alice, other].map((peer) => peer.wait((f) => f.type === "presence")));
    const bob = await join("bob", a);
    await alice.wait((f) => f.type === "presence" && f.peers.some((p: { name: string }) => p.name === "bob"));
    bob.socket.send(JSON.stringify({ type: "cursor", cursor: { x: 270, y: -80 } }));
    await alice.wait((f) => f.type === "presence" && f.peers.some((p: { cursor: { x: number } | null }) => p.cursor?.x === 270));
    bob.socket.send(JSON.stringify({ type: "cursor", cursor: null }));
    await alice.wait(() => { const latest = alice.messages.filter((f) => f.type === "presence").at(-1); return latest?.peers.length === 1 && latest.peers[0].cursor === null; });
    expect(other.messages.filter((f) => f.type === "presence").at(-1).peers).toEqual([]);
    expect(stored.get(a)?.revision).toBe(0); // Presence never writes board snapshots.
    bob.socket.close();
    await alice.wait(() => alice.messages.filter((f) => f.type === "presence").at(-1)?.peers.length === 0);
  });
  it("restores a fresh server room from binary after shutdown without relying on a snapshot", async () => {
    const { join, stored, restart } = await setup(); const alice = await join("alice", a);
    await alice.wait((f) => f.type === "state");
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id: objectId, type: "sticky-note", text: "Survives server shutdown" }] }).objects[0]!;
    await alice.command("edit", [{ kind: "create", object: note }]);
    const vector = Y.encodeStateVector(alice.doc);
    expect(stored.get(a)?.yjsState).toMatch(/^\\x[0-9a-f]+$/);
    stored.get(a)!.snapshot = empty(a); // Prove restoration is not a new JSON seed.
    await restart(); const bob = await join("bob", a); await bob.wait((f) => f.type === "state");
    expect(bob.board().objects[0]).toMatchObject(note); expect(Y.encodeStateVector(bob.doc)).toEqual(vector);
    await bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Editing resumed" } }]);
    expect(stored.get(a)?.snapshot.objects[0]).toMatchObject({ text: "Editing resumed" });
  });
  it("reports storage failure without broadcasting an unsaved edit", async () => {
    const { join, backend, stored } = await setup(); const alice = await join("alice", a);
    await alice.wait((f) => f.type === "state"); backend.save = async () => { throw new Error("Unavailable database"); };
    alice.socket.send(JSON.stringify({ type: "edit", requestId: crypto.randomUUID(), changes: [] }));
    await alice.wait((f) => f.type === "error");
    expect(stored.get(a)?.revision).toBe(0); expect(alice.messages.filter((f) => f.type === "state")).toHaveLength(1);
  });
  it("reports a corrupt binary load instead of replacing history from its snapshot", async () => {
    const { join, stored } = await setup(); stored.get(a)!.yjsState = "\\xff";
    const alice = await join("alice", a); await alice.wait((f) => f.type === "error");
    expect(alice.messages.some((f) => f.type === "state")).toBe(false); expect(stored.get(a)?.revision).toBe(0);
  });
  it("settles a saved request after reconnect and restart without applying it twice", async () => {
    const { join, stored, restart } = await setup(); const sessionId = crypto.randomUUID();
    const alice = await join("alice", a, { sessionId }); await alice.wait((f) => f.type === "state");
    const requestId = crypto.randomUUID();
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id: objectId, type: "sticky-note", text: "Exactly once" }] }).objects[0]!;
    alice.socket.send(JSON.stringify({ type: "edit", requestId, changes: [{ kind: "create", object: note }] }));
    await alice.wait(() => stored.get(a)?.revision === 1);
    await restart();
    const resumed = await join("alice", a, { sessionId, pendingRequests: [requestId] });
    const state = await resumed.wait((f) => f.type === "state"); expect(state.settled).toEqual([requestId]); expect(state.historyReset).toBe(true);
    resumed.socket.send(JSON.stringify({ type: "edit", requestId, changes: [{ kind: "create", object: note }] }));
    await resumed.wait((f) => f.type === "ack" && f.requestId === requestId);
    expect(stored.get(a)?.revision).toBe(1); expect(resumed.board().objects).toHaveLength(1);
  });
  it("keeps per-tab undo across a transport reconnect and preserves another user's text", async () => {
    const { join } = await setup(); const sessionId = crypto.randomUUID();
    const alice = await join("alice", a, { sessionId }), bob = await join("bob", a);
    await Promise.all([alice, bob].map((peer) => peer.wait((f) => f.type === "state")));
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId: a, objects: [{ id: objectId, type: "sticky-note" }] }).objects[0]!;
    await alice.command("edit", [{ kind: "create", object: note }]); await alice.command("capture");
    await alice.command("edit", [{ kind: "patch", id: objectId, patch: { x: 250 } }]);
    await bob.command("edit", [{ kind: "patch", id: objectId, patch: { text: "Bob's text" } }]);
    alice.socket.close(); await once(alice.socket, "close");
    const resumed = await join("alice", a, { sessionId }); const state = await resumed.wait((f) => f.type === "state");
    expect(state.historyReset).toBe(false); expect(state.canUndo).toBe(true);
    await resumed.command("undo"); expect(resumed.board().objects[0]).toMatchObject({ x: 0, text: "Bob's text" });
  });
  it("rejects invalid tokens before sending board data", async () => {
    const { join } = await setup(); const bad = await join("invalid", a);
    await bad.wait((f) => f.type === "error"); expect(bad.messages.some((f) => f.type === "state")).toBe(false);
  });
  it("rejects a user who has no membership in the requested board", async () => {
    const { join } = await setup(); const bad = await join("bob", b);
    await bad.wait((f) => f.type === "error"); expect(bad.messages.some((f) => f.type === "state")).toBe(false);
  });
  it("allows a viewer to read, but refuses their edits", async () => {
    const { join, stored } = await setup(); const viewer = await join("viewer", a);
    const state = await viewer.wait((f) => f.type === "state"); expect(state.canEdit).toBe(false);
    viewer.socket.send(JSON.stringify({ type: "edit", requestId: crypto.randomUUID(), changes: [] }));
    await viewer.wait((f) => f.type === "error"); expect(stored.get(a)?.revision).toBe(0);
  });
});
