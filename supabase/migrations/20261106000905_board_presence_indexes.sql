-- Supports the foreign key and cleanup of this user's expired presence records.
create index board_presence_user_updated on public.board_presence(user_id, updated_at);
