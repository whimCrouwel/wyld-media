begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_column('public', 'settings', 'image_base_url', 'settings has image_base_url');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'body-image-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b1', 'writer', 'body-image-writer', 'BW');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'five', 'five-images',
      '![](https://img.test/a.webp) ![](https://img.test/b.webp) ![](https://img.test/c.webp) ![](https://img.test/d.webp) ![](https://img.test/e.webp)',
      'draft')$$,
  'five body images are allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'six', 'six-images',
      '![](https://img.test/a.webp) ![](https://img.test/b.webp) ![](https://img.test/c.webp) ![](https://img.test/d.webp) ![](https://img.test/e.webp) ![](https://img.test/f.webp)',
      'draft')$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'six body images are rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'foreign', 'foreign-host',
      '![](https://evil.example/x.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'foreign image host is rejected'
);

-- https://img.test が https://img.test.evil.example に前方一致する抜け道
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'prefix', 'prefix-attack',
      '![](https://img.test.evil.example/x.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'prefix-matching host is rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'html', 'html-img',
      '<img src="https://img.test/a.webp">', 'draft')$$,
  'P0001', 'HTML_IMG_NOT_ALLOWED', 'raw <img> tag is rejected'
);

update settings set image_base_url = '' where id = 1;
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'unset', 'unset-base',
      '![](https://img.test/a.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'empty image_base_url rejects all images'
);

select * from finish();
rollback;
