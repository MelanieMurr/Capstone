import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { sampleBoard } from "./samples";
import {
    INITIAL_VIEWPORT,
    MAX_SCALE,
    MIN_SCALE,
    panTo,
    zoomAt,
} from "./viewport";

describe("canvas viewport", () => {
    it("pans without changing zoom or the previous viewport", () => {
        const original = { ...INITIAL_VIEWPORT };

        const next = Effect.runSync(
            panTo(original, { x: 150, y: -80 }),
        );

        expect(next).toEqual({
            x: 150,
            y: -80,
            scale: 1,
        });

        expect(original).toEqual(INITIAL_VIEWPORT);
    });

    it("keeps the same board coordinate beneath the pointer", () => {
        const before = {
            x: 70,
            y: -20,
            scale: 0.5,
        };

        const pointer = {
            x: 300,
            y: 180,
        };

        const boardX = (pointer.x - before.x) / before.scale;
        const boardY = (pointer.y - before.y) / before.scale;

        const after = Effect.runSync(
            zoomAt(before, pointer, 1.1),
        );

        expect(after.x + boardX * after.scale)
            .toBeCloseTo(pointer.x);

        expect(after.y + boardY * after.scale)
            .toBeCloseTo(pointer.y);
    });

    it("respects the zoom limits", () => {
        const pointer = { x: 300, y: 200 };

        const zoomedOut = Effect.runSync(
            zoomAt(INITIAL_VIEWPORT, pointer, 0.001),
        );

        const zoomedIn = Effect.runSync(
            zoomAt(INITIAL_VIEWPORT, pointer, 100),
        );

        expect(zoomedOut.scale).toBe(MIN_SCALE);
        expect(zoomedIn.scale).toBe(MAX_SCALE);
    });

    it("does not modify saved board objects", () => {
        const originalBoard = JSON.stringify(sampleBoard);

        const panned = Effect.runSync(
            panTo(INITIAL_VIEWPORT, { x: -200, y: 150 }),
        );

        Effect.runSync(
            zoomAt(panned, { x: 300, y: 200 }, 1.1),
        );

        expect(JSON.stringify(sampleBoard)).toBe(originalBoard);
    });
});