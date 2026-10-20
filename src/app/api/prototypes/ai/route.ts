import { Effect } from "effect";
import { requestSchema } from "../../../../lib/ai/evaluation";
import { evaluateWithLocalCodex } from "../../../../lib/ai/local-codex";

export const runtime = "nodejs";
let requests: number[] = [];
let active = false;
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Local development evaluation only." }, { status: 404 });
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return Response.json({ error: "Localhost access only." }, { status: 403 });
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 60000) return Response.json({ error: "Request too large." }, { status: 413 });
  const input = await Effect.runPromise(Effect.match(Effect.tryPromise({
    try: async () => {
      const body = await request.text();
      if (body.length > 60000) throw new Error("Request too large");
      return requestSchema.parse(JSON.parse(body));
    }, catch: () => new Error("Select 1–20 notes with unique IDs and at most 2000 characters each."),
  }), { onSuccess: (value) => value, onFailure: () => null }));
  if (!input) return Response.json({ error: "Invalid or oversized request. Select 1–20 notes with unique IDs and at most 2000 characters each." }, { status: 400 });
  requests = requests.filter((time) => Date.now() - time < 60000);
  if (active || requests.length >= 4) return Response.json({ error: "Evaluation limit reached. Wait before trying again." }, { status: 429, headers: { "Retry-After": "60" } });
  requests.push(Date.now()); active = true;
  try {
    return await Effect.runPromise(Effect.match(evaluateWithLocalCodex(input, request.signal), {
      onSuccess: (data) => Response.json(data),
      onFailure: (error) => Response.json({ error: error.message }, { status: 502 }),
    }));
  } finally { active = false; }
}
