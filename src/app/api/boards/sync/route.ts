import { upgradeWebSocket } from "@vercel/functions";
import { Effect } from "effect";
import { authenticated } from "../../../../lib/foundation/services";
import { supabaseServer } from "../../../../lib/supabase/server";
import { AppError } from "../../../../lib/foundation/contracts";
import { publicRequestOrigin } from "../../../../lib/foundation/http";
import { distributedSupabaseStore } from "../../../../lib/collaboration/distributed-store";
import { attachDistributedSocket } from "../../../../lib/collaboration/distributed-socket";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const program = Effect.gen(function* () {
    yield* Effect.try({ try: () => {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new AppError("WebSocket upgrade required.", 426);
      if (request.headers.get("origin") !== publicRequestOrigin(request)) throw new AppError("Invalid connection origin.", 403);
    }, catch: (error) => error instanceof AppError ? error : new AppError("Invalid connection.", 400) });
    const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Sign in required.", 401) });
    yield* authenticated(client); // Reject anonymous upgrades before allocating socket resources.
    return yield* Effect.tryPromise({ try: async () => {
      const store = distributedSupabaseStore();
      return upgradeWebSocket((socket) => attachDistributedSocket(socket, store), { maxPayload: 256 * 1024 });
    }, catch: () => new AppError("Shared board connection unavailable. Try again shortly.", 503) });
  });
  return Effect.runPromise(Effect.match(program, {
    onSuccess: (response) => response,
    onFailure: (error) => Response.json({ error: error.message }, { status: error instanceof AppError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }),
  }));
}
