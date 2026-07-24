begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('00000000-0000-0000-0000-0000000000e3', 'search-writer-c@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', 'search-writer-e@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'writer', 'search-writer-a', 'SWA'),
  ('00000000-0000-0000-0000-0000000000e2', 'writer', 'search-writer-b', 'SWB'),
  ('00000000-0000-0000-0000-0000000000e3', 'writer', 'search-writer-c', 'SWC'),
  ('00000000-0000-0000-0000-0000000000e4', 'writer', 'search-writer-e', 'SWE');

-- A: ベクトルもキーワードも一致(両方で強くヒット)。2チャンク(dedup検証も兼ねる)
insert into articles (id, author_id, title, slug, body, status, published_at, region) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ記事A', 'kawauso-a',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now(), '関東');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a1', 0, '', 'カワウソの生態について解説する記事です', 20,
   pg_temp.blend(1, 1, 2, 0)),
  ('00000000-0000-0000-0000-0000000000a1', 1, '', 'カワウソの別の話題です', 15,
   pg_temp.blend(1, 1, 2, 0));

-- B: キーワードのみ一致、ベクトルは最も無関係(直交)
insert into articles (id, author_id, title, slug, body, status, published_at, region) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2',
   'カワウソ記事B', 'kawauso-b',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now(), '関東');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a2', 0, '', 'カワウソに関する重要な情報です', 15,
   pg_temp.blend(1, 0, 2, 1));

-- C: ベクトルのみ中程度に一致(cosine distance ≈ 0.293、既定閾値0.5より内側)、キーワードは無関係
insert into articles (id, author_id, title, slug, body, status, published_at, region) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e3',
   '無関係記事C', 'unrelated-c',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now(), '関東');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a3', 0, '', '全く関係ない話題の記事です', 15,
   pg_temp.blend(1, 0.5, 2, 0.5));

-- F: ベクトルは中程度〜遠い(cosine distance ≈ 0.5527、既定閾値0.5の外側)、
--    キーワードもヒットしない。閾値によって vector 側から確実に落ちる。
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e5', 'search-writer-f@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e5', 'writer', 'search-writer-f', 'SWF');
insert into articles (id, author_id, title, slug, body, status, published_at, region) values
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000e5',
   '離れた記事F', 'far-f',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, 'published', now(), '関東');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a6', 0, '', '別ジャンルの話題です', 15,
   pg_temp.blend(1, 0.3, 2, 0.7));

-- D: 下書き。ベクトルもキーワードも強一致だが published ではないので絶対に出ない
insert into articles (id, author_id, title, slug, body, status) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ下書きD', null, '[{"type":"paragraph"}]'::jsonb, 'draft');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a4', 0, '', 'カワウソの下書き記事です', 15,
   pg_temp.blend(1, 1, 2, 0));

-- E: 公開済みだが審査ホールド中。ベクトルもキーワードも強一致だが出てはいけない
insert into articles (id, author_id, title, slug, body, status, published_at, region, moderation_hold) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e4',
   'カワウソ審査中E', 'kawauso-e',
   '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb,
   'published', now(), '関東', true);
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a5', 0, '', 'カワウソの審査中記事です', 15,
   pg_temp.blend(1, 1, 2, 0));

select is(
  (select slug
   from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
   order by score desc
   limit 1),
  'kawauso-a',
  'A(両方一致)が最上位に来る'
);

-- B(キーワードのみ、ベクトルは閾値外なので落ちる)と C(ベクトルのみ中程度、
-- キーワードは無関係)は片方だけの寄与で RRF スコアが同点になるので、
-- 順序ではなく「どちらも A に次ぐ結果として含まれる」ことを検証する。
select bag_eq(
  $$select slug from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)$$,
  $$values ('kawauso-a'), ('kawauso-b'), ('unrelated-c')$$,
  'A(両方一致)・B(キーワードのみ)・C(ベクトル中程度)の3記事が返る'
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

select ok(
  not exists (
    select 1 from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
    where article_id = '00000000-0000-0000-0000-0000000000a5'
  ),
  '審査ホールド中の記事E(published・強一致)はmoderation_holdのため結果に含まれない'
);

-- 閾値の効果:F はベクトル距離 ≈ 0.606 で既定閾値 0.5 の外側、かつキーワードもヒットしない。
select ok(
  not exists (
    select 1 from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
    where article_id = '00000000-0000-0000-0000-0000000000a6'
  ),
  '離れた記事F(ベクトル距離が既定閾値0.5より遠く、キーワードも無関係)は結果に含まれない'
);

-- 閾値を緩めれば F が拾えるようになることも確認(=閾値が実際に効いていることの背理)。
select ok(
  exists (
    select 1 from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10, 1.0)
    where article_id = '00000000-0000-0000-0000-0000000000a6'
  ),
  'max_distanceを1.0まで緩めると F がベクトル側で拾われる'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)),
  3,
  '下書きD・ホールドE・閾値外Fを除いた3記事だけが返る'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 1)),
  1,
  'match_countで件数を絞れる'
);

select * from finish();
rollback;
