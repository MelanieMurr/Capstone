import { test, expect } from "@playwright/test";
import { separateSessions, signIn, testAccounts } from "../helpers/sessions";
const accounts = testAccounts();
// Fail an individual broken control promptly so finally can clean its test board.
test.use({ actionTimeout: 15_000 });
test("core workflow: account, dashboard, access, canvas, AI confirmation, saved restore and sign-out", async ({ browser }) => {
  test.skip(!accounts, "Use dedicated accounts via COCANVAS_TEST_FIXTURES.");
  test.setTimeout(180_000);
  const sessions = await separateSessions(browser);
  const alice = await sessions.alice.newPage(), bob = await sessions.bob.newPage();
  const guest = await browser.newContext(); const anonymous = await guest.newPage();
  let id: string | undefined;
  let deleted = false;
  try {
    await Promise.all([signIn(alice, accounts!.alice), signIn(bob, accounts!.bob)]);
    const title = `Core workflow ${Date.now()}`;
    await alice.getByRole("textbox", { name: "New board title", exact: true }).fill(title);
    await alice.getByRole("button", { name: "Create board", exact: true }).click();
    await expect(alice).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    id = new URL(alice.url()).pathname.split("/").at(-1)!;
    await alice.goto("/dashboard");
    expect((await anonymous.request.post(`/api/boards/${id}/ai`, { data: {} })).status()).toBe(401);
    expect((await bob.request.post(`/api/boards/${id}/ai`, { data: {} })).status()).toBe(404);
    await alice.getByRole("button", { name: `Rename ${title}`, exact: true }).click();
    await alice.getByRole("textbox", { name: "Rename board title", exact: true }).fill(`${title} renamed`);
    await alice.getByRole("button", { name: "Save name", exact: true }).click();
    await alice.getByRole("link", { name: `Open ${title} renamed`, exact: true }).click();
    await expect(alice.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
    await alice.getByRole("button", { name: "Share board", exact: true }).click();
    await alice.getByRole("textbox", { name: "Collaborator email", exact: true }).fill(accounts!.bob.email);
    await alice.getByRole("combobox", { name: "Collaborator permission", exact: true }).selectOption("editor");
    await alice.getByRole("button", { name: "Grant access", exact: true }).click();
    await expect(alice.getByRole("dialog").getByRole("status")).toContainText("access");
    await alice.getByRole("button", { name: "Close sharing dialog", exact: true }).click();
    await bob.goto("/dashboard"); await bob.getByRole("link", { name: `Open ${title} renamed`, exact: true }).click();
    await expect(bob.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
    await alice.getByRole("button", { name: "Sticky note", exact: true }).click();
    await alice.getByRole("region", { name: "Board canvas" }).click({ position: { x: 220, y: 180 } });
    const text = "Prototype board search and test it with classmates.";
    await alice.getByRole("textbox", { name: "Object content", exact: true }).fill(text);
    await expect(bob.locator("[data-object-id]")).toHaveCount(1);
    await expect.poll(async () => (await (await alice.request.get(`/api/boards/${id}`)).json()).document.objects[0]?.text).toBe(text);
    const doc = (await (await alice.request.get(`/api/boards/${id}`)).json()).document;
    const payload = { notes: [{ id: doc.objects[0].id, text }], prompt: "grounded", operation: "summary" };
    expect((await alice.request.post(`/api/boards/${id}/ai`, { data: { ...payload, notes: [{ ...payload.notes[0], text: "Forged" }] } })).status()).toBe(409);
    if (!process.env.COCANVAS_LIVE_AI) {
      await alice.route("**/api/boards/*/ai", (route) => route.fulfill({ json: { result: { categories: [{ name: "Navigation", noteIds: [doc.objects[0].id] }], summary: "Prototype and evaluate board search.", actionItems: [] } } }));
    }
    await alice.getByRole("button", { name: "✦ Assistant", exact: true }).click();
    await alice.getByRole("combobox", { name: "AI provider", exact: true }).selectOption("local-codex");
    await alice.locator(".inspector").getByRole("checkbox").first().check();
    await alice.getByRole("button", { name: "Run AI request", exact: true }).click();
    await expect(alice.getByRole("region", { name: "AI response" })).toBeVisible({ timeout: 110_000 });
    await expect(bob.locator("[data-object-id]")).toHaveCount(1);
    await alice.getByRole("button", { name: "Confirm summary", exact: true }).click();
    await expect(bob.locator("[data-object-id]")).toHaveCount(2);
    await expect(alice.locator(".statusbar")).toContainText("shared changes saved");
    const saved = (await (await alice.request.get(`/api/boards/${id}`)).json()).document;
    expect(saved.objects.some((object: { type: string }) => object.type === "text")).toBe(true);
    await bob.reload(); await expect(bob.locator("[data-object-id]")).toHaveCount(2);
    expect((await (await bob.request.get(`/api/boards/${id}`)).json()).document).toEqual(saved);
    // Downgrade through the real owner endpoint; direct AI calls must also reject viewers.
    expect((await alice.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.bob.email, permission: "viewer" } })).ok()).toBe(true);
    expect((await bob.request.post(`/api/boards/${id}/ai`, { data: payload })).status()).toBe(403);
    await bob.reload(); await expect(bob.getByRole("button", { name: "Sticky note", exact: true })).toBeDisabled();
    await alice.goto("/dashboard");
    await alice.getByRole("button", { name: `Delete ${title} renamed`, exact: true }).click();
    await alice.getByRole("button", { name: "Confirm delete", exact: true }).click();
    await expect(alice.getByRole("link", { name: `Open ${title} renamed`, exact: true })).toHaveCount(0); deleted = true;
    await alice.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(alice).toHaveURL(/\/login$/);
    expect((await alice.request.get(`/api/boards/${id}`)).status()).toBe(401);
  } finally {
    if (id && !deleted) { await alice.goto("/dashboard"); await alice.request.delete(`/api/boards/${id}`); }
    await sessions.close(); await guest.close();
  }
});
