-- CoCanvas foundation. All public tables are private by default under RLS.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now()
);
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index boards_owner_updated_idx on public.boards(owner_id, updated_at desc);
create table public.board_collaborators (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('viewer','editor')),
  created_at timestamptz not null default now(),
  primary key (board_id,user_id)
);
create index board_collaborators_user_board_idx on public.board_collaborators(user_id,board_id);
create table public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  permission text not null check (permission in ('viewer','editor')),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index board_invitations_board_idx on public.board_invitations(board_id);
create index board_invitations_created_by_idx on public.board_invitations(created_by);
create unique index board_invitations_pending_email_idx on public.board_invitations(board_id,email) where status='pending';
create table public.board_documents (
  board_id uuid primary key references public.boards(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot jsonb,
  yjs_state bytea,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  updated_at timestamptz not null default now(),
  check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and snapshot ?& array['boardId','schemaVersion','objects'] and snapshot->>'boardId' = board_id::text and snapshot->>'schemaVersion' = '1' and jsonb_typeof(snapshot->'objects') = 'array')),
  check (snapshot is null or octet_length(snapshot::text) <= 10485760),
  check (yjs_state is null or octet_length(yjs_state) <= 10485760)
);

-- Private definer helpers prevent recursive RLS between boards and membership.
-- They return only whether the caller's verified auth.uid() has access.
create function private.owns_board(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.boards b where b.id = target and b.owner_id = (select auth.uid())
  );
$$;
create function private.can_access_board(target uuid, write_access boolean default false) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.boards b where b.id = target and b.owner_id = (select auth.uid()))
    or exists (select 1 from public.board_collaborators c where c.board_id = target and c.user_id = (select auth.uid()) and (not write_access or c.permission = 'editor'))
  );
$$;
revoke all on function private.owns_board(uuid) from public, anon;
revoke all on function private.can_access_board(uuid,boolean) from public, anon;
grant execute on function private.owns_board(uuid), private.can_access_board(uuid,boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_collaborators enable row level security;
alter table public.board_invitations enable row level security;
alter table public.board_documents enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy boards_read on public.boards for select to authenticated using ((select private.can_access_board(id,false)));
create policy boards_insert on public.boards for insert to authenticated with check (owner_id = (select auth.uid()));
create policy boards_update on public.boards for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy boards_delete on public.boards for delete to authenticated using (owner_id = (select auth.uid()));
create policy collaborators_read on public.board_collaborators for select to authenticated using (user_id = (select auth.uid()) or (select private.owns_board(board_id)));
create policy collaborators_insert on public.board_collaborators for insert to authenticated with check ((select private.owns_board(board_id)) and user_id <> (select auth.uid()));
create policy collaborators_update on public.board_collaborators for update to authenticated using ((select private.owns_board(board_id))) with check ((select private.owns_board(board_id)));
create policy collaborators_delete on public.board_collaborators for delete to authenticated using ((select private.owns_board(board_id)));
create policy invitations_read on public.board_invitations for select to authenticated using ((select private.owns_board(board_id)));
create policy invitations_insert on public.board_invitations for insert to authenticated with check ((select private.owns_board(board_id)) and created_by = (select auth.uid()));
create policy invitations_update on public.board_invitations for update to authenticated using ((select private.owns_board(board_id))) with check ((select private.owns_board(board_id)));
create policy invitations_delete on public.board_invitations for delete to authenticated using ((select private.owns_board(board_id)));
create policy documents_read on public.board_documents for select to authenticated using ((select private.can_access_board(board_id,false)));
create policy documents_insert on public.board_documents for insert to authenticated with check ((select private.owns_board(board_id)));
create policy documents_update on public.board_documents for update to authenticated using ((select private.can_access_board(board_id,true))) with check ((select private.can_access_board(board_id,true)));

-- Explicit grants also support projects where SQL-created tables aren't exposed automatically.
revoke all on public.profiles,public.boards,public.board_collaborators,public.board_invitations,public.board_documents from anon, authenticated;
grant select,insert on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,insert,delete on public.boards to authenticated;
grant update(title) on public.boards to authenticated;
grant select,insert,delete on public.board_collaborators to authenticated;
grant update(permission) on public.board_collaborators to authenticated;
grant select,insert,delete on public.board_invitations to authenticated;
grant update(status) on public.board_invitations to authenticated;
grant select,insert on public.board_documents to authenticated;
grant update(snapshot,yjs_state,schema_version,revision) on public.board_documents to authenticated;

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public;
create trigger boards_touch before update on public.boards for each row execute function private.touch_updated_at();
create function private.document_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then raise exception 'Document revision must advance by one'; end if;
  new.updated_at = now(); return new;
end;
$$;
revoke all on function private.document_revision() from public;
create trigger document_revision before update on public.board_documents for each row execute function private.document_revision();

-- Invoker function makes board + empty document creation one atomic transaction.
create function public.create_board(p_title text) returns public.boards language plpgsql security invoker set search_path = '' as $$
declare result public.boards;
begin
  insert into public.boards(title) values (btrim(p_title)) returning * into result;
  insert into public.board_documents(board_id,snapshot) values (result.id, jsonb_build_object('boardId',result.id,'schemaVersion',1,'objects','[]'::jsonb));
  return result;
end;
$$;
revoke all on function public.create_board(text) from public,anon;
grant execute on function public.create_board(text) to authenticated;
