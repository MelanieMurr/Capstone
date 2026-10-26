import { Effect } from "effect";
import { supabaseServer } from "../../../../../lib/supabase/server";
import { getBoard } from "../../../../../lib/foundation/services";
import { jsonResult, mutationOrigin } from "../../../../../lib/foundation/http";
import { AppError } from "../../../../../lib/foundation/contracts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => context.params);
    const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Database is unavailable.", 503) });
    // getBoard verifies the user and lets RLS check this specific board.
    yield* getBoard(client, id);
    const result = yield* Effect.tryPromise({ try: () => client.auth.getSession(), catch: () => new AppError("Sign in again.", 401) });
    if (result.error || !result.data.session) return yield* Effect.fail(new AppError("Sign in again.", 401));
    return { token: result.data.session.access_token };
  }));
}
