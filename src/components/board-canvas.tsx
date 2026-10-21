"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { Arrow, Ellipse, Group, Layer, Rect, Stage, Text } from "react-konva";
import { resolveEndpoint } from "../lib/board/model";
import type { BoardDocument, ShapeObject } from "../lib/board/model";

function ShapeText({ shape }: { shape: ShapeObject }) {
  // An ellipse's inscribed rectangle keeps wrapped labels within its curved edge.
  const factor = shape.shapeType === "ellipse" ? Math.SQRT1_2 : 1;
  const width = Math.max(1, shape.width * factor - 24 - shape.borderWidth);
  const height = Math.max(1, shape.height * factor - 24 - shape.borderWidth);
  return <Text x={(shape.width - width) / 2} y={(shape.height - height) / 2}
    width={width} height={height} text={shape.text} fontFamily="DM Sans, sans-serif"
    fontSize={shape.fontSize} fill={shape.textColor} align="center" verticalAlign="middle" lineHeight={1.3} wrap="word" />;
}

// Konva draws the board. Transparent DOM controls above it provide keyboard,
// screen-reader and pointer interactions without creating a second object model.
export default function BoardCanvas({ board, pan, zoom, selected, onError }: {
  board: BoardDocument; pan: { x: number; y: number }; zoom: number;
  selected: string | null; onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    Effect.runSync(Effect.match(Effect.try({ try: () => {
      observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }); });
      if (host.current) observer.observe(host.current);
    }, catch: () => new Error("Could not measure the canvas.") }), { onSuccess: () => {}, onFailure: (error) => onError(error.message) }));
    let active = true;
    void Effect.runPromise(Effect.match(Effect.tryPromise({ try: () => document.fonts.ready, catch: () => new Error("The canvas font could not be loaded.") }), {
      onSuccess: () => { if (active) setFontReady(true); }, onFailure: (error) => { if (active) onError(error.message); },
    }));
    return () => { active = false; observer?.disconnect(); };
  }, [onError]);
  return <div ref={host} className="konva-surface" aria-hidden="true" data-testid="board-renderer" data-renderer="react-konva">
    <Stage width={size.width} height={size.height} listening={false}>
      <Layer><Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
        {board.objects.filter((item) => item.type === "connector").map((item) => {
          const start = resolveEndpoint(item.start, board.objects), end = resolveEndpoint(item.end, board.objects);
          return start && end ? <Arrow key={item.id} points={[start.x, start.y, end.x, end.y]} fill={item.strokeColor} stroke={selected === item.id ? "#277d67" : item.strokeColor} strokeWidth={item.strokeWidth} pointerLength={8} pointerWidth={8} pointerAtBeginning={item.arrowStyle === "both"} pointerAtEnding={item.arrowStyle !== "none"} /> : null;
        })}
        {[...board.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).filter((item) => item.type !== "connector").map((item) => <Group key={`${item.id}-${fontReady}`} x={item.x} y={item.y} rotation={item.rotation}>
          {item.type === "sticky-note" ? <>
            <Rect width={item.width} height={item.height} fill={item.backgroundColor} cornerRadius={2} shadowColor="#445d36" shadowBlur={8} shadowOffsetY={5} shadowOpacity={0.08} />
            <Rect x={item.width / 2 - 15} y={10} width={30} height={5} fill="#ffffff55" cornerRadius={3} />
            <Text x={24} y={27} text={item.text} width={Math.max(1, item.width - 48)} height={Math.max(1, item.height - 42)} fontFamily="DM Sans, sans-serif" fontSize={17} lineHeight={1.5} fill="#4d5942" />
          </> : item.type === "text" ? <Text text={item.content} width={item.width} height={item.height} fontFamily="Manrope, sans-serif" fontStyle="500" fontSize={item.fontSize} fill={item.textColor} lineHeight={1.5} /> : item.shapeType === "ellipse" ?
            <Ellipse x={item.width / 2} y={item.height / 2} radiusX={Math.max(0.5, (item.width - item.borderWidth) / 2)} radiusY={Math.max(0.5, (item.height - item.borderWidth) / 2)} fill={item.fill} stroke={item.borderColor} strokeWidth={item.borderWidth} /> :
            <Rect x={item.borderWidth / 2} y={item.borderWidth / 2} width={Math.max(1, item.width - item.borderWidth)} height={Math.max(1, item.height - item.borderWidth)} fill={item.fill} stroke={item.borderColor} strokeWidth={item.borderWidth} />}
          {item.type === "shape" && <ShapeText shape={item} />}
        </Group>)}
      </Group></Layer>
    </Stage>
  </div>;
}
