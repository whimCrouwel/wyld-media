-- 20260724100200 で入れた max_distance=0.5 が厳しすぎ、キーワードが本文と
-- 一致しない自然文クエリで本来ヒットすべき記事まで除外していた(偽陰性)。
--
-- 実測(text-embedding-3-small, Chrome での検索結果確認 + 実embedding比較):
-- クエリ「森林保全の取り組み」と記事「企業の森づくり最前線」
-- (本文「フォレスト再生機構の活動を取材した」)の距離 = 0.5331。
-- 意味的に明確に関連する内容だが、0.5 のカットオフでベクトル側から
-- 完全に除外され、キーワード一致もないため検索結果が0件になっていた。
--
-- 暫定対応として閾値を 0.6 に緩める(20260724100200 で報告された「海」検索の
-- 誤ヒット時の距離 0.62〜0.79 はまだ弾ける一方、上記の偽陰性は救える)。
drop function if exists public.search_articles_hybrid(extensions.vector, text, int, double precision);

create function public.search_articles_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  match_count int default 10,
  max_distance double precision default 0.6
)
returns table (
  article_id uuid,
  slug text,
  title text,
  excerpt_html text,
  author_name text,
  author_slug text,
  region text,
  score double precision
)
language sql
stable
as $$
  with vector_ranked as (
    select
      pc.id as chunk_id,
      pc.article_id,
      row_number() over (order by pc.embedding <=> query_embedding) as rnk
    from public.post_chunks pc
    join public.articles a on a.id = pc.article_id
    where a.status = 'published'
      and not a.moderation_hold
      and pc.embedding is not null
      and (pc.embedding <=> query_embedding) < max_distance
    order by pc.embedding <=> query_embedding
    limit 50
  ),
  fulltext_ranked as (
    select
      pc.id as chunk_id,
      pc.article_id,
      row_number() over (
        order by extensions.pgroonga_score(pc.tableoid, pc.ctid) desc
      ) as rnk
    from public.post_chunks pc
    join public.articles a on a.id = pc.article_id
    where a.status = 'published' and not a.moderation_hold and pc.content &@~ query_text
    order by extensions.pgroonga_score(pc.tableoid, pc.ctid) desc
    limit 50
  ),
  fused as (
    select
      coalesce(v.chunk_id, f.chunk_id) as chunk_id,
      coalesce(v.article_id, f.article_id) as article_id,
      coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0) as rrf_score
    from vector_ranked v
    full outer join fulltext_ranked f on f.chunk_id = v.chunk_id
  ),
  best_chunk as (
    select distinct on (article_id)
      article_id, chunk_id, rrf_score
    from fused
    order by article_id, rrf_score desc
  )
  select
    a.id as article_id,
    a.slug,
    a.title,
    extensions.pgroonga_highlight_html(
      pc.content,
      extensions.pgroonga_query_extract_keywords(query_text)
    ) as excerpt_html,
    p.name as author_name,
    p.slug as author_slug,
    a.region,
    bc.rrf_score as score
  from best_chunk bc
  join public.post_chunks pc on pc.id = bc.chunk_id
  join public.articles a on a.id = bc.article_id
  join public.profiles p on p.id = a.author_id
  order by bc.rrf_score desc
  limit match_count;
$$;

revoke execute on function public.search_articles_hybrid(extensions.vector, text, int, double precision)
  from public, anon, authenticated;
grant execute on function public.search_articles_hybrid(extensions.vector, text, int, double precision)
  to service_role;
