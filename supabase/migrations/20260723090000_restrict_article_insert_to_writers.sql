-- サービスプロバイダーは記事を作成できない。writer ロールのみが自分名義の記事を作成できる。
-- 詳細: docs/TODO.md 参照(依頼一覧が空になる不具合の調査で判明)

create or replace function public.is_writer()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'writer'
  );
$$;

drop policy "insert own articles or admin" on public.articles;
create policy "insert own articles as writer or admin"
  on public.articles for insert to authenticated
  with check ((author_id = auth.uid() and public.is_writer()) or public.is_admin());
