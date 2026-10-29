import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { initialBoard } from "../board/frontend";
import { AppError } from "../foundation/contracts";
import { getBoard } from "../foundation/services";
import { supabaseServer } from "../supabase/server";
import { handleLocalAI } from "./local-route";
import { POST } from "../../app/api/boards/[id]/ai/route";
vi.mock("../foundation/services", () => ({ getBoard: vi.fn() }));
vi.mock("../supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("./local-route", () => ({ handleLocalAI: vi.fn() }));
const lookup = vi.mocked(getBoard), provider = vi.mocked(handleLocalAI);
const note = initialBoard.objects.find((object) => object.type === "sticky-note")!;
const context = { params: Promise.resolve({ id: initialBoard.boardId }) };
function request(notes: unknown = [{ id: note.id, text: note.text }], extra = {}) {
  return new Request(`http://localhost:3000/api/boards/${initialBoard.boardId}/ai`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ notes, prompt: "grounded", operation: "summary", ...extra }) });
}
function allowed(canEdit = true) {
  lookup.mockReturnValue(Effect.succeed({ document: initialBoard, canEdit, isOwner: canEdit, revision: 1, board: { id: initialBoard.boardId, title: "Test", owner_id: "20000000-0000-4000-8000-000000000001", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }));
}
beforeEach(() => { vi.mocked(supabaseServer).mockResolvedValue({} as Awaited<ReturnType<typeof supabaseServer>>); allowed(); provider.mockResolvedValue(Response.json({ result: "verified" })); });
afterEach(() => vi.resetAllMocks());
describe("saved-board AI integration boundary", () => {
  it("authorizes the saved board and delegates verified selected content", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(provider).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(lookup.mock.calls[0]![1]).toBe(initialBoard.boardId);
  });
  it.each([401, 404])("does not invoke the provider after access failure %i", async (status) => {
    lookup.mockReturnValue(Effect.fail(new AppError("Access denied", status)));
    expect((await POST(request(), context)).status).toBe(status); expect(provider).not.toHaveBeenCalled();
  });
  it("denies viewers", async () => {
    allowed(false); expect((await POST(request(), context)).status).toBe(403); expect(provider).not.toHaveBeenCalled();
  });
  it("rejects forged content and missing or foreign notes before invoking the provider", async () => {
    for (const notes of [[{ id: note.id, text: "Forged text" }], [{ id: "90000000-0000-4000-8000-000000000001", text: "Foreign note" }]]) {
      expect((await POST(request(notes), context)).status).toBe(409);
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("requires a valid operation and rejects oversized/empty input", async () => {
    expect((await POST(request([], {}), context)).status).toBe(400);
    expect((await POST(request(undefined, { operation: undefined }), context)).status).toBe(400);
    expect((await POST(request(undefined, { operation: "invent" }), context)).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects cross-site requests before loading a board", async () => {
    const input = request(); input.headers.set("Origin", "https://example.com");
    expect((await POST(input, context)).status).toBe(403); expect(lookup).not.toHaveBeenCalled();
  });
});
