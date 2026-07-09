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
  image_markers int;
  inline_images int;
begin
  -- body が変わらない UPDATE は本文検証を一切スキップする。これは
  -- settings.image_base_url をローテーションした後の救済経路: 既存記事の
  -- body が古いホストの画像 URL を参照していても、タイトルやステータス
  -- など body 以外のフィールドは編集し続けられる。新しい body を保存する
  -- には URL を新しいホストに直す必要がある(そこは引き続き強制する)。
  --
  -- ここに「信頼できる呼び出し元」の例外(auth.uid() is null or
  -- is_admin() など)は意図的に置かない。ルール1〜3は body の内容整合性の
  -- 不変条件であり、admin であってもビルド時の service role クライアント
  -- であっても常に成り立つ必要がある。これは
  -- 20260706043424_harden_publish_and_commission_rules.sql の
  -- enforce_publish_rules(著者向けのワークフローポリシーであり、内容の
  -- 整合性そのものではない)とは意図的に異なる方針。
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  -- ルール1。これがあるおかげで markdown 記法だけを数えればよく、
  -- トリガーで HTML をパースせずに済む。
  if new.body ~* '<img' then
    raise exception 'HTML_IMG_NOT_ALLOWED';
  end if;

  -- ルール1(続き)。CommonMark の reference-style(![alt][ref] +
  -- [ref]: url)や shortcut(![alt] + [alt]: url)画像は、marked が実際に
  -- <img> へ解決し、sanitize-html もそれを通してしまう。しかし以下の
  -- inline 画像用の正規表現(![alt](url))はこれらの形式にマッチしない。
  -- Postgres の正規表現には先読みがないので、"![...]" 全体の出現数と
  -- "![...](" の出現数を比較する: 前者が多ければ inline 以外の画像記法が
  -- 使われている ―― 放置するとホスト許可リストを完全に迂回できてしまう
  -- ので、カウント・ホストチェックより先に拒否する。
  select count(*) into image_markers
    from regexp_matches(new.body, '!\[[^\]]*\]', 'g');

  select count(*) into inline_images
    from regexp_matches(new.body, '!\[[^\]]*\]\(', 'g');

  if image_markers > inline_images then
    raise exception 'IMAGE_SYNTAX_NOT_ALLOWED';
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
    -- CommonMark の山括弧付き宛先 ![a](<https://...>) は正当な記法。
    -- trim(both '<>' ...) は連続した文字も剥がしてしまうので使わず、
    -- 先頭の '<' と末尾の '>' が両方揃っているときだけ1文字ずつ剥がす。
    if left(u, 1) = '<' and right(u, 1) = '>' then
      u := substring(u from 2 for length(u) - 2);
    end if;

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
