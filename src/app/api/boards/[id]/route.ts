import { Effect } from "effect";
import { supabaseServer } from "../../../../lib/supabase/server";
import { getBoard, modifyBoard } from "../../../../lib/foundation/services";
import { jsonResult, mutationOrigin, readJSON } from "../../../../lib/foundation/http";
import { AppError } from "../../../../lib/foundation/contracts";
type Context = { params: Promise<{ id: string }> };
const client = () => Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Database is unavailable.", 503) });
export async function GET(_request: Request, context: Context) { return jsonResult(Effect.gen(function* () { const { id } = yield* Effect.promise(() => context.params); return yield* getBoard(yield* client(), id); })); }
export async function PATCH(request: Request, context: Context) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () { const { id } = yield* Effect.promise(() => context.params); const input = yield* readJSON(request); return yield* modifyBoard(yield* client(), id, "rename", input); }));
}
export async function DELETE(request: Request, context: Context) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () { const { id } = yield* Effect.promise(() => context.params); return yield* modifyBoard(yield* client(), id, "delete"); }));
}
