begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_function('public', 'search_articles_hybrid', 'search_articles_hybrid function exists');

-- 1536次元ベクトルを2つの次元の重みだけで組み立てるテスト専用ヘルパ
-- (トランザクション終了で自動的に破棄される)。完全に同一の距離を持つ
-- ベクトル同士(row_numberのタイブレークが処理系依存になる)を避けるため、
-- クエリ・A・C・Bの4本を「一致度が段階的に下がる」よう明確に距離を離して作る:
--   query/A = blend(1,1, 2,0)      距離0(完全一致)
--   C       = blend(1,0.5, 2,0.5) 距離が中間(Aより明確に遠く、Bより明確に近い)
--   B       = blend(1,0, 2,1)     距離1(直交、最も遠い)
create function pg_temp.blend(dim_a int, weight_a numeric, dim_b int, weight_b numeric)
returns extensions.vector as $$
  select ('[' || string_agg(
    (case when g = dim_a then weight_a when g = dim_b then weight_b else 0 end)::text, ','
  ) || ']')::extensions.vector(1536)
  from generate_series(1, 1536) g;
$$ language sql;

-- A/B/Cは各々別著者にする: enforce_publish_rulesのPOST_INTERVAL_NOT_ELAPSED
-- (同一著者の通常投稿は連続公開できない)は本RPCのランキングロジックとは
-- 無関係な制約なので、フィクスチャが偶発的にそれへ抵触しないよう回避する。
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'search-writer-a@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'search-writer-b@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'search-writer-c@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'writer', 'search-writer-a', 'SWA'),
  ('00000000-0000-0000-0000-0000000000e2', 'writer', 'search-writer-b', 'SWB'),
  ('00000000-0000-0000-0000-0000000000e3', 'writer', 'search-writer-c', 'SWC');

-- A: ベクトルもキーワードも一致(両方で強くヒット)。2チャンク(dedup検証も兼ねる)
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ記事A', 'kawauso-a',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a1', 0, '', 'カワウソの生態について解説する記事です', 20,
   pg_temp.blend(1, 1, 2, 0)),
  ('00000000-0000-0000-0000-0000000000a1', 1, '', 'カワウソの別の話題です', 15,
   pg_temp.blend(1, 1, 2, 0));

-- B: キーワードのみ一致、ベクトルは最も無関係(直交)
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2',
   'カワウソ記事B', 'kawauso-b',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a2', 0, '', 'カワウソに関する重要な情報です', 15,
   pg_temp.blend(1, 0, 2, 1));

-- C: ベクトルのみ中程度に一致、キーワードは無関係
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e3',
   '無関係記事C', 'unrelated-c',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a3', 0, '', '全く関係ない話題の記事です', 15,
   pg_temp.blend(1, 0.5, 2, 0.5));

-- D: 下書き。ベクトルもキーワードも強一致だが published ではないので絶対に出ない
insert into articles (id, author_id, title, slug, body, status) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ下書きD', null, '[{"type":"paragraph"}]'::jsonb, 'draft');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a4', 0, '', 'カワウソの下書き記事です', 15,
   pg_temp.blend(1, 1, 2, 0));

select is(
  (select array_agg(slug order by score desc)
   from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)),
  array['kawauso-a', 'kawauso-b', 'unrelated-c'],
  'A(両方一致)が最上位、B(キーワードのみ)・C(ベクトルのみ中程度)が続く'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
   where slug = 'kawauso-a'),
  1,
  'Aは2チャンクマッチしても記事単位で1行にdedupされる'
);

select ok(
  not exists (
    select 1 from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
    where article_id = '00000000-0000-0000-0000-0000000000a4'
  ),
  '下書き記事D(ベクトル・キーワードとも強一致)はpublishedでないため結果に含まれない'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)),
  3,
  '下書きDを除いた3記事だけが返る'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 1)),
  1,
  'match_countで件数を絞れる'
);

select * from finish();
rollback;
