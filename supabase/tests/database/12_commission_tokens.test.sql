begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000010', 'tok-writer@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'tok-provider@test.local'),
  ('00000000-0000-0000-0000-000000000012', 'tok-other-writer@test.local'),
  ('00000000-0000-0000-0000-000000000013', 'tok-other-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000010', 'writer', 'tok-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000011', 'provider', 'tok-provider', 'Provider'),
  ('00000000-0000-0000-0000-000000000012', 'writer', 'tok-other-writer', 'Other Writer'),
  ('00000000-0000-0000-0000-000000000013', 'provider', 'tok-other-provider', 'Other Provider');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into commission_tokens (id, writer_id)
    values ('50000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000010')$$,
  'provider issues a token to a writer');

select matches(
  (select token from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '^WM-[0-9A-F]{8}$',
  'issued token has the expected format');

select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'provider_id is forced to the caller');

select lives_ok(
  $$insert into commission_tokens (id, writer_id, provider_id)
    values ('50000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000013')$$,
  'a spoofed provider_id does not error (silently overwritten)');
select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'the spoofed provider_id is forced back to the actual caller');

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000013')$$,
  '%INVALID_WRITER%',
  'the target must have role=writer (a provider id is rejected)');

-- act as a writer (not a provider)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000012')$$,
  '%NOT_A_PROVIDER%',
  'a writer cannot issue commission tokens');

select ok(
  exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'the target writer can see a token issued to them');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select ok(
  not exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'an unrelated provider cannot see another provider''s token');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select ok(
  exists(select 1 from commission_tokens where writer_id = '00000000-0000-0000-0000-000000000010'),
  'the issuing provider can see their own issued tokens');

select ok(
  exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000000010'),
  'an authenticated provider can read a writer profile (needed for the "pick a writer" UI)');

select * from finish();
rollback;
