import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { boardDocumentSchema } from "./model";
import { stickers, stickerAsset } from "./stickers";
import { createObject, patchObject, objectLabel } from "./operations";
import { encodeSelection, pasteSelection, deleteSelection } from "./interaction";
import { persistBoard, restoreBoard } from "../collaboration/persistence";
import { readBoard } from "../collaboration/shared-board";
const run = Effect.runSync;
describe("sticker objects", () => {
  it("creates, transforms, copies and deletes stickers using the normal object operations", () => {
    const empty = boardDocumentSchema.parse({ schemaVersion: 1, boardId: randomUUID(), objects: [] });
    const sticker = run(createObject(empty, "sticker", { x: 10, y: 20 }));
    expect(sticker).toMatchObject({ width: 96, height: 96, assetId: "celebrate" });
    const board = run(patchObject({ ...empty, objects: [sticker] }, sticker.id, { x: 90, width: 140, height: 120, rotation: 45, zIndex: 5 }));
    const copy = run(pasteSelection(board, run(encodeSelection(board, [sticker.id])), { x: 300, y: 200 }));
    expect(copy.board.objects).toHaveLength(2);
    expect(copy.board.objects[1]).toMatchObject({ type: "sticker", assetId: "celebrate", width: 140, rotation: 45, zIndex: 6 });
    expect(run(deleteSelection(copy.board, copy.ids))).toEqual(board);
  });
  it("retains stable asset IDs in binary Yjs state and safely renders missing assets", () => {
    const board = boardDocumentSchema.parse({ schemaVersion: 1, boardId: randomUUID(), objects: [{ id: randomUUID(), type: "sticker", assetId: "future-sticker" }] });
    const doc = run(restoreBoard(board.boardId, board, null));
    const stored = run(persistBoard(doc, board.boardId));
    const reopened = run(restoreBoard(board.boardId, null, stored.yjsState));
    try { expect(run(readBoard(reopened, board.boardId))).toEqual(board); expect(objectLabel(board.objects[0]!)).toBe("sticker: Unavailable sticker"); }
    finally { doc.destroy(); reopened.destroy(); }
    expect(new Set(stickers.map((item) => item.id)).size).toBe(stickers.length);
    expect(stickerAsset("future-sticker").glyph).toBe("◇");
  });
});
