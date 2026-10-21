import { Effect } from "effect";
import { supabaseServer } from "../../../../lib/supabase/server";
import { authenticate } from "../../../../lib/foundation/services";
import { AppError } from "../../../../lib/foundation/contracts";
import { jsonResult, mutationOrigin, readJSON } from "../../../../lib/foundation/http";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () {
    const { action } = yield* Effect.promise(() => context.params);
    if (action !== "signin" && action !== "signup" && action !== "signout") return yield* Effect.fail(new AppError("Not found.", 404));
    const input = action === "signout" ? {} : yield* readJSON(request);
    const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Authentication is not configured.", 503) });
    return yield* authenticate(client, action, input, "");
  }));
}
