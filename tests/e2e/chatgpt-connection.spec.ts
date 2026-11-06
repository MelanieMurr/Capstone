import { test, expect } from "@playwright/test";
import { signIn, testAccounts } from "../helpers/sessions";

test("localhost explains the required ChatGPT callback address", async ({ page }) => {
  await page.route("**/api/chatgpt", (route) => route.fulfill({ json: { activeId: null, accounts: [] } }));
  await page.goto("http://localhost:3000/");
  await page.getByRole("button", { name: "✦ Assistant", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open this board at 127.0.0.1", exact: true })).toHaveAttribute("href", "http://127.0.0.1:3000/");
  await expect(page.getByText("your browser keeps localhost and 127.0.0.1 logins separate.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with ChatGPT", exact: true })).toBeDisabled();
});

test("local connection endpoints require a real CoCanvas session and expose no credentials", async ({ page }) => {
  const accounts = testAccounts();
  test.skip(!accounts, "Dedicated Supabase fixture accounts are required.");
  expect((await page.request.get("/api/chatgpt")).status()).toBe(401);
  await signIn(page, accounts!.alice);
  const status = await page.request.get("/api/chatgpt");
  expect(status.status()).toBe(200);
  const body = await status.json();
  expect(Array.isArray(body.accounts)).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|id_token/);
  const cross = await page.request.post("/api/chatgpt", { headers: { Origin: "https://example.test" }, data: { action: "welcome" } });
  expect(cross.status()).toBe(403);
});

test("subscription UI chooses an account model, confirms plan usage, previews output and disconnects", async ({ page }) => {
  const id = "a".repeat(64);
  let connected = true, welcomeSeen = false, model: string | null = null;
  await page.route("**/api/chatgpt*", async (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON();
      if (action.action === "model") model = action.model;
      if (action.action === "welcome") welcomeSeen = true;
      if (action.action === "disconnect") connected = false;
      return route.fulfill({ json: { message: "Updated local test connection." } });
    }
    if (route.request().url().includes("models=1")) return route.fulfill({ json: { models: [{ slug: "test-account-model", display_name: "Test account model" }] } });
    return route.fulfill({ json: { activeId: id, accounts: [{ id, label: "Mock ChatGPT account · 1", connected, planEnabled: connected, model, welcomeSeen }] } });
  });
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/prototypes/ai", async (route) => {
    sent = route.request().postDataJSON();
    const notes = sent!.notes as { id: string }[];
    return route.fulfill({ json: { result: { categories: [{ name: "Themes", noteIds: notes.map((note) => note.id) }], summary: "A subscription-backed preview.", actionItems: [] } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "✦ Assistant", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const run = page.getByRole("button", { name: "Run AI request", exact: true });
  await expect(run).toBeDisabled();
  await page.getByRole("combobox", { name: "ChatGPT model", exact: true }).selectOption("test-account-model");
  await expect(run).toBeEnabled();
  await page.locator(".inspector").getByRole("checkbox").first().check();
  const before = await page.locator("[data-object-id]").count();
  await run.click();
  await expect(page.getByRole("region", { name: "AI response" })).toContainText("A subscription-backed preview.");
  expect(sent!.provider).toBe("chatgpt"); expect(sent!.connectionId).toBe(id); expect(sent!.model).toBe("test-account-model");
  expect(JSON.stringify(sent)).not.toMatch(/access_token|refresh_token|id_token|apiKey/);
  await expect(page.locator("[data-object-id]")).toHaveCount(before);
  await page.getByRole("button", { name: "Confirm summary", exact: true }).click();
  await expect(page.locator("[data-object-id]")).toHaveCount(before + 1);
  await page.getByRole("button", { name: "Disconnect ChatGPT", exact: true }).click();
  await expect(run).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue with ChatGPT", exact: true })).toBeVisible();
});
