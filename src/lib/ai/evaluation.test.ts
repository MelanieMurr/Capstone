import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { confirmResult, evaluationNotes, fixtureResult, validateResult } from "./evaluation";
const valid = (value: unknown) => Effect.runSync(Effect.match(validateResult(value, evaluationNotes), { onSuccess: () => true, onFailure: () => false }));
describe("structured AI validation", () => {
  it("accepts a grounded fixture as JSON or a parsed object", () => {
    expect(valid(fixtureResult)).toBe(true);
    expect(valid(JSON.stringify(fixtureResult))).toBe(true);
  });
  it.each([
    "not JSON", '{"summary":', { summary: 42 }, { ...fixtureResult, extra: true },
    { ...fixtureResult, summary: "" }, { ...fixtureResult, actionItems: [{ text: "Invented", sourceNoteIds: ["40000000-0000-4000-8000-000000000001"] }] },
    { ...fixtureResult, categories: [] },
    { ...fixtureResult, categories: [...fixtureResult.categories, fixtureResult.categories[0]] },
  ])("rejects malformed, incomplete or unsupported output: %j", (input) => expect(valid(input)).toBe(false));
  it("requires explicit confirmation and leaves the tray empty when cancelled", () => {
    expect(Effect.runSync(confirmResult(fixtureResult, evaluationNotes, false))).toEqual([]);
    expect(Effect.runSync(confirmResult(fixtureResult, evaluationNotes, true))).toHaveLength(3);
    expect(() => Effect.runSync(confirmResult({}, evaluationNotes, true))).toThrow();
  });
});
