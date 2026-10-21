import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Effect } from "effect";
import { supabaseConfig } from "./lib/supabase/config";

import { publicRequestOrigin } from "./lib/foundation/http";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  return Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
    const config = supabaseConfig();
    const client = createServerClient(config.url, config.key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => { values.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
    } });
    const { data } = await client.auth.getUser();
    if (!data.user) {
      const rejected = request.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })
        : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, publicRequestOrigin(request)));
      response.cookies.getAll().forEach((cookie) => rejected.cookies.set(cookie));
      rejected.headers.set("Cache-Control", "private, no-store");
      return rejected;
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }, catch: () => new Error("Authentication is temporarily unavailable.") }), { onSuccess: (value) => value, onFailure: (error) => NextResponse.json({ error: error.message }, { status: 503 }) }));
}
export const config = { matcher: ["/dashboard/:path*", "/boards/:path*", "/api/boards/:path*"] };
