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

  if left(new.url, length(base) + 1 + 36) <> base || '/' || new.owner_id::text then
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
create or replace function public.block_media_in_use()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from articles
     where cover_image_url = old.url
        or position(old.url in body) > 0
  ) then
    raise exception 'MEDIA_IN_USE';
  end if;
  return old;
end;
$$;

create trigger a_block_media_in_use
  before delete on public.media
  for each row execute function public.block_media_in_use();
