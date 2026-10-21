import { redirect } from "next/navigation";
import { Effect } from "effect";
import Dashboard from "../../components/foundation/dashboard";
import { supabaseServer } from "../../lib/supabase/server";
import { authenticated } from "../../lib/foundation/services";
export default async function Page() {
  const client = await supabaseServer();
  const user = await Effect.runPromise(Effect.match(authenticated(client), { onSuccess: (value) => value, onFailure: () => null }));
  if (!user) redirect("/login");
  return <Dashboard userId={user.id} email={user.email ?? "Your account"} />;
}
