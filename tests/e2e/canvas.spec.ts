import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BoardDocument } from "../../src/lib/board/model";
const saved = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem("cocanvas-board-v1")))!) as BoardDocument;
async function flush(page: Page) { await page.waitForTimeout(500); return saved(page); }
async function drag(page: Page, start: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 }); await page.mouse.up();
}
async function add(page: Page, tool: string) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x: 300, y: 250 } });
}

test("production Konva notes preserve identity and geometry when edited and reopened", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("board-renderer").locator("canvas")).toBeVisible();
  await add(page, "Sticky note");
  const before = (await flush(page)).objects.at(-1)!;
  expect(before).toMatchObject({ type: "sticky-note", width: 200, height: 160, backgroundColor: "#fff59d" });
  await page.getByRole("textbox", { name: "Object content", exact: true }).fill("A stable idea\nwith two lines");
  const after = (await flush(page)).objects.find((item) => item.id === before.id)!;
  expect(after).toEqual({ ...before, text: "A stable idea\nwith two lines" });
  await page.reload();
  await expect(page.getByRole("button", { name: "sticky-note: A stable idea\nwith two lines", exact: true })).toBeVisible();
  expect((await saved(page)).objects.find((item) => item.id === before.id)).toEqual(after);
});

test("text and both shape types support styling and retain data after viewport navigation", async ({ page }) => {
  await page.goto("/"); await add(page, "Text");
  await page.getByRole("textbox", { name: "Object content", exact: true }).fill("Standalone text");
  await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("30");
  await page.getByLabel("Text color", { exact: true }).fill("#125634");
  const text = (await flush(page)).objects.at(-1)!;
  expect(text).toMatchObject({ type: "text", content: "Standalone text", fontSize: 30, textColor: "#125634" });
  // Create elsewhere so creation does not hit the text interaction surface.
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x: 520, y: 180 } });
  await page.getByRole("combobox", { name: "Shape type", exact: true }).selectOption("ellipse");
  await page.getByRole("spinbutton", { name: "Border width", exact: true }).fill("6");
  await page.getByLabel("Border color", { exact: true }).fill("#123456");
  await page.getByRole("button", { name: "Set color #d5e7f5", exact: true }).click();
  const shape = (await flush(page)).objects.at(-1)!;
  expect(shape).toMatchObject({ type: "shape", shapeType: "ellipse", borderWidth: 6, borderColor: "#123456", fill: "#d5e7f5" });
  await page.getByRole("combobox", { name: "Shape type", exact: true }).selectOption("rectangle");
  const beforePan = await flush(page);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const canvas = (await page.getByRole("region", { name: "Board canvas" }).boundingBox())!;
  await drag(page, { x: canvas.x + 80, y: canvas.y + 80 }, 75, 45);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect((await flush(page)).objects).toEqual(beforePan.objects);
});

for (const tool of ["Sticky note", "Text", "Shape"]) {
  test(`${tool} moves and resizes in board coordinates after pan and zoom with one-step undo`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    const canvas = (await page.getByRole("region", { name: "Board canvas" }).boundingBox())!;
    await drag(page, { x: canvas.x + 30, y: canvas.y + 30 }, 60, 40);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click(); // 95%
    await add(page, tool);
    const before = (await flush(page)).objects.at(-1)!;
    const object = page.locator(`[data-object-id="${before.id}"]`);
    await expect(object).toHaveAttribute("aria-pressed", "true");
    const box = (await object.boundingBox())!;
    await drag(page, { x: box.x + 30, y: box.y + 30 }, 38, 19);
    const moved = (await flush(page)).objects.find((item) => item.id === before.id)!;
    expect(moved.x).toBeCloseTo(before.x + 40); expect(moved.y).toBeCloseTo(before.y + 20);
    const handle = (await page.getByRole("button", { name: "Resize bottom-right", exact: true }).boundingBox())!;
    await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 57, 38);
    const resized = (await flush(page)).objects.find((item) => item.id === before.id)!;
    expect(resized.width).toBeCloseTo(before.width + 60); expect(resized.height).toBeCloseTo(before.height + 40);
    expect(resized.x).toBeCloseTo(moved.x); expect(resized.y).toBeCloseTo(moved.y);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await flush(page)).objects.find((item) => item.id === before.id)).toEqual(moved);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await flush(page)).objects.find((item) => item.id === before.id)).toEqual(resized);
    await page.getByRole("button", { name: "Resize bottom-right", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    expect((await flush(page)).objects.find((item) => item.id === before.id)?.width).toBeCloseTo(resized.width + 10);
    const keyboardResized = (await flush(page)).objects.find((item) => item.id === before.id)!;
    const topLeft = (await page.getByRole("button", { name: "Resize top-left", exact: true }).boundingBox())!;
    await drag(page, { x: topLeft.x + topLeft.width / 2, y: topLeft.y + topLeft.height / 2 }, 19, 9.5);
    const shrunk = (await flush(page)).objects.find((item) => item.id === before.id)!;
    expect(shrunk.width).toBeCloseTo(keyboardResized.width - 20);
    expect(shrunk.height).toBeCloseTo(keyboardResized.height - 10);
    expect(shrunk.x).toBeCloseTo(keyboardResized.x + 20);
    expect(shrunk.y).toBeCloseTo(keyboardResized.y + 10);
  });
}

test("shape labels stay attached through type changes, movement, resize and reload", async ({ page }) => {
  await page.goto("/"); await add(page, "Shape");
  const shape = (await flush(page)).objects.at(-1)!;
  await page.getByRole("textbox", { name: "Object content", exact: true }).fill("Plan\nBuild together");
  await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("24");
  await page.getByLabel("Text color", { exact: true }).fill("#123456");
  await page.getByRole("combobox", { name: "Shape type", exact: true }).selectOption("ellipse");
  const object = page.locator(`[data-object-id="${shape.id}"]`);
  await expect(object).toHaveAccessibleName("shape: ellipse: Plan Build together");
  const box = (await object.boundingBox())!;
  await drag(page, { x: box.x + 35, y: box.y + 35 }, 34, 17);
  const handle = (await page.getByRole("button", { name: "Resize bottom-right", exact: true }).boundingBox())!;
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 34, 17);
  const after = (await flush(page)).objects.find((item) => item.id === shape.id)!;
  expect(after).toMatchObject({ id: shape.id, type: "shape", shapeType: "ellipse", text: "Plan\nBuild together", fontSize: 24, textColor: "#123456" });
  expect(after.x).toBeCloseTo(shape.x + 40); expect(after.y).toBeCloseTo(shape.y + 20);
  expect(after.width).toBeCloseTo(shape.width + 40); expect(after.height).toBeCloseTo(shape.height + 20);
  await page.reload();
  await expect(object).toHaveAccessibleName("shape: ellipse: Plan Build together");
  expect((await saved(page)).objects.find((item) => item.id === shape.id)).toEqual(after);
  await object.click();
  await expect(page.getByRole("textbox", { name: "Object content", exact: true })).toHaveValue("Plan\nBuild together");
  await page.getByRole("combobox", { name: "Shape type", exact: true }).selectOption("rectangle");
  await expect(object).toHaveAccessibleName("shape: rectangle: Plan Build together");
  await page.screenshot({ path: "/private/tmp/cocanvas-shape-text.png" });
});
