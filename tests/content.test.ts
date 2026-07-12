import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';
import {
  fetchPublishedArticles,
  fetchArticleBySlug,
  fetchWriters,
  fetchWriterBySlug,
  safeUrl,
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

  it('returns article detail with sanitized rendered body', async () => {
    const article = await fetchArticleBySlug(db, 'kawabe-kansatsu');
    expect(article).not.toBeNull();
    expect(article!.authorName).toBe('田中 花');
    expect(article!.authorSlug).toBe('tanaka-hana');
    expect(article!.bodyHtml).toContain('<h2 id="川辺にて">');
    expect(article!.bodyHtml).not.toContain('<script');
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
});
