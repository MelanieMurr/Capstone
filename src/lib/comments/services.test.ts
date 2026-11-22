import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeComment, listComments, commentSummary } from "./services";
const user = "91000000-0000-4000-8000-000000000001", boardId = "91000000-0000-4000-8000-000000000002", noteId = "91000000-0000-4000-8000-000000000003", id = "91000000-0000-4000-8000-000000000004";
const record = { id, board_id: boardId, note_id: noteId, author_id: user, author_name: "Commenter", body: "Please review", status: "pending", created_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null };
function client() {
  const board = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: boardId }, error: null }) };
  const comments = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: record, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: record, error: null }), range: vi.fn().mockResolvedValue({ data: [record], error: null }) };
  const db = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: user } }, error: null }) }, from: vi.fn((table: string) => {
    if (table === "boards") return board;
    if (table === "board_note_comments") return comments;
    throw new Error(`Unexpected canvas-table access: ${table}`);
  }), rpc: vi.fn().mockResolvedValue({ data: user, error: null }) };
  return { db, board, comments, api: db as unknown as SupabaseClient };
}
const run = Effect.runPromise;
describe("comment operations", () => {
  it("requires authentication and board visibility", async () => {
    const f = client(); f.db.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as never);
    await expect(run(listComments(f.api, boardId, noteId))).rejects.toMatchObject({ status: 401 });
    f.board.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(run(commentSummary(f.api, boardId))).rejects.toMatchObject({ status: 404 });
  });
  it("accepts a comment independently of editor permission and never writes canvas objects", async () => {
    const f = client(); await run(changeComment(f.api, boardId, { action: "create", id, noteId, body: record.body }));
    expect(f.comments.insert).toHaveBeenCalledWith({ id, board_id: boardId, note_id: noteId, body: record.body });
    expect(f.db.from.mock.calls.map(([table]) => table)).not.toContain("board_documents");
  });
  it.each([{ author_id: user }, { status: "approved" }, { changes: [] }])("rejects client-supplied authority or canvas mutations", async (extra) => {
    const f = client(); await expect(run(changeComment(f.api, boardId, { action: "create", id, noteId, body: record.body, ...extra }))).rejects.toMatchObject({ status: 400 });
    expect(f.comments.insert).not.toHaveBeenCalled();
  });
  it("maps denied and conflicting reviews without overwriting comment content", async () => {
    const f = client(); f.comments.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "42501" } } as never);
    await expect(run(changeComment(f.api, boardId, { action: "review", id, status: "approved" }))).rejects.toMatchObject({ status: 403 });
    expect(f.comments.update).toHaveBeenCalledWith({ status: "approved" });
    f.comments.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "23514" } } as never);
    await expect(run(changeComment(f.api, boardId, { action: "review", id, status: "rejected" }))).rejects.toMatchObject({ status: 409 });
  });
  it("settles repeated creation only for the same author, note and content", async () => {
    const f = client(); f.comments.single.mockResolvedValueOnce({ data: null, error: { code: "23505" } } as never);
    expect(await run(changeComment(f.api, boardId, { action: "create", id, noteId, body: record.body }))).toMatchObject({ comment: { id } });
    expect(f.comments.eq).toHaveBeenCalledWith("author_id", user);
  });
  it("paginates the selected note and obtains the reviewer through the guarded RPC", async () => {
    const f = client(); const result = await run(listComments(f.api, boardId, noteId, 100));
    expect(f.comments.eq).toHaveBeenCalledWith("note_id", noteId); expect(f.comments.range).toHaveBeenCalledWith(100, 199);
    expect(result.reviewerId).toBe(user);
  });
});
