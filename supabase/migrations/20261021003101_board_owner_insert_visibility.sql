-- Owner visibility must use the new row directly for INSERT ... RETURNING.
alter policy boards_read on public.boards
using (owner_id = (select auth.uid()) or (select private.can_access_board(id,false)));
