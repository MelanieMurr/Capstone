import { Effect } from "effect";
import { supabaseServer } from "../../../../../lib/supabase/server";
import { grantCollaborator } from "../../../../../lib/foundation/services";
import { jsonResult, mutationOrigin, readJSON } from "../../../../../lib/foundation/http";
import { AppError } from "../../../../../lib/foundation/contracts";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => context.params);
    const input = yield* readJSON(request);
    const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Database is unavailable.", 503) });
    return yield* grantCollaborator(client, id, input);
  }));
}
