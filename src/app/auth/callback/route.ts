import { cookies } from "next/headers";
import { Effect } from "effect";
import { localUser } from "../../../lib/ai/chatgpt/access";
import { finishConnection, OAUTH_COOKIE } from "../../../lib/ai/chatgpt/oauth";
import { publicRequestOrigin } from "../../../lib/foundation/http";
import { AppError } from "../../../lib/foundation/contracts";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return Effect.runPromise(Effect.match(Effect.gen(function* () {
    const jar = yield* Effect.tryPromise({ try: cookies, catch: () => new AppError("Could not read sign-in state.", 400) });
    const state = jar.get(OAUTH_COOKIE)?.value;
    jar.set(OAUTH_COOKIE, "", { path: "/auth/callback", maxAge: 0, httpOnly: true, sameSite: "lax" });
    const user = yield* localUser(request);
    const callback = new URL(request.url);
    const origin = new URL(publicRequestOrigin(request));
    callback.host = origin.host;
    callback.protocol = origin.protocol;
    return yield* finishConnection(user.id, callback, state);
  }), {
    onSuccess: (result) => {
      const target = new URL(result.returnTo, publicRequestOrigin(request));
      target.searchParams.set("chatgpt", result.status);
      return new Response(null, { status: 303, headers: { Location: target.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    },
    onFailure: (error) => new Response("ChatGPT connection could not be completed. Return to your local CoCanvas board, open AI, and connect again. Sign in to CoCanvas at 127.0.0.1 first. Your existing connection was preserved.", { status: error instanceof AppError ? error.status : 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }),
  }));
}
