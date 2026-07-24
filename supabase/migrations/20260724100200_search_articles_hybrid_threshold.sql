-- 検索で無関係な記事が上位に混ざる問題を修正する。
--
-- 問題:vector CTE は kNN で常に上位50件を返すため、コーパスが小さいとき
-- (=公開記事が少ないとき)、クエリと意味的に無関係な記事まで rank に載って
-- RRF スコアを稼いでしまう。例:seed の "海" 検索で 川辺/苔の森/野鳥観察 が
-- 上位に出た(意味的距離 0.62〜0.79)。
--
-- 修正:vector CTE に cosine distance の閾値 max_distance を入れて、
-- 「そもそも無関係な距離のチャンクは vector 側から除外する」。fulltext 側は
-- pgroonga の &@~ が既に暗黙の閾値(キーワードが実際に含まれる)を持つので
-- そちら側の変更は不要。
--
-- 既定値 0.5 の根拠:text-embedding-3-small では意味的に近い〜中程度の関連は
-- 概ね < 0.5、明確に別トピックは > 0.6 に落ちる傾向。seed 実測でも
-- 海岸清掃を基準にした「関連なし」記事は 0.62 以上に離れていた。
drop function if exists public.search_articles_hybrid(extensions.vector, text, int);

create function public.search_articles_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  match_count int default 10,
  max_distance double precision default 0.5
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
