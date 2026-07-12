begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public', 'settings', 'image_base_url', 'settings has image_base_url');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'body-image-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b1', 'writer', 'body-image-writer', 'BW');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'five', 'five-images', $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'five body images are allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'six', 'six-images', $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/f.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'six body images are rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'foreign', 'foreign-host',
      '[{"type":"image","attrs":{"url":"https://evil.example/x.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'foreign image host is rejected'
);

-- https://img.test が https://img.test.evil.example に前方一致する抜け道
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'prefix', 'prefix-attack',
      '[{"type":"image","attrs":{"url":"https://img.test.evil.example/x.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'prefix-matching host is rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'file-foreign', 'file-foreign-host',
      '[{"type":"file","attrs":{"url":"https://evil.example/x.pdf","filename":"x.pdf"}}]'::jsonb, 'draft')$$,
  'P0001', 'FILE_HOST_NOT_ALLOWED', 'foreign file host is rejected'
);

-- nested content(リスト項目の中の画像など)も走査対象であることを確認
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'nested', 'nested-image', $j$[
      {"type":"bulletList","content":[
        {"type":"listItem","content":[
          {"type":"image","attrs":{"url":"https://img.test/nested.webp"}}
        ]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'image nested inside a list item is still validated and allowed'
);

-- UPDATE path: 既存記事のbodyを上限超過に書き換えるのも同様に拒否される
select throws_ok(
  $$update articles set body = $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/f.webp"}}
    ]$j$::jsonb
    where slug = 'five-images'$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'updating body past the image limit is rejected'
);

update settings set image_base_url = '' where id = 1;
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'unset', 'unset-base',
      '[{"type":"image","attrs":{"url":"https://img.test/a.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'empty image_base_url rejects all images'
);

-- UPDATE path, unchanged body: ホストローテーション後も body 以外は編集できる
select lives_ok(
  $$update articles set title = 'renamed' where slug = 'five-images'$$,
  'updating a non-body column leaves a stale-host body untouched'
);

select * from finish();
rollback;
