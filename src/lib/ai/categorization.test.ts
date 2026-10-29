import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { boardDocumentSchema } from "../board/model";

import {
    evaluationNotes,
    fixtureResult,
} from "./evaluation";

import { insertCategorization } from "./categorization";

function makeBoard() {
    return boardDocumentSchema.parse({
        schemaVersion: 1,
        boardId: "30000000-0000-4000-8000-000000000001",
        objects: evaluationNotes.map((note, index) => ({
            id: note.id,
            type: "sticky-note",
            text: note.text,
            x: index * 250,
            y: 0,
            backgroundColor: "#fff0b5",
        })),
    });
}

describe("confirmed categorization insertion", () => {
    it("adds headings and copies without modifying originals", () => {
        const board = makeBoard();
        const before = structuredClone(board);

        const next = Effect.runSync(
            insertCategorization(
                board,
                fixtureResult,
                evaluationNotes,
            ),
        );

        expect(board).toEqual(before);

        expect(
            next.objects.slice(0, board.objects.length),
        ).toEqual(board.objects);

        const additions = next.objects.slice(board.objects.length);

        expect(
            additions.filter((object) => object.type === "text"),
        ).toHaveLength(fixtureResult.categories.length);

        expect(
            additions.filter(
                (object) => object.type === "sticky-note",
            ),
        ).toHaveLength(evaluationNotes.length);

        const ids = next.objects.map((object) => object.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it("rejects a response that references an unknown note", () => {
        const invalid = {
            ...fixtureResult,
            categories: [
                {
                    name: "Invalid",
                    noteIds: [
                        "90000000-0000-4000-8000-000000000001",
                    ],
                },
            ],
        };

        expect(() =>
            Effect.runSync(
                insertCategorization(
                    makeBoard(),
                    invalid,
                    evaluationNotes,
                ),
            ),
        ).toThrow();
    });

    it("rejects confirmation after a source note changes", () => {
        const board = makeBoard();

        const changed = boardDocumentSchema.parse({
            ...board,
            objects: board.objects.map((object, index) =>
                index === 0
                    ? { ...object, text: "Changed after generation" }
                    : object,
            ),
        });

        expect(() =>
            Effect.runSync(
                insertCategorization(
                    changed,
                    fixtureResult,
                    evaluationNotes,
                ),
            ),
        ).toThrow();
    });

    it("rejects confirmation after a source note is deleted", () => {
        const board = makeBoard();

        expect(() =>
            Effect.runSync(
                insertCategorization(
                    {
                        ...board,
                        objects: board.objects.slice(1),
                    },
                    fixtureResult,
                    evaluationNotes,
                ),
            ),
        ).toThrow();
    });
});