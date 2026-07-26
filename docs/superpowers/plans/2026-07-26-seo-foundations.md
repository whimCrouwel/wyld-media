# SEO Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the SEO basics that Wild Media currently lacks entirely — sitemap, `robots.txt`, canonical URLs, per-page meta description, Open Graph / Twitter Card, ISO dates, a real 404 page, and a topical homepage h1 — so Google can discover, understand, and preview every published article.

**Architecture:** Extend `Base.astro` with per-page SEO props and a `<slot name="head">` for future JSON-LD. Introduce a single `SEO.astro` component that every page uses to emit meta / canonical / OG / Twitter tags. Add an `articles.description` column so meta descriptions have a real data source, with a body-derived fallback for pre-existing rows. Wire `@astrojs/sitemap` for automatic sitemap generation. All output remains fully static (SSG).

**Tech Stack:** Astro 5 (SSG, `output: 'static'`), `@astrojs/sitemap`, Supabase (Postgres migrations + pgTAP), Vitest for unit tests, TypeScript.

## Global Constraints

- Language: Japanese for user-facing copy (`<html lang="ja">` already set at `src/layouts/Base.astro:48`).
- Rendering: SSG only (`output: 'static'` at `astro.config.mjs:5`). No SSR, no client-side data fetching for SEO-relevant content.
- Trust boundary: Permissions and business rules stay in DB layer (RLS / triggers / pgTAP). Client checks are UX-only.
- Never place service role key in `admin/`. `src/lib/supabase-server.ts` only, at build time.
- Draft/held articles must remain excluded from the build (`.eq('status','published').eq('moderation_hold', false)` — already enforced in `src/lib/content.ts:148-150,174-175`). Sitemap MUST inherit this — no accidental draft URLs.
- Test conventions: Vitest for pure functions in `tests/*.test.ts` (run via `npm test`). pgTAP for DB migrations (`supabase test db`). Astro layouts / markup verified by `npm run build` + inspecting `dist/`.
- Docs discipline: When a change updates behavior documented in `CLAUDE.md` / `ARCHITECTURE.md` / `docs/DATABASE.md` / `docs/DOMAIN-CHANGE.md`, update the doc in the same commit.
- Follow-up plans (out of scope here): Phase 2 = JSON-LD / structured data; Phase 3 = AEO enrichment (llms.txt, author bio on article page, related articles, breadcrumbs); Phase 4 = image pipeline (`astro:assets`).

## File Structure

**Created:**
- `public/robots.txt` — static robots file with sitemap URL and explicit AI crawler allow rules
- `src/pages/404.astro` — branded 404 with `noindex`, back-to-Works link, search modal trigger
- `src/lib/description.ts` — pure helper `fallbackDescription(bodyHtml, maxLen=160)` for articles lacking an explicit description
- `src/lib/seo.ts` — pure helpers `toIsoDate(input)` and `absoluteUrl(pathname, site)` used by the SEO component and Article type mapper
- `src/components/SEO.astro` — single emitter for canonical / description / OG / Twitter Card / `article:*` tags. Consumes props; owns no data fetching.
- `tests/description.test.ts` — Vitest for `fallbackDescription`
- `tests/seo.test.ts` — Vitest for `toIsoDate` and `absoluteUrl`
- `supabase/migrations/YYYYMMDDHHMMSS_add_article_description.sql` — new nullable `description text` column on `articles`
- `supabase/tests/add_article_description.test.sql` — pgTAP verifying column exists, is nullable, RLS unchanged

**Modified:**
- `package.json` — add `@astrojs/sitemap` devDependency
- `astro.config.mjs` — add `site`, add `sitemap()` integration
- `src/layouts/Base.astro:47-56` — extend Props (description, ogImage, ogType, canonicalPath, noindex, articlePublishedTime, articleModifiedTime, articleAuthor); add `<slot name="head">`; render SEO tags via the new `SEO.astro` component
- `src/lib/content.ts` — select `description` for articles; add `publishedAtISO` and `updatedAtISO` fields to the returned Article type
- `src/pages/[...page].astro:50` — pass description to Base for the homepage
- `src/pages/articles/[slug].astro:23` — pass description (from article or fallback), ogImage=coverImageUrl, ogType='article', articlePublishedTime/ModifiedTime/Author
- `src/pages/writers/[slug].astro:27` — pass description (from writer bio), ogImage=avatarUrl
- `src/pages/writers/index.astro:16` — pass a listing description
- `src/pages/providers/[slug].astro:27` — pass description, ogImage from cover
- `src/pages/providers/index.astro:17` — pass a listing description
- `src/pages/areas/[area]/[...page].astro:75` — pass a per-area description
- `src/components/organisms/Hero.astro:6-11` — replace decorative h1 with a topical Japanese h1; move existing English tagline to a visual sub-element
- `CLAUDE.md`, `ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DOMAIN-CHANGE.md` — update as noted in the relevant tasks

