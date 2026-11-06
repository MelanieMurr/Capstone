import { cookies } from "next/headers";
import { Effect } from "effect";
import { localUser } from "../../../lib/ai/chatgpt/access";
import { connectionActionSchema } from "../../../lib/ai/chatgpt/contracts";
import { beginConnection, OAUTH_COOKIE } from "../../../lib/ai/chatgpt/oauth";
import { availableModels, connectionStatus, selectModel, updateConnection } from "../../../lib/ai/chatgpt/service";
import { AppError } from "../../../lib/foundation/contracts";
import { jsonResult, publicRequestOrigin, readJSON } from "../../../lib/foundation/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return jsonResult(Effect.gen(function* () {
    const user = yield* localUser(request);
    if (new URL(request.url).searchParams.get("models") === "1") return { models: yield* availableModels(user.id) };
    return yield* connectionStatus(user.id);
  }));
}
export async function POST(request: Request) {
  return jsonResult(Effect.gen(function* () {
    const user = yield* localUser(request, true);
    const body = yield* readJSON(request, 2000);
    const input = yield* Effect.try({ try: () => connectionActionSchema.parse(body), catch: () => new AppError("Invalid ChatGPT connection request.", 400) });
    if (input.action === "connect") {
      const result = yield* beginConnection(user.id, publicRequestOrigin(request), input.returnTo, input.accountId, input.enablePlan);
      yield* Effect.tryPromise({
        try: async () => { (await cookies()).set(OAUTH_COOKIE, result.state, { httpOnly: true, sameSite: "lax", path: "/auth/callback", maxAge: 600, secure: false }); },
        catch: () => new AppError("Could not start the local ChatGPT sign-in session.", 503),
      });
      // This URL is returned only to the initiating, authenticated browser; never log it.
      return { authorization: result.authorization };
    }
    if (input.action === "model") return yield* selectModel(user.id, input.model);
    return yield* updateConnection(user.id, input.action, "accountId" in input ? input.accountId : undefined);
  }));
}
