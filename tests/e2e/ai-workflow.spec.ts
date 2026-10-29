import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { separateSessions, signIn, testAccounts } from "../helpers/sessions";

const assistant = (page: Page) => page.locator(".inspector");
const objects = (page: Page) => page.locator("[data-object-id]");
const run = (page: Page) => page.getByRole("button", { name: "Run AI request", exact: true });
function resultFor(notes: { id: string }[]) {
  return { categories: [{ name: "Useful themes", noteIds: notes.map((note) => note.id) }], summary: "A verified summary of the selected ideas.", actionItems: [{ text: "Test the proposed navigation with classmates.", sourceNoteIds: [notes[0]!.id] }] };
}
async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "✦ Assistant", exact: true }).click();
}
for (const [operation, label, additions] of [["categorize", "categorization", 3], ["summary", "summary", 1], ["action-items", "action items", 1]] as const) {
  test(`${operation}: preview, cancellation, loading, confirmation, undo, reload and errors`, async ({ page }) => {
    let mode = "valid";
    let release: (() => void) | undefined;
    let payload: { operation: string; notes: { id: string; text: string }[] } | undefined;
    await page.route("**/api/prototypes/ai", async (route) => {
      payload = route.request().postDataJSON();
      await new Promise<void>((resolve) => { release = resolve; });
      if (mode === "failed") return route.fulfill({ status: 502, json: { error: "Simulated provider failure" } });
      if (mode === "invalid") return route.fulfill({ json: { result: { summary: 42 } } });
      return route.fulfill({ json: { result: mode === "empty" ? { ...resultFor(payload!.notes), actionItems: [] } : resultFor(payload!.notes) } });
    });
    await page.goto("/"); await openAssistant(page);
    const baseline = await objects(page).count();
    await run(page).click(); await expect(assistant(page).getByRole("alert")).toContainText("Select at least one");
    await assistant(page).getByRole("checkbox").nth(0).check();
    await assistant(page).getByRole("checkbox").nth(1).check();
    await assistant(page).getByRole("combobox").selectOption(operation);
    async function generate() {
      release = undefined; await run(page).click();
      await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
      await expect(assistant(page).getByRole("checkbox").first()).toBeDisabled();
      await expect.poll(() => typeof release).toBe("function"); release!();
    }
    await generate();
    await expect(page.getByRole("region", { name: "AI response" })).toBeVisible();
    expect(payload!.operation).toBe(operation); expect(payload!.notes).toHaveLength(2);
    expect(Object.keys(payload!.notes[0]!).sort()).toEqual(["id", "text"]);
    await expect(objects(page)).toHaveCount(baseline);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(objects(page)).toHaveCount(baseline);
    await generate();
    await page.getByRole("button", { name: `Confirm ${label}`, exact: true }).click();
    await expect(objects(page)).toHaveCount(baseline + additions);
    await expect(page.getByRole("button", { name: `Confirm ${label}`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(objects(page)).toHaveCount(baseline);
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(objects(page)).toHaveCount(baseline + additions);
    await expect(page.locator(".statusbar")).toContainText("Saved on this device");
    // Wait for the debounced storage write by checking its actual contents.
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((value) => value.includes("Useful themes") || value.includes("A verified summary") || value.includes("Test the proposed navigation")))).toBe(true);
    await page.reload(); await expect(objects(page)).toHaveCount(baseline + additions); await openAssistant(page);
    await assistant(page).getByRole("checkbox").first().check(); await assistant(page).getByRole("combobox").selectOption(operation);
    for (const failure of ["invalid", "failed"]) {
      mode = failure; await generate();
      await expect(assistant(page).getByRole("alert")).toContainText(failure === "invalid" ? "Rejected response" : "Simulated provider failure");
      await expect(page.getByRole("region", { name: "AI response" })).toHaveCount(0);
      await expect(objects(page)).toHaveCount(baseline + additions); await expect(run(page)).toBeEnabled();
    }
    if (operation === "action-items") {
      mode = "empty"; await generate();
      await expect(page.getByText("No supported action items were found.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm action items", exact: true })).toBeDisabled();
    }
  });
}

const accounts = testAccounts();
test("confirmed AI output synchronizes to another user and restores from saved binary state", async ({ browser }) => {
  test.skip(!accounts, "Dedicated Supabase fixture accounts are required.");
  test.setTimeout(120_000);
  const sessions = await separateSessions(browser);
  const alice = await sessions.alice.newPage(), bob = await sessions.bob.newPage();
  let id: string | undefined;
  try {
    await Promise.all([signIn(alice, accounts!.alice), signIn(bob, accounts!.bob)]);
    const created = await alice.request.post("/api/boards", { data: { title: `AI confirmation ${Date.now()}` } }); expect(created.ok()).toBe(true); id = (await created.json()).id;
    const grant = await alice.request.post(`/api/boards/${id}/collaborators`, { data: { email: accounts!.bob.email, permission: "editor" } }); expect(grant.ok()).toBe(true);
    await Promise.all([alice.goto(`/boards/${id}`), bob.goto(`/boards/${id}`)]);
    for (const page of [alice, bob]) await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
    await alice.getByRole("button", { name: "Sticky note", exact: true }).click();
    await alice.getByRole("region", { name: "Board canvas" }).click({ position: { x: 220, y: 180 } });
    await alice.getByRole("textbox", { name: "Object content", exact: true }).fill("Prototype navigation and test it with classmates.");
    await expect(objects(bob)).toHaveCount(1);
    await alice.route("**/api/prototypes/ai", async (route) => route.fulfill({ json: { result: resultFor(route.request().postDataJSON().notes) } }));
    await openAssistant(alice);
    for (const [operation, label, expected] of [["summary", "summary", 2], ["action-items", "action items", 3], ["categorize", "categorization", 5]] as const) {
      await assistant(alice).getByRole("checkbox").first().check();
      await assistant(alice).getByRole("combobox").selectOption(operation);
      await run(alice).click(); await expect(alice.getByRole("region", { name: "AI response" })).toBeVisible();
      await expect(objects(bob)).toHaveCount(expected - (operation === "categorize" ? 2 : 1));
      await alice.getByRole("button", { name: `Confirm ${label}`, exact: true }).click();
      await expect(objects(bob)).toHaveCount(expected);
      await expect(alice.locator(".statusbar")).toContainText("shared changes saved");
      await bob.reload(); await expect(objects(bob)).toHaveCount(expected);
      const response = await bob.request.get(`/api/boards/${id}`); expect(response.ok()).toBe(true);
      expect((await response.json()).document.objects).toHaveLength(expected);
      await assistant(alice).getByRole("button", { name: "Clear selection", exact: true }).click();
    }
  } finally {
    if (id) { await Promise.all([alice.goto("/dashboard"), bob.goto("/dashboard")]); await alice.request.delete(`/api/boards/${id}`); }
    await sessions.close();
  }
});
