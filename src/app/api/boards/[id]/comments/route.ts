import { Effect } from "effect";
import { z } from "zod";
import { supabaseServer } from "../../../../../lib/supabase/server";
import { changeComment, listComments, commentSummary } from "../../../../../lib/comments/services";
import { AppError } from "../../../../../lib/foundation/contracts";
import { jsonResult, mutationOrigin, readJSON } from "../../../../../lib/foundation/http";
const contextClient = () => Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Comments are unavailable.", 503) });
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return jsonResult(Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => context.params);
    const params = new URL(request.url).searchParams;
    if (params.get("summary") === "1") return yield* commentSummary(yield* contextClient(), id);
    const offset = yield* Effect.try({ try: () => z.coerce.number().int().min(0).max(100000).parse(params.get("offset") ?? 0), catch: () => new AppError("Invalid comment page.", 400) });
    return yield* listComments(yield* contextClient(), id, params.get("noteId"), offset);
  }));
}
export function POST(request: Request, context: Context) {
  if (!mutationOrigin(request)) return Promise.resolve(Response.json({ error: "Invalid request origin." }, { status: 403 }));
  return jsonResult(Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => context.params);
    const input = yield* readJSON(request, 14000);
    return yield* changeComment(yield* contextClient(), id, input);
  }));
}
