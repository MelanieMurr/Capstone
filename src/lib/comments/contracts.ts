import { z } from "zod";
export const commentSchema = z.object({
  id: z.uuid(), board_id: z.uuid(), note_id: z.uuid(), author_id: z.uuid(), author_name: z.string(),
  body: z.string().min(1).max(2000), status: z.enum(["pending", "approved", "rejected"]),
  created_at: z.string(), reviewed_at: z.string().nullable(), reviewed_by: z.uuid().nullable(),
});
export type NoteComment = z.infer<typeof commentSchema>;
export const commentActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), id: z.uuid(), noteId: z.uuid(), body: z.string().trim().min(1).max(2000) }),
  z.strictObject({ action: z.literal("review"), id: z.uuid(), status: z.enum(["approved", "rejected"]) }),
]);
export const commentResponseSchema = z.object({ comments: z.array(commentSchema), viewerId: z.uuid(), reviewerId: z.uuid().nullable(), hasMore: z.boolean() });
