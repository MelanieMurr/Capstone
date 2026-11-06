import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { Effect } from "effect";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const force = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 5000);
  force.unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
function launch(name, args, environment) {
  const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: "inherit" });
  children.add(child);
  child.on("error", () => { console.error(`${name} could not start.`); stop(1); });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) { console.error(`${name} stopped; shutting down development services.`); stop(code || 1); }
  });
  return child;
}

await Effect.runPromise(Effect.match(Effect.tryPromise({
  try: async () => {
    // Next must load its own environment. Forwarding @next/env's internal flags
    // makes its dev worker repeatedly invalidate the application.
    const nextEnvironment = { ...process.env, NODE_ENV: "development" };
    nextEnv.loadEnvConfig(root, true);
    const environment = { ...process.env, NODE_ENV: "development" };
    const sync = new URL(environment.NEXT_PUBLIC_BOARD_SYNC_URL || "ws://127.0.0.1:1235");
    if (!["ws:", "wss:"].includes(sync.protocol)) throw new Error("NEXT_PUBLIC_BOARD_SYNC_URL must be a WebSocket URL.");
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(sync.hostname);
    if (local) {
      if (sync.protocol !== "ws:") throw new Error("The local sync service uses ws://. Use a hosted URL for WSS.");
      const port = sync.port || "80";
      const health = new URL(sync); health.protocol = "http:"; health.pathname = "/";
      const probe = async () => {
        try {
          const response = await fetch(health, { signal: AbortSignal.timeout(1000) });
          if (!response.ok || await response.text() !== "CoCanvas board sync") throw new Error("The configured sync port is occupied by another service.");
          return true;
        } catch (error) {
          if (error instanceof TypeError || error?.name === "TimeoutError") return false;
          throw error;
        }
      };
      if (await probe()) console.log(`Reusing CoCanvas board sync on port ${port}.`);
      else {
        const child = launch("Board sync", ["scripts/board-sync.ts"], { ...environment, PORT: port, BOARD_SYNC_HOST: sync.hostname === "[::1]" ? "::1" : "127.0.0.1" });
        const deadline = Date.now() + 10_000;
        while (!stopping && !await probe()) {
          if (child.exitCode !== null || Date.now() > deadline) throw new Error("Board sync did not start. Check the Supabase environment settings.");
          await new Promise((done) => setTimeout(done, 100));
        }
      }
    } else console.log("Using the configured hosted board sync service.");
    if (!stopping) launch("Next.js", ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", environment.PORT || "3000", ...process.argv.slice(2)], nextEnvironment);
  }, catch: (error) => new Error(error instanceof Error ? error.message : "Could not start development services."),
}), { onSuccess: () => {}, onFailure: (error) => { console.error(error.message); stop(1); } }));
