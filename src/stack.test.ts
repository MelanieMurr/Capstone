import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { z } from "zod";

describe("collaboration dependencies", () => {
  it("preserves independent concurrent edits after exchanging Yjs updates", () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    try {
      alice.getMap("notes").set("alice-note", "Research canvas interactions");
      bob.getMap("notes").set("bob-note", "Research authentication");
      const aliceUpdate = Y.encodeStateAsUpdate(alice);
      const bobUpdate = Y.encodeStateAsUpdate(bob);
      Y.applyUpdate(alice, bobUpdate);
      Y.applyUpdate(bob, aliceUpdate);
      expect(alice.getMap("notes").toJSON()).toEqual(bob.getMap("notes").toJSON());
      expect(alice.getMap("notes").size).toBe(2);
    } finally {
      alice.destroy();
      bob.destroy();
    }
  });

  it("rejects malformed structured output with Zod", () => {
    const schema = z.object({ summary: z.string().min(1) });
    expect(schema.safeParse({ summary: "A valid summary" }).success).toBe(true);
    expect(schema.safeParse({ summary: 42 }).success).toBe(false);
  });
});
