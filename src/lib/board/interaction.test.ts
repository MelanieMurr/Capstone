import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { boardDocumentSchema, resolveEndpoint } from "./model";
import { deleteSelection, encodeSelection, moveSelection, pasteSelection, selectInRect } from "./interaction";
import { wheelViewport } from "./viewport";
const run = Effect.runSync;
const a = randomUUID(), b = randomUUID(), line = randomUUID();
const attached = (objectId: string) => ({ kind: "attached", objectId });
const board = boardDocumentSchema.parse({ schemaVersion: 1, boardId: randomUUID(), objects: [
  { type: "shape", id: a, x: 100, y: 100, width: 60, height: 40, rotation: 90, text: "Shape" },
  { type: "sticky-note", id: b, x: 250, y: 200, width: 80, height: 45, text: "Note" },
  { type: "connector", id: line, start: attached(a), end: attached(b) },
] });
describe("canvas gestures", () => {
  it("pans on both axes and zooms around the pointer without moving its board point", () => {
    const view = { x: 30, y: 20, scale: 1 }, pointer = { x: 210, y: 150 }, page = { x: 500, y: 400 };
    expect(run(wheelViewport(view, pointer, { x: 2, y: -1 }, 1, false, page))).toEqual({ x: -2, y: 36, scale: 1 });
    const zoomed = run(wheelViewport(view, pointer, { x: 0, y: -5000 }, 0, true, page));
    expect(zoomed).toEqual({ x: -150, y: -110, scale: 2 });
  });
  it("selects by partial overlap with rotated geometry and the connector segment", () => {
    expect(selectInRect(board, { x: 55, y: 115 }, { x: 65, y: 120 })).toEqual([a]);
    expect(selectInRect(board, { x: 173, y: 169 }, { x: 182, y: 181 })).toEqual([line]);
    expect(selectInRect(board, { x: 250, y: 132 }, { x: 255, y: 137 })).toEqual([]);
  });
  it("moves a selection together and removes dangling connectors on deletion", () => {
    const next = run(moveSelection(board, [a, b, line], { x: 20, y: -10 }));
    expect(next.objects[0]).toMatchObject({ x: 120, y: 90 });
    expect(next.objects[1]).toMatchObject({ x: 270, y: 190 });
    expect(next.objects[2]).toEqual(board.objects[2]);
    expect(run(deleteSelection(next, [a, b])).objects).toEqual([]);
  });
});
describe("canvas clipboard", () => {
  it("rekeys copied objects, preserves internal links, and detaches external links at their visible positions", () => {
    const text = run(encodeSelection(board, [a, line]));
    const result = run(pasteSelection(board, text, { x: 60, y: 100 }));
    expect(result.ids).toHaveLength(2);
    expect(result.board.objects.slice(0, 3)).toEqual(board.objects);
    const copy = result.board.objects.find((item) => result.ids.includes(item.id) && item.type === "connector")!;
    expect(copy).toMatchObject({ start: { kind: "attached", objectId: expect.not.stringMatching(a) }, end: { kind: "free", x: 290, y: 222.5 } });
    if (copy.type !== "connector") throw new Error("Missing connector");
    expect(resolveEndpoint(copy.start, result.board.objects)).toEqual({ x: 80, y: 130 });
  });
  it("rejects unrecognized text, invalid data, and ID collisions", () => {
    const payload = run(encodeSelection(board, [a, b, line]));
    for (const text of ["ordinary text", "CoCanvas objects v1\n{}", payload]) {
      expect(() => run(pasteSelection(board, text, { x: 0, y: 0 }, () => a))).toThrow("Could not paste objects");
    }
  });
});
