import { Effect } from "effect";
import { AppError } from "../../foundation/contracts";
import { authenticated } from "../../foundation/services";
import { mutationOrigin, publicRequestOrigin } from "../../foundation/http";
import { supabaseServer } from "../../supabase/server";

export function requireLocal(request: Request, mutation = false) {
  if (process.env.NODE_ENV === "production") throw new AppError("ChatGPT subscription connections are available only in local development.", 404);
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!allowed.has(new URL(request.url).hostname) || !allowed.has(new URL(publicRequestOrigin(request)).hostname)) throw new AppError("Localhost access only.", 403);
  if (mutation && !mutationOrigin(request)) throw new AppError("Invalid request origin.", 403);
}
export const localUser = (request: Request, mutation = false) => Effect.gen(function* () {
  yield* Effect.try({ try: () => requireLocal(request, mutation), catch: (error) => error instanceof AppError ? error : new AppError("Invalid local request.", 400) });
  const client = yield* Effect.tryPromise({ try: supabaseServer, catch: () => new AppError("Sign in to CoCanvas before connecting ChatGPT.", 401) });
  return yield* authenticated(client);
});
