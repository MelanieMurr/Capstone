import { Effect } from "effect";
import { z } from "zod";

/** Hosting configuration only; every room still verifies its Supabase user. */
export const syncServerConfig = (environment: Record<string, string | undefined>) => Effect.try({
  try: () => {
    const production = environment.NODE_ENV === "production";
    const rawPort = environment.PORT ?? "1235";
    if (!/^\d+$/.test(rawPort)) throw new Error("PORT must be a valid TCP port.");
    const port = z.number().int().min(1).max(65535).parse(Number(rawPort));
    const host = z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).parse(environment.BOARD_SYNC_HOST ?? (production ? "0.0.0.0" : "127.0.0.1"));
    const configured = environment.BOARD_SYNC_ORIGINS;
    if (production && !configured?.trim()) throw new Error("Set BOARD_SYNC_ORIGINS to the exact HTTPS application origin before starting production sync.");
    const origins = configured === undefined ? ["http://127.0.0.1:3000", "http://localhost:3000"] : configured.split(",").map((value) => value.trim());
    for (const origin of origins) {
      const parsed = new URL(origin);
      if (origin.includes("*") || parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol) || (production && parsed.protocol !== "https:")) {
        throw new Error("BOARD_SYNC_ORIGINS must contain exact application origins without paths or wildcards; production requires HTTPS.");
      }
    }
    return { port, host, origins: [...new Set(origins)] };
  },
  catch: (cause) => new Error(cause instanceof Error ? cause.message : "Invalid board sync configuration."),
});
