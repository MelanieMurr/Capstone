import { Effect } from "effect";
import { boardDocumentSchema, boardObjectSchema } from "./model";
import type { BoardDocument, BoardObject } from "./model";
import type { Point } from "./viewport";

export type ResizeCorner = "top-left" | "bottom-right";
export const createObject = (board: BoardDocument, type: "sticky-note" | "text" | "shape", point: Point) => Effect.try({
  try: () => boardObjectSchema.parse({ id: crypto.randomUUID(), type, ...point, zIndex: Math.max(0, ...board.objects.map((item) => item.zIndex)) + 1 }),
  catch: () => new Error("Could not create this object."),
});
export const patchObject = (board: BoardDocument, id: string, patch: Record<string, unknown>) => Effect.try({
  try: () => {
    const object = board.objects.find((item) => item.id === id);
    if (!object) throw new Error();
    if ("id" in patch || "type" in patch) throw new Error();
    return boardDocumentSchema.parse({ ...board, objects: board.objects.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }, catch: () => new Error("This change is outside the supported object values."),
});
export const resizeObject = (board: BoardDocument, id: string, corner: ResizeCorner, delta: Point) => Effect.gen(function* () {
  const object = board.objects.find((item) => item.id === id);
  if (!object || object.type === "connector") return yield* Effect.fail(new Error("This object cannot be resized."));
  const radians = object.rotation * Math.PI / 180;
  // Pointer deltas arrive in board coordinates. Rotate them back into object space.
  const dx = delta.x * Math.cos(radians) + delta.y * Math.sin(radians);
  const dy = -delta.x * Math.sin(radians) + delta.y * Math.cos(radians);
  const direction = corner === "bottom-right" ? 1 : -1;
  const width = Math.max(24, Math.min(100_000, object.width + direction * dx));
  const height = Math.max(24, Math.min(100_000, object.height + direction * dy));
  const shiftX = corner === "top-left" ? object.width - width : 0;
  const shiftY = corner === "top-left" ? object.height - height : 0;
  return yield* patchObject(board, id, {
    width, height,
    x: object.x + shiftX * Math.cos(radians) - shiftY * Math.sin(radians),
    y: object.y + shiftX * Math.sin(radians) + shiftY * Math.cos(radians),
  });
});
export function objectLabel(item: BoardObject) {
  return `${item.type}: ${item.type === "sticky-note" ? item.text : item.type === "text" ? item.content : item.type === "shape" ? `${item.shapeType}${item.text ? `: ${item.text}` : ""}` : "connection"}`;
}
