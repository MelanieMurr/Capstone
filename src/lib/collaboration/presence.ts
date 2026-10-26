import { Effect } from "effect";
import { z } from "zod";

export const cursorSchema = z.strictObject({ x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7) }).nullable();
export const collaboratorSchema = z.strictObject({
  id: z.uuid(), userId: z.uuid(), name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/), cursor: cursorSchema,
});
export type Collaborator = z.infer<typeof collaboratorSchema>;
export type Cursor = z.infer<typeof cursorSchema>;
export function collaboratorColor(id: string) {
  const palette = ["#28785f", "#8755b0", "#bc6038", "#3569ad", "#a84376", "#6b702c"];
  const hash = [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  return palette[hash % palette.length]!;
}
// Cursor coordinates are board units on the wire; each viewer applies its own viewport.
export const cursorToBoard = (point: { x: number; y: number }, pan: { x: number; y: number }, zoom: number) => Effect.try({
  try: () => {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error();
    return cursorSchema.unwrap().parse({ x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom });
  }, catch: () => new Error("Could not locate the collaborator cursor."),
});
