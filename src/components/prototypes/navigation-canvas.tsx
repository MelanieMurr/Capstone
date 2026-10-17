"use client";

import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
    Arrow,
    Ellipse,
    Group,
    Layer,
    Rect,
    Stage,
    Text,
} from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { sampleBoard } from "../../lib/board/samples";
import { resolveEndpoint } from "../../lib/board/model";
import {
    INITIAL_VIEWPORT,
    panTo,
    zoomAt,
} from "../../lib/board/viewport";
import type { Viewport } from "../../lib/board/viewport";

const objects = [...sampleBoard.objects].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
);

export default function NavigationCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);

    const [size, setSize]= useState({
        width: 900,
        height: 560,
    });

    const [viewport, setViewport] =
        useState<Viewport>(INITIAL_VIEWPORT);

    const [error, setError] = useState("");

    useEffect(() => {
        const container = containerRef.current;

        if (!container) return;

        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;

            setSize({
                width: Math.max(1, Math.floor(entry.contentRect.width)),
                height: Math.max(1, Math.floor(entry.contentRect.height)),
            });
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    function applyNavigation(program: Effect.Effect<Viewport, Error>,) {
        Effect.runSync(
            Effect.match(program, {
                onFailure: (cause) => {
                    setError(cause.message);
                },
                onSuccess: (nextViewport) => {
                    setError("");
                    setViewport(nextViewport);
                },
            }),
        );
    }

    function handlePan(event: KonvaEventObject<DragEvent>,) {
        const stage = event.target.getStage();

        if (!stage || event.target !== stage) return;

        applyNavigation(
            panTo(viewport, {
                x: stage.x(),
                y: stage.y(),
            }),
        );
    }

    function handleWheel(event: KonvaEventObject<WheelEvent>,) {
        event.evt.preventDefault();

        const stage = event.target.getStage();
        const pointer = stage?.getPointerPosition();

        if (!pointer || event.evt.deltaY === 0) return;

        const factor = event.evt.deltaY < 0 ? 1.1 : 1 /1.1;

        applyNavigation(zoomAt(viewport, pointer, factor),);
    }

    function zoomFromCenter(factor: number) {
        applyNavigation(
            zoomAt(
                viewport,
                {
                    x: size.width / 2,
                    y: size.height / 2,
                },
                factor,
            ),
        );
    }

    return (
        <main
            style={{
                maxWidth: 1200,
                margin: "0 auto",
                padding: 24,
            }}
        >
            <h1>Canvas navigation prototype</h1>

            <p>
                Drag the canvas to pan. Use the mouse wheel or buttons
                to zoom. The sample objects stay at their saved
                board coordinates.
            </p>

            <div
                style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 16,
                }}
            >
            <button
                className="button"
                onClick={() => zoomFromCenter(1 / 1.1)}
            >
                Zoom out
            </button>

                <output aria-label="Zoom percentage">
                    {Math.round(viewport.scale * 100)}%
                </output>

                <button
                    className="button"
                    onClick={() => zoomFromCenter(1.1)}
                >
                    Zoom in
                </button>

                <button
                    className="button"
                    onClick={() => {
                        setViewport(INITIAL_VIEWPORT);
                        setError("");
                    }}
                >
                    Reset view
                </button>
            </div>
            {error && <p role="alert">{error}</p>}

            <div
                ref={containerRef}
                role="region"
                aria-label="Navigation prototype canvas"
                style={{
                    width: "100%",
                    height: "min(65vh, 620px)",
                    minHeight: 300,
                    overflow: "hidden",
                    border: "1px solid #d8e0db",
                    borderRadius: 12,
                    background: "#f8faf6",
                    cursor: "grab",
                    touchAction: "none",
                }}
            >
                <Stage
                    width={size.width}
                    height={size.height}
                    x={viewport.x}
                    y={viewport.y}
                    scaleX={viewport.scale}
                    scaleY={viewport.scale}
                    draggable
                    onDragMove={handlePan}
                    onDragEnd={handlePan}
                    onWheel={handleWheel}
                >
                    <Layer>
                        {objects.map((object) => {
                            if (object.type === "connector") {
                                const start = resolveEndpoint(
                                    object.start,
                                    sampleBoard.objects,
                                );

                                const end = resolveEndpoint(
                                    object.end,
                                    sampleBoard.objects,
                                );

                                if (!start || !end) return null;

                                return (
                                    <Arrow
                                        key={object.id}
                                        points={[
                                            start.x,
                                            start.y,
                                            end.x,
                                            end.y,
                                        ]}
                                        stroke={object.strokeColor}
                                        fill={object.strokeColor}
                                        strokeWidth={object.strokeWidth}
                                        pointerAtBeginning={
                                            object.arrowStyle === "both"
                                        }
                                        pointerAtEnding={
                                            object.arrowStyle !== "none"
                                        }
                                        listening={false}
                                    />
                                );
                            }

                            return (
                                <Group
                                    key={object.id}
                                    x={object.x}
                                    y={object.y}
                                    rotation={object.rotation}
                                    listening={false}
                                >
                                    {object.type === "sticky-note" && (
                                        <>
                                            <Rect
                                                width={object.width}
                                                height={object.height}
                                                fill={object.backgroundColor}
                                                cornerRadius={4}
                                            />

                                            <Text
                                                width={object.width}
                                                height={object.height}
                                                text={object.text}
                                                padding={16}
                                                fontSize={20}
                                                fill="#293e36"
                                            />
                                        </>
                                    )}
                                    {object.type === "text" && (
                                        <Text
                                            width={object.width}
                                            height={object.height}
                                            text={object.content}
                                            fontSize={object.fontSize}
                                            fill={object.textColor}
                                        />
                                    )}

                                    {object.type === "shape" &&
                                        object.shapeType === "rectangle" && (
                                            <Rect
                                                width={object.width}
                                                height={object.height}
                                                fill={object.fill}
                                                stroke={object.borderColor}
                                                strokeWidth={object.borderWidth}
                                            />
                                        )}

                                    {object.type === "shape" &&
                                        object.shapeType === "ellipse" && (
                                            <Ellipse
                                                x={object.width / 2}
                                                y={object.height / 2}
                                                radiusX={object.width / 2}
                                                radiusY={object.height / 2}
                                                fill={object.fill}
                                                stroke={object.borderColor}
                                                strokeWidth={object.borderWidth}
                                            />
                                        )}
                                </Group>
                            );
                        })}
                    </Layer>
                </Stage>
            </div>
            <h2>Viewport: changes during navigation</h2>

            <pre data-testid="viewport">
        {JSON.stringify(viewport, null, 2)}
      </pre>

            <h2>Saved object coordinates: must stay unchanged</h2>

            <pre
                data-testid="object-coordinates"
                style={{ overflowX: "auto" }}
            >
        {JSON.stringify(
            sampleBoard.objects.map((object) => ({
                id: object.id,
                type: object.type,
                x: object.x,
                y: object.y,
            })),
            null,
            2,
        )}
      </pre>
        </main>
    );



}
