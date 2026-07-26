import { describe, expect, it } from 'vitest';
import {
  articleSchema,
  personSchema,
  organizationSchema,
  webSiteSchema,
  breadcrumbListSchema,
  buildCrumbs,
  encodeJsonLd,
} from '../src/lib/schema';

const SITE = 'https://example.com';
const SITE_NAME = 'Wild Media';

describe('articleSchema', () => {
  it('emits a valid Article JSON-LD object', () => {
    const s = articleSchema({
      title: '森の記事',
      description: '森について',
      url: 'https://example.com/articles/foo',
      coverUrl: 'https://example.com/cover.jpg',
      publishedISO: '2026-07-01T00:00:00.000Z',
      updatedISO: '2026-07-02T00:00:00.000Z',
      authorName: 'はな',
      authorUrl: 'https://example.com/writers/hana',
      siteName: SITE_NAME,
      siteUrl: SITE,
    });
    expect(s['@context']).toBe('https://schema.org');
    expect(s['@type']).toBe('Article');
    expect(s.headline).toBe('森の記事');
    expect(s.description).toBe('森について');
    expect(s.image).toBe('https://example.com/cover.jpg');
    expect(s.datePublished).toBe('2026-07-01T00:00:00.000Z');
    expect(s.dateModified).toBe('2026-07-02T00:00:00.000Z');
    expect(s.inLanguage).toBe('ja');
    expect(s.author).toEqual({ '@type': 'Person', name: 'はな', url: 'https://example.com/writers/hana' });
    expect(s.publisher).toEqual({ '@type': 'Organization', name: SITE_NAME, url: SITE });
    expect(s.mainEntityOfPage).toBe('https://example.com/articles/foo');
  });

  it('omits image when coverUrl is null/undefined', () => {
    const s = articleSchema({
      title: 't', description: 'd', url: 'u',
      coverUrl: null, publishedISO: '2026-01-01T00:00:00.000Z', updatedISO: null,
      authorName: 'a', authorUrl: 'au', siteName: SITE_NAME, siteUrl: SITE,
    });
    expect('image' in s).toBe(false);
  });

  it('falls back dateModified to datePublished when updatedISO is null', () => {
    const s = articleSchema({
      title: 't', description: 'd', url: 'u',
      coverUrl: null, publishedISO: '2026-01-01T00:00:00.000Z', updatedISO: null,
      authorName: 'a', authorUrl: 'au', siteName: SITE_NAME, siteUrl: SITE,
    });
    expect(s.dateModified).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('personSchema', () => {
  it('emits a Person JSON-LD with sameAs when snsLinks provided', () => {
    const s = personSchema({
      name: 'はな', url: 'https://example.com/writers/hana',
      bio: '環境ライター', avatarUrl: 'https://example.com/a.jpg',
      snsLinks: ['https://twitter.com/hana', 'https://instagram.com/hana'],
    });
    expect(s['@type']).toBe('Person');
    expect(s.name).toBe('はな');
    expect(s.url).toBe('https://example.com/writers/hana');
    expect(s.description).toBe('環境ライター');
    expect(s.image).toBe('https://example.com/a.jpg');
    expect(s.sameAs).toEqual(['https://twitter.com/hana', 'https://instagram.com/hana']);
  });

  it('omits sameAs when snsLinks empty', () => {
    const s = personSchema({ name: 'x', url: 'u', bio: '', avatarUrl: null, snsLinks: [] });
    expect('sameAs' in s).toBe(false);
  });

  it('omits image when avatarUrl null', () => {
    const s = personSchema({ name: 'x', url: 'u', bio: '', avatarUrl: null, snsLinks: [] });
    expect('image' in s).toBe(false);
  });

  it('omits description when bio empty', () => {
    const s = personSchema({ name: 'x', url: 'u', bio: '', avatarUrl: null, snsLinks: [] });
    expect('description' in s).toBe(false);
  });
});

describe('organizationSchema', () => {
  it('emits an Organization JSON-LD with only provided fields', () => {
    const s = organizationSchema({
      name: 'Forest Co', url: 'https://example.com/providers/forest',
      description: '森林保全団体', sameAs: ['https://twitter.com/forest'],
    });
    expect(s['@type']).toBe('Organization');
    expect(s.name).toBe('Forest Co');
    expect(s.url).toBe('https://example.com/providers/forest');
    expect(s.description).toBe('森林保全団体');
    expect(s.sameAs).toEqual(['https://twitter.com/forest']);
  });

  it('omits optional fields when not provided', () => {
    const s = organizationSchema({ name: 'A', url: 'u' });
    expect('description' in s).toBe(false);
    expect('logo' in s).toBe(false);
    expect('sameAs' in s).toBe(false);
  });
});

describe('webSiteSchema', () => {
  it('emits WebSite JSON-LD', () => {
    const s = webSiteSchema({ name: SITE_NAME, url: SITE, inLanguage: 'ja' });
    expect(s['@type']).toBe('WebSite');
    expect(s.name).toBe(SITE_NAME);
    expect(s.url).toBe(SITE);
    expect(s.inLanguage).toBe('ja');
  });
});

describe('breadcrumbListSchema', () => {
  it('emits BreadcrumbList with position numbering starting at 1', () => {
    const s = breadcrumbListSchema(
      [
        { name: 'Home', url: '/' },
        { name: 'Works', url: '/' },
        { name: '森の記事', url: '/articles/foo' },
      ],
      SITE,
    );
    expect(s['@type']).toBe('BreadcrumbList');
    expect(s.itemListElement).toHaveLength(3);
    expect(s.itemListElement[0]).toEqual({
      '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/',
    });
    expect(s.itemListElement[2]).toEqual({
      '@type': 'ListItem', position: 3, name: '森の記事', item: 'https://example.com/articles/foo',
    });
  });
});

describe('buildCrumbs', () => {
  it('article crumbs: Home → Works → title', () => {
    expect(buildCrumbs.article({ title: '森の記事', slug: 'foo' })).toEqual([
      { name: 'Home', url: '/' },
      { name: 'Works', url: '/' },
      { name: '森の記事', url: '/articles/foo' },
    ]);
  });

  it('writer crumbs: Home → Writers → name', () => {
    expect(buildCrumbs.writer({ name: 'はな', slug: 'hana' })).toEqual([
      { name: 'Home', url: '/' },
      { name: 'Writers', url: '/writers' },
      { name: 'はな', url: '/writers/hana' },
    ]);
  });

  it('provider crumbs: Home → Providers → name', () => {
    expect(buildCrumbs.provider({ name: 'Forest Co', slug: 'forest' })).toEqual([
      { name: 'Home', url: '/' },
      { name: 'Providers', url: '/providers' },
      { name: 'Forest Co', url: '/providers/forest' },
    ]);
  });

  it('area crumbs: Home → Works → region', () => {
    expect(buildCrumbs.area({ region: '関東', areaSlug: 'kanto' })).toEqual([
      { name: 'Home', url: '/' },
      { name: 'Works', url: '/' },
      { name: '関東', url: '/areas/kanto' },
    ]);
  });
});

describe('encodeJsonLd', () => {
  it('escapes </script> in string values', () => {
    const out = encodeJsonLd({ name: 'foo</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
  });

  it('escapes U+2028 line separator', () => {
    const out = encodeJsonLd({ name: 'a b' });
    expect(out).not.toContain(' ');
    expect(out).toContain('\\u2028');
  });

  it('escapes U+2029 paragraph separator', () => {
    const out = encodeJsonLd({ name: 'a b' });
    expect(out).not.toContain(' ');
    expect(out).toContain('\\u2029');
  });

  it('leaves normal content unchanged and valid JSON', () => {
    const out = encodeJsonLd({ '@type': 'Person', name: 'はな' });
    expect(
      JSON.parse(
        out
          .replace(/\\u003c/g, '<')
          .replace(/\\u2028/g, ' ')
          .replace(/\\u2029/g, ' '),
      ),
    ).toEqual({ '@type': 'Person', name: 'はな' });
  });
});
