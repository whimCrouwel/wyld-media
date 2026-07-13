begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_table('public', 'post_chunks', 'post_chunks table exists');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'chunk-writer@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000d1', 'writer', 'chunk-writer', 'CW');
insert into articles (id, author_id, title, body) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
   'テスト記事', '[]'::jsonb);

select lives_ok(
  $$insert into post_chunks (article_id, chunk_index, heading_path, content, token_count)
    values ('00000000-0000-0000-0000-0000000000d2', 0, '見出し', '本文テキスト', 10)$$,
  'seeding a chunk succeeds as postgres'
);

select throws_ok(
  $$insert into post_chunks (article_id, chunk_index, heading_path, content, token_count)
    values ('00000000-0000-0000-0000-0000000000d2', 0, '見出し2', '別の本文', 5)$$,
  '23505', null, 'duplicate (article_id, chunk_index) is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select 1 from post_chunks$$,
  '42501', null, 'authenticated cannot read post_chunks directly'
);
reset role;

set local role anon;
select throws_ok(
  $$select 1 from post_chunks$$,
  '42501', null, 'anon cannot read post_chunks directly'
);
reset role;

delete from articles where id = '00000000-0000-0000-0000-0000000000d2';
select is(
  (select count(*)::int from post_chunks
   where article_id = '00000000-0000-0000-0000-0000000000d2'),
  0,
  'deleting the article cascades to post_chunks'
);

select * from finish();
rollback;
