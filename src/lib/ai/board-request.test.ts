import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import type { BoardDocument } from "../board/model";
import { prepareBoardAIRequest } from "./board-request";

const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";

const board: BoardDocument = {
    schemaVersion: 1,
    boardId: "30000000-0000-4000-8000-000000000001",
    objects: [
        {
            id: firstId,
            type: "sticky-note",
            text: "  Improve board search.  ",
            backgroundColor: "#fff0b5",
            x: 0,
            y: 0,
            width: 180,
            height: 140,
            rotation: 0,
            zIndex: 0,
        },
        {
            id: secondId,
            type: "sticky-note",
            text: "Show disconnected status.",
            backgroundColor: "#fff0b5",
            x: 200,
            y: 0,
            width: 180,
            height: 140,
            rotation: 0,
            zIndex: 1,
        },
    ],
};

describe("selected board notes for AI", () => {
    it("includes selected content and the chosen operation", () => {
        const result = Effect.runSync(
            prepareBoardAIRequest(board, [firstId], "summary"),
        );

        expect(result).toEqual({
            notes: [
                {
                    id: firstId,
                    text: "Improve board search.",
                },
            ],
            prompt: "grounded",
            operation: "summary",
        });
    });

    it("includes multiple notes when selected", () => {
        const result = Effect.runSync(
            prepareBoardAIRequest(
                board,
                [firstId, secondId],
                "categorize",
            ),
        );

        expect(result.notes.map((note) => note.id)).toEqual([
            firstId,
            secondId,
        ]);
    });

    it("rejects an empty selection", () => {
        expect(() =>
            Effect.runSync(
                prepareBoardAIRequest(board, [], "summary"),
            ),
        ).toThrow();
    });

    it("rejects duplicate selections", () => {
        expect(() =>
            Effect.runSync(
                prepareBoardAIRequest(
                    board,
                    [firstId, firstId],
                    "summary",
                ),
            ),
        ).toThrow();
    });

    it("rejects a note that no longer exists", () => {
        expect(() =>
            Effect.runSync(
                prepareBoardAIRequest(
                    { ...board, objects: [] },
                    [firstId],
                    "summary",
                ),
            ),
        ).toThrow();
    });

    it("rejects blank selected notes", () => {
        const emptyBoard: BoardDocument = {
            ...board,
            objects: board.objects.map((object) =>
                object.id === firstId
                    ? { ...object, text: "   " }
                    : object,
            ),
        };

        expect(() =>
            Effect.runSync(
                prepareBoardAIRequest(emptyBoard, [firstId], "summary"),
            ),
        ).toThrow();
    });

    it("rejects an unsupported operation", () => {
        expect(() =>
            Effect.runSync(
                prepareBoardAIRequest(board, [firstId], "invent"),
            ),
        ).toThrow();
    });
});