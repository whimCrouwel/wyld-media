begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'del-with-articles@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'del-without-articles@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'writer', 'del-with-articles', 'W1'),
  ('00000000-0000-0000-0000-0000000000e2', 'writer', 'del-without-articles', 'W2');

insert into articles (author_id, title) values
  ('00000000-0000-0000-0000-0000000000e1', '記事あり');

-- 記事を持つユーザーの削除は FK 違反(23503)でブロックされる
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23503', null, '記事を持つユーザーの削除はFK違反でブロックされる'
);

select is(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000e1')::int,
  1, 'ブロックされた場合プロフィールは残る'
);

-- 記事を持たないユーザーの削除は成功し、profiles にも cascade する
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000e2'$$,
  '記事を持たないユーザーの削除は成功する'
);

select is(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000e2')::int,
  0, '削除成功時はprofilesもcascadeで消える'
);

select * from finish();
rollback;
