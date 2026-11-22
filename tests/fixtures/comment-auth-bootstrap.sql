-- TEST ONLY: minimal auth claims for an isolated PostgreSQL cluster, not a Supabase migration.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key,email text,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid(),auth.jwt() to authenticated;
