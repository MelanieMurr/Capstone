import { NextResponse } from "next/server";
import { Effect } from "effect";
import { supabaseServer } from "../../../lib/supabase/server";
import { safeNext } from "../../../lib/foundation/contracts";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const success = await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
    const code = url.searchParams.get("code"); if (!code) return false;
    const client = await supabaseServer(); const { error } = await client.auth.exchangeCodeForSession(code); return !error;
  }, catch: () => new Error("Confirmation failed") }), { onSuccess: (value) => value, onFailure: () => false }));
  return NextResponse.redirect(new URL(success ? safeNext(url.searchParams.get("next")) : "/login?error=confirmation", request.url));
}
