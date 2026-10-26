import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Effect } from "effect";
import { startSyncServer, supabaseBackend } from "../../scripts/board-sync.ts";
import { boardDocumentSchema } from "../../src/lib/board/model.ts";
import { decodeState } from "../../src/lib/collaboration/persistence.ts";
import { readBoard } from "../../src/lib/collaboration/shared-board.ts";

// Explicit opt-in. Only this test's board and membership are created/deleted.
const file = process.env.COCANVAS_TEST_FIXTURES;
test("Supabase bytea survives room-server shutdown with no JSON snapshot", { skip: !file, timeout: 60_000 }, async () => {
  const accounts = JSON.parse(readFileSync(file!, "utf8"));
  const client = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = client(), collaborator = client();
  const [alice, bob] = await Promise.all([owner.auth.signInWithPassword(accounts.alice), collaborator.auth.signInWithPassword(accounts.bob)]);
  assert.equal(alice.error, null); assert.equal(bob.error, null);
  const created = await owner.rpc("create_board", { p_title: `Binary persistence test ${Date.now()}` });
  assert.equal(created.error, null); const id = created.data.id as string;
  let service: ReturnType<typeof startSyncServer> | undefined;
  const docs: Y.Doc[] = [];
  try {
    const membership = await owner.from("board_collaborators").insert({ board_id: id, user_id: accounts.bob.id, permission: "editor" }); assert.equal(membership.error, null);
    const note = crypto.randomUUID(), shape = crypto.randomUUID(), text = crypto.randomUUID(), ellipse = crypto.randomUUID();
    const snapshot = boardDocumentSchema.parse({ schemaVersion: 1, boardId: id, objects: [
      { id: note, type: "sticky-note", text: "Durable 🌱", x: -20, y: 180, width: 240, height: 190 },
      { id: shape, type: "shape", text: "Rectangle label", x: 400, y: 200, rotation: 45 },
      { id: text, type: "text", content: "Standalone", fontSize: 30, x: 700, y: 200 },
      { id: ellipse, type: "shape", shapeType: "ellipse", text: "Ellipse label", x: 400, y: 500 },
      { id: crypto.randomUUID(), type: "connector", start: { kind: "attached", objectId: note, anchorX: 1, anchorY: 0.5 }, end: { kind: "attached", objectId: shape, anchorX: 0, anchorY: 0.5 } },
    ] });
    const seeded = await owner.from("board_documents").update({ snapshot, revision: 1 }).eq("board_id", id).eq("revision", 0).select("revision");
    assert.equal(seeded.error, null); assert.equal(seeded.data?.length, 1);
    async function start() {
      service = startSyncServer(supabaseBackend(), 0);
      if (!service.http.listening) await once(service.http, "listening");
    }
    async function join(token: string) {
      const address = service!.http.address(); assert.ok(address && typeof address !== "string");
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, { origin: "http://127.0.0.1:3000" });
      const doc = new Y.Doc({ gc: false }); docs.push(doc);
      const messages: { type: string; requestId?: string }[] = [];
      socket.on("message", (bytes) => { const message = JSON.parse(bytes.toString()); if (message.type === "state") Y.applyUpdate(doc, Buffer.from(message.update, "base64")); messages.push(message); });
      async function wait(predicate: (frame: { type: string; requestId?: string }) => boolean) {
        const deadline = Date.now() + 10_000;
        while (!messages.some(predicate)) { assert.ok(Date.now() < deadline, "Timed out waiting for saved state"); assert.ok(!messages.some((m) => m.type === "error"), "Room rejected the operation"); await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
      await once(socket, "open"); socket.send(JSON.stringify({ type: "join", boardId: id, token })); await wait((m) => m.type === "state");
      return { doc, edit: async (objectId: string, patch: Record<string, unknown>) => {
        const requestId = crypto.randomUUID(); socket.send(JSON.stringify({ type: "edit", requestId, changes: [{ kind: "patch", id: objectId, patch }] })); await wait((m) => m.requestId === requestId);
      } };
    }
    await start(); const first = await join(alice.data.session!.access_token);
    await first.edit(note, { text: "Saved as real binary" });
    const before = Effect.runSync(readBoard(first.doc, id)), vector = Y.encodeStateVector(first.doc);
    const saved = await owner.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", id).single(); assert.equal(saved.error, null);
    const bytes = Effect.runSync(decodeState(saved.data!.yjs_state)); assert.ok(bytes.byteLength > 0);
    const verified = new Y.Doc({ gc: false }); docs.push(verified); Y.applyUpdate(verified, bytes);
    assert.deepEqual(Effect.runSync(readBoard(verified, id)), before);
    await service!.close(); service = undefined;
    const cleared = await owner.from("board_documents").update({ snapshot: null, revision: saved.data!.revision + 1 }).eq("board_id", id).eq("revision", saved.data!.revision).select("revision");
    assert.equal(cleared.error, null); assert.equal(cleared.data?.length, 1);
    await start(); const reopened = await join(bob.data.session!.access_token);
    assert.deepEqual(Effect.runSync(readBoard(reopened.doc, id)), before);
    assert.deepEqual(Y.encodeStateVector(reopened.doc), vector, "Must retain original Yjs struct identities");
    await reopened.edit(shape, { text: "Collaborator after restart", x: 520 });
    const after = await owner.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", id).single(); assert.equal(after.error, null);
    assert.equal(after.data!.snapshot.objects.find((o: { id: string }) => o.id === shape).text, "Collaborator after restart");
    assert.ok(after.data!.yjs_state.startsWith("\\x"));
  } finally {
    if (service) await service.close();
    for (const doc of docs) doc.destroy();
    const removed = await owner.from("boards").delete().eq("id", id).select("id"); assert.equal(removed.error, null); assert.equal(removed.data?.length, 1);
  }
});
