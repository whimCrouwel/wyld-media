begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000020', 'artrole-writer@test.local'),
  ('00000000-0000-0000-0000-000000000021', 'artrole-provider@test.local'),
  ('00000000-0000-0000-0000-000000000022', 'artrole-admin@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000020', 'writer', 'artrole-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000021', 'provider', 'artrole-provider', 'Provider'),
  ('00000000-0000-0000-0000-000000000022', 'admin', 'artrole-admin', 'Admin');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-000000000021', 'provider-authored')$$,
  '42501', null, 'provider cannot insert their own article');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-000000000020', 'writer-authored')$$,
  'writer can insert their own article');

-- act as admin -- admin does not author articles; auditing is done via a
-- moderation hold instead (see 14_article_moderation_hold.test.sql)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-000000000021', 'admin-authored-for-provider')$$,
  '42501', null, 'admin cannot insert an article for any author');

select * from finish();
rollback;
