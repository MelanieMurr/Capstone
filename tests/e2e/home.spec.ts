import { expect, test } from "@playwright/test";

test("the Next.js application starts and renders CoCanvas", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("CoCanvas");
  await expect(page.getByRole("heading", { name: "CoCanvas" })).toBeVisible();
});

test("canvas edits persist and can be undone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x: 300, y: 180 } });
  await page.getByRole("textbox", { name: "Object content" }).fill("My capstone idea");
  await expect(page.getByRole("button", { name: "sticky-note: My capstone idea", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Saved on this device");
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByRole("button", { name: "sticky-note: My capstone idea", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "sticky-note: My capstone idea", exact: true }).click();
  await page.getByRole("button", { name: "Delete object" }).click();
  await expect(page.getByRole("button", { name: "sticky-note: My capstone idea", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "sticky-note: My capstone idea", exact: true })).toBeVisible();
});

test("workspace supports drag, connections, zoom and responsive layout", async ({ page }) => {
  await page.goto("/");
  const note = page.getByRole("button", { name: /sticky-note: THE OPPORTUNITY/ });
  const box = await note.boundingBox();
  await page.mouse.move(box!.x + 40, box!.y + 50);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + 80);
  await page.mouse.up();
  await expect(page.getByRole("spinbutton", { name: "x", exact: true })).not.toHaveValue("80");
  await page.getByRole("button", { name: "Connector", exact: true }).click();
  await note.click();
  await page.getByRole("button", { name: /sticky-note: WHAT IF/ }).click();
  await expect(page.getByText("10 objects", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("95%");
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x: 600, y: 120 } });
  await page.screenshot({ path: "/private/tmp/cocanvas-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/private/tmp/cocanvas-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
