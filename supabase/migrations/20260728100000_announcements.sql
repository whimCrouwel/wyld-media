-- お知らせ機能。アドミンが対象(ライター/事業者/エンドユーザー)を指定して配信する。
-- 公開サイトはこのテーブルだけ、初めてブラウザから anon key + RLS で直接読む
-- (他の公開データは全てビルド時に service role で読む。既存の検索はテーブル直読みでは
-- なく search-articles Edge Function 経由)。

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  audiences text[] not null,
  published boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- array_length は空配列で NULL を返し CHECK を素通りしてしまうため、
  -- 空配列を確実に弾ける cardinality() を使う。
  constraint announcements_audiences_valid check (
    audiences <@ array['writer', 'provider', 'end_user']::text[]
    and cardinality(audiences) > 0
  )
);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function extensions.moddatetime(updated_at);

create or replace function public.is_provider()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'provider'
  );
$$;

grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.announcements to anon;

alter table public.announcements enable row level security;

create policy "admin selects all announcements"
  on public.announcements for select to authenticated
  using (public.is_admin());

create policy "writer or provider selects own audience announcements"
  on public.announcements for select to authenticated
  using (
    published = true
    and (
      (public.is_writer() and 'writer' = ANY(audiences))
      or (public.is_provider() and 'provider' = ANY(audiences))
    )
  );

create policy "admin inserts announcements"
  on public.announcements for insert to authenticated
  with check (public.is_admin());

create policy "admin updates announcements"
  on public.announcements for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin deletes announcements"
  on public.announcements for delete to authenticated
  using (public.is_admin());

create policy "anon reads published end user announcements"
  on public.announcements for select to anon
  using (published = true and 'end_user' = ANY(audiences));
