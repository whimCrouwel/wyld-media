begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

-- reference-style image: marked/CommonMark resolves this to a real <img>,
-- but the inline-only regex used to miss it entirely and let it through.
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'ref', 'ref-style-image',
      $md$![x][1]

[1]: https://evil.example/t.gif$md$, 'draft')$$,
  'P0001', 'IMAGE_SYNTAX_NOT_ALLOWED', 'reference-style image is rejected'
);

-- shortcut image: same bypass risk as reference-style, just without an
-- explicit label.
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'shortcut', 'shortcut-image',
      '![x]', 'draft')$$,
  'P0001', 'IMAGE_SYNTAX_NOT_ALLOWED', 'shortcut image is rejected'
);

-- angle-bracket destination is valid CommonMark and must not be rejected
-- just because the capture happens to include the < > characters.
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'angle', 'angle-bracket-image',
      '![a](<https://img.test/x.webp>)', 'draft')$$,
  'angle-bracket in-base image is allowed'
);

-- UPDATE path: rewriting an existing article's body to exceed the image
-- limit must be caught the same way an INSERT would be.
select throws_ok(
  $$update articles set body =
      '![](https://img.test/a.webp) ![](https://img.test/b.webp) ![](https://img.test/c.webp) ![](https://img.test/d.webp) ![](https://img.test/e.webp) ![](https://img.test/f.webp)'
    where slug = 'five-images'$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'updating body past the image limit is rejected'
);

update settings set image_base_url = '' where id = 1;
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'unset', 'unset-base',
      '![](https://img.test/a.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'empty image_base_url rejects all images'
);

-- UPDATE path, unchanged body: after a host rotation (image_base_url now
-- ''), the article whose body still references the old host must remain
-- editable in every field except body itself -- this is the remediation
-- path that lets an admin fix title/status without being locked out.
select lives_ok(
  $$update articles set title = 'renamed' where slug = 'five-images'$$,
  'updating a non-body column leaves a stale-host body untouched'
);

select * from finish();
rollback;
