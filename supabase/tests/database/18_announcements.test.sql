begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000040', 'ann-admin@test.local'),
  ('00000000-0000-0000-0000-000000000041', 'ann-writer@test.local'),
  ('00000000-0000-0000-0000-000000000042', 'ann-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000040', 'admin', 'ann-admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000041', 'writer', 'ann-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000042', 'provider', 'ann-provider', 'Provider');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000040","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array[]::text[], true)$$,
  '%announcements_audiences_valid%',
  '空配列の audiences は拒否される');

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array['bogus'], true)$$,
  '%announcements_audiences_valid%',
  '許可されていない audience 値は拒否される');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000043', 'ライター向け', '本文w', array['writer'], true)$$,
  'admin はライター向けの公開お知らせを作成できる');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000044', '事業者向け下書き', '本文p', array['provider'], false)$$,
  'admin は非公開のお知らせを作成できる');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000045', 'エンドユーザー向け', '本文e', array['end_user'], true)$$,
  'admin はエンドユーザー向けの公開お知らせを作成できる');

select is(
  (select count(*)::int from announcements),
  3,
  'admin は下書き含む全件を select できる');

select lives_ok(
  $$update announcements set title = '更新後' where id = '00000000-0000-0000-0000-000000000043'$$,
  'admin は更新できる');

select lives_ok(
  $$delete from announcements where id = '00000000-0000-0000-0000-000000000044'$$,
  'admin は削除できる');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from announcements),
  1,
  'writer には公開済みかつ writer 向けの1件だけ見える(事業者/エンドユーザー向けは見えない)');

-- UPDATE の USING 句にマッチする行が無い場合、DELETE/UPDATE はエラーにならず
-- 単に対象0行として静かに成功する(エラーになるのは INSERT の WITH CHECK 違反だけ)。
-- そのため lives_ok で「エラーにならないこと」を確認した上で、実際に書き換わって
-- いないことを別途 postgres ロールで確認する。
select lives_ok(
  $$update announcements set title = '書き換え試行' where id = '00000000-0000-0000-0000-000000000043'$$,
  'writer の update 文自体はエラーにならない(RLSにマッチする行が無く0行が対象)');

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array['writer'], true)$$,
  '%',
  'writer は作成できない(insertはRLSのwith check違反でエラーになる)');

set local role postgres;
select is(
  (select title from announcements where id = '00000000-0000-0000-0000-000000000043'),
  '更新後',
  'writer の update 試行はタイトルを書き換えられていない(RLSにより対象0行だった)');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from announcements),
  0,
  'provider には(writer向け1件のみ存在する現状で)何も見えない');

-- act as anon
set local role anon;
reset request.jwt.claims;

select is(
  (select count(*)::int from announcements),
  1,
  'anon には公開済みかつ end_user 向けの1件だけ見える');

select * from finish();
rollback;
