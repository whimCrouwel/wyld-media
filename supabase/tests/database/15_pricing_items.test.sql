begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000040', 'pricing-admin@test.local'),
  ('00000000-0000-0000-0000-000000000041', 'pricing-writer-a@test.local'),
  ('00000000-0000-0000-0000-000000000044', 'pricing-writer-b@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000040', 'admin', 'pricing-admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000041', 'writer', 'pricing-writer-a', 'Writer A'),
  ('00000000-0000-0000-0000-000000000044', 'writer', 'pricing-writer-b', 'Writer B');

-- postgres として seed(RLS バイパス)
-- Writer A: 公開1 + 下書き1、Writer B: 公開1
insert into pricing_items (id, writer_id, label, unit, amount, sort_order, published) values
  ('00000000-0000-0000-0000-000000000042',
   '00000000-0000-0000-0000-000000000041', '基本記事', '1本', 8000, 10, true),
  ('00000000-0000-0000-0000-000000000043',
   '00000000-0000-0000-0000-000000000041', '画像追加(下書き)', '1枚', 1000, 20, false),
  ('00000000-0000-0000-0000-000000000045',
   '00000000-0000-0000-0000-000000000044', '取材同行', '1日', 20000, 10, true);

-- act as writer A
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}', true);
set local role authenticated;

-- Writer A は自分の行(下書き含む)だけ見える。Writer B の行は見えない。
select is(
  (select count(*)::int from pricing_items),
  2,
  'writer A sees only own pricing items (published + draft)');

-- 自分名義でのinsertはOK
select lives_ok(
  $$insert into pricing_items (writer_id, label, unit, amount)
    values ('00000000-0000-0000-0000-000000000041', 'own row', '1本', 5000)$$,
  'writer A can insert row with own writer_id');

-- 他人名義でのinsertはRLSでブロック(with check 違反 → 42501)
select throws_ok(
  $$insert into pricing_items (writer_id, label, unit, amount)
    values ('00000000-0000-0000-0000-000000000044', 'stolen', '1本', 1)$$,
  '42501',
  null,
  'writer A cannot insert row with another writer_id');

-- 他人の行のupdateはRLSで無音失敗(0行更新)
select lives_ok(
  $$update pricing_items set amount = 1
    where id = '00000000-0000-0000-0000-000000000045'$$,
  'writer A update on B row returns without error');

set local role postgres;
select is(
  (select amount from pricing_items where id = '00000000-0000-0000-0000-000000000045'),
  20000,
  'but the update matched 0 rows (RLS blocked it)');

-- 他人の行のdeleteも無音失敗
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$delete from pricing_items where id = '00000000-0000-0000-0000-000000000045'$$,
  'writer A delete on B row returns without error');

set local role postgres;
select is(
  (select count(*)::int from pricing_items where id = '00000000-0000-0000-0000-000000000045'),
  1,
  'but the delete matched 0 rows (RLS blocked it)');

-- act as admin: 全writerの行が見える + 全writer名義で insert/update/delete できる
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000040","role":"authenticated"}', true);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from pricing_items),
  '>=',
  3,
  'admin sees pricing items across writers');

select lives_ok(
  $$insert into pricing_items (writer_id, label, unit, amount)
    values ('00000000-0000-0000-0000-000000000044', 'admin-inserted', '1本', 3000)$$,
  'admin can insert for any writer');

select lives_ok(
  $$update pricing_items set amount = 25000
    where id = '00000000-0000-0000-0000-000000000045'$$,
  'admin can update any row');

set local role postgres;
select is(
  (select amount from pricing_items where id = '00000000-0000-0000-0000-000000000045'),
  25000,
  'admin update actually persisted');

-- check constraints (postgres として実行 - constraint violations は RLS 到達前に発火)
select throws_ok(
  $$insert into pricing_items (writer_id, label, unit, amount)
    values ('00000000-0000-0000-0000-000000000041', '', '1本', 100)$$,
  '23514',
  null,
  'empty label is rejected by check constraint');

select throws_ok(
  $$insert into pricing_items (writer_id, label, unit, amount)
    values ('00000000-0000-0000-0000-000000000041', 'マイナス', '1本', -1)$$,
  '23514',
  null,
  'negative amount is rejected by check constraint');

select * from finish();
rollback;
