import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  getClientToken, getLocalBookmarks, isBookmarkedLocal,
  toggleBookmark, fetchBookmarkCount, fetchTopBookmarkedArticles,
} from '../src/lib/bookmarks';

// --- localStorage の純粋ロジック(mock Storage) ---

function mockStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('bookmarks localStorage helpers', () => {
  it('getClientToken は生成して永続化し、次回は同じ値を返す', () => {
    const s = mockStorage();
    const first = getClientToken(s);
    expect(first).toBeTruthy();
    expect(getClientToken(s)).toBe(first);
  });

  it('getLocalBookmarks は壊れた値でも空配列を返す', () => {
    expect(getLocalBookmarks(mockStorage({ wm_bookmarks: 'not-json' }))).toEqual([]);
    expect(getLocalBookmarks(mockStorage())).toEqual([]);
  });

  it('isBookmarkedLocal は保存済みの記事だけ true', () => {
    const s = mockStorage({ wm_bookmarks: JSON.stringify(['a', 'b']) });
    expect(isBookmarkedLocal('a', s)).toBe(true);
    expect(isBookmarkedLocal('c', s)).toBe(false);
  });
});

// --- サーバー(ローカルSupabase・anon key + RLS/RPC) ---

describe('bookmarks server (RPC / view)', () => {
  const serviceClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const anonClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const TEST_TOKEN = 'vitest-bookmark-token-0001';
  let publishedId: string;
  let publishedSlug: string;
  let draftId: string;

  beforeAll(async () => {
    const pub = await serviceClient
      .from('articles').select('id, slug').eq('status', 'published').not('slug', 'is', null).limit(1).single();
    if (pub.error) throw pub.error;
    publishedId = pub.data.id;
    publishedSlug = pub.data.slug;

    const draft = await serviceClient
      .from('articles').select('id').eq('status', 'draft').limit(1).single();
    if (draft.error) throw draft.error;
    draftId = draft.data.id;

    // 前回の残骸を掃除
    await serviceClient.from('article_bookmarks').delete().eq('client_token', TEST_TOKEN);
  });

  afterAll(async () => {
    await serviceClient.from('article_bookmarks').delete().eq('client_token', TEST_TOKEN);
  });

  it('公開記事を toggle すると保存数が+1され、localStorageに記録される', async () => {
    const storage = mockStorage({ wm_bookmark_token: TEST_TOKEN });
    const before = await fetchBookmarkCount(anonClient, publishedId);

    const r1 = await toggleBookmark(anonClient, publishedId, storage);
    expect(r1.bookmarked).toBe(true);
    expect(r1.count).toBe(before + 1);
    expect(isBookmarkedLocal(publishedId, storage)).toBe(true);
    expect(await fetchBookmarkCount(anonClient, publishedId)).toBe(before + 1);
  });

  it('もう一度 toggle すると外れて保存数が元に戻る', async () => {
    const storage = mockStorage({ wm_bookmark_token: TEST_TOKEN });
    const before = await fetchBookmarkCount(anonClient, publishedId);
    const r = await toggleBookmark(anonClient, publishedId, storage);
    expect(r.bookmarked).toBe(false);
    expect(r.count).toBe(before - 1);
    expect(isBookmarkedLocal(publishedId, storage)).toBe(false);
  });

  it('ランキングに保存した公開記事が現れる', async () => {
    const storage = mockStorage({ wm_bookmark_token: TEST_TOKEN });
    await toggleBookmark(anonClient, publishedId, storage);
    const top = await fetchTopBookmarkedArticles(anonClient, 30, 20);
    expect(top.some((a) => a.slug === publishedSlug)).toBe(true);
    // 後始末
    await toggleBookmark(anonClient, publishedId, storage);
  });

  it('下書き記事はブックマークできない(RPCが拒否)', async () => {
    const storage = mockStorage({ wm_bookmark_token: TEST_TOKEN });
    await expect(toggleBookmark(anonClient, draftId, storage)).rejects.toThrow();
  });

  it('anon は base テーブルを直接読めない', async () => {
    const { error } = await anonClient.from('article_bookmarks').select('id').limit(1);
    expect(error).not.toBeNull();
  });
});
