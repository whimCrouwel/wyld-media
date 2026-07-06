create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.articles to authenticated;
grant select, update on public.settings to authenticated;

alter table public.profiles enable row level security;
alter table public.articles enable row level security;
alter table public.settings enable row level security;

-- profiles
create policy "select own profile or admin all"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "update own profile or admin all"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy "admin inserts profiles"
  on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy "admin deletes profiles"
  on public.profiles for delete to authenticated
  using (public.is_admin());

-- articles
create policy "select own articles or admin all"
  on public.articles for select to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy "insert own articles or admin"
  on public.articles for insert to authenticated
  with check (author_id = auth.uid() or public.is_admin());
create policy "update own articles or admin all"
  on public.articles for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());
create policy "delete own articles or admin all"
  on public.articles for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- settings
create policy "authenticated read settings"
  on public.settings for select to authenticated
  using (true);
create policy "admin updates settings"
  on public.settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
