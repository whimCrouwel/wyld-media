begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000009', 'pub-writer@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'pub-provider@test.local');

insert into profiles (id, role, slug, name, commission_code) values
  ('00000000-0000-0000-0000-000000000009', 'writer', 'pub-writer', 'Writer', null),
  ('00000000-0000-0000-0000-00000000000b', 'provider', 'pub-provider', 'Provider', 'WM-33CC44DD');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status)
    values ('30000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000009',
            'pub-a', 'first post', 'published')$$,
  'first normal publish succeeds');
select ok(
  (select published_at from articles
    where id = '30000000-0000-0000-0000-000000000001') is not null,
  'published_at is set automatically');

select throws_like(
  $$insert into articles (author_id, slug, title, status)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-too-soon', 'too soon', 'published')$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'second normal publish within the interval is rejected');

set local role postgres;
update articles set published_at = now() - interval '11 days'
 where id = '30000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status)
    values ('30000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000009',
            'pub-b', 'second post', 'published')$$,
  'normal publish succeeds after the interval elapsed');

select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_code_input)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-c', 'commissioned 1', 'published', 'WM-33CC44DD')$$,
  'commissioned article publishes immediately (exempt)');
select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_code_input)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-d', 'commissioned 2', 'published', 'WM-33CC44DD')$$,
  'multiple commissioned articles are all exempt');

select lives_ok(
  $$insert into articles (id, author_id, title)
    values ('30000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000009', 'draft e')$$,
  'drafts are never rate-limited');
select throws_like(
  $$update articles set status = 'published', slug = 'pub-e'
    where id = '30000000-0000-0000-0000-000000000003'$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'draft-to-published transition is also rate-limited');

set local role postgres;
update articles set published_at = now() - interval '11 days'
 where id = '30000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update articles set status = 'published', slug = 'pub-e'
    where id = '30000000-0000-0000-0000-000000000003'$$,
  'draft publishes via update after interval elapsed');
select ok(
  (select published_at from articles
    where id = '30000000-0000-0000-0000-000000000003') is not null,
  'published_at set on update transition');

select * from finish();
rollback;
