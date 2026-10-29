import { describe, expect, it, vi, afterEach } from "vitest";
import { Effect } from "effect";
import { boardDocumentSchema } from "../board/model";
import { evaluationNotes, fixtureResult, validateResult, summaryResponseSchema, actionItemsResponseSchema, categorizationResponseSchema } from "./evaluation";
import { insertAIResult } from "./insertion";
import { requestBoardAI } from "./board-request";
const board = () => boardDocumentSchema.parse({ schemaVersion: 1, boardId: "30000000-0000-4000-8000-000000000001", objects: evaluationNotes.map((note) => ({ ...note, type: "sticky-note" })) });
afterEach(() => vi.unstubAllGlobals());
describe("AI operation contracts and confirmed edits", () => {
  it.each(["categorize", "summary", "action-items"])("validates and inserts %s without changing originals", (operation) => {
    const source = board(); const before = structuredClone(source);
    const next = Effect.runSync(insertAIResult(source, operation, fixtureResult, evaluationNotes));
    expect(source).toEqual(before); expect(next.objects.slice(0, 3)).toEqual(source.objects);
    const additions = next.objects.slice(3);
    expect(additions.length).toBe(operation === "categorize" ? 5 : operation === "summary" ? 1 : 2);
    expect(new Set(next.objects.map((object) => object.id)).size).toBe(next.objects.length);
    if (operation === "summary") expect(additions[0]).toMatchObject({ type: "text", content: fixtureResult.summary });
    if (operation === "action-items") expect(additions.map((object) => object.type === "sticky-note" && object.text)).toEqual(fixtureResult.actionItems.map((item) => item.text));
  });
  it.each(["categorize", "summary", "action-items"])("rejects invalid output and stale/deleted sources for %s", (operation) => {
    const source = board();
    for (const input of [{}, { ...fixtureResult, summary: "   " }, { ...fixtureResult, categories: [] }, { ...fixtureResult, actionItems: [{ text: "Invented", sourceNoteIds: ["90000000-0000-4000-8000-000000000001"] }] }]) {
      expect(() => Effect.runSync(insertAIResult(source, operation, input, evaluationNotes))).toThrow();
    }
    expect(() => Effect.runSync(insertAIResult({ ...source, objects: [] }, operation, fixtureResult, evaluationNotes))).toThrow();
    source.objects[0] = { ...source.objects[0]!, type: "sticky-note", text: "Changed", backgroundColor: "#ffffff" };
    expect(() => Effect.runSync(insertAIResult(source, operation, fixtureResult, evaluationNotes))).toThrow();
  });
  it("defines separate valid and invalid operation response contracts", () => {
    expect(summaryResponseSchema.safeParse({ summary: "A summary" }).success).toBe(true);
    expect(summaryResponseSchema.safeParse({ summary: "  " }).success).toBe(false);
    expect(summaryResponseSchema.safeParse({ summary: "OK", extra: true }).success).toBe(false);
    expect(categorizationResponseSchema.safeParse({ categories: fixtureResult.categories }).success).toBe(true);
    expect(categorizationResponseSchema.safeParse({ categories: [{ name: " ", noteIds: [evaluationNotes[0]!.id] }] }).success).toBe(false);
    expect(actionItemsResponseSchema.safeParse({ actionItems: fixtureResult.actionItems }).success).toBe(true);
    expect(actionItemsResponseSchema.safeParse({ actionItems: [{ text: "Do it", sourceNoteIds: [] }] }).success).toBe(false);
    expect(actionItemsResponseSchema.safeParse({ actionItems: [{ text: " ", sourceNoteIds: [evaluationNotes[0]!.id] }] }).success).toBe(false);
    expect(actionItemsResponseSchema.safeParse({ actionItems: [{ text: "Do it", sourceNoteIds: [evaluationNotes[0]!.id, evaluationNotes[0]!.id] }] }).success).toBe(false);
  });
  it("allows no supported actions as a valid preview but inserts nothing", () => {
    const result = { ...fixtureResult, actionItems: [] };
    expect(Effect.runSync(validateResult(result, evaluationNotes))).toEqual(result);
    expect(() => Effect.runSync(insertAIResult(board(), "action-items", result, evaluationNotes))).toThrow();
  });
  it("rejects unsupported operations", () => {
    expect(() => Effect.runSync(insertAIResult(board(), "invent", fixtureResult, evaluationNotes))).toThrow();
  });
  it("sends selected content and rejects unsuccessful and invalid server responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: fixtureResult })).mockResolvedValueOnce(Response.json({ error: "Try again later" }, { status: 429 })).mockResolvedValueOnce(Response.json({ result: { summary: 42 } }));
    vi.stubGlobal("fetch", fetcher);
    await Effect.runPromise(requestBoardAI(board(), evaluationNotes.map((note) => note.id), "summary"));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ notes: evaluationNotes, operation: "summary" });
    await expect(Effect.runPromise(requestBoardAI(board(), [evaluationNotes[0]!.id], "summary"))).rejects.toThrow("Try again later");
    await expect(Effect.runPromise(requestBoardAI(board(), [evaluationNotes[0]!.id], "summary"))).rejects.toThrow("Rejected response");
  });
});
