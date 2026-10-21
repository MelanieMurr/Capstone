import { Effect } from "effect";
import { supabaseServer } from "../../../lib/supabase/server";
import { createBoard, listBoards } from "../../../lib/foundation/services";
import { jsonResult, mutationOrigin, readJSON } from "../../../lib/foundation/http";
import { AppError } from "../../../lib/foundation/contracts";
const client = () => Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Database is unavailable.", 503) });
export async function GET() { return jsonResult(Effect.gen(function* () { return yield* listBoards(yield* client()); })); }
export async function POST(request: Request) {
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return jsonResult(Effect.gen(function* () { const input = yield* readJSON(request); return yield* createBoard(yield* client(), input); }));
}
