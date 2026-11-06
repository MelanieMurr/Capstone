import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { Effect } from "effect";
import { boardDocumentSchema } from "../../src/lib/board/model.ts";
import { readBoard } from "../../src/lib/collaboration/shared-board.ts";
const fixturePath = process.env.COCANVAS_TEST_FIXTURES;
const baseURL = process.env.COCANVAS_VERCEL_TEST_URL;

test("hosted Vercel collaboration: login, access, shared Yjs edits, reconnect and restore", { skip: !fixturePath || !baseURL, timeout: 150000 }, async () => {
  assert.match(baseURL!, /^https:\/\//);
  const accounts = JSON.parse(readFileSync(fixturePath!, "utf8"));
  // Optional private Netscape jar from `vercel curl --cookie-jar`; never log its values.
  const protection = process.env.COCANVAS_VERCEL_COOKIE_JAR;
  const cookies = protection ? readFileSync(protection, "utf8").split("\n").filter((line) => line.includes("\t")).map((line) => {
    const parts = line.replace(/^#HttpOnly_/, "").split("\t");
    return { name: parts[5]!, value: parts[6]!, domain: parts[0]!, path: parts[2]!, expires: Number(parts[4]), httpOnly: true, secure: parts[3] === "TRUE", sameSite: "Lax" as const };
  }) : [];
  const contexts = await Promise.all([0, 1, 2].map(() => request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { Origin: new URL(baseURL!).origin }, storageState: { cookies, origins: [] } })));
  const [alice, bob, guest] = contexts;
  assert.ok(alice && bob && guest);
  const sockets: WebSocket[] = [], docs: Y.Doc[] = [];
  let boardId: string | undefined;
  async function wait(check: () => boolean, message: string) {
    const deadline = Date.now() + 20000;
    while (!check()) { assert.ok(Date.now() < deadline, message); await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  async function join(context: APIRequestContext) {
    const authorization = await context.post(`/api/boards/${boardId}/sync-session`);
    assert.equal(authorization.status(), 200);
    const { token } = await authorization.json();
    const jar = await context.storageState();
    const socket = new WebSocket(`${baseURL!.replace(/^https:/, "wss:")}/api/boards/sync`, { origin: new URL(baseURL!).origin, headers: { Cookie: jar.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") } });
    sockets.push(socket); const doc = new Y.Doc(); docs.push(doc);
    const messages: any[] = [];
    let failure: Error | undefined;
    socket.on("error", () => { failure = new Error("Hosted WebSocket connection failed"); });
    socket.on("unexpected-response", (_req, response) => { response.resume(); failure = new Error(`Hosted upgrade returned ${response.statusCode}`); });
    socket.on("message", (bytes) => { const frame = JSON.parse(bytes.toString()); messages.push(frame); if (frame.type === "state") Y.applyUpdate(doc, Buffer.from(frame.update, "base64")); });
    await wait(() => socket.readyState === WebSocket.OPEN || !!failure, "WebSocket did not open"); assert.ifError(failure);
    socket.send(JSON.stringify({ type: "join", token, boardId, sessionId: randomUUID() }));
    await wait(() => messages.some((frame) => ["state", "error"].includes(frame.type)), "Join did not complete");
    assert.ok(!messages.some((frame) => frame.type === "error"), "Hosted join rejected");
    const board = () => Effect.runSync(readBoard(doc, boardId!));
    return { socket, board, messages, command: async (changes: unknown[]) => {
      const requestId = randomUUID(); socket.send(JSON.stringify({ type: "edit", changes, requestId }));
      await wait(() => messages.some((frame) => frame.requestId === requestId || frame.type === "error"), "Edit not acknowledged");
      assert.ok(!messages.some((frame) => frame.type === "error"), "Hosted edit rejected");
    } };
  }
  try {
    for (const [context, account] of [[alice, accounts.alice], [bob, accounts.bob]] as const) {
      const response = await context.post("/api/auth/signin", { data: { email: account.email, password: account.password } }); assert.equal(response.status(), 200);
    }
    assert.equal((await guest.get("/api/boards/sync")).status(), 401);
    const created = await alice.post("/api/boards", { data: { title: `Vercel test ${Date.now()}` } }); assert.equal(created.status(), 200);
    boardId = (await created.json()).id; assert.ok(boardId);
    assert.equal((await bob.get(`/api/boards/${boardId}`)).status(), 404);
    assert.equal((await alice.post(`/api/boards/${boardId}/collaborators`, { data: { email: accounts.bob.email, permission: "editor" } })).status(), 200);
    assert.equal((await alice.get("/api/boards/sync")).status(), 426);
    const a = await join(alice), b = await join(bob);
    const note = boardDocumentSchema.parse({ schemaVersion: 1, boardId, objects: [{ id: randomUUID(), type: "sticky-note", text: "Hosted binary Yjs" }] }).objects[0]!;
    await a.command([{ kind: "create", object: note }]); await wait(() => b.board().objects.length === 1, "Remote edit did not arrive");
    await Promise.all([a.command([{ kind: "patch", id: note.id, patch: { x: 321 } }]), b.command([{ kind: "patch", id: note.id, patch: { text: "Both users saved" } }])]);
    await wait(() => [a, b].every((peer) => peer.board().objects[0]?.x === 321 && JSON.stringify(peer.board().objects[0]).includes("Both users saved")), "Concurrent edits did not converge");
    await wait(() => a.messages.some((frame) => frame.type === "presence" && frame.peers.length > 0), "Shared presence missing");
    a.socket.close(); const resumed = await join(alice); assert.ok(JSON.stringify(resumed.board().objects[0]).includes("Both users saved"));
    const restored = await alice.get(`/api/boards/${boardId}`); assert.equal(restored.status(), 200);
    assert.equal((await restored.json()).document.objects[0].text, "Both users saved");
  } finally {
    for (const socket of sockets) socket.terminate(); for (const doc of docs) doc.destroy();
    if (boardId) { const response = await alice.delete(`/api/boards/${boardId}`); assert.equal(response.status(), 200, "Test board cleanup failed"); }
    for (const context of [alice, bob]) await context.post("/api/auth/signout");
    await Promise.all(contexts.map((context) => context.dispose()));
  }
});
