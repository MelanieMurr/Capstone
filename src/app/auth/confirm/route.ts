import { NextResponse } from "next/server";
import { Effect } from "effect";
import { supabaseServer } from "../../../lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const success = await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
    const token_hash = url.searchParams.get("token_hash"); if (!token_hash || url.searchParams.get("type") !== "email") return false;
    const client = await supabaseServer(); const { error } = await client.auth.verifyOtp({ token_hash, type: "email" }); return !error;
  }, catch: () => new Error("Confirmation failed") }), { onSuccess: (value) => value, onFailure: () => false }));
  return NextResponse.redirect(new URL(success ? "/dashboard" : "/login?error=confirmation", request.url));
}
