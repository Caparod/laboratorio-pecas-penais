-- The application persists its complete database in this row. There is no
-- legitimate direct browser access, so public roles intentionally get no RLS
-- policy. The server-side service_role keeps access because it bypasses RLS.

alter table if exists public.app_state enable row level security;

revoke all on table public.app_state from anon, authenticated;
