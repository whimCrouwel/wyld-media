import type { SupabaseClient } from '@supabase/supabase-js';

// 読者による匿名ブックマーク。ログイン不要。各ブラウザが localStorage に
// ランダムな client_token を持ち、それを鍵にサーバー側の付け外し(toggle_bookmark RPC)を行う。
// 「自分がブックマークしたか」は localStorage が真実で、サーバーには数だけを問い合わせる。

const TOKEN_KEY = 'wm_bookmark_token';
const LIST_KEY = 'wm_bookmarks';

// --- localStorage(純粋・テスト時は mock Storage を渡す) ---

function generateToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 古い環境向けフォールバック(UUIDでなくてよい。衝突しにくい不透明値であれば十分)。
  return `t_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function getClientToken(storage: Storage): string {
  let token = storage.getItem(TOKEN_KEY);
  if (!token) {
    token = generateToken();
    storage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export function getLocalBookmarks(storage: Storage): string[] {
  try {
    const raw = storage.getItem(LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isBookmarkedLocal(articleId: string, storage: Storage): boolean {
  return getLocalBookmarks(storage).includes(articleId);
}

function setLocalBookmarks(ids: string[], storage: Storage): void {
  storage.setItem(LIST_KEY, JSON.stringify(ids));
}

function addLocalBookmark(articleId: string, storage: Storage): void {
  const ids = getLocalBookmarks(storage);
  if (!ids.includes(articleId)) setLocalBookmarks([...ids, articleId], storage);
}

function removeLocalBookmark(articleId: string, storage: Storage): void {
  setLocalBookmarks(getLocalBookmarks(storage).filter((id) => id !== articleId), storage);
}

// ブックマークが変わったことを島(island)をまたいで知らせるイベント。記事ページの
// ボタンが発火し、左サイドバーの「保存した記事」/「読者に人気」が再描画に使う。
export const BOOKMARKS_CHANGED_EVENT = 'wm:bookmarks-changed';

export function notifyBookmarksChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BOOKMARKS_CHANGED_EVENT));
  }
}

// --- サーバー ---

export interface ToggleResult {
  bookmarked: boolean;
  count: number;
}

// ブックマークを付け外しし、localStorage も同期する。戻り値はサーバー集計後の保存数。
export async function toggleBookmark(
  supabase: SupabaseClient,
  articleId: string,
  storage: Storage,
): Promise<ToggleResult> {
  const token = getClientToken(storage);
  const { data, error } = await supabase.rpc('toggle_bookmark', {
    a_id: articleId,
    p_token: token,
  });
  if (error) throw error;

  // RPC は TABLE を返すので配列の先頭を取る。サーバーの結果(bookmarked)を正として
  // localStorage を同期する — こうすれば localStorage が部分的に消えても desync しない。
  const row = (Array.isArray(data) ? data[0] : data) as
    | { bookmarked: boolean; bookmark_count: number }
    | undefined;
  const bookmarked = row?.bookmarked ?? false;
  if (bookmarked) addLocalBookmark(articleId, storage);
  else removeLocalBookmark(articleId, storage);

  return { bookmarked, count: row?.bookmark_count ?? 0 };
}

// 記事1本の保存数(全期間)。未ブックマークの記事は行が無いので 0 を返す。
export async function fetchBookmarkCount(
  supabase: SupabaseClient,
  articleId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('article_bookmark_counts')
    .select('bookmark_count')
    .eq('article_id', articleId)
    .maybeSingle();
  if (error) throw error;
  return data?.bookmark_count ?? 0;
}

// 複数記事の保存数をまとめて取得(CMSでライターに一覧表示する用)。
export async function fetchBookmarkCounts(
  supabase: SupabaseClient,
  articleIds: string[],
): Promise<Map<string, number>> {
  if (articleIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('article_bookmark_counts')
    .select('article_id, bookmark_count')
    .in('article_id', articleIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.article_id as string, r.bookmark_count as number]));
}

export interface TopBookmarkedArticle {
  slug: string;
  title: string;
  coverImageUrl: string | null;
  bookmarkCount: number;
}

// 左カラムのランキング用: 直近 days 日でよく保存された公開記事の上位 limit 件。
export async function fetchTopBookmarkedArticles(
  supabase: SupabaseClient,
  days = 30,
  limit = 5,
): Promise<TopBookmarkedArticle[]> {
  const { data, error } = await supabase.rpc('top_bookmarked_articles', {
    p_days: days,
    p_lim: limit,
  });
  if (error) throw error;
  return (data ?? []).map(
    (r: { slug: string; title: string; cover_image_url: string | null; bookmark_count: number }) => ({
      slug: r.slug,
      title: r.title,
      coverImageUrl: r.cover_image_url,
      bookmarkCount: r.bookmark_count,
    }),
  );
}

export interface SavedArticle {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string | null;
}

// 「保存した記事」一覧用: localStorage が持つ記事ID群のうち、公開中の記事の
// 公開フィールドを取得する。戻り順はDB任せなので、呼び出し側で localStorage の
// 保存順(新しい順)に並べ替える。存在しない/非公開になったIDは自然に落ちる。
export async function fetchSavedArticles(
  supabase: SupabaseClient,
  ids: string[],
): Promise<SavedArticle[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('bookmarked_articles', { p_ids: ids });
  if (error) throw error;
  const byId = new Map(
    (data ?? []).map((r: { id: string; slug: string; title: string; cover_image_url: string | null }) => [
      r.id,
      { id: r.id, slug: r.slug, title: r.title, coverImageUrl: r.cover_image_url } as SavedArticle,
    ]),
  );
  // localStorage の保存順を保つ(末尾=最近保存を先頭に)。
  return ids
    .slice()
    .reverse()
    .map((id) => byId.get(id))
    .filter((a): a is SavedArticle => a !== undefined);
}
