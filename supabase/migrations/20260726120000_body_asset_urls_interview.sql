-- body_asset_urls を SQL 版に置き換え、interview.attrs.speakers[].avatarUrl も列挙対象にする。
-- asset_type='image' のときのみアバターも返す (画像アセットの一種として扱う)。

create or replace function public.body_asset_urls(body jsonb, asset_type text)
returns setof text
language sql
immutable
set search_path = public
as $$
  with recursive nodes as (
    select jsonb_array_elements(coalesce(body, '[]'::jsonb)) as n
    union all
    select jsonb_array_elements(n->'content')
    from nodes
    where jsonb_typeof(n->'content') = 'array'
  )
  -- 既存: type=asset_type のノードの attrs.url
  select n->'attrs'->>'url'
  from nodes
  where n->>'type' = asset_type
    and n->'attrs'->>'url' is not null

  union all

  -- 追加: interview.attrs.speakers[*].avatarUrl (asset_type='image' のときのみ対象)
  select s->>'avatarUrl'
  from nodes,
       lateral jsonb_array_elements(coalesce(n->'attrs'->'speakers', '[]'::jsonb)) as s
  where n->>'type' = 'interview'
    and asset_type = 'image'
    and s->>'avatarUrl' is not null;
$$;

comment on function public.body_asset_urls(jsonb, text) is
  '記事本文 JSON から指定タイプの画像/ファイルURLを列挙する。 asset_type=image のとき interview.attrs.speakers[].avatarUrl も対象。';

-- 上の変更により body_asset_urls(body, 'image') は interview アバターも含むようになった。
-- しかし enforce_body_image_rules (20260712090100_body_image_rules_jsonb.sql) はこの
-- 関数の結果をそのまま「本文画像は5枚まで」の枚数チェックにも使っているため、そのままでは
-- アバターがこの上限に食い込んでしまう(仕様: アバターは本文画像の上限とは別枠)。
-- 上限チェック専用に、type='image' ノードそのものだけを数える関数を用意し、
-- enforce_body_image_rules の枚数チェックだけをこちらに差し替える。
-- ホストチェック(IMAGE_HOST_NOT_ALLOWED)・MEDIA_IN_USE はこれまで通り
-- body_asset_urls(body, 'image')(アバター込み)を使い続ける。
create or replace function public.body_image_node_count(body jsonb)
returns int
language sql
immutable
set search_path = public
as $$
  with recursive nodes as (
    select jsonb_array_elements(coalesce(body, '[]'::jsonb)) as n
    union all
    select jsonb_array_elements(n->'content')
    from nodes
    where jsonb_typeof(n->'content') = 'array'
  )
  select count(*)::int
  from nodes
  where n->>'type' = 'image'
    and n->'attrs'->>'url' is not null;
$$;

comment on function public.body_image_node_count(jsonb) is
  '本文中の type=image ノード数(interview アバターは含まない)。MAX_BODY_IMAGES 上限チェック専用。';

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

  -- 枚数上限は type=image ノードのみを数える(interview アバターは別枠、
  -- 上の body_image_node_count 参照)。ホストチェックは image_urls
  -- (アバター込み)のまま行う。
  if public.body_image_node_count(new.body) > max_images then
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
