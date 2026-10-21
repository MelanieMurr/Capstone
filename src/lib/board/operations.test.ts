import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { boardDocumentSchema, boardObjectSchema, resolveEndpoint } from "./model";
import { connectObjects, createObject, deleteObject, patchObject, resizeObject } from "./operations";
const id = "50000000-0000-4000-8000-000000000001";
const other = "50000000-0000-4000-8000-000000000002";
const makeBoard = (rotation = 0) => boardDocumentSchema.parse({ boardId: "50000000-0000-4000-8000-000000000003", schemaVersion: 1, objects: [
  { id, type: "sticky-note", x: 80, y: 90, width: 200, height: 160, rotation, text: "Original" },
  { id: other, type: "shape", x: 500, y: 500 },
] });
const run = <A,>(program: Effect.Effect<A, Error>) => Effect.runSync(program);
describe("canvas object operations", () => {
  it("creates each supported object with stable unique identity and model defaults", () => {
    const board = makeBoard();
    const created = ["sticky-note", "text", "shape"].map((type) => run(createObject(board, type as "text", { x: -20, y: 30 })));
    expect(new Set(created.map((item) => item.id)).size).toBe(3);
    created.forEach((item) => { expect(item).toEqual(boardObjectSchema.parse({ id: item.id, type: item.type, x: -20, y: 30, zIndex: 1 })); });
  });
  it("edits text without moving, resizing or reidentifying the object", () => {
    const before = makeBoard(); const after = run(patchObject(before, id, { text: "Changed\nidea" }));
    expect(after.objects[0]).toEqual({ ...before.objects[0], text: "Changed\nidea" });
    expect(after.objects[1]).toEqual(before.objects[1]);
    expect(before.objects[0]).toHaveProperty("text", "Original");
  });
  it("rejects invalid geometry and identity reassignment without changing the source", () => {
    const board = makeBoard();
    for (const patch of [{ width: -1 }, { x: Infinity }, { id: other }, { type: "text" }, { text: "x".repeat(10001) }]) {
      expect(() => run(patchObject(board, id, patch))).toThrow();
    }
    expect(board.objects[0]).toHaveProperty("width", 200);
  });
  it("resizes from the bottom right while retaining its top-left anchor", () => {
    const result = run(resizeObject(makeBoard(), id, "bottom-right", { x: 60, y: 40 })).objects[0]!;
    expect(result).toMatchObject({ id, x: 80, y: 90, width: 260, height: 200 });
  });
  it("retains the opposite corner when resizing a rotated object from top left", () => {
    const before = makeBoard(35);
    const endpoint = { kind: "attached" as const, objectId: id, anchorX: 1, anchorY: 1 };
    const after = run(resizeObject(before, id, "top-left", { x: 75, y: -12 }));
    const oldPoint = resolveEndpoint(endpoint, before.objects)!; const newPoint = resolveEndpoint(endpoint, after.objects)!;
    expect(newPoint.x).toBeCloseTo(oldPoint.x); expect(newPoint.y).toBeCloseTo(oldPoint.y);
    expect(after.objects[0]).toHaveProperty("rotation", 35);
  });
  it("prevents flipping and keeps dimensions within the schema limits", () => {
    const small = run(resizeObject(makeBoard(), id, "bottom-right", { x: -1000, y: -1000 })).objects[0]!;
    expect(small).toMatchObject({ width: 24, height: 24 });
    const large = run(resizeObject(makeBoard(), id, "bottom-right", { x: 1e6, y: 1e6 })).objects[0]!;
    expect(large).toMatchObject({ width: 100000, height: 100000 });
    expect(() => run(resizeObject(makeBoard(), id, "top-left", { x: NaN, y: 0 }))).toThrow();
  });
});

