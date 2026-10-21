import { test, expect } from "@playwright/test";
import { separateSessions, signIn, testAccounts } from "../helpers/sessions";

const accounts = testAccounts();

test("protected pages reject unauthenticated access and auth form validates errors", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?/);
  expect((await page.request.get("/api/boards")).status()).toBe(401);
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("test@example.test");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect(await page.getByLabel("Password", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.tooShort)).toBe(true);
  // Verify direct signup navigation without emailing or creating a real user.
  await page.route("**/api/auth/signup", (route) => route.fulfill({ json: { message: "Account created.", signedIn: true } }));
  await page.route("**/dashboard", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Signed in dashboard</h1>" }));
  await page.getByLabel("Password", { exact: true }).fill("Long-enough-test-pass123");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Signed in dashboard" })).toBeVisible();

});

test("real auth, private dashboard CRUD and saved-board restoration", async ({ browser }) => {
  test.skip(!accounts, "Provide COCANVAS_TEST_FIXTURES to run isolated real-Supabase tests.");
  const sessions = await separateSessions(browser);
  const alice = await sessions.alice.newPage(), bob = await sessions.bob.newPage();
  let boardId: string | undefined;
  try {
    await alice.goto("/login");
    await alice.getByRole("textbox", { name: "Email", exact: true }).fill(accounts!.alice.email);
    await alice.getByLabel("Password", { exact: true }).fill("Incorrect-password-123456");
    await alice.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(alice.getByRole("alert").filter({ hasText: "Sign-in failed" })).toContainText("Sign-in failed");
    await signIn(alice, accounts!.alice); await signIn(bob, accounts!.bob);
    const title = `E2E ideas ${Date.now()}`;
    await alice.getByRole("textbox", { name: "New board title", exact: true }).fill(title);
    await alice.getByRole("button", { name: "Create board", exact: true }).click();
    const open = alice.getByRole("link", { name: `Open ${title}`, exact: true });
    await expect(open).toBeVisible();
    const href = (await open.getAttribute("href"))!; boardId = href.split("/").at(-1)!;
    // A different authenticated user sees neither metadata nor document content.
    await bob.reload(); await expect(bob.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    expect((await bob.request.get(`/api/boards/${boardId}`)).status()).toBe(404);
    expect((await bob.request.patch(`/api/boards/${boardId}`, { data: { title: "Unauthorized" } })).status()).toBe(403);
    expect((await bob.request.delete(`/api/boards/${boardId}`)).status()).toBe(403);
    await alice.getByRole("button", { name: `Rename ${title}`, exact: true }).click();
    await alice.getByRole("textbox", { name: "Rename board title", exact: true }).fill(`${title} renamed`);
    await alice.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(alice.getByRole("link", { name: `${title} renamed`, exact: true })).toBeVisible();
    await alice.getByRole("link", { name: `Open ${title} renamed`, exact: true }).click();
    await expect(alice).toHaveURL(new RegExp(`/boards/${boardId}$`));
    await alice.getByRole("button", { name: "Sticky note", exact: true }).click();
    await alice.getByRole("region", { name: "Board canvas" }).click({ position: { x: 220, y: 180 } });
    await alice.getByRole("textbox", { name: "Object content", exact: true }).fill("Persisted private idea");
    await expect.poll(async () => {
      const response = await alice.request.get(`/api/boards/${boardId}`);
      const json = await response.json(); return json.document?.objects?.some((object: { text?: string }) => object.text === "Persisted private idea");
    }).toBe(true);
    await alice.reload();
    await expect(alice.getByRole("button", { name: "sticky-note: Persisted private idea", exact: true })).toBeVisible();
    // Stale revisions are rejected instead of silently replacing another edit.
    const current = await (await alice.request.get(`/api/boards/${boardId}`)).json();
    const accepted = await alice.request.put(`/api/boards/${boardId}/document`, { data: { document: current.document, revision: current.revision } });
    expect(accepted.status()).toBe(200);
    expect((await alice.request.put(`/api/boards/${boardId}/document`, { data: { document: current.document, revision: current.revision } })).status()).toBe(409);
    await alice.goto("/dashboard");
    await alice.getByRole("button", { name: `Delete ${title} renamed`, exact: true }).click();
    await alice.getByRole("button", { name: "Keep board", exact: true }).click();
    await expect(alice.getByRole("link", { name: `${title} renamed`, exact: true })).toBeVisible();
    await alice.getByRole("button", { name: `Delete ${title} renamed`, exact: true }).click();
    await alice.getByRole("button", { name: "Confirm delete", exact: true }).click();
    await expect(alice.getByRole("link", { name: `${title} renamed`, exact: true })).toHaveCount(0);
    boardId = undefined;
    await alice.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(alice).toHaveURL(/\/login$/);
    await alice.goto("/dashboard"); await expect(alice).toHaveURL(/\/login\?/);
    // Session isolation: signing out Alice does not sign out Bob.
    await bob.reload(); await expect(bob).toHaveURL(/\/dashboard$/);
    await bob.route("**/api/boards", (route) => route.fulfill({ status: 503, json: { error: "Example unavailable database" } }));
    await bob.reload(); await expect(bob.getByRole("alert").filter({ hasText: "Example unavailable database" })).toContainText("Example unavailable database");
  } finally {
    if (boardId) await alice.request.delete(`/api/boards/${boardId}`);
    await sessions.close();
  }
});
