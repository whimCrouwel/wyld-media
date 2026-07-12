begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- fixtures (as postgres, bypasses RLS)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'rls-admin@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'rls-writer1@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'rls-writer2@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'rls-admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000002', 'writer', 'rls-writer-one', 'Writer One'),
  ('00000000-0000-0000-0000-000000000003', 'writer', 'rls-writer-two', 'Writer Two');

insert into articles (id, author_id, title) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'w1 draft'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'w2 draft');
insert into articles (author_id, slug, title, status, published_at, body) values
  ('00000000-0000-0000-0000-000000000002', 'rls-w1-published', 'w1 published', 'published', now(),
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb);

-- act as writer1
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from articles)::int, 2,
  'writer1 sees only own articles (drafts included)');
select is((select count(*) from articles
  where author_id = '00000000-0000-0000-0000-000000000003')::int, 0,
  'writer1 cannot see writer2 articles');
select lives_ok(
  $$update articles set title = 'hacked'
    where id = '10000000-0000-0000-0000-000000000002'$$,
  'updating an invisible row affects 0 rows without error');
select throws_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-000000000003', 'spoofed')$$,
  '42501', null, 'writer1 cannot insert an article as writer2');
select throws_ok(
  $$insert into profiles (id, role, slug, name)
    values ('00000000-0000-0000-0000-000000000003', 'writer', 'dup', 'X')$$,
  '42501', null, 'writer1 cannot insert profiles');
select lives_ok(
  $$update profiles set name = 'Writer One Renamed'
    where id = '00000000-0000-0000-0000-000000000002'$$,
  'writer1 can update own profile');
select is((select count(*) from settings)::int, 1,
  'authenticated users can read settings');
select lives_ok(
  $$update settings set post_interval_days = 99 where id = 1$$,
  'non-admin settings update affects 0 rows without error');

-- back to postgres: verify nothing leaked through
set local role postgres;
select is((select title from articles
  where id = '10000000-0000-0000-0000-000000000002'), 'w2 draft',
  'writer2 draft title unchanged');
select is((select post_interval_days from settings where id = 1), 10,
  'settings unchanged by non-admin');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from articles)::int, 3, 'admin sees all articles');
select lives_ok(
  $$update settings set featured_count = 5 where id = 1$$,
  'admin can update settings');
select is((select featured_count from settings where id = 1), 5,
  'admin settings update applied');

select * from finish();
rollback;