describe("shape text", () => {
  it("loads old shapes with empty text and valid typography defaults", () => {
    const shape = boardObjectSchema.parse({ id, type: "shape" });
    expect(shape).toMatchObject({ text: "", fontSize: 20, textColor: "#222222" });
  });
  it("keeps text and styling attached to the same shape through movement and resize", () => {
    const board = makeBoard();
    const edited = run(patchObject(board, other, { text: "A labelled shape\nwith two lines", fontSize: 28, textColor: "#123456" }));
    const moved = run(patchObject(edited, other, { x: 520, y: 530 }));
    const resized = run(resizeObject(moved, other, "bottom-right", { x: 40, y: 20 }));
    expect(resized.objects.find((item) => item.id === other)).toMatchObject({ id: other, type: "shape", x: 520, y: 530, width: 240, height: 180, text: "A labelled shape\nwith two lines", fontSize: 28, textColor: "#123456" });
    expect(() => run(patchObject(board, other, { text: "x".repeat(10001) }))).toThrow();
    expect(() => run(patchObject(board, other, { fontSize: 0 }))).toThrow();
  });
});

describe("connectors and deletion", () => {
  it("creates attached references with facing edge anchors", () => {
    const board = run(patchObject(makeBoard(), other, { y: 90 }));
    const next = run(connectObjects(board, id, other));
    expect(next.objects.at(-1)).toMatchObject({ type: "connector", start: { kind: "attached", objectId: id, anchorX: 1, anchorY: 0.5 }, end: { kind: "attached", objectId: other, anchorX: 0, anchorY: 0.5 } });
    expect(next.objects.slice(0, 2)).toEqual(board.objects);
    expect(() => run(connectObjects(board, id, id))).toThrow();
    expect(() => run(connectObjects(board, id, "missing"))).toThrow();
  });
  it("keeps stable references while endpoints follow movement, resizing and rotation", () => {
    const original = run(connectObjects(run(patchObject(makeBoard(), other, { y: 90 })), id, other));
    const connector = original.objects.at(-1)!;
    if (connector.type !== "connector") throw new Error("Expected connector");
    const moved = run(patchObject(original, id, { x: 120, y: 150, width: 300, height: 200, rotation: 90 }));
    const point = resolveEndpoint(connector.start, moved.objects)!;
    expect(point.x).toBeCloseTo(20); expect(point.y).toBeCloseTo(450);
    expect(moved.objects.at(-1)).toEqual(connector);
  });
  it("supports notes, text, rectangles and ellipses as endpoints, but rejects connectors", () => {
    const board = boardDocumentSchema.parse({ ...makeBoard(), objects: [
      ...makeBoard().objects,
      { id: "50000000-0000-4000-8000-000000000010", type: "text", x: 600 },
      { id: "50000000-0000-4000-8000-000000000011", type: "shape", shapeType: "ellipse", x: 900 },
    ] });
    for (const target of board.objects.slice(1)) expect(run(connectObjects(board, id, target.id)).objects).toHaveLength(5);
    const connected = run(connectObjects(board, id, other));
    expect(() => run(connectObjects(connected, id, connected.objects.at(-1)!.id))).toThrow();
  });
  it("deletes only a connector when it is selected", () => {
    const original = makeBoard(); const connected = run(connectObjects(original, id, other));
    expect(run(deleteObject(connected, connected.objects.at(-1)!.id))).toEqual(original);
  });
  it("deletes each supported object together with all attached connectors atomically", () => {
    for (const type of ["sticky-note", "text", "shape"] as const) {
      const board = boardDocumentSchema.parse({ ...makeBoard(), objects: [{ id, type }, makeBoard().objects[1]] });
      const connected = run(connectObjects(run(connectObjects(board, id, other)), other, id));
      const deleted = run(deleteObject(connected, id));
      expect(deleted.objects).toEqual([board.objects[1]]);
      expect(boardDocumentSchema.safeParse(deleted).success).toBe(true);
      expect(connected.objects).toHaveLength(4);
    }
  });
  it("cleans one-sided attachments but preserves unrelated free connectors", () => {
    const a = "50000000-0000-4000-8000-000000000012", b = "50000000-0000-4000-8000-000000000013";
    const board = boardDocumentSchema.parse({ ...makeBoard(), objects: [ ...makeBoard().objects,
      { id: a, type: "connector", start: { kind: "free", x: 1, y: 2 }, end: { kind: "attached", objectId: id } },
      { id: b, type: "connector", start: { kind: "free", x: 1, y: 2 }, end: { kind: "free", x: 3, y: 4 } },
    ] });
    expect(run(deleteObject(board, id)).objects.map((item) => item.id)).toEqual([other, b]);
    expect(() => run(deleteObject(board, "missing"))).toThrow();
  });
});
