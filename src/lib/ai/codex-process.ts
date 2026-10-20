import { spawn } from "node:child_process";

export type CommandResult = { stdout: string; stderr: string };
export type CommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

/** No shell interpolation; inputs travel through stdin, never command arguments. */
export function runCommand(binary: string, args: string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("cancelled"));
    const child = spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "", stderr = "", bytes = 0, failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    const abort = () => stop("cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2_000_000) stop("output limit"); else stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2_000_000) stop("output limit"); else stderr += chunk.toString(); });
    child.on("error", (error: NodeJS.ErrnoException) => { failure = new Error(error.code === "ENOENT" ? "cli missing" : "process failed"); });
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      cleanup();
      if (failure) return reject(failure);
      if (code !== 0) {
        // Classify without returning raw CLI logs, prompts or credentials to clients.
        const text = `${stdout}\n${stderr}`;
        return reject(new Error(/usage.limit|quota|rate.limit|credits|limit.reached/i.test(text) ? "subscription limit" : /login|sign.in|unauthorized|authentication/i.test(text) ? "login required" : "process failed"));
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}
