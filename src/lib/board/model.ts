import { z } from "zod";

const finite = z.number().finite();
const dimension = finite.positive().max(100_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
const point = z.strictObject({ x: finite, y: finite });
const base = {
  id: z.uuid(),
  x: finite.default(0),
  y: finite.default(0),
  width: dimension.default(200),
  height: dimension.default(160),
  rotation: finite.min(0).lt(360).default(0),
  zIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
};

export const stickyNoteSchema = z.strictObject({
  ...base,
  type: z.literal("sticky-note"),
  text: z.string().max(10_000).default(""),
  backgroundColor: color.default("#fff59d"),
});
export const textSchema = z.strictObject({
  ...base,
  type: z.literal("text"),
  content: z.string().max(10_000).default(""),
  fontSize: finite.min(8).max(256).default(24),
  textColor: color.default("#222222"),
});
export const shapeSchema = z.strictObject({
  ...base,
  type: z.literal("shape"),
  shapeType: z.enum(["rectangle", "ellipse"]).default("rectangle"),
  text: z.string().max(10_000).default(""),
  fontSize: finite.min(8).max(256).default(20),
  textColor: color.default("#222222"),
  fill: color.default("#ffffff"),
  borderColor: color.default("#222222"),
  borderWidth: finite.min(0).max(32).default(2),
});

// Attached anchors are fractions of the target's unrotated bounding box.
export const endpointSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("free"), ...point.shape }),
  z.strictObject({
    kind: z.literal("attached"),
    objectId: z.uuid(),
    anchorX: finite.min(0).max(1).default(0.5),
    anchorY: finite.min(0).max(1).default(0.5),
  }),
]);
export const connectorSchema = z.strictObject({
  ...base,
  type: z.literal("connector"),
  start: endpointSchema,
  end: endpointSchema,
  arrowStyle: z.enum(["none", "end", "both"]).default("end"),
  strokeColor: color.default("#222222"),
  strokeWidth: finite.positive().max(32).default(2),
});
export const boardObjectSchema = z.discriminatedUnion("type", [
  stickyNoteSchema, textSchema, shapeSchema, connectorSchema,
]);
export const boardDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  boardId: z.uuid(),
  objects: z.array(boardObjectSchema).max(10_000),
}).superRefine((board, ctx) => {
  const objects = new Map(board.objects.map((object) => [object.id, object]));
  const seen = new Set<string>();
  board.objects.forEach((object, index) => {
    if (seen.has(object.id)) {
      ctx.addIssue({ code: "custom", path: ["objects", index, "id"], message: "Duplicate object ID" });
    }
    seen.add(object.id);
    if (object.type !== "connector") return;
    for (const side of ["start", "end"] as const) {
      const endpoint = object[side];
      if (endpoint.kind !== "attached") continue;
      const target = objects.get(endpoint.objectId);
      if (!target || target.type === "connector") {
        ctx.addIssue({ code: "custom", path: ["objects", index, side, "objectId"], message: "Attachment must reference a non-connector on this board" });
      }
    }
  });
});

export type StickyNote = z.output<typeof stickyNoteSchema>;
export type TextObject = z.output<typeof textSchema>;
export type ShapeObject = z.output<typeof shapeSchema>;
export type Connector = z.output<typeof connectorSchema>;
export type ConnectorEndpoint = z.output<typeof endpointSchema>;
export type BoardObject = z.output<typeof boardObjectSchema>;
export type BoardDocument = z.output<typeof boardDocumentSchema>;

/** Resolve attachment geometry after movement, resizing, or rotation. */
export function resolveEndpoint(endpoint: ConnectorEndpoint, objects: readonly BoardObject[]) {
  if (endpoint.kind === "free") return { x: endpoint.x, y: endpoint.y };
  const target = objects.find((object) => object.id === endpoint.objectId && object.type !== "connector");
  if (!target) return null; // Concurrent deletion: hide the dangling connector.
  const radians = target.rotation * Math.PI / 180;
  const dx = endpoint.anchorX * target.width;
  const dy = endpoint.anchorY * target.height;
  return {
    x: target.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: target.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}
