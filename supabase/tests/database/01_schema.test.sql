begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'avatar_url', 'profiles has avatar_url');
select has_column('public', 'profiles', 'location', 'profiles has location');
select has_column('public', 'profiles', 'region', 'profiles has region');
select has_column('public', 'profiles', 'cover_image_url', 'profiles has cover_image_url');
select has_column('public', 'profiles', 'service_name', 'profiles has service_name');
select has_column('public', 'profiles', 'service_description', 'profiles has service_description');
select has_column('public', 'profiles', 'service_url', 'profiles has service_url');
select has_column('public', 'profiles', 'service_image_url', 'profiles has service_image_url');
select has_column('public', 'profiles', 'certified', 'profiles has certified');

select has_table('public', 'articles', 'articles table exists');
select has_column('public', 'articles', 'region', 'articles has region');

select has_table('public', 'settings', 'settings table exists');
select has_column('public', 'settings', 'page_size', 'settings has page_size');
select has_column('public', 'settings', 'commission_interval_days', 'settings has commission_interval_days');
select has_column('public', 'settings', 'featured_window_days', 'settings has featured_window_days');

select throws_ok(
  $$update settings set page_size = 0 where id = 1$$,
  '23514', null, 'page_size must be at least 1'
);

select results_eq(
  'select post_interval_days, featured_count, commission_interval_days, featured_window_days from settings where id = 1',
  $$values (10, 3, 10, 14)$$,
  'settings has initial row with defaults'
);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000000a', 'schema-writer@test.local');

select throws_ok(
  $$insert into profiles (id, role, slug, name)
    values ('00000000-0000-0000-0000-00000000000a', 'writer', 'Bad_Slug!', 'W')$$,
  '23514', null, 'profile slug format is enforced'
);

insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-00000000000a', 'writer', 'schema-writer', 'W');

select throws_ok(
  $$update profiles set region = '中部'
    where id = '00000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'profile region must be one of the 12 areas'
);

select lives_ok(
  $$update profiles set region = '甲信越'
    where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a valid region is accepted'
);

select throws_ok(
  $$insert into articles (author_id, slug, title)
    values ('00000000-0000-0000-0000-00000000000a', 'Bad Slug', 't')$$,
  '23514', null, 'article slug format is enforced'
);

select throws_ok(
  $$insert into articles (author_id, status, published_at, title, body)
    values ('00000000-0000-0000-0000-00000000000a', 'published', now(), 't',
      '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb)$$,
  '23514', null, 'published article requires slug'
);

select lives_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-00000000000a', 'draft without slug')$$,
  'draft without slug is allowed'
);

select throws_ok(
  $$insert into articles (author_id, slug, title, region)
    values ('00000000-0000-0000-0000-00000000000a', 'bad-region', 't', '中部')$$,
  '23514', null, 'article region must be one of the 12 areas'
);

-- 下書きは取材地なしで保存できる。公開だけが必須。
select throws_ok(
  $$insert into articles (author_id, status, published_at, slug, title, body)
    values ('00000000-0000-0000-0000-00000000000a', 'published', now(), 'no-region', 't',
      '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb)$$,
  '23514', null, 'published article requires region'
);

select is(
  (select count(*) from articles
    where author_id = '00000000-0000-0000-0000-00000000000a')::int,
  1, 'draft row inserted'
);

select * from finish();
rollback;
