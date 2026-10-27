import { expect, test } from "@playwright/test";
import type { Browser, Page, WebSocketRoute } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { separateSessions, signIn, testAccounts } from "../helpers/sessions";
const accounts = testAccounts();
const object = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`);
const ready = (page: Page) => expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled({ timeout: 15_000 });
const status = (page: Page) => page.locator(".statusbar [role=status]");
async function select(page: Page, id: string) { await object(page, id).focus(); await page.keyboard.press("Enter"); }
async function add(page: Page, content: string, x = 180, y = 180) {
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x, y } });
  await page.getByRole("textbox", { name: "Object content", exact: true }).fill(content);
  return (await page.locator('[data-object-id][aria-pressed="true"]').getAttribute("data-object-id"))!;
}
async function setup(browser: Browser, share = false, intercept = false) {
  const sessions = await separateSessions(browser);
  const alice = await sessions.alice.newPage(), bob = await sessions.bob.newPage();
  await Promise.all([signIn(alice, accounts!.alice), signIn(bob, accounts!.bob)]);
  const title = `Access/recovery E2E ${Date.now()}`;
  const created = await alice.request.post("/api/boards", { data: { title } }); expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const gate = { available: true, dropAck: false, dropSend: false, client: null as WebSocketRoute | null, server: null as WebSocketRoute | null };
  if (intercept) await alice.routeWebSocket(/:1235\//, (route) => {
    if (!gate.available) { void route.close({ code: 1012, reason: "Test connection unavailable" }); return; }
    const server = route.connectToServer(); gate.client = route; gate.server = server;
    route.onMessage((message) => {
      const frame = JSON.parse(message.toString());
      if (gate.dropSend && frame.type === "edit") {
        gate.dropSend = false; gate.available = false;
        void Promise.allSettled([route.close({ code: 1012, reason: "Test interrupted send" }), server.close()]);
      } else server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(message.toString());
      if (gate.dropAck && frame.type === "state" && frame.requestId) {
        gate.dropAck = false; gate.available = false;
        void Promise.allSettled([route.close({ code: 1012, reason: "Test lost saved acknowledgement" }), server.close()]);
      } else route.send(message);
    });
  });
  if (share) {
    const granted = await alice.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.bob.email, permission: "editor" } }); expect(granted.ok()).toBe(true);
  }
  await alice.goto(`/boards/${id}`); await ready(alice);
  if (share) { await bob.goto(`/boards/${id}`); await ready(bob); }
  return { alice, bob, id, title, gate, cleanup: async () => {
    await Promise.all([alice.goto("/dashboard"), bob.goto("/dashboard")]);
    const removed = await alice.request.delete(`/api/boards/${id}`); expect(removed.ok()).toBe(true);
    await sessions.close();
  } };
}

test.describe("registered access and connection recovery", () => {
  test.setTimeout(120_000);
  test.skip(!accounts, "Provide private dedicated test account fixtures.");
  test("owner grants registered access through Share; recipient dashboard works; non-owners cannot grant", async ({ browser }) => {
    const f = await setup(browser); const { alice, bob, id, title } = f;
    try {
      expect((await bob.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.alice.email, permission: "editor" } })).status()).toBe(403);
      await expect(bob.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
      await alice.getByRole("button", { name: "Share board", exact: true }).click();
      const dialog = alice.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "Collaborator email", exact: true }).fill(`missing-${Date.now()}@example.test`);
      await dialog.getByRole("button", { name: "Grant access", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("No registered account");
      await dialog.getByRole("textbox", { name: "Collaborator email", exact: true }).fill(accounts!.bob.email.toUpperCase());
      await dialog.getByRole("button", { name: "Grant access", exact: true }).click();
      await expect(dialog.getByRole("status")).toContainText("Editor access granted");
      await alice.getByRole("button", { name: "Close sharing dialog", exact: true }).click();
      await bob.reload(); await bob.getByRole("link", { name: `Open ${title}`, exact: true }).click(); await ready(bob);
      const note = await add(bob, "Collaborator can edit"); await expect(object(alice, note)).toHaveAccessibleName("sticky-note: Collaborator can edit");
      await bob.getByRole("button", { name: "Share board", exact: true }).click();
      await expect(bob.getByRole("dialog")).toContainText("Only the board owner");
      await expect(bob.getByRole("button", { name: "Grant access", exact: true })).toHaveCount(0);
      expect((await bob.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.alice.email, permission: "editor" } })).status()).toBe(403);
      // Calling the database RPC directly cannot bypass the owner check either.
      process.loadEnvFile(".env.local");
      const tokenResponse = await bob.request.post(`/api/boards/${id}/sync-session`); const { token } = await tokenResponse.json();
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      const denied = await db.rpc("grant_board_access", { p_board_id: id, p_email: accounts!.alice.email, p_permission: "editor" }); expect(denied.error?.code).toBe("42501");
      await bob.getByRole("button", { name: "Close sharing dialog", exact: true }).click();
      const viewer = await alice.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.bob.email, permission: "viewer" } }); expect(viewer.ok()).toBe(true);
      await bob.reload(); await expect(status(bob)).toContainText("view-only");
      await expect(bob.getByRole("button", { name: "Sticky note", exact: true })).toBeDisabled();
      await expect(object(bob, note)).toHaveAccessibleName("sticky-note: Collaborator can edit");
    } finally { await f.cleanup(); }
  });
  test("reconnects without refresh after the other user edits, then resumes two-way editing", async ({ browser }) => {
    const f = await setup(browser, true, true); const { alice, bob, gate } = f;
    try {
      const note = await add(alice, "Before disconnect"); await expect(object(bob, note)).toHaveCount(1);
      await expect(status(alice)).toContainText("shared changes saved");
      await alice.evaluate(() => Reflect.set(window, "recoveryMarker", "same page"));
      gate.available = false; await Promise.allSettled([gate.client!.close({ code: 1012, reason: "Test network loss" }), gate.server!.close()]);
      await expect(status(alice)).toContainText("Reconnecting");
      await expect(alice.getByRole("button", { name: "Sticky note", exact: true })).toBeDisabled();
      await select(bob, note); await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Edited while Alice disconnected");
      const other = await add(bob, "New while disconnected", 480, 180);
      await expect(status(bob)).toContainText("shared changes saved");
      gate.available = true; await ready(alice);
      expect(await alice.evaluate(() => Reflect.get(window, "recoveryMarker"))).toBe("same page");
      await expect(object(alice, note)).toHaveAccessibleName("sticky-note: Edited while Alice disconnected");
      await expect(object(alice, other)).toHaveAccessibleName("sticky-note: New while disconnected");
      await select(alice, note); await alice.getByRole("spinbutton", { name: "width", exact: true }).fill("320");
      await expect(object(bob, note)).toHaveCSS("width", "320px");
    } finally { await f.cleanup(); }
  });
  test("replays an edit interrupted before sending and preserves another user's changes", async ({ browser }) => {
    const f = await setup(browser, true, true); const { alice, bob, gate } = f;
    try {
      const note = await add(alice, "Initial text"); await expect(object(bob, note)).toHaveCount(1);
      await expect(status(alice)).toContainText("shared changes saved"); await select(bob, note);
      gate.dropSend = true;
      await alice.getByRole("spinbutton", { name: "width", exact: true }).fill("333");
      await expect(status(alice)).toContainText("Reconnecting");
      await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Text from the online user");
      const other = await add(bob, "Another online change", 480, 180); await expect(status(bob)).toContainText("shared changes saved");
      gate.available = true; await ready(alice); await expect(status(alice)).toContainText("shared changes saved");
      for (const page of [alice, bob]) {
        await expect(object(page, note)).toHaveCSS("width", "333px");
        await expect(object(page, note)).toHaveAccessibleName("sticky-note: Text from the online user");
        await expect(object(page, other)).toHaveAccessibleName("sticky-note: Another online change");
      }
    } finally { await f.cleanup(); }
  });
  test("a saved creation with a lost acknowledgement is recovered once while remote edits survive", async ({ browser }) => {
    const f = await setup(browser, true, true); const { alice, bob, id, gate } = f;
    try {
      const existing = await add(bob, "Remote original", 480, 180); await expect(object(alice, existing)).toHaveCount(1);
      await alice.evaluate(() => Reflect.set(window, "recoveryMarker", "no reload"));
      gate.dropAck = true;
      await alice.getByRole("button", { name: "Sticky note", exact: true }).click(); await alice.getByRole("region", { name: "Board canvas" }).click({ position: { x: 180, y: 180 } });
      const created = (await alice.locator('[data-object-id][aria-pressed="true"]').getAttribute("data-object-id"))!;
      await expect(status(alice)).toContainText("Reconnecting");
      await select(bob, existing); await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Remote edit retained");
      await expect(status(bob)).toContainText("shared changes saved");
      const revision = (await (await bob.request.get(`/api/boards/${id}`)).json()).revision;
      gate.available = true; await ready(alice); await expect(status(alice)).toContainText("shared changes saved");
      expect(await alice.evaluate(() => Reflect.get(window, "recoveryMarker"))).toBe("no reload");
      await expect(object(alice, existing)).toHaveAccessibleName("sticky-note: Remote edit retained"); await expect(object(alice, created)).toHaveCount(1);
      await expect(object(bob, created)).toHaveCount(1);
      expect((await (await bob.request.get(`/api/boards/${id}`)).json()).revision).toBe(revision);
      await select(alice, created); await alice.getByRole("textbox", { name: "Object content", exact: true }).fill("Editing resumed");
      await expect(object(bob, created)).toHaveAccessibleName("sticky-note: Editing resumed");
    } finally { await f.cleanup(); }
  });
});
