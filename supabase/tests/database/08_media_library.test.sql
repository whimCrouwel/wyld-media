begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

select * from finish();
rollback;
