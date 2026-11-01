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
/** Bound bytes before decoding or parsing, including chunked bodies without Content-Length. */
export const readJSON = (request: Request, maxBytes = 10_500_000) => Effect.tryPromise({
  try: async () => {
    const declared = request.headers.get("content-length");
    if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0)) throw new AppError("Invalid request length.", 400);
    if (declared !== null && Number(declared) > maxBytes) throw new AppError("Request too large.", 413);
    if (!request.body) throw new AppError("Invalid JSON request.", 400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const pieces: string[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          // Do not await tee cancellation: an unread second branch can delay it.
          void reader.cancel().catch(() => undefined);
          throw new AppError("Request too large.", 413);
        }
        pieces.push(decoder.decode(chunk.value, { stream: true }));
      }
      pieces.push(decoder.decode());
      return JSON.parse(pieces.join("")) as unknown;
    } finally { reader.releaseLock(); }
  },
  catch: (cause) => cause instanceof AppError ? cause : new AppError("Invalid JSON request.", 400),
});
export async function jsonResult<A>(program: Effect.Effect<A, Error>) {
  return Effect.runPromise(Effect.match(program, {
    onSuccess: (result) => Response.json(result, { headers: { "Cache-Control": "private, no-store" } }),
    onFailure: (error) => Response.json({ error: error.message }, { status: error instanceof AppError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }),
  }));
}
