-- 本文画像のルールを DB 層で強制する。
--   1. 本文に生の <img> タグを書けない(markdown の ![alt](url) 記法のみ)
--   2. 本文の画像は 5 枚まで
--   3. 画像は settings.image_base_url 配下のものだけ
--
-- image_base_url の既定は空文字。設定しない限り本文に画像を置けない(fail closed)。
-- この値は Edge Function の R2_PUBLIC_BASE_URL と一致させること。ずれると
-- アップロードは成功するのに保存が IMAGE_HOST_NOT_ALLOWED で落ちる。

alter table public.settings
  add column image_base_url text not null default '';

create or replace function public.enforce_body_image_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- admin/src/lib/images.ts の MAX_BODY_IMAGES と一致させること。権威はこちら。
  max_images constant int := 5;
  base text;
  urls text[];
  u text;
begin
  -- ルール1。これがあるおかげで markdown 記法だけを数えればよく、
  -- トリガーで HTML をパースせずに済む。
  if new.body ~* '<img' then
    raise exception 'HTML_IMG_NOT_ALLOWED';
  end if;

  select image_base_url into base from settings where id = 1;

  select array_agg(m[1]) into urls
    from regexp_matches(new.body, '!\[[^\]]*\]\(\s*([^)\s]+)', 'g') as m;

  if urls is null then
    return new;
  end if;

  -- ルール2
  if array_length(urls, 1) > max_images then
    raise exception 'IMAGE_LIMIT_EXCEEDED';
  end if;

  -- ルール3。base が空なら必ず落ちる(fail closed)。
  -- base || '/' で比較するのは、https://img.test が
  -- https://img.test.evil.example に前方一致するのを防ぐため。
  foreach u in array urls loop
    if base = '' or left(u, length(base) + 1) <> base || '/' then
      raise exception 'IMAGE_HOST_NOT_ALLOWED';
    end if;
  end loop;

  return new;
end;
$$;

create trigger a_enforce_body_image_rules
  before insert or update on public.articles
  for each row execute function public.enforce_body_image_rules();
