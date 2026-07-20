-- 検索結果にライター名と取材地を出す。
-- 最終 SELECT は既に articles を join しているので region は列を足すだけ。
-- ライター名だけ profiles への join が1本増えるが、対象は match_count 件
-- (既定10件)で author_id は FK なので誤差。
--
-- 返り値の列を増やすため create or replace ではなく drop してから作り直す。
drop function if exists public.search_articles_hybrid(extensions.vector, text, int);

create function public.search_articles_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  match_count int default 10
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
    where a.status = 'published' and pc.embedding is not null
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
    where a.status = 'published' and pc.content &@~ query_text
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

revoke execute on function public.search_articles_hybrid(extensions.vector, text, int)
  from public, anon, authenticated;
grant execute on function public.search_articles_hybrid(extensions.vector, text, int)
  to service_role;
