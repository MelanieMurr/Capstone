import OpenAI from "openai";
import { Effect } from "effect";
import { z } from "zod";
import { AppError } from "../../foundation/contracts";
import { prompts, requestSchema, responseSchema, validateResult } from "../evaluation";
import { fetchModels, withActiveAccount } from "./service";

export class ChatGPTInferenceError extends AppError {
  constructor(message: string, status: number, public readonly code?: string, public readonly requestId?: string, public readonly param?: string, public readonly providerBody?: unknown) { super(message, status); }
}
function inferenceError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIError) {
    const detail = z.object({ detail: z.string() }).safeParse(error.error);
    const suffix = error.code === "subscription_sharing_usage_limit_exceeded" ? "Usage limit reached. Review your plan or app limit in ChatGPT usage settings." : error.code === "subscription_sharing_user_not_eligible" ? "ChatGPT plan usage is unavailable for this account or workspace." : detail.success ? detail.data.detail.slice(0, 500) : "Check the selected ChatGPT account, plan access, or try again later.";
    return new ChatGPTInferenceError(`ChatGPT request failed (${error.status ?? 502}). ${suffix}`, error.status ?? 502, error.code ?? undefined, error.requestID ?? undefined, error.param ?? undefined, error.error);
  }
  return new AppError("ChatGPT did not complete a valid response. No content was inserted. Try again later.", 502);
}

export function evaluateWithChatGPT(userId: string, input: unknown, signal?: AbortSignal) {
  return Effect.gen(function* () {
    const request = yield* Effect.try({ try: () => requestSchema.parse(input), catch: () => new AppError("Invalid AI request.", 400) });
    return yield* withActiveAccount(userId, async (account, token) => {
      try {
        if (request.connectionId !== account.id || request.model !== account.model || !account.model) throw new AppError("Your ChatGPT account or model changed. Refresh the connection and review your selection.", 409);
        const models = await fetchModels(token);
        if (!models.some((item) => item.slug === account.model)) throw new AppError("The selected model is no longer available. Choose another model for this account.", 400);
        // Explicit OAuth credential and endpoint: OPENAI_API_KEY/base URL env vars are never used.
        const client = new OpenAI({ apiKey: token, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 90_000, organization: null, project: null, logLevel: "off" });
        const controller = AbortSignal.timeout(90_000);
        const { data: stream, request_id: requestId } = await client.responses.create({
          model: account.model, store: false, stream: true,
          instructions: `${prompts[request.prompt]}\nThe user selected ${request.operation ?? "complete analysis"}. Return categories, summary, and actionItems as JSON matching the schema.`,
          input: [{ role: "user", content: JSON.stringify({ notes: request.notes }) }],
          text: { format: { type: "json_schema", name: "board_analysis", strict: true, schema: z.toJSONSchema(responseSchema) } },
        }, { signal: signal ? AbortSignal.any([signal, controller]) : controller }).withResponse();
        let output = "", completed = false;
        let usage: unknown = null;
        try {
          for await (const event of stream) {
            if (event.type === "response.output_text.delta") {
              output += event.delta;
              if (output.length > 100_000) throw new AppError("ChatGPT response exceeded the allowed size. No content was inserted.", 502);
            } else if (event.type === "response.failed") {
              const code: string | undefined = event.response.error?.code;
              const statuses: Record<string, number> = { subscription_sharing_usage_limit_exceeded: 429, subscription_sharing_user_not_eligible: 403, subscription_sharing_usage_unavailable: 503, subscription_sharing_unsupported_capability: 400, subscription_sharing_route_not_supported: 403, subscription_sharing_invalid_user: 401, subscription_sharing_user_unavailable: 503, chatpass_v2_scope_not_authorized: 403, chatpass_v2_invalid_authorization_context: 403 };
              const status = code ? statuses[code] ?? 502 : 502;
              throw new ChatGPTInferenceError(code === "subscription_sharing_usage_limit_exceeded" ? "ChatGPT usage limit reached. Review your plan or app limit in ChatGPT usage settings." : "ChatGPT could not complete this request. Check your account or try again later.", status, code, requestId ?? undefined, undefined, event.response.error);
            } else if (event.type === "response.incomplete" || event.type === "error") {
              throw new AppError("ChatGPT returned an incomplete response. No content was inserted.", 502);
            } else if (event.type === "response.completed") {
              completed = true;
              usage = event.response.usage;
            }
          }
        } finally { stream.controller.abort(); }
        if (!completed) throw new AppError("The ChatGPT stream ended before completion. No content was inserted.", 502);
        const result = Effect.runSync(validateResult(output, request.notes));
        return { result, model: account.model, usage, prompt: request.prompt, source: "local-chatgpt-subscription" as const, authentication: "chatgpt" as const };
      } catch (error) { throw inferenceError(error); }
    });
  });
}
