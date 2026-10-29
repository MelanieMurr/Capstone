import { Effect } from "effect";
import { requestSchema } from "../../../../../lib/ai/evaluation";
import { handleLocalAI } from "../../../../../lib/ai/local-route";
import { supabaseServer } from "../../../../../lib/supabase/server";
import { getBoard } from "../../../../../lib/foundation/services";
import { AppError } from "../../../../../lib/foundation/contracts";
import { mutationOrigin } from "../../../../../lib/foundation/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return Effect.runPromise(Effect.match(Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => context.params);
    const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Database is unavailable.", 503) });
    const saved = yield* getBoard(client, id);
    if (!saved.canEdit) return yield* Effect.fail(new AppError("Editor access is required for board AI requests.", 403));
    const input = yield* Effect.tryPromise({
      try: async () => {
        const body = await request.clone().text();
        if (body.length > 60000) throw new Error();
        return requestSchema.parse(JSON.parse(body));
      }, catch: () => new AppError("Select 1–20 valid notes and an AI operation.", 400),
    });
    if (!input.operation) return yield* Effect.fail(new AppError("Choose an AI operation.", 400));
    for (const note of input.notes) {
      const source = saved.document.objects.find((object) => object.id === note.id);
      if (!source || source.type !== "sticky-note" || source.text.trim() !== note.text) {
        return yield* Effect.fail(new AppError("Selected notes differ from the saved board. Wait for shared changes to save, review your selection, and try again.", 409));
      }
    }
    return yield* Effect.tryPromise({ try: () => handleLocalAI(request), catch: () => new AppError("AI service is unavailable. Please try again.", 503) });
  }), {
    onSuccess: (response) => { response.headers.set("Cache-Control", "private, no-store"); return response; },
    onFailure: (error) => Response.json({ error: error.message }, { status: error instanceof AppError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }),
  }));
}
