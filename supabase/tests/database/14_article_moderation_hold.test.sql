begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000030', 'modhold-writer@test.local'),
  ('00000000-0000-0000-0000-000000000031', 'modhold-admin@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000030', 'writer', 'modhold-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000031', 'admin', 'modhold-admin', 'Admin');

insert into articles (id, author_id, title, slug, body, status, published_at, region) values
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000030',
   '審査対象記事', 'modhold-article',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb,
   'published', now(), '関東');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$update articles set moderation_hold = true
    where id = '00000000-0000-0000-0000-000000000032'$$,
  '%only be changed by an admin%',
  'writer cannot place a hold on their own article');

select throws_like(
  $$update articles set moderation_hold_at = now()
    where id = '00000000-0000-0000-0000-000000000032'$$,
  '%only be changed by an admin%',
  'writer cannot backdoor moderation_hold_at without changing the flag');

select lives_ok(
  $$update articles set status = 'draft'
    where id = '00000000-0000-0000-0000-000000000032'$$,
  'writer keeps normal control over status regardless of hold protection');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$update articles set moderation_hold = true
    where id = '00000000-0000-0000-0000-000000000032'$$,
  '%requires a reason%',
  'admin cannot place a hold without a reason');

select lives_ok(
  $$update articles set moderation_hold = true, moderation_hold_reason = '事実誤認の指摘あり'
    where id = '00000000-0000-0000-0000-000000000032'$$,
  'admin can place a hold with a reason');

set local role postgres;
select ok(
  (select moderation_hold_at is not null and moderation_hold_by = '00000000-0000-0000-0000-000000000031'
     and moderation_hold_reason = '事実誤認の指摘あり'
     from articles where id = '00000000-0000-0000-0000-000000000032'),
  'placing a hold server-stamps who/when and keeps the reason');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update articles set moderation_hold = false
    where id = '00000000-0000-0000-0000-000000000032'$$,
  'admin can release a hold');

set local role postgres;
select ok(
  (select moderation_hold_at is null and moderation_hold_by is null and moderation_hold_reason is null
     from articles where id = '00000000-0000-0000-0000-000000000032'),
  'releasing a hold clears who, when, and the reason');

select * from finish();
rollback;
