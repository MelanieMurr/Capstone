import { Effect } from "effect";
import {object, z} from "zod";
import type { BoardDocument } from "../board/model.ts";
import { requestSchema, validateResult } from "./evaluation.ts";
import {cause} from "effect/reactivity/AsyncResult";

const selectionSchema = z
    .array(z.uuid())
    .min(1, "Select at least one sticky note!")
    .max(20, "You cannot select more than 20 notes!");

function requestError(cause: unknown): Error {
    return cause instanceof Error ? cause : new Error("The AI request could not be completed :( ");
}

export function prepareBoardAIRequest(
    board: BoardDocument,
    selectedIds: readonly string[],
    operation: unknown,
) {
    return Effect.try({
        try: () => {
            const selection = selectionSchema.safeParse(selectedIds);

            if (!selection.success) {
                throw new Error(
                    selection.error.issues[0]?.message ?? "Select 1-20 sticky notes!",
                );
            }

            if (new Set(selection.data).size !== selection.data.length) {
                throw new Error("A note can only be selected once!");
            }

            const notes = selection.data.map((id) => {
                const note = board.objects.find((object) => object.id === id);

                if (!note || note.type !== "sticky-note") {
                    throw new Error(
                        "A selected note is no longer available. Review your selection.",
                    );
                }

                const text = note.text.trim();

                if (!text) {
                    throw new Error(
                        "A note you selected is empty! Please add text, or deselect it.",
                    );
                }

                if (text.length > 2000) {
                    throw new Error(
                        "A selected note exceeds 2,000 characters!! Please shorten it or deselect it.",
                    );
                }

                return { id: note.id, text };
            });

            const parsed = requestSchema.safeParse({
                notes,
                operation,
                prompt: "grounded",
            });

            if (!parsed.success) {
                throw new Error("Choose a valid AI operation and selection!");
            }

            return parsed.data;
        },

        catch: requestError,
    });
}

export function requestBoardAI(
    board: BoardDocument,
    selectedIds: readonly string[],
    operation: unknown,
) {
    return Effect.gen(function* () {
        const payload = yield* prepareBoardAIRequest(
            board,
            selectedIds,
            operation,
        );

        const rawResult = yield* Effect.tryPromise({
            try: async () => {
                const response = await fetch("/api/prototypes/ai", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(100_000),
                });

                const body: unknown = await response.json();

                if (!response.ok) {
                    const failure = z
                        .object({ error: z.string() })
                        .safeParse(body);

                    throw new Error(
                        failure.success ? failure.data.error : `AI request failed (${response.status}.`,
                    );
                }

                return z.object({ result: z.unknown() }).parse(body).result;
            },

            catch: (cause) => {
                if (
                    cause instanceof Error &&
                    (cause.name === "TimeoutError" ||
                        cause.name === "AbortError")
                ) {
                    return new Error(
                        "The AI request timed out. Please try again.",
                    );
                }

                return requestError(cause);
            },
        });

        const result = yield* validateResult(rawResult, payload.notes);

        return {
            result,
            notes: payload.notes,
        };
    });
}