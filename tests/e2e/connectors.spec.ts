import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boardDocumentSchema } from "../../src/lib/board/model";
import type { BoardDocument } from "../../src/lib/board/model";
const ids = {
  note: "70000000-0000-4000-8000-000000000001", text: "70000000-0000-4000-8000-000000000002",
  rectangle: "70000000-0000-4000-8000-000000000003", ellipse: "70000000-0000-4000-8000-000000000004",
};
const fixture = boardDocumentSchema.parse({ schemaVersion: 1, boardId: "70000000-0000-4000-8000-000000000005", objects: [
  { id: ids.note, type: "sticky-note", x: 80, y: 80, width: 160, height: 100, text: "Note A" },
  { id: ids.text, type: "text", x: 440, y: 80, width: 160, height: 100, content: "Text B" },
  { id: ids.rectangle, type: "shape", x: 80, y: 300, width: 160, height: 100, text: "Shape C" },
  { id: ids.ellipse, type: "shape", shapeType: "ellipse", x: 440, y: 300, width: 160, height: 100, text: "Shape D" },
] });
const object = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`);
const saved = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem("cocanvas-board-v1")))!) as BoardDocument;
async function flush(page: Page) { await page.waitForTimeout(500); return saved(page); }
async function connect(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: "Connector", exact: true }).click();
  await object(page, from).click(); await object(page, to).click();
  const board = await flush(page); return board.objects.at(-1)!;
}
async function navigate(page: Page) {
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const box = (await page.getByRole("region", { name: "Board canvas" }).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 4 }); await page.mouse.up();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript((board) => { if (!localStorage.getItem("cocanvas-board-v1")) localStorage.setItem("cocanvas-board-v1", JSON.stringify(board)); }, fixture);
  await page.goto("/");
  await expect(page.getByTestId("board-renderer").locator("canvas")).toBeVisible();
});

test("a connector can be selected on its line or by keyboard and styled", async ({ page }) => {
  const connector = await connect(page, ids.note, ids.text);
  expect(connector).toMatchObject({ type: "connector", start: { kind: "attached", objectId: ids.note }, end: { kind: "attached", objectId: ids.text } });
  await expect(object(page, connector.id)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("region", { name: "Board canvas" }).click({ position: { x: 650, y: 250 } });
  const box = (await page.getByRole("region", { name: "Board canvas" }).boundingBox())!;
  await page.mouse.click(box.x + 35 + 340 * 0.85, box.y + 25 + 130 * 0.85);
  await expect(object(page, connector.id)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Arrow style", exact: true }).selectOption("both");
  await page.getByLabel("Line color", { exact: true }).fill("#335577");
  await page.getByRole("spinbutton", { name: "Line width", exact: true }).fill("4");
  expect((await flush(page)).objects.find((item) => item.id === connector.id)).toMatchObject({ arrowStyle: "both", strokeColor: "#335577", strokeWidth: 4 });
  // Native select editing must not trigger the global deletion shortcut.
  await page.getByRole("combobox", { name: "Arrow style", exact: true }).focus(); await page.keyboard.press("Backspace");
  expect((await flush(page)).objects.some((item) => item.id === connector.id)).toBe(true);
  await object(page, connector.id).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Connector", exact: true })).toBeVisible();
});

test("attached endpoints follow geometry changes without rewriting connector references", async ({ page }) => {
  const connector = await connect(page, ids.note, ids.text);
  await object(page, ids.note).click();
  for (const [key, value] of Object.entries({ x: 120, width: 200, height: 120, rotation: 90 })) {
    await page.getByRole("spinbutton", { name: key, exact: true }).fill(String(value));
  }
  const after = await flush(page);
  expect(after.objects.find((item) => item.id === connector.id)).toEqual(connector);
  const path = (await object(page, connector.id).locator("path").getAttribute("d"))!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(path[0]).toBeCloseTo(60); expect(path[1]).toBeCloseTo(280);
  expect(path[2]).toBeCloseTo(440); expect(path[3]).toBeCloseTo(130);
  await page.reload();
  expect((await saved(page)).objects).toEqual(after.objects);
});

for (const kind of ["note", "text", "rectangle", "ellipse", "connector"] as const) {
  test(`deleting ${kind} after pan/zoom cleans references and supports undo/redo`, async ({ page }) => {
    const target = kind === "connector" ? ids.text : ids[kind];
    const connector = await connect(page, target === ids.note ? ids.text : ids.note, target);
    const deleteId = kind === "connector" ? connector.id : target;
    const before = await saved(page);
    await navigate(page);
    await object(page, deleteId).focus(); await page.keyboard.press("Enter");
    if (kind === "rectangle" || kind === "connector") await page.getByRole("button", { name: "Delete object", exact: true }).click();
    else await page.keyboard.press("Delete");
    const deleted = await flush(page);
    expect(deleted.objects.some((item) => item.id === deleteId)).toBe(false);
    expect(deleted.objects.some((item) => item.id === connector.id)).toBe(false);
    expect(deleted.objects.filter((item) => item.type !== "connector")).toHaveLength(kind === "connector" ? 4 : 3);
    expect(boardDocumentSchema.safeParse(deleted).success).toBe(true);
    await expect(page.locator('[data-object-id][aria-pressed="true"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await flush(page)).objects).toEqual(before.objects);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await flush(page)).objects).toEqual(deleted.objects);
    await page.reload(); expect((await saved(page)).objects).toEqual(deleted.objects);
  });
}

test("deleting a pending source clears its reference and a new connection still works", async ({ page }) => {
  await page.getByRole("button", { name: "Connector", exact: true }).click();
  await object(page, ids.note).click();
  await page.getByRole("button", { name: "Delete object", exact: true }).click();
  await object(page, ids.text).click(); await object(page, ids.rectangle).click();
  const board = await flush(page);
  expect(board.objects.at(-1)).toMatchObject({ type: "connector", start: { kind: "attached", objectId: ids.text }, end: { kind: "attached", objectId: ids.rectangle } });
  expect(board.objects.some((item) => item.id === ids.note)).toBe(false);
});
