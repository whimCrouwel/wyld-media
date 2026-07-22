begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000004', 'prot-writer@test.local'),
  ('00000000-0000-0000-0000-000000000006', 'prot-admin@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000004', 'writer', 'prot-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000006', 'admin', 'prot-admin', 'Admin');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update profiles set name = 'Writer Renamed'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  'writer can update own name');
select throws_like(
  $$update profiles set role = 'admin'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  '%only be changed by an admin%',
  'writer cannot change own role');

set local role postgres;
select is(
  (select name from profiles
    where id = '00000000-0000-0000-0000-000000000004'),
  'Writer Renamed', 'name change was persisted');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update profiles set role = 'provider'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  'admin can change roles');

set local role postgres;
select is(
  (select role from profiles
    where id = '00000000-0000-0000-0000-000000000004')::text,
  'provider', 'role change by admin was persisted');

select * from finish();
rollback;
