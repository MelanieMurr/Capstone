import { afterEach, describe, expect, it, vi } from "vitest";
import { access, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { fixtureResult, evaluationNotes } from "./evaluation";
import { runCommand } from "./codex-process";
import { cliUsage, codexEnvironment, evaluateWithLocalCodex } from "./local-codex";

vi.mock("./codex-process", () => ({ runCommand: vi.fn() }));
const command = vi.mocked(runCommand);
afterEach(() => { vi.resetAllMocks(); });

describe("local Codex provider", () => {
  it("excludes API keys and provider overrides from child environment", () => {
    const env = codexEnvironment({ NODE_ENV: "development", HOME: "/home/test", PATH: "/bin", OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret", CODEX_ACCESS_TOKEN: "secret", OPENAI_BASE_URL: "https://example.com", DATABASE_URL: "secret" });
    expect(env).toEqual({ NODE_ENV: "development", HOME: "/home/test", PATH: "/bin" });
  });
  it("requires ChatGPT login and never falls back to API-key auth", async () => {
    command.mockResolvedValue({ stdout: "Logged in using an API key", stderr: "" });
    await expect(Effect.runPromise(evaluateWithLocalCodex({ notes: evaluationNotes, prompt: "grounded" }))).rejects.toThrow("API-key login is not accepted");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("uses schema output, stdin, read-only isolation and cleans temporary files", async () => {
    command.mockImplementation(async (_binary, args, options) => {
      if (args.includes("status")) return { stdout: "Logged in using ChatGPT", stderr: "" };
      await writeFile(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify(fixtureResult));
      expect(args).toContain("--ignore-user-config");
      expect(args).toContain('forced_login_method="chatgpt"');
      expect(args).toContain("read-only");
      expect(args).toContain("--output-schema");
      expect(options.input).toContain(evaluationNotes[0]!.text);
      expect(args.join(" ")).not.toContain(evaluationNotes[0]!.text);
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      return { stdout: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 } }), stderr: "" };
    });
    const result = await Effect.runPromise(evaluateWithLocalCodex({ notes: evaluationNotes, prompt: "grounded" }));
    expect(result.result).toEqual(fixtureResult);
    expect(result.source).toBe("local-codex-cli");
    expect(result.usage?.total_tokens).toBe(150);
    const temporary = command.mock.calls[1]![2].cwd;
    await expect(access(temporary)).rejects.toThrow();
  });
  it("rejects invalid model output, even after a completed turn", async () => {
    command.mockImplementation(async (_binary, args) => {
      if (args.includes("status")) return { stdout: "Logged in using ChatGPT", stderr: "" };
      await writeFile(args[args.indexOf("--output-last-message") + 1]!, '{"summary":42}');
      return { stdout: '{"type":"turn.completed"}', stderr: "" };
    });
    await expect(Effect.runPromise(evaluateWithLocalCodex({ notes: evaluationNotes, prompt: "concise" }))).rejects.toThrow("invalid output");
  });
  it("surfaces missing CLI failures without any fallback", async () => {
    command.mockRejectedValue(new Error("cli missing"));
    await expect(Effect.runPromise(evaluateWithLocalCodex({ notes: evaluationNotes, prompt: "concise" }))).rejects.toThrow("Codex CLI was not found");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("does not fabricate usage for missing completion metadata", () => {
    expect(cliUsage('not JSON\n{"type":"thread.started"}')).toBeNull();
  });
});

 it.each(["categorize", "summary", "action-items"])("forwards the selected %s operation and notes to the server-side CLI", async (operation) => {
    command.mockImplementation(async (_binary, args, options) => {
      if (args.includes("status")) return { stdout: "Logged in using ChatGPT", stderr: "" };
      const instruction = operation === "categorize" ? "selected categorization" : operation === "summary" ? "selected a summary" : "selected action items";
      expect(options.input).toContain(instruction);
      expect(options.input).toContain(evaluationNotes[0]!.text);
      await writeFile(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify(fixtureResult));
      return { stdout: '{"type":"turn.completed"}', stderr: "" };
    });
    expect((await Effect.runPromise(evaluateWithLocalCodex({ notes: evaluationNotes, prompt: "grounded", operation }))).result).toEqual(fixtureResult);
  });
