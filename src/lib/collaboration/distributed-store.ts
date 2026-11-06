import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BoardAccessError } from "./distributed-board.ts";
import type { DistributedStore } from "./distributed-board.ts";
import { collaboratorColor, collaboratorSchema, cursorSchema } from "./presence.ts";
import type { Collaborator, Cursor } from "./presence.ts";

export type PresenceStore = {
  touch: (token: string, boardId: string, peer: Collaborator) => Promise<void>;
  peers: (token: string, boardId: string) => Promise<Collaborator[]>;
  remove: (token: string, connectionId: string) => Promise<void>;
};
export function distributedSupabaseStore(): DistributedStore & PresenceStore {
  const url = z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = z.string().min(1).parse(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const client = (token: string) => createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) }, auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async load(token, boardId) {
      const db = client(token);
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth.user) throw new BoardAccessError("Sign in required.");
      const { data: board, error } = await db.from("boards").select("owner_id").eq("id", boardId).maybeSingle();
      if (error) throw new Error("Board access check failed.");
      if (!board) throw new BoardAccessError("Board access ended.");
      let canEdit = board.owner_id === auth.user.id;
      if (!canEdit) {
        const { data: member, error: memberError } = await db.from("board_collaborators").select("permission").eq("board_id", boardId).eq("user_id", auth.user.id).maybeSingle();
        if (memberError) throw new Error("Board membership check failed.");
        if (!member) throw new BoardAccessError("Board access ended.");
        canEdit = member.permission === "editor";
      }
      const { data: stored, error: storedError } = await db.from("board_documents").select("snapshot,yjs_state,revision").eq("board_id", boardId).single();
      if (storedError || !stored) throw new Error("Board load failed.");
      return { snapshot: stored.snapshot, yjsState: stored.yjs_state, revision: Number(stored.revision), canEdit,
        user: { id: auth.user.id, name: String(auth.user.user_metadata?.display_name || auth.user.email?.split("@")[0] || "Collaborator").slice(0, 40) || "Collaborator" } };
    },
    async commit(token, boardId, revision, value) {
      const { data, error } = await client(token).from("board_documents").update({ snapshot: value.snapshot, yjs_state: value.yjsState, schema_version: 1, revision: revision + 1 }).eq("board_id", boardId).eq("revision", revision).select("revision");
      if (error) throw new Error("Board save failed. Reconnecting to verify saved edits…");
      return data?.length === 1;
    },
    async touch(token, boardId, peer) {
      const { error } = await client(token).rpc("touch_board_presence", { connection_id: peer.id, target_board: boardId, member_name: peer.name, point: cursorSchema.parse(peer.cursor) });
      if (error) throw new Error("Could not update board presence.");
    },
    async peers(token, boardId) {
      const { data, error } = await client(token).rpc("read_board_presence", { target_board: boardId });
      if (error) throw new Error("Could not read board presence.");
      return z.array(z.object({ id: z.uuid(), user_id: z.uuid(), display_name: z.string(), cursor: cursorSchema })).max(1000).parse(data).map((row) => collaboratorSchema.parse({ id: row.id, userId: row.user_id, name: row.display_name, cursor: row.cursor as Cursor, color: collaboratorColor(row.user_id) }));
    },
    async remove(token, connectionId) {
      const { error } = await client(token).from("board_presence").delete().eq("id", connectionId);
      if (error) throw new Error("Could not remove board presence.");
    },
  };
}
