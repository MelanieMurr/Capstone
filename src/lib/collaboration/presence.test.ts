import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { collaboratorColor, cursorSchema, cursorToBoard } from "./presence";
describe("collaborator coordinates", () => {
  it("round-trips a cursor through each viewer's independent pan and zoom", () => {
    const world = Effect.runSync(cursorToBoard({ x: 240, y: 160 }, { x: 40, y: 60 }, 0.5));
    expect(world).toEqual({ x: 400, y: 200 });
    const viewer = { x: -120, y: 45, zoom: 1.7 };
    expect({ x: viewer.x + world.x * viewer.zoom, y: viewer.y + world.y * viewer.zoom }).toEqual({ x: 560, y: 385 });
  });
  it("rejects malformed coordinates and invalid zoom", () => {
    for (const zoom of [0, -1, NaN, Infinity]) expect(() => Effect.runSync(cursorToBoard({ x: 1, y: 1 }, { x: 0, y: 0 }, zoom))).toThrow();
    expect(cursorSchema.safeParse({ x: Infinity, y: 0 }).success).toBe(false);
    expect(cursorSchema.parse(null)).toBeNull();
  });
  it("keeps a user's color stable across connections", () => {
    expect(collaboratorColor("a")).toBe(collaboratorColor("a")); expect(collaboratorColor("a")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