---

## Task 1: Sitemap + `robots.txt` + `astro.config.mjs` site

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`
- Create: `public/robots.txt`
- Modify: `docs/DOMAIN-CHANGE.md` (add note that `astro.config.mjs`'s `site` and `robots.txt`'s Sitemap URL must be updated when the production domain changes)

**Interfaces:**
- Consumes: none (first task)
- Produces: `Astro.site` becomes defined for later tasks (canonical URL resolution in Task 4 depends on it). `dist/sitemap-index.xml` and `dist/sitemap-0.xml` exist after every build.

- [ ] **Step 1: Install `@astrojs/sitemap`**

Run: `npm i -D @astrojs/sitemap`

- [ ] **Step 2: Update `astro.config.mjs` to set `site` and add the sitemap integration**

Replace `astro.config.mjs` with:

```javascript
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// The public production URL. Update this AND public/robots.txt when the domain changes.
// See docs/DOMAIN-CHANGE.md.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://wyld-media.vercel.app';

export default defineConfig({
  site: SITE,
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 3: Create `public/robots.txt`**

Create `public/robots.txt` with:

```
User-agent: *
Allow: /

# AI crawlers — explicitly allow so Wild Media appears in AI answer engines.
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /

Sitemap: https://wyld-media.vercel.app/sitemap-index.xml
```

- [ ] **Step 4: Update `docs/DOMAIN-CHANGE.md` to include the two new touch points**

Append a new checklist item under the existing Vercel section:

```markdown
### 公開サイトのビルド設定

- `astro.config.mjs` の `SITE` 定数(または `PUBLIC_SITE_URL` 環境変数)を新ドメインに更新
- `public/robots.txt` の `Sitemap:` 行を新ドメインに更新
```

- [ ] **Step 5: Build and verify sitemap + robots are emitted**

Run: `npm run build`
Expected: build completes successfully. Verify:

```bash
test -f dist/robots.txt && echo "robots.txt OK"
test -f dist/sitemap-index.xml && echo "sitemap-index OK"
test -f dist/sitemap-0.xml && echo "sitemap-0 OK"
grep -c '<loc>' dist/sitemap-0.xml
```

Expected: three "OK" lines and a `<loc>` count > 0 (should include home + articles + writers + providers + areas).

- [ ] **Step 6: Verify no drafts leaked into the sitemap**

The `getStaticPaths()` in `src/pages/articles/[slug].astro:8` already filters to published + non-held articles via `src/lib/content.ts:148-150`, so the sitemap inherits that filter automatically (sitemap builds from built routes). Confirm by picking any known held/draft slug from the local seed DB (if any) and grepping:

```bash
# Substitute a known draft slug if seed has one; otherwise this step is a spot-check.
grep -c "known-draft-slug" dist/sitemap-0.xml
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json astro.config.mjs public/robots.txt docs/DOMAIN-CHANGE.md
git commit -m "feat(seo): add sitemap integration, robots.txt, and site URL config"
```

---

## Task 2: `articles.description` column + `fallbackDescription` helper

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_article_description.sql` (timestamp per Supabase convention; run `supabase migration new add_article_description` to auto-generate the filename)
- Create: `supabase/tests/add_article_description.test.sql`
- Create: `src/lib/description.ts`
- Create: `tests/description.test.ts`
- Modify: `src/lib/content.ts` (select `description`; expose on Article type; use fallback when null/empty)
- Modify: `docs/DATABASE.md` (add `description` to the `articles` ER)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `Article` type from `src/lib/content.ts` gains `description: string` (never null — fallback fills empties).
  - `src/lib/description.ts` exports `export function fallbackDescription(bodyHtml: string, maxLen = 160): string` — strips tags/whitespace, truncates at word boundary, appends `…` if truncated, returns `''` for empty input.

- [ ] **Step 1: Generate the migration file skeleton**

Run: `supabase migration new add_article_description`

This creates `supabase/migrations/<timestamp>_add_article_description.sql`.

- [ ] **Step 2: Write the migration SQL**

Replace the file contents with:

```sql
-- Adds an optional per-article description used for <meta name="description">
-- and OG/Twitter descriptions. Nullable; the site renders a body-derived
-- fallback when this column is null or empty. See src/lib/description.ts.
alter table articles
  add column description text;

comment on column articles.description is
  'Optional short summary for SEO/OG meta. Falls back to a body-derived excerpt when null/empty.';
```

- [ ] **Step 3: Write the failing pgTAP test**

Create `supabase/tests/add_article_description.test.sql`:

```sql
begin;
select plan(3);

-- Column exists
select has_column('articles', 'description', 'articles.description exists');

-- Column is nullable (so existing rows do not break the migration)
select col_is_null('articles', 'description', 'articles.description is nullable');

-- Column type is text
select col_type_is('articles', 'description', 'text', 'articles.description is text');

select * from finish();
rollback;
```

- [ ] **Step 4: Run the migration and pgTAP tests**

Run: `supabase db reset && supabase test db`
Expected: reset applies the new migration; the three assertions in `add_article_description.test.sql` PASS.

- [ ] **Step 5: Write the failing Vitest test for `fallbackDescription`**

Create `tests/description.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fallbackDescription } from '../src/lib/description';

describe('fallbackDescription', () => {
  it('returns empty string for empty input', () => {
    expect(fallbackDescription('')).toBe('');
    expect(fallbackDescription('   ')).toBe('');
  });

  it('strips HTML tags and collapses whitespace', () => {
    const html = '<p>森の中で<strong>鳥</strong>を  観察した。</p>';
    expect(fallbackDescription(html)).toBe('森の中で鳥を 観察した。');
  });

  it('truncates at maxLen and appends an ellipsis when longer', () => {
    const html = '<p>' + 'あ'.repeat(200) + '</p>';
    const result = fallbackDescription(html, 160);
    expect(result.endsWith('…')).toBe(true);
    // 160 body chars + the ellipsis
    expect([...result].length).toBe(161);
  });

  it('does not append an ellipsis when input already fits', () => {
    const html = '<p>短い文章です。</p>';
    expect(fallbackDescription(html, 160)).toBe('短い文章です。');
  });

  it('handles nested tags and entities', () => {
    const html = '<p>A &amp; B<br/><em>C</em></p>';
    expect(fallbackDescription(html)).toBe('A & B C');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- description`
Expected: FAIL — module `../src/lib/description` not found.

- [ ] **Step 7: Implement `fallbackDescription`**

Create `src/lib/description.ts`:

```typescript
// Strips HTML tags, decodes the common named entities, collapses whitespace,
// and truncates at `maxLen` (character units, not bytes). Appends '…' when truncated.
// Used as the SEO description when an article has no explicit `articles.description`.
export function fallbackDescription(bodyHtml: string, maxLen = 160): string {
  const stripped = bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped === '') return '';
  const chars = [...stripped];
  if (chars.length <= maxLen) return stripped;
  return chars.slice(0, maxLen).join('') + '…';
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- description`
Expected: PASS (5 assertions).

- [ ] **Step 9: Extend `src/lib/content.ts` to select and expose `description`**

Find the `Article` TypeScript type in `src/lib/content.ts` (near the `fetchArticles*` functions) and add:

```typescript
description: string;  // Never null — see fallbackDescription when DB value is null/empty.
```

Find the Supabase select statements for articles (search for `.from('articles').select(`) at approximately lines 130-190 and add `description` to the column list. In the row → Article mapper, add:

```typescript
import { fallbackDescription } from './description';

// inside the mapper:
description: (row.description ?? '').trim() || fallbackDescription(bodyHtml),
```

`bodyHtml` should already be computed in the same mapper (it's what feeds `set:html` at `src/pages/articles/[slug].astro:47`). If the listing mapper doesn't have `bodyHtml` handy (listings often skip body), pass the raw JSON body through `renderBlocksToHtml()` from `@wild-media/blocks-renderer` OR fall back to `''` (empty description on listings is acceptable — listings pages use their own listing-level description in Task 6).

- [ ] **Step 10: Verify existing content tests still pass**

Run: `npm test`
Expected: PASS across all suites.

- [ ] **Step 11: Update `docs/DATABASE.md`**

In the `articles` table section, add a row for `description` under the columns list with type `text`, nullable, comment "SEO description; falls back to body excerpt when null".

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations supabase/tests src/lib/description.ts src/lib/content.ts tests/description.test.ts docs/DATABASE.md
git commit -m "feat(articles): add description column and fallbackDescription helper for meta tags"
```

---

## Task 3: ISO date + absolute URL helpers on `src/lib/seo.ts`

**Files:**
- Create: `src/lib/seo.ts`
- Create: `tests/seo.test.ts`
- Modify: `src/lib/content.ts` (add `publishedAtISO` and `updatedAtISO` fields to Article type; populate from `published_at` / `updated_at`)

**Interfaces:**
- Consumes: Article rows already carry `published_at` and `updated_at` (`supabase/migrations/20260706030845_create_schema.sql:29,33`).
- Produces:
  - `src/lib/seo.ts` exports:
    - `export function toIsoDate(input: string | Date | null | undefined): string | null` — returns ISO 8601 string, or null for null/invalid input.
    - `export function absoluteUrl(pathname: string, site: string | URL): string` — resolves a pathname against a base site URL; strips duplicate slashes; never appends a trailing slash unless the input has one.
  - Article type from `src/lib/content.ts` gains `publishedAtISO: string | null` and `updatedAtISO: string | null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/seo.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { absoluteUrl, toIsoDate } from '../src/lib/seo';

describe('toIsoDate', () => {
  it('returns null for null/undefined', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it('returns null for empty string or invalid date', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });

  it('converts a timestamptz string to ISO 8601', () => {
    expect(toIsoDate('2026-07-01 09:30:00+00')).toBe('2026-07-01T09:30:00.000Z');
  });

  it('accepts a Date object', () => {
    expect(toIsoDate(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('absoluteUrl', () => {
  it('joins a pathname to a site URL', () => {
    expect(absoluteUrl('/articles/foo', 'https://wyld-media.vercel.app'))
      .toBe('https://wyld-media.vercel.app/articles/foo');
  });

  it('preserves a trailing slash when present', () => {
    expect(absoluteUrl('/', 'https://wyld-media.vercel.app'))
      .toBe('https://wyld-media.vercel.app/');
  });

  it('handles a site value that is already a URL object', () => {
    expect(absoluteUrl('/writers/hana', new URL('https://wyld-media.vercel.app')))
      .toBe('https://wyld-media.vercel.app/writers/hana');
  });

  it('collapses double slashes at the join', () => {
    expect(absoluteUrl('/articles/foo', 'https://wyld-media.vercel.app/'))
      .toBe('https://wyld-media.vercel.app/articles/foo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- seo`
Expected: FAIL — module `../src/lib/seo` not found.

- [ ] **Step 3: Implement `src/lib/seo.ts`**

```typescript
export function toIsoDate(input: string | Date | null | undefined): string | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function absoluteUrl(pathname: string, site: string | URL): string {
  const base = site instanceof URL ? site : new URL(site);
  // new URL(pathname, base) handles leading-slash join correctly.
  return new URL(pathname, base).href;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- seo`
Expected: PASS (8 assertions).

- [ ] **Step 5: Extend `Article` type in `src/lib/content.ts` with ISO date fields**

Add to the Article type near the top of the type definition:

```typescript
publishedAtISO: string | null;
updatedAtISO: string | null;
```

In each article row → Article mapper (search for `published_at:` or `publishedAt:` in `src/lib/content.ts`), import `toIsoDate` from `./seo` and populate:

```typescript
import { toIsoDate } from './seo';

// inside the mapper:
publishedAtISO: toIsoDate(row.published_at),
updatedAtISO: toIsoDate(row.updated_at),
```

- [ ] **Step 6: Verify all tests still pass**

Run: `npm test`
Expected: PASS across all suites.

- [ ] **Step 7: Commit**

```bash
git add src/lib/seo.ts src/lib/content.ts tests/seo.test.ts
git commit -m "feat(seo): add toIsoDate and absoluteUrl helpers; expose ISO dates on Article type"
```

---

## Task 4: SEO props and `<slot name="head">` on `Base.astro`

**Files:**
- Modify: `src/layouts/Base.astro:45-56` (Props interface + head content)

**Interfaces:**
- Consumes: `Astro.site` (set in Task 1); `absoluteUrl` from Task 3 (used inline for canonical resolution).
- Produces: `Base` accepts these new optional props:
  - `description?: string`
  - `canonicalPath?: string` (defaults to `Astro.url.pathname`)
  - `ogImage?: string` (absolute URL or site-relative; auto-resolved to absolute)
  - `ogType?: 'website' | 'article' | 'profile'` (default `'website'`)
  - `noindex?: boolean` (default `false`)
  - `articlePublishedTime?: string | null` (ISO)
  - `articleModifiedTime?: string | null` (ISO)
  - `articleAuthor?: string` (name; used for `article:author` meta and for Twitter creator hint)
- Named slot `head` becomes available for later tasks (Phase 2 JSON-LD) to inject content.

- [ ] **Step 1: Read the current `Base.astro`**

Read `src/layouts/Base.astro` in full. Existing Props at approximately line 45 is likely `interface Props { title: string; }`. Note the current head block at lines 49-53.

- [ ] **Step 2: Extend the Props interface**

Replace the Props interface with:

```typescript
export interface Props {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'profile';
  noindex?: boolean;
  articlePublishedTime?: string | null;
  articleModifiedTime?: string | null;
  articleAuthor?: string;
}
```

Destructure in the frontmatter:

```typescript
const {
  title,
  description,
  canonicalPath,
  ogImage,
  ogType = 'website',
  noindex = false,
  articlePublishedTime,
  articleModifiedTime,
  articleAuthor,
} = Astro.props;
```

- [ ] **Step 3: Import the SEO component (created in Task 5) — leave a placeholder import comment for now**

At the top of the frontmatter, add:

```astro
---
import SEO from '../components/SEO.astro';
// Props/destructuring above
---
```

Since `SEO.astro` doesn't exist yet, Task 4 build verification is deferred to Task 5 (they land together). This task's PR gate is: type-check passes for the Base.astro change once Task 5 lands.

- [ ] **Step 4: Replace the head block with the SEO component + a named slot**

In the `<head>` section, replace the existing per-tag output (title, meta charset, meta viewport) with:

```astro
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <SEO
    title={title}
    description={description}
    canonicalPath={canonicalPath}
    ogImage={ogImage}
    ogType={ogType}
    noindex={noindex}
    articlePublishedTime={articlePublishedTime}
    articleModifiedTime={articleModifiedTime}
    articleAuthor={articleAuthor}
  />
  <slot name="head" />
  <!-- keep any existing font/style links below this line -->
</head>
```

Preserve any existing `<link>` tags (stylesheet imports, favicon) that were in the head — move them below `<slot name="head" />`.

- [ ] **Step 5: Do NOT build yet — proceed directly to Task 5**

Task 4 alone leaves the project referencing a component that doesn't exist. Do not commit at this point. Task 5 creates `SEO.astro` and the two tasks are committed together at the end of Task 5.

---

## Task 5: `SEO.astro` component

**Files:**
- Create: `src/components/SEO.astro`

**Interfaces:**
- Consumes: props defined in Task 4; `Astro.site` (Task 1); `absoluteUrl` from `src/lib/seo.ts` (Task 3).
- Produces: emits `<title>`, `<meta name="description">`, `<link rel="canonical">`, Open Graph tags, Twitter Card tags, optional `<meta name="robots" content="noindex,follow">`, optional `article:*` tags for `ogType === 'article'`.

- [ ] **Step 1: Create the component**

Create `src/components/SEO.astro`:

```astro
---
import { absoluteUrl } from '../lib/seo';

export interface Props {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'profile';
  noindex?: boolean;
  articlePublishedTime?: string | null;
  articleModifiedTime?: string | null;
  articleAuthor?: string;
}

const {
  title,
  description,
  canonicalPath,
  ogImage,
  ogType = 'website',
  noindex = false,
  articlePublishedTime,
  articleModifiedTime,
  articleAuthor,
} = Astro.props;

if (!Astro.site) {
  throw new Error('SEO: Astro.site is undefined. Set `site` in astro.config.mjs (see Task 1).');
}

const canonical = absoluteUrl(canonicalPath ?? Astro.url.pathname, Astro.site);
const ogImageAbs = ogImage ? absoluteUrl(ogImage, Astro.site) : null;
const siteName = 'Wild Media';
---
<title>{title}</title>
{description && <meta name="description" content={description} />}
<link rel="canonical" href={canonical} />
{noindex && <meta name="robots" content="noindex,follow" />}

<!-- Open Graph -->
<meta property="og:site_name" content={siteName} />
<meta property="og:type" content={ogType} />
<meta property="og:title" content={title} />
{description && <meta property="og:description" content={description} />}
<meta property="og:url" content={canonical} />
{ogImageAbs && <meta property="og:image" content={ogImageAbs} />}
<meta property="og:locale" content="ja_JP" />

<!-- Twitter Card -->
<meta name="twitter:card" content={ogImageAbs ? 'summary_large_image' : 'summary'} />
<meta name="twitter:title" content={title} />
{description && <meta name="twitter:description" content={description} />}
{ogImageAbs && <meta name="twitter:image" content={ogImageAbs} />}

<!-- Article-specific -->
{ogType === 'article' && articlePublishedTime && (
  <meta property="article:published_time" content={articlePublishedTime} />
)}
{ogType === 'article' && articleModifiedTime && (
  <meta property="article:modified_time" content={articleModifiedTime} />
)}
{ogType === 'article' && articleAuthor && (
  <meta property="article:author" content={articleAuthor} />
)}
```

- [ ] **Step 2: Build to verify Base + SEO compile together**

Run: `npm run build`
Expected: build completes. Verify the homepage HTML has the new tags:

```bash
grep -c '<link rel="canonical"' dist/index.html
grep -c 'og:site_name' dist/index.html
grep -c 'twitter:card' dist/index.html
```

Expected: `1`, `1`, `1`.

At this point pages that don't yet pass a description will lack `<meta name="description">` — that's intentional; Task 6 wires descriptions per page.

- [ ] **Step 3: Commit Tasks 4 + 5 together**

```bash
git add src/layouts/Base.astro src/components/SEO.astro
git commit -m "feat(seo): add SEO component with canonical, OG, Twitter Card and article meta"
```

---

## Task 6: Wire `description` + `ogImage` per page

**Files:**
- Modify: `src/pages/[...page].astro:50`
- Modify: `src/pages/articles/[slug].astro:23`
- Modify: `src/pages/writers/[slug].astro:27`
- Modify: `src/pages/writers/index.astro:16`
- Modify: `src/pages/providers/[slug].astro:27`
- Modify: `src/pages/providers/index.astro:17`
- Modify: `src/pages/areas/[area]/[...page].astro:75`

**Interfaces:**
- Consumes: `Article.description`, `Article.publishedAtISO`, `Article.updatedAtISO`, `Article.authorName`, `Article.coverImageUrl` (all now available after Tasks 2 + 3). For writers/providers: existing `bio` / `avatarUrl` / `cover_image_url` / `description` fields on those DB rows.
- Produces: every built HTML page in `dist/` carries a `<meta name="description">`, a canonical link, and Open Graph tags. Article pages additionally carry `article:published_time` / `article:modified_time` / `article:author`.

- [ ] **Step 1: Homepage (`src/pages/[...page].astro:50`)**

Update the `<Base>` invocation to add:

```astro
<Base
  title={page.currentPage === 1 ? 'Wild Media' : `Wild Media — ${page.currentPage}ページ目`}
  description="環境と生き方を書く、日本のライターによるメディア。森・山・海・街から、書き手それぞれの視点で綴る記事を毎週公開。"
  canonicalPath={page.currentPage === 1 ? '/' : `/${page.currentPage}`}
>
```

For pages 2+, no `og:image` — the listing page has no natural single image. (A follow-up Phase 2 task could ship a default OG asset.)

- [ ] **Step 2: Article detail (`src/pages/articles/[slug].astro:23`)**

Update the `<Base>` invocation:

```astro
<Base
  title={`${article.title} | Wild Media`}
  description={article.description}
  canonicalPath={`/articles/${article.slug}`}
  ogImage={article.coverImageUrl}
  ogType="article"
  articlePublishedTime={article.publishedAtISO}
  articleModifiedTime={article.updatedAtISO}
  articleAuthor={article.authorName}
>
```

- [ ] **Step 3: Writer detail (`src/pages/writers/[slug].astro:27`)**

```astro
<Base
  title={`${writer.name} | Wild Media`}
  description={writer.bio ? writer.bio.slice(0, 160) : `${writer.name}の記事一覧 — Wild Media`}
  canonicalPath={`/writers/${writer.slug}`}
  ogImage={writer.avatarUrl ?? undefined}
  ogType="profile"
>
```

- [ ] **Step 4: Writer index (`src/pages/writers/index.astro:16`)**

```astro
<Base
  title="Writers | Wild Media"
  description="Wild Media に寄稿するライターの一覧。それぞれの視点と専門から、環境と暮らしを書く。"
  canonicalPath="/writers"
>
```

- [ ] **Step 5: Provider detail (`src/pages/providers/[slug].astro:27`)**

```astro
<Base
  title={`${provider.name} | Wild Media`}
  description={provider.description ? provider.description.slice(0, 160) : `${provider.name} — Wild Media 認定プロバイダー`}
  canonicalPath={`/providers/${provider.slug}`}
  ogImage={provider.coverImageUrl ?? undefined}
  ogType="profile"
>
```

If `provider.description` is not currently on the type, either add it via a similar migration + select (out of scope here — use the fallback branch) or shorten the fallback. Confirm the field name in `src/lib/content.ts` before writing.

- [ ] **Step 6: Provider index (`src/pages/providers/index.astro:17`)**

```astro
<Base
  title="Providers | Wild Media"
  description="Wild Media 認定プロバイダー一覧。環境と暮らしに関わるサービスを提供する事業者を紹介。"
  canonicalPath="/providers"
>
```

- [ ] **Step 7: Area page (`src/pages/areas/[area]/[...page].astro:75`)**

```astro
<Base
  title={page.currentPage === 1 ? `${areaLabel} | Wild Media` : `${areaLabel} — ${page.currentPage}ページ目 | Wild Media`}
  description={`${areaLabel}に関する記事の一覧 — Wild Media`}
  canonicalPath={page.currentPage === 1 ? `/areas/${areaSlug}` : `/areas/${areaSlug}/${page.currentPage}`}
>
```

Substitute the variable names that actually exist in that file (likely `area`, `areaSlug`, `areaLabel` — check current source before editing).

- [ ] **Step 8: Build and inspect the output**

Run: `npm run build`
Expected: build succeeds. Verify every HTML page in `dist/` has canonical + description:

```bash
# All pages should have canonical
find dist -name '*.html' -not -path '*/404*' | while read f; do
  grep -q 'rel="canonical"' "$f" || echo "MISSING canonical: $f"
done

# All pages should have description
find dist -name '*.html' -not -path '*/404*' | while read f; do
  grep -q 'name="description"' "$f" || echo "MISSING description: $f"
done

# Article pages should have article:published_time
find dist/articles -name '*.html' | while read f; do
  grep -q 'article:published_time' "$f" || echo "MISSING article:published_time: $f"
done
```

Expected: no "MISSING …" lines.

- [ ] **Step 9: Spot-check social preview with a browser**

Run: `npm run preview`
Open a browser to `http://localhost:4321/articles/<any-slug>` and View Source. Confirm the tags exist and `og:image` is an absolute R2 URL.

- [ ] **Step 10: Commit**

```bash
git add src/pages
git commit -m "feat(seo): pass per-page description, canonical, and OG image to Base layout"
```

---

## Task 7: Custom 404 page

**Files:**
- Create: `src/pages/404.astro`

**Interfaces:**
- Consumes: `Base` (with `noindex` prop added in Task 4).
- Produces: `dist/404.html` exists and Vercel serves it for unknown paths (Astro static builds auto-produce `404.html`, which Vercel picks up).

- [ ] **Step 1: Create `src/pages/404.astro`**

```astro
---
import Base from '../layouts/Base.astro';
---
<Base
  title="ページが見つかりません | Wild Media"
  description="お探しのページは見つかりませんでした。トップまたは記事一覧からお探しください。"
  noindex={true}
>
  <main class="mx-auto max-w-2xl px-6 py-24 text-center">
    <p class="text-sm tracking-widest text-fg-muted">404</p>
    <h1 class="mt-4 text-4xl font-serif">ページが見つかりません</h1>
    <p class="mt-6 text-fg-muted">
      お探しのページは削除されたか、URL が変更された可能性があります。
    </p>
    <div class="mt-10 flex justify-center gap-4">
      <a href="/" class="rounded-full border px-6 py-3">トップへ</a>
      <a href="/writers" class="rounded-full border px-6 py-3">ライターを見る</a>
    </div>
  </main>
</Base>
```

Adjust the Tailwind class names to match the project's existing tokens (search `src/pages/[...page].astro` or `src/components/organisms/Hero.astro` for the actual class conventions if the classes above don't match).

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: `dist/404.html` exists.

```bash
test -f dist/404.html && echo "404 OK"
grep -q 'noindex' dist/404.html && echo "noindex OK"
grep -q 'ページが見つかりません' dist/404.html && echo "copy OK"
```

Expected: three "OK" lines.

- [ ] **Step 3: Commit**

```bash
git add src/pages/404.astro
git commit -m "feat(seo): add branded 404 page with noindex"
```

---

## Task 8: Homepage h1 topical revision

**Files:**
- Modify: `src/components/organisms/Hero.astro:6-11`

**Interfaces:**
- Consumes: nothing.
- Produces: homepage h1 is topical Japanese copy; the existing decorative English tagline is preserved as a subtitle element (not an h1).

- [ ] **Step 1: Read the current Hero**

Read `src/components/organisms/Hero.astro`. Current h1 at lines 6-11 is `<h1>Writings for your well beings</h1>` (or similar).

- [ ] **Step 2: Replace the h1**

Change the h1 to Japanese topical copy and demote the English tagline to a `<p>` or `<span>`:

```astro
<h1 class="[current-h1-classes]">環境と生き方を書く、ライターのメディア</h1>
<p class="[smaller-decorative-classes]">Writings for your well beings</p>
```

Keep the existing class names for visual continuity — just change the text and add a subtitle line.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected:

```bash
grep -o '<h1[^>]*>[^<]*</h1>' dist/index.html | head -1
```

Expected output: `<h1 ...>環境と生き方を書く、ライターのメディア</h1>`.

- [ ] **Step 4: Visual check**

Run: `npm run preview`
Open `http://localhost:4321/` in a browser. Confirm the hero visually still works — Japanese h1 in the display font, English tagline visible as a subtitle.

- [ ] **Step 5: Commit**

```bash
git add src/components/organisms/Hero.astro
git commit -m "feat(seo): topical Japanese h1 on homepage; demote English tagline to subtitle"
```

---

## Self-Review

**Spec coverage (audit → tasks):**
- Robots.txt → Task 1 ✓
- Sitemap → Task 1 ✓
- `astro.config.mjs` `site` → Task 1 ✓
- Canonical URLs → Task 4 + 5 ✓
- Per-page `<meta name="description">` → Task 2 (data source) + Task 5 (emitter) + Task 6 (per-page wiring) ✓
- `articles.description` DB column → Task 2 ✓
- Open Graph + Twitter Card → Task 5 + Task 6 ✓
- `article:published_time` / `article:modified_time` / `article:author` → Task 3 (ISO helpers) + Task 5 + Task 6 ✓
- Custom 404 → Task 7 ✓
- Hero h1 → Task 8 ✓
- Docs updates (DOMAIN-CHANGE, DATABASE) → Task 1 + Task 2 ✓

**Placeholder scan:** No TBD / TODO / "implement later" / "add appropriate handling" strings. Each step has runnable code or an exact command.

**Type consistency:**
- `fallbackDescription(bodyHtml: string, maxLen = 160): string` — used identically in Task 2 (definition) and Task 6 (via Article.description mapper).
- `toIsoDate(input): string | null` — defined in Task 3; consumed by Article mapper Task 3 step 5; SEO component (Task 5) receives the string-or-null and skips the meta tag when null.
- `absoluteUrl(pathname, site)` — defined in Task 3; consumed by SEO component (Task 5).
- Article fields added in Tasks 2 + 3 (`description`, `publishedAtISO`, `updatedAtISO`) — consumed in Task 6 with identical names.
- Base.astro Props (Task 4) matches SEO.astro Props (Task 5) 1:1.

**Not in scope (Phase 2 / 3 / 4 follow-ups):** JSON-LD, llms.txt, author bio on article page, related articles, breadcrumbs, splash-overlay crawler fix, `astro:assets` image pipeline. These get their own plans.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-seo-foundations.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
