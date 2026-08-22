-- 読者による匿名ブックマーク機能。
--
-- 読者はログインしない。各ブラウザが localStorage にランダムな client_token を持ち、
-- それを鍵にブックマークを付け外しする。ライターのモチベーション向上のため、記事の
-- 保存数を公開サイト・CMS に表示し、左カラムに「よく保存されている記事」ランキングを出す。
--
-- 匿名なので token を量産すれば水増しは可能(監査レベルの正確さは無い)。賞金のない
-- 小規模コミュニティなので許容し、将来 reader アカウント化する際に厳密化する想定。
--
-- 安全設計:
--   * anon に base テーブルの直接 insert/delete/select は一切与えない
--     (anon DELETE を許すと `where true` で全消しできてしまうため)。
--   * 付け外しは SECURITY DEFINER の toggle_bookmark() 経由のみ。渡された token の行だけを
--     操作し、公開記事以外は拒否する。
--   * 数の読み取りは集計ビュー/関数(いずれも生の token を晒さない)を anon に許可する。

create table public.article_bookmarks (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  -- localStorage 由来の不透明なランダム値。空・過大長は弾く。
  client_token text not null check (btrim(client_token) <> '' and length(client_token) <= 100),
  created_at timestamptz not null default now(),
  -- 同じブラウザ(token)が同じ記事を二重にブックマークできないようにする。
  constraint article_bookmarks_unique unique (article_id, client_token)
);

create index article_bookmarks_article_id_idx on public.article_bookmarks (article_id);
create index article_bookmarks_created_at_idx on public.article_bookmarks (created_at);

alter table public.article_bookmarks enable row level security;
-- base テーブルには anon/authenticated 向けのポリシーを一切作らない = 直接アクセス不可。
-- アクセスは全て下記の SECURITY DEFINER 関数・ビュー(owner=postgres は RLS をバイパス)経由。

-- service role は掃除・移行用に直接触れるようにしておく(他テーブルと同じ運用)。
grant select, insert, update, delete on public.article_bookmarks to service_role;

-- 記事単位の保存数(全期間)。生の行を晒さず件数だけを見せる集計ビュー。
-- owner(postgres)権限で実行されるため、base テーブルの RLS をバイパスして全件を数える。
create view public.article_bookmark_counts as
  select article_id, count(*)::int as bookmark_count
  from public.article_bookmarks
  group by article_id;

grant select on public.article_bookmark_counts to anon, authenticated;

-- ブックマークの付け外し(トグル)。渡された token の行だけを対象にする。
-- 公開記事以外は拒否。サーバー側の行の有無を正として、付いたか(bookmarked)と
-- その記事の最新の保存数(bookmark_count)を返す。クライアントは localStorage を
-- この戻り値に合わせて同期する(サーバーを唯一の真実にして desync を防ぐ)。
create or replace function public.toggle_bookmark(a_id uuid, p_token text)
returns table (bookmarked boolean, bookmark_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  did_bookmark boolean;
begin
  if btrim(coalesce(p_token, '')) = '' or length(p_token) > 100 then
    raise exception 'invalid client_token';
  end if;
  if not exists (select 1 from articles where id = a_id and status = 'published') then
    raise exception 'article is not bookmarkable';
  end if;

  select id into existing
  from article_bookmarks
  where article_id = a_id and client_token = p_token;

  if existing is not null then
    delete from article_bookmarks where id = existing;
    did_bookmark := false;
  else
    insert into article_bookmarks (article_id, client_token) values (a_id, p_token);
    did_bookmark := true;
  end if;

  return query
    select did_bookmark,
           (select count(*)::int from article_bookmarks where article_id = a_id);
end;
$$;

grant execute on function public.toggle_bookmark(uuid, text) to anon, authenticated;

-- 左カラムのランキング用: 直近 p_days 日でよく保存された公開記事を上位 p_lim 件。
-- 公開記事の公開フィールド(slug/title)＋件数だけを返す。
create or replace function public.top_bookmarked_articles(p_days int default 30, p_lim int default 5)
returns table (slug text, title text, bookmark_count int)
language sql
stable
security definer
set search_path = public
as $$
  select a.slug, a.title, count(b.id)::int as bookmark_count
  from article_bookmarks b
  join articles a on a.id = b.article_id and a.status = 'published'
  where b.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by a.slug, a.title
  order by count(b.id) desc, max(b.created_at) desc
  limit greatest(p_lim, 1);
$$;

grant execute on function public.top_bookmarked_articles(int, int) to anon, authenticated;
