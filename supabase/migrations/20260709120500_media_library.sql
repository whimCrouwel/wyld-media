-- アップロード済み画像の記録。メディアライブラリの一覧・再利用・削除の土台。
-- R2 のオブジェクトそのものはここにはない(URL だけを持つ)。

create table public.media (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  url text not null unique,
  bytes int not null check (bytes > 0),
  created_at timestamptz not null default now()
);

create index media_owner_created_idx on public.media (owner_id, created_at desc);

alter table public.media enable row level security;
grant select, insert, delete on public.media to authenticated;

create policy "select own media or admin all"
  on public.media for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy "insert own media"
  on public.media for insert to authenticated
  with check (owner_id = auth.uid());
create policy "delete own media or admin all"
  on public.media for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- URL は許可ホスト配下でなければならず、キーの先頭は所有者の uid でなければ
-- ならない(r2-upload-url が uid/uuid.ext の形で発行する)。
-- これを欠くと、PostgREST を直接叩いて他人のオブジェクトを自分のライブラリに
-- 登録し、後述の削除経路で消せてしまう。
create or replace function public.enforce_media_url()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  base text;
begin
  select image_base_url into base from settings where id = 1;

  if base = '' or left(new.url, length(base) + 1) <> base || '/' then
    raise exception 'IMAGE_HOST_NOT_ALLOWED';
  end if;

  -- uid の直後は必ず '/' でなければならない。この文字を見ないと
  -- base/<own-uid>(キーが何もない)や base/<own-uid>garbage.ext(uid を
  -- 前方一致させただけの偽装キー)まで通ってしまう。
  if left(new.url, length(base) + 1 + 36) <> base || '/' || new.owner_id::text
     or substr(new.url, length(base) + 1 + 36 + 1, 1) <> '/' then
    raise exception 'MEDIA_OWNER_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger a_enforce_media_url
  before insert on public.media
  for each row execute function public.enforce_media_url();

-- 使用中の画像は消せない。削除は R2 のオブジェクト削除を伴い取り消せないため、
-- 参照が残っていると記事の画像が 404 になる。
--
-- 「使用中」は本文の実際の markdown 画像宛先(public.body_image_urls)に
-- 限定する。単純な substring 一致(position(url in body) > 0)だと、URL を
-- 地の文にただ書いただけの記事でも「使用中」扱いになり、書き手が他人の
-- 公開 URL を自分の記事の本文に書くだけで、その画像を永久に削除不能へ
-- 追い込める(誰でも他人のメディアを凍結できてしまう)。
create or replace function public.block_media_in_use()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- 信頼済み呼び出し元(サービスロール = auth.uid() is null、および管理者)は
  -- この保護を越えられる。auth.users の削除は owner_id の on delete cascade
  -- 経由でこの BEFORE DELETE トリガーを発火させるので、これが無いと
  -- 「メディアが使用中だからユーザーを削除できない」という詰みが起きる。
  --
  -- これは 20260709120000_body_image_rules.sql の enforce_body_image_rules
  -- とは意図的に逆の方針。あちらは本文の内容整合性そのものの不変条件で
  -- あり admin にもサービスロールにも常に適用されるべきものだが、
  -- MEDIA_IN_USE は「誤って」生きた参照を壊すことを防ぐガードでしかない。
  -- admin が承知の上で削除する、あるいはユーザー削除の cascade がメディア
  -- ごと消し去るのは、結果を理解した上での意図的な行為なのでブロックしない。
  if auth.uid() is null or public.is_admin() then
    return old;
  end if;

  if exists (
    select 1 from articles a
     where a.cover_image_url = old.url
        or exists (
             select 1 from public.body_image_urls(a.body) bu where bu = old.url
           )
  ) then
    raise exception 'MEDIA_IN_USE';
  end if;
  return old;
end;
$$;

create trigger a_block_media_in_use
  before delete on public.media
  for each row execute function public.block_media_in_use();
