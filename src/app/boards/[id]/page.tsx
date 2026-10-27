import { notFound, redirect } from "next/navigation";
import { Effect } from "effect";
import SavedBoard from "../../../components/foundation/saved-board";
import { supabaseServer } from "../../../lib/supabase/server";
import { getBoard } from "../../../lib/foundation/services";
import { AppError } from "../../../lib/foundation/contracts";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const client = await supabaseServer();
  const result = await Effect.runPromise(Effect.match(getBoard(client, id), { onSuccess: (value) => ({ value, error: null }), onFailure: (error) => ({ value: null, error }) }));
  if (result.error instanceof AppError && result.error.status === 401) redirect("/login");
  if (result.error instanceof AppError && result.error.status === 404) notFound();
  if (!result.value) throw new Error("Could not open this board.");
  return <SavedBoard id={id} title={result.value.board.title} document={result.value.document} revision={result.value.revision} canEdit={result.value.canEdit} isOwner={result.value.isOwner} />;
}
