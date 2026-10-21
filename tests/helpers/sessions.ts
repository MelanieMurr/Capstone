import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";
export type TestAccount = { id: string; email: string; password: string };
export type TestAccounts = { alice: TestAccount; bob: TestAccount };
export function testAccounts(): TestAccounts | null {
  const file = process.env.COCANVAS_TEST_FIXTURES;
  return file ? JSON.parse(readFileSync(file, "utf8")) as TestAccounts : null;
}
export async function signIn(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your boards", exact: true })).toBeVisible();
}
export async function separateSessions(browser: Browser) {
  const alice = await browser.newContext(), bob = await browser.newContext();
  return { alice, bob, close: async () => { await alice.close(); await bob.close(); } };
}
