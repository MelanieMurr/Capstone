import { Effect } from "effect";

export type Point = {
    x: number;
    y: number;
};

export type Viewport = Point & {
    scale: number;
};

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

export const INITIAL_VIEWPORT: Viewport = {
    x: 40,
    y: 40,
    scale: 1,
};

function assertFinite(...values: number[]) {
    if (!values.every(Number.isFinite)) {
        throw new Error("Viewport values must be finite numbers");
    }
}

export function panTo(
    viewport: Viewport,
    position: Point,
): Effect.Effect<Viewport, Error> {
    return Effect.try({
        try: () => {
            assertFinite(position.x, position.y);
            return {
                ...viewport,
                x: position.x,
                y: position.y,
            };
        },
        catch: () => new Error("Could not update the canvas position.")
    });
}

export function zoomAt(
    viewport: Viewport,
    pointer: Point,
    factor: number,
): Effect.Effect<Viewport, Error> {
    return Effect.try({
        try: () => {
            assertFinite(
                viewport.x,
                viewport.y,
                viewport.scale,
                pointer.x,
                pointer.y,
                factor,
            );

            if (viewport.scale <= 0 || factor <= 0) {
                throw new Error("Scale and zoom factors must be positive.")
            }

            const nextScale = Math.min(
                MAX_SCALE,
                Math.max(MIN_SCALE, viewport.scale * factor),
            );

            const boardX = (pointer.x - viewport.x) / viewport.scale;
            const boardY = (pointer.y - viewport.y) / viewport.scale;

            return {
                x: pointer.x - boardX * nextScale,
                y: pointer.y - boardY * nextScale,
                scale: nextScale,
            };
        },
        catch: () => new Error("Could not update the canvas zoom.")
    });
}