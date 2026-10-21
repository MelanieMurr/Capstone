import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";

// Opt in with a fresh address; this creates a real account in configured Supabase.
// Delete that disposable user in Supabase after verification.
const email = process.env.COCANVAS_LIVE_SIGNUP_EMAIL;
test("live signup opens a session and the same password signs in again", async ({ page, browser }) => {
  test.skip(!email, "Set COCANVAS_LIVE_SIGNUP_EMAIL to a fresh disposable email address.");
  const password = randomBytes(24).toString("hex");
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Your boards", exact: true })).toBeVisible();
  expect((await page.request.get("/api/boards")).status()).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/boards")).status()).toBe(401);

  // Start with an empty cookie jar; signup's session cannot mask a broken login.
  const fresh = await browser.newContext();
  try {
    const login = await fresh.newPage();
    await login.goto("/login");
    await login.getByRole("textbox", { name: "Email", exact: true }).fill(email!);
    await login.getByLabel("Password", { exact: true }).fill("Incorrect-password-123456");
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login.getByRole("alert").filter({ hasText: "did not match" })).toBeVisible();
    await login.getByLabel("Password", { exact: true }).fill(password);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login).toHaveURL(/\/dashboard$/, { timeout: 15000 });
    expect((await login.request.get("/api/boards")).status()).toBe(200);
    expect((await login.request.post("/api/auth/recover", { data: { email } })).status()).toBe(404);
    expect((await login.request.post("/api/auth/password", { data: { password: "Replacement-test-password" } })).status()).toBe(404);
    expect((await login.request.get("/auth/callback?code=old-link")).status()).toBe(404);
    await login.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(login).toHaveURL(/\/login$/);
  } finally { await fresh.close(); }
});
