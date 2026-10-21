import { Effect } from "effect";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, boardInputSchema, boardRowSchema, idSchema, loginSchema, signupSchema } from "./contracts";
import { boardDocumentSchema } from "../board/model";

const fail = (cause: unknown) => cause instanceof AppError ? cause : new AppError("The request could not be completed. Please try again.", 503);
export const authenticated = (client: SupabaseClient) => Effect.tryPromise({
  try: async () => {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new AppError("Please sign in to continue.", 401);
    return data.user;
  }, catch: fail,
});
export const authenticate = (client: SupabaseClient, action: "signin" | "signup" | "signout", input: unknown, callback: string) => Effect.tryPromise({
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
      if (error) throw new AppError("Sign-in failed. Check your email, password and email confirmation.", 401);
      return { message: "Signed in.", signedIn: true };
    }
    const { data, error } = await client.auth.signUp({ ...parsed.data, options: { emailRedirectTo: callback } });
    if (error) throw new AppError(error.status === 429 ? "Too many signup attempts. Please wait before trying again." : "Could not create an account. Please check your details and try again.", error.status === 429 ? 429 : 400);
    return { message: data.session ? "Account created." : "Check your email to confirm your account, then sign in. If you already have an account, use Sign in.", signedIn: Boolean(data.session) };
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
    const { data: doc, error: docError } = await client.from("board_documents").select("snapshot,revision").eq("board_id", id).single();
    if (docError) throw docError;
    const document = boardDocumentSchema.parse(doc.snapshot ?? { schemaVersion: 1, boardId: id, objects: [] });
    let canEdit = parsed.owner_id === user.id;
    if (!canEdit) {
      const { data: membership, error: memberError } = await client.from("board_collaborators").select("permission").eq("board_id", id).eq("user_id", user.id).maybeSingle();
      if (memberError) throw memberError;
      canEdit = membership?.permission === "editor";
    }
    return { board: parsed, document, revision: z.number().int().nonnegative().parse(doc.revision), canEdit };
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
    const { data, error } = await client.from("board_documents").update({ snapshot: parsed.data.document, revision: parsed.data.revision + 1 }).eq("board_id", id).eq("revision", parsed.data.revision).select("revision");
    if (error?.code === "42501") throw new AppError("You cannot edit this board.", 403);
    if (error) throw error;
    if (!data?.length) throw new AppError("The board changed elsewhere or access was removed. Reload before saving again.", 409);
    return { revision: data[0]!.revision as number };
  }, catch: fail });
});
