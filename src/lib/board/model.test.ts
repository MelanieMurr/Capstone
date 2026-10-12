import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boardDocumentSchema, boardObjectSchema, resolveEndpoint } from "./model";
import { sampleBoard } from "./samples";

describe("board data contract", () => {
  it("restores all sample types, IDs and attachments through JSON", () => {
    expect(boardDocumentSchema.parse(JSON.parse(JSON.stringify(sampleBoard)))).toEqual(sampleBoard);
    expect(new Set(sampleBoard.objects.map((object) => object.type)).size).toBe(4);
  });
  it.each([
    { type: "image" }, { width: 0 }, { height: -1 }, { x: Infinity },
    { rotation: 360 }, { zIndex: -1 }, { backgroundColor: "red" }, { unexpected: true },
  ])("rejects malformed object properties: %j", (patch) => {
    expect(boardObjectSchema.safeParse({ ...sampleBoard.objects[0], ...patch }).success).toBe(false);
  });
  it("rejects duplicate IDs, dangling references and unsupported versions", () => {
    expect(boardDocumentSchema.safeParse({ ...sampleBoard, objects: [...sampleBoard.objects, sampleBoard.objects[0]] }).success).toBe(false);
    expect(boardDocumentSchema.safeParse({ ...sampleBoard, objects: sampleBoard.objects.slice(1) }).success).toBe(false);
    expect(boardDocumentSchema.safeParse({ ...sampleBoard, schemaVersion: 2 }).success).toBe(false);
  });
  it("supplies defaults without inventing a new object ID", () => {
    const object = boardObjectSchema.parse({ id: sampleBoard.objects[0]!.id, type: "sticky-note" });
    expect(object).toMatchObject({ id: sampleBoard.objects[0]!.id, width: 200, rotation: 0, text: "" });
    expect(boardObjectSchema.safeParse({ type: "sticky-note" }).success).toBe(false);
  });
  it("attachments follow movement, resizing and rotation and tolerate a missing target", () => {
    const target = sampleBoard.objects[0]!;
    const endpoint = { kind: "attached" as const, objectId: target.id, anchorX: 1, anchorY: 0.5 };
    expect(resolveEndpoint(endpoint, [target])).toEqual({ x: 240, y: 160 });
    const moved = { ...target, x: 100, y: 100, width: 300, rotation: 90 };
    expect(resolveEndpoint(endpoint, [moved])!.x).toBeCloseTo(20);
    expect(resolveEndpoint(endpoint, [moved])!.y).toBeCloseTo(400);
    expect(resolveEndpoint(endpoint, [])).toBeNull();
  });
  it("nested Yjs fields preserve concurrent movement and color changes, including binary restore", () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const restored = new Y.Doc();
    try {
      const note = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(sampleBoard.objects[0]!)) note.set(key, value);
      alice.getMap<Y.Map<unknown>>("objects").set(sampleBoard.objects[0]!.id, note);
      Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
      note.set("position", { x: 120, y: 80 });
      bob.getMap<Y.Map<unknown>>("objects").get(sampleBoard.objects[0]!.id)!.set("backgroundColor", "#aabbcc");
      const a = Y.encodeStateAsUpdate(alice);
      const b = Y.encodeStateAsUpdate(bob);
      Y.applyUpdate(alice, b);
      Y.applyUpdate(bob, a);
      expect(alice.getMap("objects").toJSON()).toEqual(bob.getMap("objects").toJSON());
      expect(note.get("position")).toEqual({ x: 120, y: 80 });
      expect(note.get("backgroundColor")).toBe("#aabbcc");
      Y.applyUpdate(restored, Y.encodeStateAsUpdate(alice));
      expect(restored.getMap("objects").toJSON()).toEqual(alice.getMap("objects").toJSON());
    } finally { alice.destroy(); bob.destroy(); restored.destroy(); }
  });
});
