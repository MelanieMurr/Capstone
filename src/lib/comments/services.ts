import { Effect } from "effect";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticated } from "../foundation/services";
import { AppError } from "../foundation/contracts";
import { commentActionSchema, commentSchema } from "./contracts";
const failure = (error: unknown) => error instanceof AppError ? error : new AppError("Comments are temporarily unavailable. Please try again.", 503);
const access = (client: SupabaseClient, boardId: string) => Effect.gen(function* () {
  yield* Effect.try({ try: () => z.uuid().parse(boardId), catch: () => new AppError("Board not found.", 404) });
  const user = yield* authenticated(client);
  yield* Effect.tryPromise({ try: async () => {
    const { data, error } = await client.from("boards").select("id").eq("id", boardId).maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("Board not found or access denied.", 404);
  }, catch: failure });
  return user;
});
export const listComments = (client: SupabaseClient, boardId: string, noteId: string | null, offset = 0) => Effect.gen(function* () {
  const user = yield* access(client, boardId);
  if (noteId) yield* Effect.try({ try: () => z.uuid().parse(noteId), catch: () => new AppError("Invalid note.", 400) });
  return yield* Effect.tryPromise({ try: async () => {
    // The board overview provides badge counts; a selected note gets its own paginated history.
    let query = client.from("board_note_comments").select("*").eq("board_id", boardId);
    if (noteId) query = query.eq("note_id", noteId);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 99);
    if (error) throw error;
    let reviewerId: string | null = null;
    if (noteId) {
      const reviewer = await client.rpc("board_note_reviewer", { target_board: boardId, target_note: noteId });
      if (reviewer.error) throw reviewer.error;
      reviewerId = z.uuid().nullable().parse(reviewer.data);
    }
    return { comments: z.array(commentSchema).parse(data), viewerId: user.id, reviewerId, hasMore: data?.length === 100 };
  }, catch: failure });
});
export const changeComment = (client: SupabaseClient, boardId: string, input: unknown) => Effect.gen(function* () {
  const user = yield* access(client, boardId);
  const command = yield* Effect.try({ try: () => commentActionSchema.parse(input), catch: () => new AppError("Use a comment of 1–2,000 characters or a valid review action.", 400) });
  return yield* Effect.tryPromise({ try: async () => {
    if (command.action === "create") {
      const value = { id: command.id, board_id: boardId, note_id: command.noteId, body: command.body };
      const { data, error } = await client.from("board_note_comments").insert(value).select().single();
      if (error?.code === "23505") {
        const existing = await client.from("board_note_comments").select().eq("id", command.id).eq("board_id", boardId).eq("author_id", user.id).maybeSingle();
        if (!existing.error && existing.data?.body === command.body && existing.data?.note_id === command.noteId) return { comment: commentSchema.parse(existing.data) };
        throw new AppError("This request has already been used. Please refresh.", 409);
      }
      if (["42501", "P0002", "23503"].includes(error?.code ?? "")) throw new AppError("You cannot comment on this note. Check that it still exists and you have board access.", 403);
      if (error) throw error;
      return { comment: commentSchema.parse(data) };
    }
    const { data, error } = await client.from("board_note_comments").update({ status: command.status }).eq("id", command.id).eq("board_id", boardId).select().maybeSingle();
    if (error?.code === "23514") throw new AppError("This comment has already been reviewed. Refresh to see the result.", 409);
    if (error?.code === "42501" || (!error && !data)) throw new AppError("Only this note's reviewer can approve or reject its comments.", 403);
    if (error) throw error;
    return { comment: commentSchema.parse(data) };
  }, catch: failure });
});
export const commentSummary = (client: SupabaseClient, boardId: string) => Effect.gen(function* () {
  yield* access(client, boardId);
  return yield* Effect.tryPromise({ try: async () => {
    const { data, error } = await client.rpc("board_comment_counts", { target_board: boardId });
    if (error) throw error;
    return { counts: z.record(z.uuid(), z.number().int().nonnegative()).parse(data) };
  }, catch: failure });
});
