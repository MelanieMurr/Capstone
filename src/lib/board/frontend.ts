import { Effect } from "effect";
import { boardDocumentSchema } from "./model";
import type { BoardDocument } from "./model";

export const validateBoard = (input: unknown) => Effect.try({
  try: () => boardDocumentSchema.parse(input),
  catch: () => new Error("This board contains invalid objects."),
});
export const loadBoard = () => Effect.try({
  try: () => {
    const raw = localStorage.getItem("cocanvas-board-v1");
    return raw ? boardDocumentSchema.parse(JSON.parse(raw)) : null;
  },
  catch: () => new Error("Your saved board could not be loaded. The example board is shown."),
});
export const saveBoard = (board: BoardDocument) => Effect.try({
  try: () => localStorage.setItem("cocanvas-board-v1", JSON.stringify(boardDocumentSchema.parse(board))),
  catch: () => new Error("Could not save on this device. Export a copy to keep your work."),
});
export const exportBoard = (board: BoardDocument) => Effect.try({
  try: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "cocanvas-board.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  catch: () => new Error("Export failed. Please try again."),
});
export const initialBoard = boardDocumentSchema.parse({
  schemaVersion: 1, boardId: "10000000-0000-4000-8000-000000000001",
  objects: [
    { id: "10000000-0000-4000-8000-000000000002", type: "text", x: 80, y: 70, width: 600, height: 60, content: "Good ideas start with a little space.", fontSize: 32 },
    { id: "10000000-0000-4000-8000-000000000003", type: "text", x: 80, y: 125, width: 600, height: 40, content: "A place to think out loud, connect the dots, and make a plan.", fontSize: 15, textColor: "#77817e" },
    { id: "10000000-0000-4000-8000-000000000004", type: "sticky-note", x: 80, y: 245, width: 220, height: 190, text: "THE OPPORTUNITY\n\nOne shared space for everyone's best ideas.", backgroundColor: "#fff0b5" },
    { id: "10000000-0000-4000-8000-000000000005", type: "sticky-note", x: 390, y: 245, width: 220, height: 190, text: "WHAT IF…\n\nWe could turn a messy brainstorm into a clear next step?", backgroundColor: "#d9ede5" },
    { id: "10000000-0000-4000-8000-000000000006", type: "sticky-note", x: 700, y: 245, width: 220, height: 190, text: "NEXT UP\n\nBuild a small prototype. Learn together. Keep iterating.", backgroundColor: "#eadff3" },
    { id: "10000000-0000-4000-8000-000000000007", type: "connector", start: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000004", anchorX: 1, anchorY: 0.5 }, end: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000005", anchorX: 0, anchorY: 0.5 }, strokeColor: "#8b9992" },
    { id: "10000000-0000-4000-8000-000000000008", type: "connector", start: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000005", anchorX: 1, anchorY: 0.5 }, end: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000006", anchorX: 0, anchorY: 0.5 }, strokeColor: "#8b9992" },
    { id: "10000000-0000-4000-8000-000000000009", type: "shape", x: 80, y: 515, width: 840, height: 115, fill: "#ffffff", borderColor: "#d8e0db", borderWidth: 1 },
    { id: "10000000-0000-4000-8000-000000000010", type: "text", x: 110, y: 540, width: 750, height: 70, content: "A LITTLE REMINDER\nThere's no wrong place to start. Add a note and see where it takes you.", fontSize: 17, textColor: "#65746c" },
  ],
});
