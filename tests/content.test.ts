import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchPublishedArticles,
  fetchArticleBySlug,
  fetchWriters,
  fetchWriterBySlug,
  renderMarkdown,
} from '../src/lib/content';

const db = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe('renderMarkdown', () => {
  it('renders markdown and strips scripts', () => {
    const html = renderMarkdown('## 見出し\n\n**強調** <script>alert(1)</script>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
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
    expect(article!.bodyHtml).toContain('<h2>');
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
