-- Private comment content is intentionally separate from the shared Yjs document.
-- Otherwise every collaborator would receive unapproved text in binary updates.
create table public.board_note_authors (
  board_id uuid not null references public.boards(id) on delete cascade,
  note_id uuid not null,
  author_id uuid references auth.users(id) on delete set null,
  legacy boolean not null default false,
  primary key(board_id,note_id)
);
create index note_authors_user on public.board_note_authors(author_id);
alter table public.board_note_authors enable row level security;

create function private.note_is_current(target_board uuid, target_note uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.board_documents d,
    lateral jsonb_array_elements(coalesce(d.snapshot->'objects','[]'::jsonb)) o
    where d.board_id = target_board and o->>'type' = 'sticky-note' and o->>'id' = target_note::text);
$$;
revoke all on function private.note_is_current(uuid,uuid) from public,anon;
grant execute on function private.note_is_current(uuid,uuid) to authenticated;
create policy note_authors_read on public.board_note_authors for select to authenticated
using ((select private.can_access_board(board_id,false)) and private.note_is_current(board_id,note_id));
revoke all on public.board_note_authors from public,anon,authenticated;
grant select on public.board_note_authors to authenticated;

-- Legacy notes go to the owner. A copied note gets a fresh ID and new authorship.
insert into public.board_note_authors(board_id,note_id,author_id,legacy)
select d.board_id,(o->>'id')::uuid,b.owner_id,true
from public.board_documents d join public.boards b on b.id=d.board_id,
lateral jsonb_array_elements(coalesce(d.snapshot->'objects','[]'::jsonb)) o
where o->>'type'='sticky-note' on conflict do nothing;

-- Membership checks for another author need private visibility, not broader RLS grants.
create function private.note_comment_reviewer(target_board uuid,target_note uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare creator uuid; owner uuid;
begin
  if auth.uid() is null or not private.can_access_board(target_board,false)
    or not private.note_is_current(target_board,target_note) then return null; end if;
  select b.owner_id,a.author_id into owner,creator from public.boards b
    join public.board_note_authors a on a.board_id=b.id
    where b.id=target_board and a.note_id=target_note;
  if creator=owner or exists(select 1 from public.board_collaborators c where c.board_id=target_board and c.user_id=creator)
    then return creator; end if;
  return owner;
end;
$$;
revoke all on function private.note_comment_reviewer(uuid,uuid) from public,anon;
grant execute on function private.note_comment_reviewer(uuid,uuid) to authenticated;

create table public.board_note_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  note_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default left(coalesce(nullif(split_part(auth.jwt()->>'email','@',1),''),'Collaborator'),40),
  body text not null check (length(btrim(body)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Historical reviewer identity survives account deletion; the guarded trigger sets it.
  reviewed_by uuid,
  foreign key(board_id,note_id) references public.board_note_authors(board_id,note_id) on delete cascade
);
create index note_comments_note on public.board_note_comments(board_id,note_id,created_at);
create index note_comments_author on public.board_note_comments(author_id);
alter table public.board_note_comments enable row level security;
create policy note_comments_read on public.board_note_comments for select to authenticated
using ((select private.can_access_board(board_id,false)) and private.note_is_current(board_id,note_id)
  and (status='approved' or author_id=(select auth.uid()) or private.note_comment_reviewer(board_id,note_id)=(select auth.uid())));
create policy note_comments_create on public.board_note_comments for insert to authenticated
with check (author_id=(select auth.uid()) and status='pending' and (select private.can_access_board(board_id,false))
  and private.note_is_current(board_id,note_id));
create policy note_comments_review on public.board_note_comments for update to authenticated
using (private.note_comment_reviewer(board_id,note_id)=(select auth.uid()))
with check (private.note_comment_reviewer(board_id,note_id)=(select auth.uid()) and status in ('approved','rejected'));
revoke all on public.board_note_comments from public,anon,authenticated;
grant select on public.board_note_comments to authenticated;
grant insert(id,board_id,note_id,body) on public.board_note_comments to authenticated;
grant update(status) on public.board_note_comments to authenticated;

-- The document lock serializes comment insertion with note deletion/cleanup.
create function private.guard_note_comment() returns trigger language plpgsql security definer set search_path = '' as $$
declare saved jsonb;
begin
  if auth.uid() is null or not private.can_access_board(new.board_id,false) then raise exception 'Board access required' using errcode='42501'; end if;
  if TG_OP='INSERT' then
    if new.author_id<>auth.uid() then raise exception 'Invalid author' using errcode='42501'; end if;
    select d.snapshot into saved from public.board_documents d where d.board_id=new.board_id for share;
    if not exists(select 1 from jsonb_array_elements(coalesce(saved->'objects','[]'::jsonb)) o where o->>'id'=new.note_id::text and o->>'type'='sticky-note') then
      raise exception 'Note not found' using errcode='P0002'; end if;
  else
    if private.note_comment_reviewer(new.board_id,new.note_id) is distinct from auth.uid() then raise exception 'Reviewer access required' using errcode='42501'; end if;
    if old.status<>'pending' and new.status<>old.status then raise exception 'Comment already reviewed' using errcode='23514'; end if;
    if new.status<>old.status then new.reviewed_at:=now(); new.reviewed_by:=auth.uid(); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_note_comment() from public;
create trigger guard_note_comment before insert or update on public.board_note_comments for each row execute function private.guard_note_comment();

-- Only this guarded trigger writes note authorship; no client-supplied creator is trusted.
-- Deleted note IDs retain their author record so undo/recreation cannot steal authorship.
create function private.track_note_authors() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner uuid; legacy_seed boolean := false;
begin
  if auth.uid() is null or not private.can_access_board(new.board_id,true) then
    raise exception 'Editor access required' using errcode='42501'; end if;
  if new.snapshot is null then return new; end if;
  select b.owner_id into owner from public.boards b where b.id=new.board_id;
  if TG_OP='UPDATE' then legacy_seed := old.snapshot is null and old.yjs_state is not null; end if;
  insert into public.board_note_authors(board_id,note_id,author_id,legacy)
    select new.board_id,(o->>'id')::uuid,case when legacy_seed then owner else auth.uid() end,legacy_seed
    from jsonb_array_elements(new.snapshot->'objects') o where o->>'type'='sticky-note'
    on conflict do nothing;
  delete from public.board_note_comments c where c.board_id=new.board_id and not exists(
    select 1 from jsonb_array_elements(new.snapshot->'objects') o where o->>'type'='sticky-note' and o->>'id'=c.note_id::text);
  return new;
end;
$$;
revoke all on function private.track_note_authors() from public;
create trigger track_note_authors after insert or update of snapshot on public.board_documents for each row execute function private.track_note_authors();

create function public.board_note_reviewer(target_board uuid,target_note uuid) returns uuid
language sql stable security invoker set search_path = '' as $$
  select private.note_comment_reviewer(target_board,target_note);
$$;
revoke all on function public.board_note_reviewer(uuid,uuid) from public,anon;
grant execute on function public.board_note_reviewer(uuid,uuid) to authenticated;
create function public.board_comment_counts(target_board uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.note_id,c.amount),'{}'::jsonb)
  from (select note_id,count(*) as amount from public.board_note_comments where board_id=target_board group by note_id) c;
$$;
revoke all on function public.board_comment_counts(uuid) from public,anon;
grant execute on function public.board_comment_counts(uuid) to authenticated;
