import { Effect } from "effect";

import {
    boardDocumentSchema,
    boardObjectSchema,
} from "../board/model";

import type {
    BoardDocument,
    BoardObject,
} from "../board/model";

import { validateResult } from "./evaluation";

export type SubmittedNote = {
    id: string;
    text: string;
};

export function insertCategorization(
    board: BoardDocument,
    input: unknown,
    submittedNotes: SubmittedNote[],
) {
    return Effect.gen(function* (){
        const result = yield* validateResult(input, submittedNotes);

        return yield* Effect.try({
            try: () => {
                const sources = submittedNotes.map((submitted) => {
                    const current = board.objects.find(
                        (object) => object.id === submitted.id,
                    );

                    if (!current || current.type !== "sticky-note") {
                        throw new Error("A source note was deleted. Generate a new categorization.",);
                    }

                    if (current.text.trim() !== submitted.text.trim()) {
                        throw new Error("A source note changed after this request. Generate a new categorization.",);
                    }

                    return current;
                });

                const sourceById = new Map(
                    sources.map((note) => [note.id, note]),
                );

                const submittedById = new Map(
                    submittedNotes.map((note) => [note.id, note]),
                );

                const additions: BoardObject[] = [];

                let zIndex = Math.max(
                    0,
                    ...board.objects.map((object) => object.zIndex),
                );

                const top =
                    Math.max(
                        0,
                        ...board.objects
                            .filter((object) => object.type !== "connector")
                            .map(
                                (object) =>
                                    object.y + object.width + object.height,
                            ),
                    ) + 100;

                result.categories.forEach((category, categoryIndex) => {
                    const x = 80 + categoryIndex * 300;

                    additions.push(
                        boardObjectSchema.parse({
                            id: crypto.randomUUID(),
                            type: "text",
                            content: category.name,
                            x,
                            y: top,
                            width: 260,
                            height: 100,
                            fontSize: 28,
                            zIndex: ++zIndex,
                        }),
                    );

                    let y = top + 120;

                    category.noteIds.forEach((id) => {
                        const source = sourceById.get(id);
                        const submitted = submittedById.get(id);

                        if (!source || !submitted) {
                            throw new Error("A category references an unavailable note.",);
                        }

                        const height = Math.max(
                            180,
                            Math.ceil(submitted.text.length / 24) * 24,
                        );

                        additions.push(
                            boardObjectSchema.parse({
                                id: crypto.randomUUID(),
                                type: "sticky-note",
                                text: submitted.text,
                                backgroundColor: source.backgroundColor,
                                x,
                                y,
                                width: 240,
                                height,
                                rotation: 0,
                                zIndex: ++zIndex,
                            }),
                        );

                        y += height + 24;
                    });
                });

                return boardDocumentSchema.parse({
                    ...board,
                    objects: [...board.objects, ...additions],
                });
            },

            catch: (cause) =>
                cause instanceof Error ? cause : new Error("The categorization could not be added to the board.",),
        });
    });
}