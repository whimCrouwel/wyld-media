begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b2', 'body-blocks-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b2', 'writer', 'body-blocks-writer', 'BB');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'yt', 'youtube-embed',
      '[{"type":"embed","attrs":{"url":"https://www.youtube.com/watch?v=abc","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'youtube embed is allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'evil', 'evil-embed',
      '[{"type":"embed","attrs":{"url":"https://evil.example/embed/1","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'P0001', 'EMBED_HOST_NOT_ALLOWED', 'disallowed embed host is rejected'
);

-- youtube.com(wwwなし)はDBトリガーとdetectEmbedProviderの両方で意図的に非許可
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'bare', 'bare-youtube',
      '[{"type":"embed","attrs":{"url":"https://youtube.com/watch?v=abc","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'P0001', 'EMBED_HOST_NOT_ALLOWED', 'bare youtube.com without www is rejected'
);

select * from finish();
rollback;
