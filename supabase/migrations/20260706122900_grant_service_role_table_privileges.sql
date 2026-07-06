-- service_role bypasses RLS policies but Postgres still enforces table-level
-- GRANTs independently of RLS. Migration 20260706031309_rls_policies.sql only
-- granted privileges to `authenticated`, so the service_role key used by
-- Edge Functions (e.g. invite-user) could not read/write these tables at all,
-- failing with "permission denied for table ..." regardless of RLS.
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.articles to service_role;
grant select, update on public.settings to service_role;
