begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000c', 'hard-writer@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'hard-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-00000000000c', 'writer', 'hard-writer', 'Writer'),
  ('00000000-0000-0000-0000-00000000000d', 'provider', 'hard-provider', 'Provider');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
-- あえて過去日時で発行する: 直後に2件目を発行するため、commission_interval_days の
-- 間隔チェックに引っかからないようにする。
insert into commission_tokens (id, writer_id, created_at) values
  ('50000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000c',
   now() - interval '11 days');
-- a second valid token to the same writer, so we can test swapping the link
-- to a different token (not just clearing it to null) on a published article.
insert into commission_tokens (id, writer_id) values
  ('50000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000000c');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

-- 1) client-supplied backdate on the publish transition is ignored: the
--    insert itself must not be blocked, but the stored published_at must be
--    "now", not the 100-day-old value the client sent.
select lives_ok(
  $$insert into articles (id, author_id, slug, title, status, published_at, body, region)
    values ('40000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-00000000000c',
            'hard-a', 'first post', 'published', now() - interval '100 days',
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'writer publish with a backdated published_at is accepted');

set local role postgres;
select ok(
  (select published_at from articles
    where id = '40000000-0000-0000-0000-000000000001') > now() - interval '1 minute',
  'client-supplied backdate is ignored; published_at is server-set to now()');

-- 2) with the backdate bypass closed, an immediate second normal publish by
--    the same writer must still be rate-limited.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into articles (author_id, slug, title, status, body, region)
    values ('00000000-0000-0000-0000-00000000000c',
            'hard-b', 'second post', 'published',
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'second normal publish immediately after is still rejected');

-- 3) trusted (postgres/admin) callers can still backdate published_at, e.g.
--    for fixtures or admin tooling. Clear the leftover writer JWT first so
--    auth.uid() is null and this action is recognized as trusted.
set local role postgres;
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$update articles set published_at = now() - interval '11 days'
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'trusted (postgres) backdate of published_at succeeds');

-- 4) once published, published_at is immutable for the writer as long as the
--    row stays published: the update must not error, but the write must be
--    silently discarded (article stays at the trusted ~11-day-old value).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update articles set published_at = now() - interval '30 days'
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'writer update of published_at on an already-published row does not error');

set local role postgres;
select ok(
  (select published_at from articles
    where id = '40000000-0000-0000-0000-000000000001')
    between now() - interval '12 days' and now() - interval '10 days',
  'published_at stays at the trusted 11-day value, not the client-attempted 30 days');

-- 5) commissioned articles are exempt from the interval, but once published
--    the commission link cannot be unlinked without unpublishing first.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status, commission_token_input, body, region)
    values ('40000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-00000000000c',
            'hard-c', 'commissioned post', 'published',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000007'),
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'writer publishes a commissioned article (rate limit exempt)');

select throws_like(
  $$update articles set commission_token_input = null
    where id = '40000000-0000-0000-0000-000000000003'$$,
  '%COMMISSION_UNLINK_REQUIRES_UNPUBLISH%',
  'clearing the commission link while still published is rejected');

select throws_like(
  $$update articles set commission_token_input =
      (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000008')
    where id = '40000000-0000-0000-0000-000000000003'$$,
  '%COMMISSION_UNLINK_REQUIRES_UNPUBLISH%',
  'swapping the commission link to a different token while still published is rejected');

-- 6) unpublish first, then the link can be cleared; republishing afterwards
--    is a normal (uncommissioned) publish and goes through the rate limit
--    again. article 1 is currently ~11 days old (> the 10-day interval),
--    which would let the republish through and make this assertion
--    meaningless, so (as a trusted postgres action) freshen it to 1 day old
--    first so the interval genuinely blocks the republish attempt below.
select lives_ok(
  $$update articles set status = 'draft'
    where id = '40000000-0000-0000-0000-000000000003'$$,
  'writer unpublishes the commissioned article');

select lives_ok(
  $$update articles set commission_token_input = null
    where id = '40000000-0000-0000-0000-000000000003'$$,
  'commission link can be cleared once the article is a draft');

set local role postgres;
select set_config('request.jwt.claims', '', true);
update articles set published_at = now() - interval '1 day'
 where id = '40000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$update articles set status = 'published', region = '関東'
    where id = '40000000-0000-0000-0000-000000000003'$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'republishing as a normal (uncommissioned) post goes through the rate limit again');

select * from finish();
rollback;
