import { Effect } from "effect";
import { boardDocumentSchema, resolveEndpoint } from "./model";
import type { BoardDocument, BoardObject, ConnectorEndpoint } from "./model";
import type { Point } from "./viewport";

const prefix = "CoCanvas objects v1\n";
const maxClipboardBytes = 180_000; // Leave room for the shared edit frame envelope.
const valid = (work: () => BoardDocument, message: string) => Effect.try({
  try: () => boardDocumentSchema.parse(work()), catch: () => new Error(message),
});

export const deleteSelection = (board: BoardDocument, ids: readonly string[]) => valid(() => {
  const removed = new Set(ids);
  const remains = (end: ConnectorEndpoint) => end.kind === "free" || !removed.has(end.objectId);
  return { ...board, objects: board.objects.filter((item) => !removed.has(item.id) &&
    (item.type !== "connector" || (remains(item.start) && remains(item.end)))) };
}, "Could not delete the selection.");

export const moveSelection = (board: BoardDocument, ids: readonly string[], delta: Point) => valid(() => {
  const selected = new Set(ids);
  const move = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  const end = (p: ConnectorEndpoint): ConnectorEndpoint => p.kind === "free" ? { kind: "free", ...move(p) } : p;
  return { ...board, objects: board.objects.map((item) => !selected.has(item.id) ? item :
    item.type === "connector" ? { ...item, start: end(item.start), end: end(item.end) } : { ...item, ...move(item) }) };
}, "Could not move the selection.");

export const encodeSelection = (board: BoardDocument, ids: readonly string[]) => Effect.try({
  try: () => {
    const selected = new Set(ids);
    const endpoint = (end: ConnectorEndpoint): ConnectorEndpoint => {
      if (end.kind === "free" || selected.has(end.objectId)) return end;
      const point = resolveEndpoint(end, board.objects);
      if (!point) throw new Error();
      // References outside the copied set become free endpoints at their visible positions.
      return { kind: "free", ...point };
    };
    const objects = board.objects.filter((item) => selected.has(item.id)).map((item) =>
      item.type === "connector" ? { ...item, start: endpoint(item.start), end: endpoint(item.end) } : item);
    if (!objects.length) throw new Error();
    const payload = prefix + JSON.stringify(boardDocumentSchema.parse({ ...board, objects }));
    if (new TextEncoder().encode(payload).length > maxClipboardBytes) throw new Error();
    return payload;
  },
  catch: () => new Error("Could not copy this selection. Try selecting fewer objects."),
});

export const isCanvasClipboard = (text: string) => text.startsWith(prefix);

const dot = (p: Point, axis: Point) => p.x * axis.x + p.y * axis.y;
const range = (points: Point[], axis: Point) => {
  const values = points.map((p) => dot(p, axis));
  return [Math.min(...values), Math.max(...values)] as const;
};
function corners(item: BoardObject) {
  const rad = item.rotation * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  return [[0, 0], [item.width, 0], [item.width, item.height], [0, item.height]].map(([x, y]) =>
    ({ x: item.x + x! * c - y! * s, y: item.y + x! * s + y! * c }));
}
function footprint(item: BoardObject, objects: readonly BoardObject[]) {
  if (item.type !== "connector") return corners(item);
  const start = resolveEndpoint(item.start, objects), end = resolveEndpoint(item.end, objects);
  return start && end ? [start, end] : [];
}

export const pasteSelection = (board: BoardDocument, payload: string, target: Point, makeId = () => crypto.randomUUID()) => Effect.try({
  try: () => {
    if (!isCanvasClipboard(payload) || payload.length > maxClipboardBytes || new TextEncoder().encode(payload).length > maxClipboardBytes) throw new Error();
    const source = boardDocumentSchema.parse(JSON.parse(payload.slice(prefix.length)));
    if (!source.objects.length || source.objects.length > 2000) throw new Error();
    const ids = new Map(source.objects.map((item) => [item.id, makeId()]));
    let x = Infinity, y = Infinity;
    for (const item of source.objects) for (const point of footprint(item, source.objects)) {
      x = Math.min(x, point.x); y = Math.min(y, point.y);
    }
    const offset = (p: Point) => ({ x: p.x - x + target.x, y: p.y - y + target.y });
    const endpoint = (p: ConnectorEndpoint): ConnectorEndpoint => p.kind === "free" ? { kind: "free", ...offset(p) } : { ...p, objectId: ids.get(p.objectId)! };
    const top = board.objects.reduce((value, item) => Math.max(value, item.zIndex), 0);
    const objects = [...source.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).map((item, index) => {
      const geometry = { ...offset(item), id: ids.get(item.id)!, zIndex: top + index + 1 };
      return item.type === "connector" ? { ...item, ...geometry, start: endpoint(item.start), end: endpoint(item.end) } : { ...item, ...geometry };
    });
    return { board: boardDocumentSchema.parse({ ...board, objects: [...board.objects, ...objects] }), ids: objects.map((item) => item.id) };
  },
  catch: () => new Error("Could not paste objects. Copy a valid selection from CoCanvas and try again."),
});

/** Partial overlap using rotated object bounds or the connector centerline. */
export function selectInRect(board: BoardDocument, a: Point, b: Point) {
  const rect = [
    { x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y },
  ];
  return board.objects.filter((item) => {
    const polygon = footprint(item, board.objects);
    if (!polygon.length) return false;
    const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length]!;
      axes.push({ x: q.y - p.y, y: p.x - q.x });
    });
    return axes.every((axis) => {
      const [lo, hi] = range(polygon, axis), [min, max] = range(rect, axis);
      return lo <= max && hi >= min;
    });
  }).map((item) => item.id);
}
