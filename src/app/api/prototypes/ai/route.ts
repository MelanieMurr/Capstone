import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { Effect } from "effect";
import { prompts, requestSchema, responseSchema, validateResult } from "../../../../lib/ai/evaluation";

export const runtime = "nodejs";
let requests: number[] = [];
let active = false;
export async function POST(request: Request) {
  // A development-only evaluation endpoint, never a public anonymous API proxy.
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Local development evaluation only." }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return Response.json({ error: "Set OPENAI_API_KEY and OPENAI_MODEL in .env.local, then restart Next.js. No API request was sent." }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 60000) return Response.json({ error: "Request too large." }, { status: 413 });
  const body = await Effect.runPromise(Effect.match(Effect.tryPromise({ try: () => request.text(), catch: () => new Error("Invalid body") }), { onSuccess: (value) => value, onFailure: () => null }));
  if (!body || body.length > 60000) return Response.json({ error: "Invalid or oversized body." }, { status: 400 });
  const input = requestSchema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!input.success) return Response.json({ error: "Select 1–20 notes with unique IDs and at most 2000 characters each." }, { status: 400 });
  requests = requests.filter((time) => Date.now() - time < 60000);
  if (active || requests.length >= 4) return Response.json({ error: "Evaluation limit reached. Wait a minute before trying again." }, { status: 429, headers: { "Retry-After": "60" } });
  requests.push(Date.now()); active = true;
  const program = Effect.tryPromise({
    try: async () => {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY!, maxRetries: 0, timeout: 30000 });
      const result = await client.responses.parse({
        model: process.env.OPENAI_MODEL!, store: false, max_output_tokens: 2000,
        instructions: prompts[input.data.prompt], input: JSON.stringify(input.data.notes),
        text: { format: zodTextFormat(responseSchema, "board_analysis") },
      });
      if (result.status !== "completed" || !result.output_parsed) throw new Error("The model refused or did not finish its response.");
      const validated = Effect.runSync(validateResult(result.output_parsed, input.data.notes));
      return { result: validated, model: result.model, usage: result.usage, prompt: input.data.prompt, source: "live-api" };
    },
    catch: (cause) => new Error(cause instanceof OpenAI.APIError && cause.status === 429 ? "The provider rate limit or quota was reached. Check billing and retry later." : "The model request failed, was refused, timed out, or returned invalid output. No board content was inserted."),
  });
  try {
    return await Effect.runPromise(Effect.match(program, { onSuccess: (data) => Response.json(data), onFailure: (error) => Response.json({ error: error.message }, { status: 502 }) }));
  } finally { active = false; }
}
