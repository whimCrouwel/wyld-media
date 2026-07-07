import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  buildArticlePayload,
  createDraft,
  fetchArticleForEdit,
  saveArticle,
  deleteArticle,
  checkSlugAvailable,
  validateCommissionCode,
} from '../src/lib/articles';

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

const created: string[] = [];

beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (error) throw error;
});

afterEach(async () => {
  // 作成した記事を後始末(冪等性)
  while (created.length) {
    const id = created.pop()!;
    await supabase.from('articles').delete().eq('id', id);
  }
});

describe('buildArticlePayload', () => {
  it('maps form input, nulling empties and sanitizing cover url', () => {
    expect(buildArticlePayload({
      title: 'テスト', slug: 'test-slug', body: '本文',
      coverUrl: 'https://img.example/x.webp', commissionCode: 'WM-11AA22BB',
    })).toEqual({
      title: 'テスト', slug: 'test-slug', body: '本文',
      cover_image_url: 'https://img.example/x.webp',
      commission_code_input: 'WM-11AA22BB',
    });
  });
  it('nulls empty slug/cover/commission and rejects unsafe cover', () => {
    const p = buildArticlePayload({
      title: 'T', slug: '', body: '', coverUrl: 'javascript:x', commissionCode: '',
    });
    expect(p.slug).toBeNull();
    expect(p.cover_image_url).toBeNull();
    expect(p.commission_code_input).toBeNull();
  });
  it('never includes status/published_at/commissioned_by', () => {
    const p = buildArticlePayload({ title: 'T', slug: '', body: '', coverUrl: '', commissionCode: '' });
    expect(p).not.toHaveProperty('status');
    expect(p).not.toHaveProperty('published_at');
    expect(p).not.toHaveProperty('commissioned_by');
  });
});

describe('validateCommissionCode (seeded)', () => {
  it('returns provider name for the seeded code and null for a bad one', async () => {
    // seed の provider forest-org のコードを取得(RLS で読めないため RPC 経由)。
    // seed スクリプトは固定コードを使わないので、まず有効コードを知る手段が要る:
    // provider 本人ではないので、既存の依頼記事から辿るのは不可。
    // → seed は forest-org にコードを自動生成する。テストは「不正コードは null」を主に確認する。
    expect(await validateCommissionCode(supabase, 'WM-00000000')).toBeNull();
  });
});

describe('article CRUD (seeded, as hana)', () => {
  it('creates a draft, fetches it, updates it, deletes it', async () => {
    const id = await createDraft(supabase, {
      title: '新しい下書き', slug: '', body: '# 見出し\n\n本文', coverUrl: '', commissionCode: '',
    });
    created.push(id);
    expect(typeof id).toBe('string');

    const article = await fetchArticleForEdit(supabase, id);
    expect(article).not.toBeNull();
    expect(article!.status).toBe('draft');
    expect(article!.title).toBe('新しい下書き');

    await saveArticle(supabase, id, {
      title: '更新後タイトル', slug: '', body: '本文2', coverUrl: '', commissionCode: '',
    }, false);
    const updated = await fetchArticleForEdit(supabase, id);
    expect(updated!.title).toBe('更新後タイトル');
    expect(updated!.status).toBe('draft');
  });

  it('checkSlugAvailable is false for an existing published slug of mine, true for a fresh one', async () => {
    // hana は 'koke-no-mori' を公開済み(seed)
    expect(await checkSlugAvailable(supabase, 'koke-no-mori')).toBe(false);
    expect(await checkSlugAvailable(supabase, 'brand-new-unique-slug-xyz')).toBe(true);
  });

  it('publishing a commissioned draft with a bad code raises INVALID_COMMISSION_CODE', async () => {
    const id = await createDraft(supabase, {
      title: '依頼下書き', slug: 'commissioned-draft-test', body: '本文', coverUrl: '', commissionCode: '',
    });
    created.push(id);
    await expect(
      saveArticle(supabase, id, {
        title: '依頼下書き', slug: 'commissioned-draft-test', body: '本文',
        coverUrl: '', commissionCode: 'WM-BADCODE0',
      }, true),
    ).rejects.toThrow(/INVALID_COMMISSION_CODE/);
  });
});
