import { test, expect } from "@playwright/test";

test("sticky notes support dragging, resizing, editing, deletion and viewport independence", async ({ page }) => {
  await page.goto("/prototypes/sticky-notes");
  const data = page.getByTestId("note-data");
  await expect(page.getByRole("button", { name: "Select note 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select note 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Note text" }).fill("My prototype note");
  const stage = page.getByRole("region", { name: "Sticky note canvas" });
  const box = (await stage.boundingBox())!;
  // Drag the initial note using actual canvas coordinates (40px stage offset).
  await page.mouse.move(box.x + 155, box.y + 155);
  await page.mouse.down(); await page.mouse.move(box.x + 205, box.y + 185, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole("spinbutton", { name: "Note x", exact: true })).toHaveValue("130");
  // Bottom-right Transformer anchor: moved note at (130,110), size (200,160).
  await page.mouse.move(box.x + 370, box.y + 310);
  await page.mouse.down(); await page.mouse.move(box.x + 430, box.y + 350, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "Note width", exact: true }).inputValue())).toBeGreaterThan(240);
  const before = await data.textContent();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Select mode", exact: true }).click();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 70, { steps: 8 }); await page.mouse.up();
  expect(await data.textContent()).toBe(before);
  await page.getByRole("button", { name: "Pan mode", exact: true }).click();
  await page.getByRole("button", { name: "Select note 1", exact: true }).click();
  // Dragging after panning and zooming still uses board coordinates.
  const camera = JSON.parse((await page.getByTestId("viewport-state").textContent())!);
  const noteState = JSON.parse((await data.textContent())!)[0];
  const px = box.x + camera.x + (noteState.x + 30) * camera.scale;
  const py = box.y + camera.y + (noteState.y + 30) * camera.scale;
  await page.mouse.move(px, py); await page.mouse.down();
  await page.mouse.move(px + 44, py + 22, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "Note x", exact: true }).inputValue())).toBeCloseTo(170, 0);
  // Inspector controls also use board coordinates.
  await page.getByRole("spinbutton", { name: "Note x", exact: true }).fill("250");
  await expect(data).toContainText('"x": 250');
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select note 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select note 2", exact: true })).toHaveCount(0);
});

test("two separate browser sessions sync creation, movement, edits, concurrent changes and deletion", async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  try {
    const alice = await a.newPage(), bob = await b.newPage();
    const room = `test-${Date.now()}`;
    for (const page of [alice, bob]) {
      await page.goto("/prototypes/sync");
      await page.getByRole("textbox", { name: "Room", exact: true }).fill(room);
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    }
    await alice.getByRole("button", { name: "Add note", exact: true }).click();
    await alice.getByRole("textbox", { name: "Note text", exact: true }).fill("Alice idea");
    await expect(bob.getByRole("button", { name: "Select note 1", exact: true })).toContainText("Alice idea");
    await bob.getByRole("button", { name: "Select note 1", exact: true }).click();
    await bob.getByRole("spinbutton", { name: "Note x", exact: true }).fill("280");
    await expect(alice.getByRole("spinbutton", { name: "Note x", exact: true })).toHaveValue("280");
    await bob.getByRole("button", { name: "Add note", exact: true }).click();
    await bob.getByRole("textbox", { name: "Note text", exact: true }).fill("Bob idea");
    await expect(alice.getByRole("button", { name: "Select note 2", exact: true })).toBeVisible();
    await Promise.all([
      alice.getByRole("textbox", { name: "Note text", exact: true }).fill("Alice concurrent edit"),
      bob.getByRole("textbox", { name: "Note text", exact: true }).fill("Bob concurrent edit"),
    ]);
    await expect(alice.getByTestId("note-data")).toContainText("Bob concurrent edit");
    await expect(bob.getByTestId("note-data")).toContainText("Alice concurrent edit");
    await expect.poll(async () => await alice.getByTestId("note-data").textContent()).toBe(await bob.getByTestId("note-data").textContent());
    await bob.getByRole("button", { name: "Delete note", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Select note 2", exact: true })).toHaveCount(0);
    await bob.reload();
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible();
    await expect(bob.getByTestId("note-data")).toContainText("Alice concurrent edit");
  } finally { await a.close(); await b.close(); }
});

test("AI validation rejects invalid output and requires confirmation", async ({ page }) => {
  await page.goto("/prototypes/ai");
  await page.getByRole("button", { name: "Load invalid example" }).click();
  await page.getByRole("button", { name: "Validate response" }).click();
  await expect(page.getByRole("status")).toContainText("Rejected response");
  await expect(page.getByRole("button", { name: "Confirm insertion" })).toHaveCount(0);
  await page.getByRole("button", { name: "Load fixture" }).click();
  await page.getByRole("button", { name: "Validate response" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("list", { name: "Inserted content" }).locator("li")).toHaveCount(0);
  await page.getByRole("button", { name: "Validate response" }).click();
  await page.getByRole("button", { name: "Confirm insertion" }).click();
  await expect(page.getByRole("list", { name: "Inserted content" }).locator("li")).toHaveCount(3);
});
