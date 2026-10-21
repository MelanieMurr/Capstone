import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

export async function supabaseServer() {
  const store = await cookies();
  const config = supabaseConfig();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        // Server Components cannot write cookies. Proxy refreshes them before render;
        // route handlers can write them during signin, confirmation and signout.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Read-only Server Component context. */ }
      },
    },
  });
}
