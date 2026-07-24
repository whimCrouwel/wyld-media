import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  buildArticlePayload,
  createDraft,
  fetchArticleForEdit,
  saveArticle,
  deleteArticle,
  checkSlugAvailable,
  validateCommissionToken,
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
    await deleteArticle(supabase, id);
  }
});

describe('buildArticlePayload', () => {
  it('maps form input, nulling empties and sanitizing cover url', () => {
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }];
    expect(buildArticlePayload({
      title: 'テスト', slug: 'test-slug', body,
      coverUrl: 'https://img.example/x.webp', commissionToken: 'WM-11AA22BB', region: '関東',
    })).toEqual({
      title: 'テスト', slug: 'test-slug', body,
      cover_image_url: 'https://img.example/x.webp',
      commission_token_input: 'WM-11AA22BB',
      region: '関東',
    });
  });
  it('nulls empty slug/cover/commission and rejects unsafe cover', () => {
    const p = buildArticlePayload({
      title: 'T', slug: '', body: [], coverUrl: 'javascript:x', commissionToken: '', region: '関東',
    });
    expect(p.slug).toBeNull();
    expect(p.cover_image_url).toBeNull();
    expect(p.commission_token_input).toBeNull();
  });
  it('never includes status/published_at/commissioned_by', () => {
    const p = buildArticlePayload({
      title: 'T', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
    });
    expect(p).not.toHaveProperty('status');
    expect(p).not.toHaveProperty('published_at');
    expect(p).not.toHaveProperty('commissioned_by');
  });

  it('取材地を payload に入れる', () => {
    const p = buildArticlePayload({
      title: 't', slug: 's', body: [], coverUrl: '', commissionToken: '', region: '甲信越',
    });
    expect(p.region).toBe('甲信越');
  });

  it('リスト外の取材地は null にする(最終判断はDBのcheck制約)', () => {
    const p = buildArticlePayload({
      title: 't', slug: 's', body: [], coverUrl: '', commissionToken: '', region: '中部',
    });
    expect(p.region).toBeNull();
  });

  it('未選択は null', () => {
    const p = buildArticlePayload({
      title: 't', slug: 's', body: [], coverUrl: '', commissionToken: '', region: '',
    });
    expect(p.region).toBeNull();
  });
});

