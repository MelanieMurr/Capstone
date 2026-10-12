import { boardDocumentSchema } from "./model";

export const sampleBoard = boardDocumentSchema.parse({
  schemaVersion: 1,
  boardId: "10000000-0000-4000-8000-000000000001",
  objects: [
    { id: "10000000-0000-4000-8000-000000000002", type: "sticky-note", x: 40, y: 80, text: "Research collaboration" },
    { id: "10000000-0000-4000-8000-000000000003", type: "text", x: 40, y: 20, height: 40, content: "CoCanvas planning" },
    { id: "10000000-0000-4000-8000-000000000004", type: "shape", x: 400, y: 80, shapeType: "rectangle" },
    { id: "10000000-0000-4000-8000-000000000005", type: "shape", x: 400, y: 300, shapeType: "ellipse" },
    {
      id: "10000000-0000-4000-8000-000000000006", type: "connector",
      start: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000002", anchorX: 1, anchorY: 0.5 },
      end: { kind: "attached", objectId: "10000000-0000-4000-8000-000000000004", anchorX: 0, anchorY: 0.5 },
    },
    {
      id: "10000000-0000-4000-8000-000000000007", type: "connector",
      start: { kind: "free", x: 300, y: 300 },
      end: { kind: "free", x: 350, y: 400 }, arrowStyle: "both",
    },
  ],
});
