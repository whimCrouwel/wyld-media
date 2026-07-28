-- 未使用メディア(どこからも参照されていない R2 画像/ファイル)の自動掃除。
--
-- 記事の削除・カバー画像の差し替え・本文からの画像削除は R2 オブジェクトと
-- media 行を掃除しない(block_media_in_use は「現役の画像を誤って消す」のを
-- 防ぐガードであって、清掃機能ではない)。放置すると未参照のオブジェクトが
-- R2 に溜まり続けるため、週1で自動掃除する:
--
--   pg_cron(毎週月曜 00:00 UTC = 月曜 9:00 JST)
--     → public.invoke_cleanup_orphaned_media()
--       → Edge Function cleanup-orphaned-media を HTTP で起動(pg_net)
--         → public.delete_orphaned_media() で media 行を原子的に削除
--         → 返った URL の R2 オブジェクトを削除
--
-- R2 の削除はネットワーク越しの S3 API が要るので DB だけでは完結できない。
-- そのため「検出+DB行削除」を DB 関数、「R2オブジェクト削除」を Edge Function
-- が担う分業になっている。

-- ============================================================
-- 1. 検出+削除の本体。Edge Function が service_role で RPC 呼び出しする。
-- ============================================================
--
-- 「使用中」の定義は block_media_in_use(20260712090100)と同じ参照元
-- (記事のカバー画像・body_asset_urls が拾う本文の画像/ファイル/interview
-- 話者アバター)に加えて、プロフィールのアバター・カバー・主要サービス画像
-- (これらは記事を経由しないため block_media_in_use の対象外だが、現役の
-- 参照であることに変わりはない)。本文 JSON の走査は body_asset_urls に
-- 一元化されており、ここで再実装しない。
--
-- グレース期間: アップロード直後でまだ記事に保存されていない(編集中の)
-- 画像を「未使用」と誤検知しないため、作成から grace_hours 未満の行は
-- 対象外にする。既定は 7 日。
--
-- 検出と削除を同一 SQL 文で行う(検出してから別文で消すと、その間に参照が
-- 付いた画像を消しうる)。呼び出し元が service_role のとき block_media_in_use
-- は素通り(auth.uid() is null)なので、この文の「未参照」検証だけが安全装置。
--
-- security definer にする理由: media/articles/profiles/settings には
-- service_role への GRANT が無い(docs/TODO.md 記載の通り。ローカルの
-- 新デフォルトでは新規テーブルは明示 GRANT なしにどのロールからも読めない)。
-- テーブル側に GRANT をばらまくより、この関数だけを定義者(postgres)権限で
-- 走らせ、実行権を service_role に限定する方が露出が小さい。
--
-- 返り値の key は R2 オブジェクトの削除に使う(url から settings.image_base_url
-- を剥いだもの)。settings を読めない Edge Function 側で導出せず、ここで返す。
-- image_base_url をローテーションした後に残る旧ホストの media 行は、キー導出が
-- できないため対象外とする(current base 配下の URL のみ削除する)。
create or replace function public.delete_orphaned_media(grace_hours int default 168)
returns table (url text, key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
begin
  -- 24時間未満のグレース指定は誤操作とみなして拒否する(fat-finger保険)。
  if grace_hours < 24 then
    raise exception 'GRACE_TOO_SHORT';
  end if;

  select image_base_url into base from settings where id = 1;
  if base is null or base = '' then
    raise exception 'IMAGE_BASE_URL_NOT_SET';
  end if;

  return query
  with used as (
    select a.cover_image_url from public.articles a where a.cover_image_url is not null
    union
    select bu from public.articles a cross join public.body_asset_urls(a.body, 'image') bu
    union
    select bu from public.articles a cross join public.body_asset_urls(a.body, 'file') bu
    union
    select p.avatar_url from public.profiles p where p.avatar_url is not null
    union
    select p.cover_image_url from public.profiles p where p.cover_image_url is not null
    union
    select p.service_image_url from public.profiles p where p.service_image_url is not null
  )
  delete from public.media m
  where m.created_at < now() - make_interval(hours => grace_hours)
    and left(m.url, length(base) + 1) = base || '/'
    and m.url not in (select * from used)
  returning m.url, substr(m.url, length(base) + 2);
end;
$$;

comment on function public.delete_orphaned_media(int) is
  'どこからも参照されておらず作成から grace_hours 以上経過した media 行を削除し、R2 オブジェクト削除用に URL とキーを返す。Edge Function cleanup-orphaned-media 専用。';

-- 実行できるのは service_role(= Edge Function)だけ。一般ユーザーに開くと
-- 「他人のライブラリの未使用画像を勝手に消す」操作になってしまう。
revoke all on function public.delete_orphaned_media(int) from public, anon, authenticated;
grant execute on function public.delete_orphaned_media(int) to service_role;

-- ============================================================
-- 2. cron から Edge Function を起動するラッパー
-- ============================================================
--
-- Function の URL と service role key は環境ごとに違うので Vault から読む。
-- 必要な secret(名前は project_url / service_role_key)が未登録の環境
-- (ローカルの素の db reset 直後など)では静かにスキップする — cron が毎週
-- エラーを吐き続けるより、セットアップ済みの環境でだけ動く方がよい。
-- 本番のセットアップ手順は docs/superpowers/DEPLOYMENT-CHECKLIST.md。
create extension if not exists pg_net;

create or replace function public.invoke_cleanup_orphaned_media()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  srk text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into srk from vault.decrypted_secrets where name = 'service_role_key';

  if base_url is null or srk is null then
    raise notice 'cleanup-orphaned-media: vault secrets (project_url / service_role_key) not set, skipping';
    return;
  end if;

  -- pg_net は非同期(キューに積むだけ)。結果は Edge Function 側のログで見る。
  perform net.http_post(
    url := base_url || '/functions/v1/cleanup-orphaned-media',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || srk,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

comment on function public.invoke_cleanup_orphaned_media() is
  'pg_cron 専用。Vault の project_url / service_role_key を使って Edge Function cleanup-orphaned-media を起動する。';

-- vault を読める関数を API 経由で呼ばせない(cron = postgres のみが実行する)。
revoke all on function public.invoke_cleanup_orphaned_media() from public, anon, authenticated, service_role;

-- ============================================================
-- 3. 週1スケジュール(毎週月曜 00:00 UTC = 月曜 9:00 JST)
-- ============================================================
create extension if not exists pg_cron;

-- cron.schedule は同名ジョブがあれば上書きする(再実行しても増殖しない)。
select cron.schedule(
  'cleanup-orphaned-media-weekly',
  '0 0 * * 1',
  $$select public.invoke_cleanup_orphaned_media()$$
);
