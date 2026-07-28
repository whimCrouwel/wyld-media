begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function('public', 'delete_orphaned_media', array['int'],
  'delete_orphaned_media function exists');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'orphan-writer@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'orphan-provider@test.local');
insert into profiles (id, role, slug, name, avatar_url, cover_image_url) values
  ('00000000-0000-0000-0000-0000000000d1', 'writer', 'orphan-writer', 'W',
   'https://img.test/00000000-0000-0000-0000-0000000000d1/prof-avatar.webp',
   'https://img.test/00000000-0000-0000-0000-0000000000d1/prof-cover.webp');
insert into profiles (id, role, slug, name, service_image_url) values
  ('00000000-0000-0000-0000-0000000000d2', 'provider', 'orphan-provider', 'P',
   'https://img.test/00000000-0000-0000-0000-0000000000d2/prof-service.webp');

-- 参照の全種類を1つずつ用意する: 記事カバー・本文画像・本文ファイル・
-- interview話者アバター・プロフィールのアバター/カバー/サービス画像。
-- すべて10日前作成(グレース期間168hを確実に超えている)= 「参照だけが命綱」。
insert into media (owner_id, url, bytes, created_at)
select '00000000-0000-0000-0000-0000000000d1', u, 10, now() - interval '10 days'
from unnest(array[
  'https://img.test/00000000-0000-0000-0000-0000000000d1/cover.webp',
  'https://img.test/00000000-0000-0000-0000-0000000000d1/body-img.webp',
  'https://img.test/00000000-0000-0000-0000-0000000000d1/body-file.pdf',
  'https://img.test/00000000-0000-0000-0000-0000000000d1/iv-avatar.webp',
  'https://img.test/00000000-0000-0000-0000-0000000000d1/prof-avatar.webp',
  'https://img.test/00000000-0000-0000-0000-0000000000d1/prof-cover.webp'
]) as u;
insert into media (owner_id, url, bytes, created_at) values
  ('00000000-0000-0000-0000-0000000000d2',
   'https://img.test/00000000-0000-0000-0000-0000000000d2/prof-service.webp',
   10, now() - interval '10 days');

-- 孤立2種: 10日前(削除対象)と1時間前(グレース期間内なので残る)
insert into media (owner_id, url, bytes, created_at) values
  ('00000000-0000-0000-0000-0000000000d1',
   'https://img.test/00000000-0000-0000-0000-0000000000d1/orphan-old.webp',
   999, now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000000d1',
   'https://img.test/00000000-0000-0000-0000-0000000000d1/orphan-new.webp',
   10, now() - interval '1 hour');

insert into articles (author_id, title, cover_image_url, body) values
  ('00000000-0000-0000-0000-0000000000d1', 'uses everything',
   'https://img.test/00000000-0000-0000-0000-0000000000d1/cover.webp',
   $j$[
     {"type":"image","attrs":{"url":"https://img.test/00000000-0000-0000-0000-0000000000d1/body-img.webp"}},
     {"type":"file","attrs":{"url":"https://img.test/00000000-0000-0000-0000-0000000000d1/body-file.pdf","filename":"doc.pdf"}},
     {"type":"interview","attrs":{"speakers":[
       {"key":"A","name":"聞き手","role":"","avatarUrl":"https://img.test/00000000-0000-0000-0000-0000000000d1/iv-avatar.webp"},
       {"key":"B","name":"答え手","role":"","avatarUrl":"https://img.test/b.webp"}
     ]},"content":[
       {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
       {"type":"turn","attrs":{"speaker":"B"},"content":[{"type":"text","text":"y"}]}
     ]}
   ]$j$::jsonb);

-- 24時間未満のグレース指定は拒否される
select throws_ok(
  $$select * from public.delete_orphaned_media(1)$$,
  'P0001', 'GRACE_TOO_SHORT', 'grace shorter than 24h is rejected'
);

-- 削除されるのは「10日前の孤立」だけ。URL と(R2削除用の)キーが返る
select results_eq(
  $$select url, key from public.delete_orphaned_media()$$,
  $$values ('https://img.test/00000000-0000-0000-0000-0000000000d1/orphan-old.webp',
            '00000000-0000-0000-0000-0000000000d1/orphan-old.webp')$$,
  'only the old orphan is deleted, returning url and derived R2 key'
);

select is(
  (select count(*) from media
    where url = 'https://img.test/00000000-0000-0000-0000-0000000000d1/orphan-old.webp')::int,
  0, 'the old orphan media row is gone'
);

-- 参照されている7件 + グレース期間内の1件 = 8件が無傷で残る
select is(
  (select count(*) from media where owner_id in
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2'))::int,
  8, 'all referenced media and the fresh orphan survive'
);

-- 再実行しても何も返らない(冪等)
select is_empty(
  $$select * from public.delete_orphaned_media()$$,
  'second run deletes nothing'
);

-- 一般ユーザーは実行できない(Edge Function = service_role 専用)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select * from public.delete_orphaned_media()$$,
  '42501', null, 'authenticated users cannot execute delete_orphaned_media'
);

select throws_ok(
  $$select public.invoke_cleanup_orphaned_media()$$,
  '42501', null, 'authenticated users cannot execute invoke_cleanup_orphaned_media'
);

-- cron のラッパーは Vault 未設定の環境では静かにスキップする(エラーにしない)
set local role postgres;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$select public.invoke_cleanup_orphaned_media()$$,
  'invoke wrapper skips quietly when vault secrets are absent'
);

select * from finish();
rollback;
