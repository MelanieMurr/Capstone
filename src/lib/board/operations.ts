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

/** Create one connector referencing existing object IDs, never copied geometry. */
export const connectObjects = (board: BoardDocument, sourceId: string, targetId: string) => Effect.try({
  try: () => {
    const source = board.objects.find((item) => item.id === sourceId && item.type !== "connector");
    const target = board.objects.find((item) => item.id === targetId && item.type !== "connector");
    if (!source || !target || source.id === target.id) throw new Error();
    const center = (item: BoardObject) => {
      const angle = item.rotation * Math.PI / 180;
      return { x: item.x + item.width / 2 * Math.cos(angle) - item.height / 2 * Math.sin(angle), y: item.y + item.width / 2 * Math.sin(angle) + item.height / 2 * Math.cos(angle) };
    };
    const anchor = (item: BoardObject, toward: Point) => {
      const origin = center(item), radians = item.rotation * Math.PI / 180;
      const dx = toward.x - origin.x, dy = toward.y - origin.y;
      const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
      const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
      return Math.abs(localX / item.width) >= Math.abs(localY / item.height)
        ? { anchorX: localX >= 0 ? 1 : 0, anchorY: 0.5 }
        : { anchorX: 0.5, anchorY: localY >= 0 ? 1 : 0 };
    };
    const connector = boardObjectSchema.parse({ id: crypto.randomUUID(), type: "connector",
      start: { kind: "attached", objectId: source.id, ...anchor(source, center(target)) },
      end: { kind: "attached", objectId: target.id, ...anchor(target, center(source)) },
    });
    return boardDocumentSchema.parse({ ...board, objects: [...board.objects, connector] });
  }, catch: () => new Error("Choose two different notes, text elements or shapes on this board."),
});

/** Remove the target and all attached connectors in the same validated update. */
export const deleteObject = (board: BoardDocument, id: string) => Effect.try({
  try: () => {
    if (!board.objects.some((item) => item.id === id)) throw new Error();
    return boardDocumentSchema.parse({ ...board, objects: board.objects.filter((item) => item.id !== id &&
      !(item.type === "connector" && [item.start, item.end].some((end) => end.kind === "attached" && end.objectId === id))) });
  }, catch: () => new Error("The selected object could not be deleted."),
});

export function connectorLabel(item: Extract<BoardObject, { type: "connector" }>, objects: readonly BoardObject[]) {
  const describe = (end: typeof item.start) => {
    if (end.kind === "free") return `point (${Math.round(end.x)}, ${Math.round(end.y)})`;
    const target = objects.find((candidate) => candidate.id === end.objectId);
    if (!target) return "missing object";
    const name = target.type === "text" ? target.content : target.type === "sticky-note" || target.type === "shape" ? target.text : "";
    return name.split("\n")[0]?.slice(0, 45) || (target.type === "shape" ? target.shapeType : target.type);
  };
  return `Connector from ${describe(item.start)} to ${describe(item.end)}`;
}
