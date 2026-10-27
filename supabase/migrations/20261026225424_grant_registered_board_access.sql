-- Exact-email lookup needs auth.users access. Keep the definer in the private
-- schema and check the verified caller's ownership before looking up any user.
create function private.grant_registered_board_access(p_board_id uuid, p_email text, p_permission text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  recipient uuid;
  normalized text := lower(btrim(p_email));
begin
  if caller is null or not exists (select 1 from public.boards b where b.id = p_board_id and b.owner_id = caller) then
    raise exception 'Only the board owner can grant access.' using errcode = '42501';
  end if;
  if p_permission is null or p_permission not in ('viewer','editor') or normalized is null or length(normalized) not between 3 and 254 then
    raise exception 'Invalid access request.' using errcode = '22023';
  end if;
  select u.id into recipient from auth.users u where lower(u.email) = normalized and u.deleted_at is null limit 1;
  if recipient is null then
    raise exception 'Registered account not found.' using errcode = 'P0002';
  end if;
  if recipient = caller then
    raise exception 'The owner already has access.' using errcode = '22023';
  end if;
  insert into public.board_collaborators(board_id,user_id,permission) values(p_board_id,recipient,p_permission)
    on conflict(board_id,user_id) do update set permission = excluded.permission;
  return recipient;
end;
$$;
revoke all on function private.grant_registered_board_access(uuid,text,text) from public, anon;
grant execute on function private.grant_registered_board_access(uuid,text,text) to authenticated;

-- The exposed entry point has invoker privileges; the guarded private helper
-- performs only this narrow operation. No user directory or admin key is exposed.
create function public.grant_board_access(p_board_id uuid, p_email text, p_permission text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.grant_registered_board_access(p_board_id,p_email,p_permission);
$$;
revoke all on function public.grant_board_access(uuid,text,text) from public, anon;
grant execute on function public.grant_board_access(uuid,text,text) to authenticated;
