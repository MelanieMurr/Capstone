import { Effect } from "effect";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, accessInputSchema, boardInputSchema, boardRowSchema, idSchema, loginSchema, signupSchema } from "./contracts";
import { persistBoard, restoreBoard } from "../collaboration/persistence";
import { readBoard, writeBoard } from "../collaboration/shared-board";
import { boardDocumentSchema } from "../board/model";
import type { BoardDocument } from "../board/model";

const fail = (cause: unknown) => cause instanceof AppError ? cause : new AppError("The request could not be completed. Please try again.", 503);
export const authenticated = (client: SupabaseClient) => Effect.tryPromise({
  try: async () => {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new AppError("Please sign in to continue.", 401);
    return data.user;
  }, catch: fail,
});
export const authenticate = (client: SupabaseClient, action: "signin" | "signup" | "signout", input: unknown, _callback: string) => Effect.tryPromise({
  try: async () => {
    if (action === "signout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new AppError("Could not sign out. Please try again.", 503);
      return { message: "Signed out.", signedIn: false };
    }
    const parsed = (action === "signup" ? signupSchema : loginSchema).safeParse(input);
    if (!parsed.success) throw new AppError(action === "signup" ? "Enter a valid email and a password of 12–128 characters." : "Enter your email and password.", 400);
    if (action === "signin") {
      const { error } = await client.auth.signInWithPassword(parsed.data);
      if (error) throw new AppError("Sign-in failed. The email and password did not match.", 401);
      return { message: "Signed in.", signedIn: true };
    }
    const { data, error } = await client.auth.signUp(parsed.data);
    if (error) throw new AppError(error.status === 429 ? "Too many signup attempts. Please wait before trying again." : "Could not create an account. Please check your details and try again.", error.status === 429 ? 429 : 400);
    if (!data.session) throw new AppError("Direct signup is not enabled in Supabase yet. The project owner must turn off Confirm email in Authentication settings.", 503);
    return { message: "Account created.", signedIn: true };
  }, catch: fail,
});
export const listBoards = (client: SupabaseClient) => Effect.gen(function* () {
  yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    const { data, error } = await client.from("boards").select("id,owner_id,title,created_at,updated_at").order("updated_at", { ascending: false });
    if (error) throw error;
    return z.array(boardRowSchema).parse(data);
  }, catch: fail });
});
export const createBoard = (client: SupabaseClient, input: unknown) => Effect.gen(function* () {
  yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    const parsed = boardInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Use a board title of 1–120 characters.", 400);
    const { data, error } = await client.rpc("create_board", { p_title: parsed.data.title });
    if (error) throw error;
    return boardRowSchema.parse(data);
  }, catch: fail });
});
export const getBoard = (client: SupabaseClient, id: string) => Effect.gen(function* () {
  const user = yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    if (!idSchema.safeParse(id).success) throw new AppError("Board not found.", 404);
    const { data: board, error } = await client.from("boards").select("id,owner_id,title,created_at,updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!board) throw new AppError("Board not found or access denied.", 404);
    const parsed = boardRowSchema.parse(board);
    const { data: doc, error: docError } = await client.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", id).single();
    if (docError) throw docError;
    const restored = await Effect.runPromise(restoreBoard(id, doc.snapshot, doc.yjs_state));
    let document: BoardDocument;
    try { document = await Effect.runPromise(readBoard(restored, id)); } finally { restored.destroy(); }
    let canEdit = parsed.owner_id === user.id;
    if (!canEdit) {
      const { data: membership, error: memberError } = await client.from("board_collaborators").select("permission").eq("board_id", id).eq("user_id", user.id).maybeSingle();
      if (memberError) throw memberError;
      canEdit = membership?.permission === "editor";
    }
    return { board: parsed, document, isOwner: parsed.owner_id === user.id, revision: z.number().int().nonnegative().parse(doc.revision), canEdit };
  }, catch: fail });
});
export const modifyBoard = (client: SupabaseClient, id: string, action: "rename" | "delete", input?: unknown) => Effect.gen(function* () {
  const user = yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    if (!idSchema.safeParse(id).success) throw new AppError("Board not found.", 404);
    const { data: existing, error: lookupError } = await client.from("boards").select("owner_id").eq("id", id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing || existing.owner_id !== user.id) throw new AppError("Only the board owner can make this change.", 403);
    if (action === "rename") {
      const parsed = boardInputSchema.safeParse(input);
      if (!parsed.success) throw new AppError("Use a board title of 1–120 characters.", 400);
      const { data, error } = await client.from("boards").update({ title: parsed.data.title }).eq("id", id).eq("owner_id", user.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new AppError("Board no longer exists or access was removed.", 404);
    } else {
      const { data, error } = await client.from("boards").delete().eq("id", id).eq("owner_id", user.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new AppError("Board no longer exists or access was removed.", 404);
    }
    return { ok: true };
  }, catch: fail });
});
export const saveDocument = (client: SupabaseClient, id: string, input: unknown) => Effect.gen(function* () {
  yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    const parsed = z.strictObject({ document: boardDocumentSchema, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) }).safeParse(input);
    if (!idSchema.safeParse(id).success || !parsed.success || parsed.data.document.boardId !== id) throw new AppError("Invalid board document.", 400);
    const { data: previous, error: loadError } = await client.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!previous || previous.revision !== parsed.data.revision) throw new AppError("The board changed elsewhere or access was removed. Reload before saving again.", 409);
    const restored = await Effect.runPromise(restoreBoard(id, previous.snapshot, previous.yjs_state));
    let stored: { snapshot: BoardDocument; yjsState: string };
    try {
      await Effect.runPromise(writeBoard(restored, parsed.data.document, "snapshot-import"));
      stored = await Effect.runPromise(persistBoard(restored, id));
    } finally { restored.destroy(); }
    const { data, error } = await client.from("board_documents").update({ snapshot: stored.snapshot, yjs_state: stored.yjsState, schema_version: 1, revision: parsed.data.revision + 1 }).eq("board_id", id).eq("revision", parsed.data.revision).select("revision");
    if (error?.code === "42501") throw new AppError("You cannot edit this board.", 403);
    if (error) throw error;
    if (!data?.length) throw new AppError("The board changed elsewhere or access was removed. Reload before saving again.", 409);
    return { revision: data[0]!.revision as number };
  }, catch: fail });
});

export const grantCollaborator = (client: SupabaseClient, id: string, input: unknown) => Effect.gen(function* () {
  const user = yield* authenticated(client);
  return yield* Effect.tryPromise({ try: async () => {
    const parsed = accessInputSchema.safeParse(input);
    if (!idSchema.safeParse(id).success || !parsed.success) throw new AppError("Enter a registered email and choose viewer or editor access.", 400);
    const { data: board, error: lookupError } = await client.from("boards").select("owner_id").eq("id", id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!board || board.owner_id !== user.id) throw new AppError("Only the board owner can grant access.", 403);
    const { error } = await client.rpc("grant_board_access", { p_board_id: id, p_email: parsed.data.email, p_permission: parsed.data.permission });
    if (error?.code === "P0002") throw new AppError("No registered account uses that email. Ask them to create an account first.", 404);
    if (error?.code === "42501") throw new AppError("Only the board owner can grant access.", 403);
    if (error?.code === "22023") throw new AppError("Choose another registered account and a valid permission.", 400);
    if (error) throw error;
    return { message: `${parsed.data.permission === "editor" ? "Editor" : "Viewer"} access granted. They can open this board from their dashboard.`, permission: parsed.data.permission };
  }, catch: fail });
});
