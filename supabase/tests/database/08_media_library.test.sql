begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select has_table('public', 'media', 'media table exists');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'media-writer1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'media-writer2@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'writer', 'media-writer-one', 'M1'),
  ('00000000-0000-0000-0000-0000000000c2', 'writer', 'media-writer-two', 'M2');

-- writer1 として振る舞う
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp', 1234)$$,
  'writer1 can record own media'
);

select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://evil.example/00000000-0000-0000-0000-0000000000c1/b.webp', 10)$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'media url must live under image_base_url'
);

-- 他人の uid 配下のキーは記録できない(自分の owner_id では所有者不一致になる)
select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://img.test/00000000-0000-0000-0000-0000000000c2/c.webp', 10)$$,
  'P0001', 'MEDIA_OWNER_MISMATCH', 'media key prefix must be the owner uid'
);

-- 他人になりすまして insert はできない(RLS)
select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c2',
            'https://img.test/00000000-0000-0000-0000-0000000000c2/d.webp', 10)$$,
  '42501', null, 'writer1 cannot record media as writer2'
);

-- 未使用なら削除できる
select lives_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp'$$,
  'unused media can be deleted'
);

-- 本文から参照されている画像は削除できない
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp', 10);
insert into articles (author_id, title, body)
values ('00000000-0000-0000-0000-0000000000c1', 'uses image',
        '![](https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp)');

select throws_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'media referenced by an article body cannot be deleted'
);

-- カバー画像として参照されている画像も削除できない
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp', 10);
insert into articles (author_id, title, cover_image_url)
values ('00000000-0000-0000-0000-0000000000c1', 'uses cover',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp');

select throws_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'media used as a cover image cannot be deleted'
);

-- MEDIA_IN_USE は本文中の実際の markdown 画像宛先だけを見るべきで、地の文に
-- URL を書いただけでは「使用中」とみなしてはならない。さもないと、誰でも
-- 他人の公開 URL を自分の記事の本文にただ書くだけで、その画像を永久に
-- 削除不能へ追い込める。
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/phantom.webp', 10);

-- writer2 として振る舞う
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;

insert into articles (author_id, title, body)
values ('00000000-0000-0000-0000-0000000000c2', 'plain prose mention',
  'see the file at https://img.test/00000000-0000-0000-0000-0000000000c1/phantom.webp for reference, not an image');

-- writer1 に戻す
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/phantom.webp'$$,
  'plain-prose mention of a media URL does not block deletion (not a markdown image)'
);

-- admin は MEDIA_IN_USE を越えられる(製品上の復旧経路)。実際に markdown
-- 画像として参照されているメディアでも admin なら削除できることを確認する。
set local role postgres;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c3', 'media-admin@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000c3', 'admin', 'media-admin', 'Admin');

-- writer1 に戻す
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/admin-target.webp', 10);
insert into articles (author_id, title, body)
values ('00000000-0000-0000-0000-0000000000c1', 'admin target image',
        '![](https://img.test/00000000-0000-0000-0000-0000000000c1/admin-target.webp)');

-- admin として振る舞う
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/admin-target.webp'$$,
  'admin can delete media even when referenced by a real markdown image'
);

-- ユーザー削除の cascade(auth.users -> media.owner_id on delete cascade)は
-- MEDIA_IN_USE に阻まれてはならない。さもないと、使用中の画像を持つ書き手を
-- 一切削除できなくなる。
set local role postgres;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c4', 'media-writer4@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000c4', 'writer', 'media-writer-four', 'M4');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
set local role authenticated;

insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c4',
        'https://img.test/00000000-0000-0000-0000-0000000000c4/cascade.webp', 10);
insert into articles (author_id, title, body)
values ('00000000-0000-0000-0000-0000000000c4', 'cascade target',
        '![](https://img.test/00000000-0000-0000-0000-0000000000c4/cascade.webp)');

-- postgres として振る舞う(auth.uid() is null = 信頼済み呼び出し元)
set local role postgres;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000c4'$$,
  'deleting the owning user cascades through in-use media without MEDIA_IN_USE'
);

select is(
  (select count(*) from media
    where url = 'https://img.test/00000000-0000-0000-0000-0000000000c4/cascade.webp')::int,
  0,
  'cascaded media row is gone after the owning user is deleted'
);

-- uid の直後に '/' が来ない偽装キーは拒否されなければならない
-- (base/<own-uid> そのまま、または base/<own-uid>garbage.ext)。
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://img.test/00000000-0000-0000-0000-0000000000c1garbage.webp', 10)$$,
  'P0001', 'MEDIA_OWNER_MISMATCH', 'uid not immediately followed by / is rejected'
);

select * from finish();
rollback;
