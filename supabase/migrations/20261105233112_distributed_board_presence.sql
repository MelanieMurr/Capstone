-- Presence is independent of board documents: cursor traffic never rewrites Yjs state.
create table public.board_presence (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 40),
  cursor jsonb check (cursor is null or (
    jsonb_typeof(cursor) = 'object' and cursor ? 'x' and cursor ? 'y' and (cursor - 'x' - 'y') = '{}'::jsonb
    and jsonb_typeof(cursor->'x') = 'number' and jsonb_typeof(cursor->'y') = 'number'
    and abs((cursor->>'x')::numeric) <= 10000000 and abs((cursor->>'y')::numeric) <= 10000000)),
  updated_at timestamptz not null default now()
);
create index board_presence_board_updated on public.board_presence(board_id, updated_at);
alter table public.board_presence enable row level security;
create policy presence_read on public.board_presence for select to authenticated
  using ((select private.can_access_board(board_id, false)) and updated_at > now() - interval '45 seconds');
-- Owners can see their expired records so upsert and self-cleanup remain possible.
create policy presence_self_read on public.board_presence for select to authenticated using (user_id = (select auth.uid()));
create policy presence_insert on public.board_presence for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_access_board(board_id, false)));
create policy presence_update on public.board_presence for update to authenticated
  using (user_id = (select auth.uid()) and (select private.can_access_board(board_id, false)))
  with check (user_id = (select auth.uid()) and (select private.can_access_board(board_id, false)));
create policy presence_delete on public.board_presence for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.board_presence from anon, authenticated;
grant select, delete on public.board_presence to authenticated;
grant insert(id,board_id,user_id,display_name,cursor) on public.board_presence to authenticated;
grant update(display_name,cursor) on public.board_presence to authenticated;
create function private.touch_board_presence() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function private.touch_board_presence() from public;
create trigger presence_timestamp before update on public.board_presence for each row execute function private.touch_board_presence();
-- Server-side time, auth.uid(), invoker privileges and RLS apply to every operation.
create function public.touch_board_presence(connection_id uuid, target_board uuid, member_name text, point jsonb default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.board_presence where user_id = (select auth.uid()) and updated_at < now() - interval '90 seconds';
  insert into public.board_presence(id,board_id,user_id,display_name,cursor)
  values(connection_id,target_board,(select auth.uid()),member_name,point)
  on conflict(id) do update set display_name = excluded.display_name, cursor = excluded.cursor
    where public.board_presence.board_id = excluded.board_id;
end;
$$;
revoke all on function public.touch_board_presence(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.touch_board_presence(uuid,uuid,text,jsonb) to authenticated;
create function public.read_board_presence(target_board uuid)
returns setof public.board_presence language sql stable security invoker set search_path = '' as $$
  select * from public.board_presence where board_id = target_board and updated_at > now() - interval '45 seconds' limit 1000;
$$;
revoke all on function public.read_board_presence(uuid) from public, anon;
grant execute on function public.read_board_presence(uuid) to authenticated;
