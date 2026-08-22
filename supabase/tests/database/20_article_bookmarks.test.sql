begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- オブジェクトの存在
select has_table('public', 'article_bookmarks', 'article_bookmarks テーブルが存在する');
select has_view('public', 'article_bookmark_counts', '集計ビューが存在する');
select has_function('public', 'toggle_bookmark', array['uuid', 'text'], 'toggle_bookmark 関数が存在する');
select has_function('public', 'top_bookmarked_articles', array['integer', 'integer'], 'top_bookmarked_articles 関数が存在する');
select has_function('public', 'bookmarked_articles', array['uuid[]'], 'bookmarked_articles 関数が存在する');

-- セットアップ: ライター1人 + 公開記事1本 + 下書き1本
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'bm-writer@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000b1', 'writer', 'bm-writer', 'BM Writer');
insert into articles (id, author_id, title, slug, cover_image_url, body, status, published_at, region) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '公開記事', 'bm-pub', 'https://example.test/cover-a1.jpg',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb,
   'published', now(), '関東'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1',
   '下書き記事', null, null,
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb,
   'draft', null, '関東');

-- anon として振る舞う(読者はログインしない)
set local role anon;
reset request.jwt.claims;

select is(
  (select bookmark_count from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a1', 'tokenA')),
  1,
  'anon は公開記事をブックマークでき、保存数1が返る');

select is(
  (select bookmark_count from public.article_bookmark_counts
   where article_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'anon は集計ビューで保存数を読める');

select throws_ok(
  $$select count(*) from public.article_bookmarks$$,
  '42501',
  null,
  'anon は base テーブルを直接 select できない(権限なし)');

select is(
  (select bookmark_count from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a1', 'tokenA')),
  0,
  '同じ token で再度呼ぶとブックマークが外れ、保存数0になる');

select throws_like(
  $$select * from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a2', 'tokenA')$$,
  '%not bookmarkable%',
  '下書き記事はブックマークできない');

select throws_like(
  $$select * from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a1', '   ')$$,
  '%invalid client_token%',
  '空の token は拒否される');

-- 別トークンは別カウントとして加算される(裸の select を出さないよう全てアサーションに包む)
select is(
  (select bookmark_count from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a1', 'tokenA')),
  1,
  'tokenA を付け直すと保存数1');
select is(
  (select bookmark_count from public.toggle_bookmark('00000000-0000-0000-0000-0000000000a1', 'tokenB')),
  2,
  '別トークン tokenB を足すと保存数2(別カウントとして加算)');

-- ランキングは公開記事のみを返す(下書きは対象外)
select is(
  (select slug from public.top_bookmarked_articles(30, 5) limit 1),
  'bm-pub',
  'ランキングは公開記事を返す');
select is(
  (select count(*)::int from public.top_bookmarked_articles(30, 5) where slug is null),
  0,
  'ランキングに下書き(slug null)は含まれない');
select is(
  (select cover_image_url from public.top_bookmarked_articles(30, 5) where slug = 'bm-pub'),
  'https://example.test/cover-a1.jpg',
  'ランキングはカバー画像URLを返す');

-- 「保存した記事」一覧: 渡したIDのうち公開記事だけを返す
select is(
  (select slug from public.bookmarked_articles(
     array['00000000-0000-0000-0000-0000000000a1']::uuid[])),
  'bm-pub',
  'bookmarked_articles は公開記事を返す');
select is(
  (select count(*)::int from public.bookmarked_articles(
     array['00000000-0000-0000-0000-0000000000a2']::uuid[])),
  0,
  'bookmarked_articles は下書き記事を返さない');

-- unique 制約(owner から直接 dup insert)
set local role postgres;
select throws_like(
  $$insert into article_bookmarks (article_id, client_token)
    values ('00000000-0000-0000-0000-0000000000a1', 'tokenA')$$,
  '%article_bookmarks_unique%',
  '同一(記事, token)の二重登録は unique 制約で拒否される');

select is(
  (select count(*)::int from article_bookmarks
   where article_id = '00000000-0000-0000-0000-0000000000a1'),
  2,
  '公開記事の保存は2件(tokenA, tokenB)のまま');

select * from finish();
rollback;
