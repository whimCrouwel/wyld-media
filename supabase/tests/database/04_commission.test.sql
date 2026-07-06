begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000007', 'com-writer@test.local'),
  ('00000000-0000-0000-0000-000000000008', 'com-provider@test.local');

insert into profiles (id, role, slug, name, commission_code) values
  ('00000000-0000-0000-0000-000000000007', 'writer', 'com-writer', 'Writer', null),
  ('00000000-0000-0000-0000-000000000008', 'provider', 'com-provider', 'Green Provider', 'WM-11AA22BB');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, title, commission_code_input)
    values ('20000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000007',
            'commissioned draft', 'WM-11AA22BB')$$,
  'valid commission code is accepted');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000008'::uuid,
  'commissioned_by resolved from code');

select throws_like(
  $$insert into articles (author_id, title, commission_code_input)
    values ('00000000-0000-0000-0000-000000000007', 'bad code', 'WM-NOPE0000')$$,
  '%INVALID_COMMISSION_CODE%',
  'invalid commission code is rejected');

select lives_ok(
  $$insert into articles (id, author_id, title, commissioned_by)
    values ('20000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000007',
            'spoofed', '00000000-0000-0000-0000-000000000008')$$,
  'direct commissioned_by insert does not error');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000002'),
  null::uuid,
  'directly-set commissioned_by is nulled out (must come from a code)');

select is(
  public.validate_commission_code('WM-11AA22BB'),
  'Green Provider',
  'validate RPC returns provider name on exact match');
select is(
  public.validate_commission_code('WM-NOPE0000'),
  null::text,
  'validate RPC returns null when no match');

select lives_ok(
  $$update articles set commission_code_input = null
    where id = '20000000-0000-0000-0000-000000000001'$$,
  'commission code can be cleared');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the code clears commissioned_by');

select * from finish();
rollback;