describe('validateCommissionToken (seeded)', () => {
  it('returns the provider name for a token issued to a writer, and null for an unknown token', async () => {
    expect(await validateCommissionToken(supabase, 'WM-00000000')).toBeNull();

    // kenta 宛てに発行する: commissions.test.ts が forest→hana のペアで頻繁にトークンを
    // 発行しており、commission_interval_days の間隔チェックが並行実行時に衝突しうるため
    // (テストの分離のため別ペアを使う)。
    const kentaClient = createClient(
      process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: kentaSignInError } = await kentaClient.auth.signInWithPassword({
      email: 'kenta@seed.local', password: 'seed-pass-1234',
    });
    if (kentaSignInError) throw kentaSignInError;
    const { data: { user: kentaUser } } = await kentaClient.auth.getUser();

    const providerClient = createClient(
      process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: signInError } = await providerClient.auth.signInWithPassword({
      email: 'forest@seed.local', password: 'seed-pass-1234',
    });
    if (signInError) throw signInError;

    const { data: tokenRow, error: tokenError } = await providerClient
      .from('commission_tokens').insert({ writer_id: kentaUser!.id }).select('id, token').single();
    if (tokenError) throw tokenError;

    expect(await validateCommissionToken(kentaClient, tokenRow.token)).toBe('フォレスト再生機構');

    // 未使用のまま残すと commission_interval_days の間隔チェックにより次回のテスト実行で
    // このペアへの発行がブロックされるため、後始末として取り消す。
    await providerClient
      .from('commission_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenRow.id);
  });
});

describe('article CRUD (seeded, as hana)', () => {
  it('creates a draft, fetches it, updates it, deletes it', async () => {
    const id = await createDraft(supabase, {
      title: '新しい下書き', slug: '',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '見出しと本文' }] }],
      coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    expect(typeof id).toBe('string');

    const article = await fetchArticleForEdit(supabase, id);
    expect(article).not.toBeNull();
    expect(article!.status).toBe('draft');
    expect(article!.title).toBe('新しい下書き');

    await saveArticle(supabase, id, {
      title: '更新後タイトル', slug: '',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '本文2' }] }],
      coverUrl: '', commissionToken: '', region: '関東',
    }, false);
    const updated = await fetchArticleForEdit(supabase, id);
    expect(updated!.title).toBe('更新後タイトル');
    expect(updated!.status).toBe('draft');

    await deleteArticle(supabase, id);
    const gone = await fetchArticleForEdit(supabase, id);
    expect(gone).toBeNull();
  });

  it('checkSlugAvailable is false for an existing published slug of mine, true for a fresh one', async () => {
    // hana は 'koke-no-mori' を公開済み(seed)
    expect(await checkSlugAvailable(supabase, 'koke-no-mori')).toBe(false);
    expect(await checkSlugAvailable(supabase, 'brand-new-unique-slug-xyz')).toBe(true);
  });

  it('checkSlugAvailable excludes the article own id (edit mode)', async () => {
    const id = await createDraft(supabase, {
      title: 'slug自己除外', slug: 'self-exclude-slug-test',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
      coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    // without excludeId: the row itself makes the slug appear taken
    expect(await checkSlugAvailable(supabase, 'self-exclude-slug-test')).toBe(false);
    // with excludeId = its own id: available (editing keeps its own slug)
    expect(await checkSlugAvailable(supabase, 'self-exclude-slug-test', id)).toBe(true);
  });

  it('publishing a commissioned draft with an unknown token raises INVALID_COMMISSION_TOKEN', async () => {
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }];
    const id = await createDraft(supabase, {
      title: '依頼下書き', slug: 'commissioned-draft-test', body, coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    await expect(
      saveArticle(supabase, id, {
        title: '依頼下書き', slug: 'commissioned-draft-test', body,
        coverUrl: '', commissionToken: 'WM-BADTOKEN', region: '関東',
      }, true),
    ).rejects.toThrow(/INVALID_COMMISSION_TOKEN/);
  });
});

describe('optimistic concurrency (Task 18)', () => {
  it('fetchArticleForEdit exposes updatedAt as an ISO timestamp', async () => {
    const id = await createDraft(supabase, {
      title: '更新日時テスト', slug: '',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
      coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    const article = await fetchArticleForEdit(supabase, id);
    expect(article).not.toBeNull();
    expect(typeof article!.updatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(article!.updatedAt))).toBe(false);
  });

  it('saveArticle succeeds when expectedUpdatedAt matches the current row', async () => {
    const id = await createDraft(supabase, {
      title: '一致テスト', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    const before = await fetchArticleForEdit(supabase, id);
    const result = await saveArticle(supabase, id, {
      title: '一致テスト2', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
    }, false, before!.updatedAt);
    expect(typeof result.updatedAt).toBe('string');
  });

  it('saveArticle throws CONFLICT when expectedUpdatedAt is stale', async () => {
    const id = await createDraft(supabase, {
      title: '競合テスト', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    const staleTimestamp = new Date(0).toISOString();
    await expect(
      saveArticle(supabase, id, {
        title: '競合テスト2', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
      }, false, staleTimestamp),
    ).rejects.toThrow('CONFLICT');
  });

  it('saveArticle throws NOT_FOUND when the article id does not exist and no expectedUpdatedAt is given', async () => {
    await expect(
      saveArticle(supabase, '00000000-0000-0000-0000-000000000000', {
        title: '存在しない', slug: '', body: [], coverUrl: '', commissionToken: '', region: '関東',
      }, false),
    ).rejects.toThrow('NOT_FOUND');
  });
});
