-- articles.body を markdown文字列から Tiptap ブロックJSON配列(jsonb)へ移行する。
-- 本番データは存在しない(初回デプロイ未実施)ため、既存データの変換は行わない。

alter table public.articles drop column body;
alter table public.articles add column body jsonb not null default '[]'::jsonb;

drop function if exists public.body_image_urls(text);

-- body(jsonbのブロック配列)を再帰的に走査し、指定した type のノードが持つ
-- attrs.url をすべて集める。image/file/embed のいずれの検証にも使う。
-- リスト項目などネストしたcontent配下のブロックも対象。
create or replace function public.body_asset_urls(body jsonb, asset_type text)
returns setof text
language plpgsql
immutable
set search_path = public
as $$
declare
  node jsonb;
begin
  if jsonb_typeof(body) = 'array' then
    for node in select * from jsonb_array_elements(body) loop
      if node ->> 'type' = asset_type and node -> 'attrs' ->> 'url' is not null then
        return next node -> 'attrs' ->> 'url';
      end if;
      if node ? 'content' then
        return query select public.body_asset_urls(node -> 'content', asset_type);
      end if;
    end loop;
  end if;
  return;
end;
$$;

create or replace function public.enforce_body_image_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- admin/src/lib/images.ts の MAX_BODY_IMAGES と一致させること。権威はこちら。
  max_images constant int := 5;
  base text;
  image_urls text[];
  file_urls text[];
  u text;
begin
  -- body が変わらない UPDATE は本文検証を一切スキップする(ホストローテーション後の
  -- 救済経路。20260709120000_body_image_rules.sql のオリジナルコメント参照)。
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  select image_base_url into base from settings where id = 1;

  -- select 内で "u" をそのままテーブルエイリアスにすると、同名の plpgsql 変数 u
  -- (下の foreach で使う)と衝突して "column reference is ambiguous" になる
  -- ため、エイリアスは別名にする。
  select array_agg(asset_url) into image_urls from public.body_asset_urls(new.body, 'image') as asset_url;
  select array_agg(asset_url) into file_urls from public.body_asset_urls(new.body, 'file') as asset_url;

  if image_urls is not null and array_length(image_urls, 1) > max_images then
    raise exception 'IMAGE_LIMIT_EXCEEDED';
  end if;

  if image_urls is not null then
    foreach u in array image_urls loop
      if base = '' or left(u, length(base) + 1) <> base || '/' then
        raise exception 'IMAGE_HOST_NOT_ALLOWED';
      end if;
    end loop;
  end if;

  if file_urls is not null then
    foreach u in array file_urls loop
      if base = '' or left(u, length(base) + 1) <> base || '/' then
        raise exception 'FILE_HOST_NOT_ALLOWED';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- media_library.sql の block_media_in_use は旧 body_image_urls(text) を
-- 呼んでいたため、jsonb版に合わせて再定義する(トリガー自体は既存のまま)。
create or replace function public.block_media_in_use()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return old;
  end if;

  if exists (
    select 1 from articles a
     where a.cover_image_url = old.url
        or exists (select 1 from public.body_asset_urls(a.body, 'image') bu where bu = old.url)
        or exists (select 1 from public.body_asset_urls(a.body, 'file') bu where bu = old.url)
  ) then
    raise exception 'MEDIA_IN_USE';
  end if;
  return old;
end;
$$;
