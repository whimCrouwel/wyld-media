import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';
import {
  fetchPublishedArticles,
  fetchArticleBySlug,
  fetchWriters,
  fetchWriterBySlug,
  fetchPageSize,
  safeUrl,
  extractHeadings,
} from '../src/lib/content';

const db = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe('article rendering via renderBlocksToHtml', () => {
  const BASE = 'https://img.test';

  it('renders blocks and strips scripts', async () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '強調', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ] };
    const html = await renderBlocksToHtml(doc, BASE);
    expect(html).toContain('<h2 id="見出し">');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', async () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: '' } }] };
    expect(await renderBlocksToHtml(doc, BASE)).toContain(`src="${BASE}/x.webp"`);
  });

  it('許可ホスト以外の画像は落とす', async () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: 'https://evil.example/x.webp', alt: '', caption: '' } }] };
    expect(await renderBlocksToHtml(doc, BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', async () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: '' } }] };
    expect(await renderBlocksToHtml(doc, '')).not.toContain('<img');
  });
});

describe('extractHeadings', () => {
  it('extracts h2 headings in order', () => {
    const html = '<p>intro</p><h2 id="はじめに">はじめに</h2><p>body</p><h2 id="まとめ">まとめ</h2>';
    expect(extractHeadings(html)).toEqual([
      { id: 'はじめに', text: 'はじめに' },
      { id: 'まとめ', text: 'まとめ' },
    ]);
  });

  it('ignores h3 (front-end TOC is h2-only)', () => {
    const html = '<h2 id="A">A</h2><h3 id="A-1">A-1</h3>';
    expect(extractHeadings(html)).toEqual([{ id: 'A', text: 'A' }]);
  });

  it('strips inline marks from the display text', () => {
    const html = '<h2 id="太字を含む見出し">太字を<strong>含む</strong>見出し</h2>';
    expect(extractHeadings(html)).toEqual([{ id: '太字を含む見出し', text: '太字を含む見出し' }]);
  });

  it('decodes HTML entities consistently between id and text', () => {
    // render.ts の実出力形状: id 属性は "&"/'"' 双方をエンティティ化するが、
    // テキストノードは "&" のみエンティティ化し引用符はそのまま出す。
    // デコード後は id/text とも同じ生テキストに揃うはず。
    const html = '<h2 id="AT&amp;T &quot;plan&quot;">AT&amp;T "plan"</h2>';
    expect(extractHeadings(html)).toEqual([{ id: 'AT&T "plan"', text: 'AT&T "plan"' }]);
  });

  it('returns an empty array when there are no headings', () => {
    expect(extractHeadings('<p>no headings here</p>')).toEqual([]);
  });
});

describe('safeUrl', () => {
  it('passes through http:// URLs unchanged', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });

  it('passes through https:// URLs unchanged', () => {
    expect(safeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('rejects javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });

  it('rejects malformed URL strings', () => {
    expect(safeUrl('not a url')).toBeNull();
  });
});

describe('content data layer (requires seeded local Supabase)', () => {
  it('splits featured (latest commissioned, max featured_count) from normal', async () => {
    const { featured, normal } = await fetchPublishedArticles(db);
    expect(featured.map((a) => a.slug)).toEqual(['kaigan-seisou', 'kigyou-no-mori']);
    expect(featured.every((a) => a.commissionedByName === 'フォレスト再生機構')).toBe(true);
    expect(normal.map((a) => a.slug)).toEqual(['toshi-no-yachou', 'koke-no-mori', 'kawabe-kansatsu']);
  });

  it('featured_window_days を超えて公開された依頼記事は帯から外れる(PRバッジは別途常時表示)', async () => {
    const { data: before, error: beforeError } = await db
      .from('settings')
      .select('featured_window_days')
      .eq('id', 1)
      .single();
    if (beforeError) throw beforeError;
    try {
      // 窓を0日にすると「今日公開」以外の依頼記事は全て帯の対象外になる
      // (シード記事はすべて過去日付なので featured は空になるはず)。
      const { error } = await db
        .from('settings')
        .update({ featured_window_days: 0 })
        .eq('id', 1);
      if (error) throw error;
      const { featured } = await fetchPublishedArticles(db);
      expect(featured).toEqual([]);
    } finally {
      const { error } = await db
        .from('settings')
        .update({ featured_window_days: before.featured_window_days })
        .eq('id', 1);
      if (error) throw error;
    }
  });

  it('returns article detail with sanitized rendered body', async () => {
    const article = await fetchArticleBySlug(db, 'kawabe-kansatsu');
    expect(article).not.toBeNull();
    expect(article!.authorName).toBe('田中 花');
    expect(article!.authorSlug).toBe('tanaka-hana');
    expect(article!.bodyHtml).toContain('<h2 id="川辺にて">');
    expect(article!.bodyHtml).not.toContain('<script');
    expect(article!.headings).toEqual(expect.arrayContaining([{ id: '川辺にて', text: '川辺にて' }]));
  });

  it('returns null for unknown slug', async () => {
    expect(await fetchArticleBySlug(db, 'no-such-slug')).toBeNull();
  });

  it('lists only writers (no admin, no provider)', async () => {
    const writers = await fetchWriters(db);
    expect(writers.map((w) => w.slug).sort()).toEqual(['sato-kenta', 'tanaka-hana']);
  });

  it('returns writer detail with published articles only (draft excluded)', async () => {
    const writer = await fetchWriterBySlug(db, 'tanaka-hana');
    expect(writer).not.toBeNull();
    expect(writer!.articles.map((a) => a.slug)).toEqual([
      'kaigan-seisou',
      'kigyou-no-mori',
      'koke-no-mori',
      'kawabe-kansatsu',
    ]);
    expect(await fetchWriterBySlug(db, 'seed-admin')).toBeNull();
  });

  it('公開記事は取材地を持つ', async () => {
    const { featured, normal } = await fetchPublishedArticles(db);
    const all = [...featured, ...normal];
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(typeof a.region).toBe('string');
      expect(a.region).not.toBe('');
    }
  });

  it('fetchPageSize は 1 以上の整数を返す', async () => {
    const size = await fetchPageSize(db);
    expect(Number.isInteger(size)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(1);
  });
});
