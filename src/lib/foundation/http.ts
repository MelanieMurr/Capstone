import { Effect } from "effect";
import { AppError } from "./contracts";
export function publicRequestOrigin(request: Request) {
  const url = new URL(request.url);
  // Next's internal Request URL may use localhost while the browser uses 127.0.0.1.
  // Compare against the actual Host header; do not accept arbitrary forwarded hosts.
  const host = request.headers.get("host");
  if (host) url.host = host;
  return url.origin;
}
export function mutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (!origin || origin === publicRequestOrigin(request)) && request.headers.get("sec-fetch-site") !== "cross-site";
}
export const readJSON = (request: Request) => Effect.tryPromise({
  try: async () => { const body = await request.text(); if (body.length > 10_500_000) throw new Error(); return JSON.parse(body) as unknown; },
  catch: () => new AppError("Invalid or oversized request.", 400),
});
export async function jsonResult<A>(program: Effect.Effect<A, Error>) {
  return Effect.runPromise(Effect.match(program, {
    onSuccess: (result) => Response.json(result, { headers: { "Cache-Control": "private, no-store" } }),
    onFailure: (error) => Response.json({ error: error.message }, { status: error instanceof AppError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }),
  }));
}
