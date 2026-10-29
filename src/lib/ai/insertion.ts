import { Effect } from "effect";
import { boardDocumentSchema, boardObjectSchema } from "../board/model";
import type { BoardDocument } from "../board/model";
import { operationSchema, validateResult } from "./evaluation";
import { insertCategorization } from "./categorization";
import type { SubmittedNote } from "./categorization";

/** Prepare a single undoable board edit; the caller must explicitly confirm. */
export function insertAIResult(board: BoardDocument, operation: unknown, input: unknown, notes: SubmittedNote[]) {
  return Effect.gen(function* () {
    const chosen = yield* Effect.try({ try: () => operationSchema.parse(operation), catch: () => new Error("Choose a valid AI operation.") });
    const result = yield* validateResult(input, notes);
    if (chosen === "categorize") return yield* insertCategorization(board, result, notes);
    return yield* Effect.try({
      try: () => {
        for (const note of notes) {
          const source = board.objects.find((object) => object.id === note.id);
          if (!source || source.type !== "sticky-note" || source.text.trim() !== note.text.trim()) {
            throw new Error("Source notes changed or were deleted. Generate a new response before confirming.");
          }
        }
        const content = chosen === "summary" ? [result.summary] : result.actionItems.map((item) => item.text);
        if (!content.length) throw new Error("There are no action items to insert.");
        const top = Math.max(0, ...board.objects.filter((object) => object.type !== "connector").map((object) => object.y + object.width + object.height)) + 100;
        const highest = Math.max(0, ...board.objects.map((object) => object.zIndex));
        let y = top;
        const additions = content.map((text, index) => {
          const height = Math.max(180, Math.ceil(text.length / 35) * 26);
          const object = boardObjectSchema.parse({ id: crypto.randomUUID(), type: chosen === "summary" ? "text" : "sticky-note", ...(chosen === "summary" ? { content: text, fontSize: 24 } : { text, backgroundColor: "#d9ede5" }), x: 80, y, width: 420, height, zIndex: highest + index + 1 });
          y += height + 24;
          return object;
        });
        return boardDocumentSchema.parse({ ...board, objects: [...board.objects, ...additions] });
      },
      catch: (cause) => cause instanceof Error ? cause : new Error("Could not insert AI content."),
    });
  });
}
