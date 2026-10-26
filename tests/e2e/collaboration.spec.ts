import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { separateSessions, signIn, testAccounts } from "../helpers/sessions";
import type { BoardDocument } from "../../src/lib/board/model";

// Opt-in: use dedicated users; each test creates and deletes only its own boards.
const accounts = testAccounts();
const object = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`);
const canvas = (page: Page) => page.getByRole("region", { name: "Board canvas" });
async function add(page: Page, tool: string, content: string, x = 180, y = 170) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await canvas(page).click({ position: { x, y } });
  await page.getByRole("textbox", { name: "Object content", exact: true }).fill(content);
  return (await page.locator('[data-object-id][aria-pressed="true"]').getAttribute("data-object-id"))!;
}
async function select(page: Page, id: string) { await object(page, id).focus(); await page.keyboard.press("Enter"); }
async function ready(page: Page) { await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled(); }
async function snapshot(page: Page, id: string): Promise<BoardDocument> { return (await (await page.request.get(`/api/boards/${id}`)).json()).document; }

test.describe("private shared-board collaboration", () => {
  test.setTimeout(120_000);
  test.skip(!accounts, "Set COCANVAS_TEST_FIXTURES to dedicated confirmed test users.");
  async function fixture(browser: Parameters<typeof separateSessions>[0]) {
    const sessions = await separateSessions(browser);
    const alice = await sessions.alice.newPage(), bob = await sessions.bob.newPage();
    await Promise.all([signIn(alice, accounts!.alice), signIn(bob, accounts!.bob)]);
    const boards: string[] = [];
    async function create(suffix: string) {
      const response = await alice.request.post("/api/boards", { data: { title: `Collaboration E2E ${suffix} ${Date.now()}` } });
      expect(response.ok()).toBe(true); const { id } = await response.json(); boards.push(id); return id as string;
    }
    const id = await create("shared"), isolatedId = await create("isolated");
    const tokenResponse = await alice.request.post(`/api/boards/${id}/sync-session`);
    expect(tokenResponse.ok()).toBe(true); const { token } = await tokenResponse.json();
    // This is the owner's normal RLS-protected Data API, never an admin/service key.
    process.loadEnvFile(".env.local");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const membership = await db.from("board_collaborators").insert({ board_id: id, user_id: accounts!.bob.id, permission: "editor" });
    expect(membership.error).toBeNull();
    await Promise.all([alice.goto(`/boards/${id}`), bob.goto(`/boards/${id}`)]);
    await Promise.all([ready(alice), ready(bob)]);
    return { alice, bob, id, isolatedId, sessions, cleanup: async () => {
      await Promise.all([alice.goto("/dashboard"), bob.goto("/dashboard")]);
      for (const boardId of boards) await alice.request.delete(`/api/boards/${boardId}`);
      await sessions.close();
    } };
  }

  test("all object types sync in both directions, survive reopening, and stay in their room", async ({ browser }) => {
    const f = await fixture(browser); const { alice, bob, id } = f;
    try {
      const isolated = await f.sessions.alice.newPage(); await isolated.goto(`/boards/${f.isolatedId}`); await ready(isolated);
      const note = await add(alice, "Sticky note", "Shared note A");
      await expect(object(bob, note)).toHaveAccessibleName("sticky-note: Shared note A");
      await select(bob, note); await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Edited by B");
      await expect(object(alice, note)).toHaveAccessibleName("sticky-note: Edited by B");
      // A real pointer drag commits only the changed geometry at release.
      const box = (await object(bob, note).boundingBox())!;
      await bob.mouse.move(box.x + 20, box.y + 20); await bob.mouse.down(); await bob.mouse.move(box.x + 88, box.y + 54, { steps: 5 }); await bob.mouse.up();
      await expect.poll(async () => (await object(alice, note).getAttribute("style"))).toContain("left: 250.588");
      await select(alice, note);
      const width = Number(await alice.getByRole("spinbutton", { name: "width", exact: true }).inputValue());
      const handle = (await alice.getByRole("button", { name: "Resize bottom-right", exact: true }).boundingBox())!;
      await alice.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await alice.mouse.down();
      await alice.mouse.move(handle.x + handle.width / 2 + 34, handle.y + handle.height / 2 + 17, { steps: 4 }); await alice.mouse.up();
      await expect(object(bob, note)).toHaveCSS("width", `${width + 40}px`);
      const text = await add(bob, "Text", "Shared text B", 480, 160);
      await expect(object(alice, text)).toHaveAccessibleName("text: Shared text B");
      const shape = await add(alice, "Shape", "Shared shape A", 180, 390);
      await expect(object(bob, shape)).toHaveAccessibleName("shape: rectangle: Shared shape A");
      await select(bob, shape); await bob.getByRole("combobox", { name: "Shape type", exact: true }).selectOption("ellipse");
      await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Labeled by B");
      await expect(object(alice, shape)).toHaveAccessibleName("shape: ellipse: Labeled by B");
      await alice.getByRole("button", { name: "Connector", exact: true }).click(); await select(alice, note); await select(alice, shape);
      const connector = (await alice.locator('g[data-object-id][aria-pressed="true"]').getAttribute("data-object-id"))!;
      await expect(object(bob, connector)).toHaveCount(1);
      await select(bob, shape); await bob.getByRole("button", { name: "Delete object", exact: true }).click();
      await expect(object(alice, shape)).toHaveCount(0); await expect(object(alice, connector)).toHaveCount(0);
      await select(alice, text); await alice.getByRole("button", { name: "Delete object", exact: true }).click(); await expect(object(bob, text)).toHaveCount(0);
      await expect(isolated.locator("[data-object-id]")).toHaveCount(0);
      expect((await bob.request.get(`/api/boards/${f.isolatedId}`)).status()).toBe(404);
      expect((await bob.request.post(`/api/boards/${f.isolatedId}/sync-session`)).status()).toBe(404);
      await expect.poll(async () => (await snapshot(alice, id)).objects.length).toBe(1);
      await Promise.all([alice.reload(), bob.reload()]); await Promise.all([ready(alice), ready(bob)]);
      await expect(object(alice, note)).toHaveAccessibleName("sticky-note: Edited by B"); await expect(object(bob, note)).toHaveCSS("width", `${width + 40}px`);
    } finally { await f.cleanup(); }
  });

  test("presence joins/leaves and cursor coordinates follow each viewer's pan and zoom", async ({ browser }) => {
    const f = await fixture(browser); const { alice, bob } = f;
    try {
      await expect(alice.getByRole("list", { name: "Active collaborators" }).getByRole("listitem")).toHaveCount(1);
      await expect(bob.getByRole("list", { name: "Active collaborators" }).getByRole("listitem")).toHaveCount(1);
      await bob.getByRole("button", { name: "Pan", exact: true }).click(); const view = (await canvas(bob).boundingBox())!;
      await bob.mouse.move(view.x + 20, view.y + 20); await bob.mouse.down(); await bob.mouse.move(view.x + 100, view.y + 60, { steps: 4 }); await bob.mouse.up();
      await bob.getByRole("button", { name: "Zoom in", exact: true }).click(); await bob.getByRole("button", { name: "Zoom in", exact: true }).click();
      const origin = (await canvas(alice).boundingBox())!; await alice.mouse.move(origin.x + 210, origin.y + 170);
      const cursor = bob.getByTestId("collaborator-cursor"); await expect(cursor).toHaveCount(1);
      await expect.poll(() => cursor.evaluate((el) => parseFloat((el as HTMLElement).style.left))).toBeCloseTo(115 + (210 - 35) / 0.85 * 1.05, 1);
      await expect.poll(() => cursor.evaluate((el) => parseFloat((el as HTMLElement).style.top))).toBeCloseTo(65 + (170 - 25) / 0.85 * 1.05, 1);
      await alice.mouse.move(30, 25); await expect(cursor).toHaveCount(0);
      await bob.goto("/dashboard"); await expect(alice.getByRole("list", { name: "Active collaborators" }).getByRole("listitem")).toHaveCount(0);
      await bob.goto(`/boards/${f.id}`); await ready(bob);
      await expect(alice.getByRole("list", { name: "Active collaborators" }).getByRole("listitem")).toHaveCount(1);
    } finally { await f.cleanup(); }
  });

  test("simultaneous UI edits preserve unrelated fields and converge on conflicts", async ({ browser }) => {
    const f = await fixture(browser); const { alice, bob, id } = f;
    try {
      const first = await add(alice, "Sticky note", "Initial A"); await expect(object(bob, first)).toHaveCount(1);
      const second = await add(bob, "Sticky note", "Initial B", 480, 170); await expect(object(alice, second)).toHaveCount(1);
      await Promise.all([select(alice, first), select(bob, second)]);
      await Promise.all([alice.getByRole("textbox", { name: "Object content", exact: true }).fill("Concurrent A"), bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Concurrent B")]);
      for (const page of [alice, bob]) { await expect(object(page, first)).toHaveAccessibleName("sticky-note: Concurrent A"); await expect(object(page, second)).toHaveAccessibleName("sticky-note: Concurrent B"); }
      await select(bob, first);
      await Promise.all([alice.getByRole("spinbutton", { name: "x", exact: true }).fill("320"), bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Remote text survives move")]);
      for (const page of [alice, bob]) { await expect(object(page, first)).toHaveCSS("left", "320px"); await expect(object(page, first)).toHaveAccessibleName("sticky-note: Remote text survives move"); }
      // An in-progress gesture uses its pointer-down snapshot, even as remote text arrives.
      const box = (await object(alice, first).boundingBox())!;
      await alice.mouse.move(box.x + 20, box.y + 20); await alice.mouse.down(); await alice.mouse.move(box.x + 54, box.y + 37, { steps: 3 });
      await bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Text during drag");
      await alice.mouse.up();
      for (const page of [alice, bob]) { await expect(object(page, first)).toHaveAccessibleName("sticky-note: Text during drag"); await expect(object(page, first)).toHaveCSS("left", "360px"); }
      await Promise.all([alice.getByRole("textbox", { name: "Object content", exact: true }).fill("Conflict A"), bob.getByRole("textbox", { name: "Object content", exact: true }).fill("Conflict B")]);
      await expect.poll(async () => {
        const a = await object(alice, first).getAttribute("aria-label"), b = await object(bob, first).getAttribute("aria-label");
        return a === b && ["sticky-note: Conflict A", "sticky-note: Conflict B"].includes(a!);
      }).toBe(true);
      const accepted = (await snapshot(alice, id)).objects.find((item) => item.id === first)!;
      expect(accepted.x).toBe(360);
    } finally { await f.cleanup(); }
  });
});
