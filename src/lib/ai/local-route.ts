import { Effect } from "effect";
import { requestSchema } from "./evaluation";
import { evaluateWithLocalCodex } from "./local-codex";
import { evaluateWithChatGPT, ChatGPTInferenceError } from "./chatgpt/inference";
import { localUser, requireLocal } from "./chatgpt/access";
import { AppError } from "../foundation/contracts";

import { mutationOrigin, readJSON } from "../foundation/http";

let requests: number[] = [];
let active = false;
export async function handleLocalAI(request: Request, verifiedInput?: unknown) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Local development evaluation only." }, { status: 404 });
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return Response.json({ error: "Localhost access only." }, { status: 403 });
  if (!mutationOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  try { requireLocal(request, true); } catch { return Response.json({ error: "Localhost access only." }, { status: 403 }); }
  if (Number(request.headers.get("content-length") || 0) > 60000) return Response.json({ error: "Request too large." }, { status: 413 });
  const parsed = await Effect.runPromise(Effect.match(Effect.gen(function* () {
    const body = verifiedInput ?? (yield* readJSON(request, 60000));
    return yield* Effect.try({ try: () => requestSchema.parse(body), catch: () => new Error("Select 1–20 notes with unique IDs and at most 2000 characters each.") });
  }), { onSuccess: (value) => ({ value, error: null }), onFailure: (error) => ({ value: null, error }) }));
  const input = parsed.value;
  if (parsed.error && "status" in parsed.error && parsed.error.status === 413) return Response.json({ error: "Request too large." }, { status: 413 });
  if (!input) return Response.json({ error: "Invalid or oversized request. Select 1–20 notes with unique IDs and at most 2000 characters each." }, { status: 400 });
  requests = requests.filter((time) => Date.now() - time < 60000);
  if (active || requests.length >= 4) return Response.json({ error: "Evaluation limit reached. Wait before trying again." }, { status: 429, headers: { "Retry-After": "60" } });
  requests.push(Date.now()); active = true;
  try {
    const program: Effect.Effect<unknown, Error> = input.provider === "chatgpt" ? Effect.gen(function* () {
      const user = yield* localUser(request, true);
      return yield* evaluateWithChatGPT(user.id, input, request.signal);
    }) : evaluateWithLocalCodex(input, request.signal);
    return await Effect.runPromise(Effect.match(program, {
      onSuccess: (data) => Response.json(data),
      onFailure: (error) => Response.json({ error: error.message, ...(error instanceof ChatGPTInferenceError ? { code: error.code, requestId: error.requestId, param: error.param } : {}) }, { status: error instanceof AppError ? error.status : 502 }),
    }));
  } finally { active = false; }
}
