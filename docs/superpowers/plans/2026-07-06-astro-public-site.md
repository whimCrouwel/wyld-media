# Astro 公開サイト実装計画(計画2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** シード済みの Supabase から記事・ライター情報を取得し、Featured 優先のトップ/記事/ライターページを持つ完全静的な公開サイトを Astro でビルドできる状態にする。

**Architecture:** Astro 5 の完全静的ビルド。ビルド時に service role キーで Supabase から全公開データを取得し、Markdown を HTML 化(sanitize 込み)して静的ページを生成する。ブラウザ側 JS はこの計画では一切なし(CMS 画面は計画3)。データ取得ロジックは Supabase クライアントを引数で受け取る純粋関数(`src/lib/content.ts`)にし、Vitest でローカル実 DB に対して統合テストする。

**Tech Stack:** Astro 5(static)、@supabase/supabase-js v2、marked + sanitize-html(ビルド時 Markdown 変換)、Vitest、Node 20+

**設計スペック:** `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md` / **前提:** 計画1(Supabase バックエンド)は main にマージ済み。ローカルスタックが起動していること(`supabase start`)。

## Global Constraints

- `.env` は絶対にコミットしない(`.env.example` をコミットする)。service role キーはビルド時・テスト時・シード時のみ使用し、ブラウザに渡るコードから import しない
- URL 構造: 記事 `/articles/{slug}`、ライター `/writers/{slug}`(スペックで確定済み)
- Featured = 「最新の依頼記事(`commissioned_by` 非 null)を `settings.featured_count` 件」。枠から外れた依頼記事は通常一覧に並ぶ
- 公開ページに出すのは `status = 'published'` の記事のみ。下書きはいかなる形でも露出させない
- Markdown はビルド時に HTML 化し、必ず sanitize-html を通す(記事本文由来の `<script>` 等を除去)
- UI テキストは日本語。デザインなし(素の HTML、CSS は書かない)— MVP 方針
- PostgREST の埋め込みは FK 名で曖昧性解消する: `profiles!articles_author_id_fkey` / `profiles!articles_commissioned_by_fkey`(articles は profiles への FK を2本持つため必須)
- シードデータの published_at は明示指定する(service role は trusted なので任意の日時を設定できる)。同一著者の通常記事は 10 日以上間隔を空けた日付にし、**古い順に insert** する(頻度制限トリガーは insert 時の既存最新公開日を見るため)
- コミットメッセージは Conventional Commits
- テスト実行: `npm test`(Vitest)。ビルド検証: `npm run build`

---

### Task 1: Astro プロジェクトの雛形と Supabase クライアント

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/env.d.ts`, `src/lib/supabase-server.ts`, `src/pages/index.astro`(仮)
- Create: `.env.example`, `.env`(コミットしない)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: ローカル Supabase スタック(`supabase status` のキー)
- Produces: `npm run dev/build/test/seed` が動く Astro プロジェクト。`supabaseServer`(service role クライアント、Astro ページ専用)

- [ ] **Step 1: Node バージョン確認**

Run: `node --version`
Expected: v20 以上(v18.17+ でも可)。無ければ report して停止

- [ ] **Step 2: package.json を作成**

```json
{
  "name": "wild-media",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run --passWithNoTests",
    "seed": "node scripts/seed.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "astro": "^5.0.0",
    "marked": "^14.0.0",
    "sanitize-html": "^2.13.0"
  },
  "devDependencies": {
    "@types/sanitize-html": "^2.11.0",
    "dotenv": "^16.4.0",
    "vitest": "^2.1.0"
  }
}
```

(バージョン解決に失敗するパッケージがあれば最新安定版に上げてよい。メジャーの乗り換えが必要な場合は報告すること)

- [ ] **Step 3: 設定ファイル群を作成**

`astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
});
```

`tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "src/**/*", "tests/**/*"],
  "exclude": ["dist"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
  },
});
```

`src/env.d.ts`:

```ts
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: 環境変数ファイルを作成**

`.env.example`(コミットする):

```env
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`.env`(コミットしない): `supabase status` を実行し、ANON_KEY と SERVICE_ROLE_KEY の実値を入れて上記と同形式で作成する。

`.gitignore` の末尾に追記:

```gitignore
# Astro / Node
dist/
.astro/
.env
```

- [ ] **Step 5: Supabase サーバークライアントと仮トップページ**

`src/lib/supabase-server.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env に設定してください',
  );
}

// ビルド時専用クライアント。ブラウザに渡るコードから import しないこと。
export const supabaseServer = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
```

`src/pages/index.astro`(Task 4 で置き換える仮ページ。supabase は import しない):

```astro
---
const title = 'Wild Media';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>{title}</title></head>
  <body>
    <h1>{title}</h1>
    <p>準備中</p>
  </body>
</html>
```

- [ ] **Step 6: インストールとビルド確認**

Run: `npm install`
Expected: エラーなし(peer dependency 警告は許容)

Run: `npm run build`
Expected: `dist/index.html` が生成され、ビルドが成功する

Run: `npm test`
Expected: テスト 0 件で正常終了(--passWithNoTests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json vitest.config.ts src .env.example .gitignore
git commit -m "chore: scaffold astro static site with supabase client"
```

---

### Task 2: シードスクリプト(ローカル開発用サンプルデータ)

**Files:**
- Create: `scripts/seed.mjs`

**Interfaces:**
- Consumes: 計画1のスキーマ・トリガー(依頼コード自動生成、頻度制限、published_at の trusted 挙動)
- Produces: 決定的なシードデータ。ユーザー4名(admin / writer×2 / provider)、公開記事5本(うち依頼記事2本)、下書き1本。slug は `kawabe-kansatsu`, `koke-no-mori`, `toshi-no-yachou`, `kigyou-no-mori`(依頼), `kaigan-seisou`(依頼)。Task 3 のテストと Task 4 のビルド検証はこのデータに依存する

- [ ] **Step 1: seed.mjs を書く**

`scripts/seed.mjs`:

```js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を .env に設定してください');
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const USERS = [
  { email: 'admin@seed.local', role: 'admin', slug: 'seed-admin', name: '運営 太郎', bio: '' },
  { email: 'hana@seed.local', role: 'writer', slug: 'tanaka-hana', name: '田中 花', bio: '川と森を歩いて書くネイチャーライター。' },
  { email: 'kenta@seed.local', role: 'writer', slug: 'sato-kenta', name: '佐藤 健太', bio: '都市の生きものを追いかけています。' },
  { email: 'forest@seed.local', role: 'provider', slug: 'forest-org', name: 'フォレスト再生機構', bio: '企業と森をつなぐNPO。' },
];

// 通常記事は同一著者で10日以上間隔を空け、古い順に insert する(頻度制限トリガー対策)。
// published_at の明示指定は service role(trusted)だから通る。
// kawabe-kansatsu の本文にはサニタイズ検証用の <script> を意図的に含めている。
const ARTICLES = [
  { author: 'tanaka-hana', slug: 'kawabe-kansatsu', title: '川辺の観察日記', publishedAt: daysAgo(30),
    body: '## 川辺にて\n\n朝の川辺を歩いた。\n\n- カワセミ\n- サギ\n\n<script>alert("xss")</script>\n\n**静かな時間**だった。' },
  { author: 'tanaka-hana', slug: 'koke-no-mori', title: '苔の森を歩く', publishedAt: daysAgo(15),
    body: '## 苔の森\n\n雨上がりの森は苔が輝く。' },
  { author: 'sato-kenta', slug: 'toshi-no-yachou', title: '都市の野鳥観察', publishedAt: daysAgo(5),
    cover: 'https://placehold.co/1600x900', body: '## 街の鳥たち\n\n公園のカラスを観察した。' },
  { author: 'tanaka-hana', slug: 'kigyou-no-mori', title: '企業の森づくり最前線', publishedAt: daysAgo(3),
    commissioned: true, body: '## 企業の森\n\nフォレスト再生機構の活動を取材した。' },
  { author: 'tanaka-hana', slug: 'kaigan-seisou', title: '海岸清掃の一日', publishedAt: daysAgo(1),
    commissioned: true, body: '## 海岸にて\n\n清掃活動に参加した。' },
];

async function main() {
  // 1) auth ユーザーを冪等に確保し、profiles を upsert
  const { data: listed, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const byEmail = new Map(listed.users.map((u) => [u.email, u.id]));

  const ids = {};
  for (const u of USERS) {
    let id = byEmail.get(u.email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: 'seed-pass-1234',
        email_confirm: true,
      });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      id = data.user.id;
    }
    const { error: upsertError } = await db
      .from('profiles')
      .upsert({ id, role: u.role, slug: u.slug, name: u.name, bio: u.bio }, { onConflict: 'id' });
    if (upsertError) throw new Error(`profile ${u.slug}: ${upsertError.message}`);
    ids[u.slug] = id;
  }

  // 2) provider の依頼コード(insert 時に自動生成済み)を取得
  const { data: provider, error: providerError } = await db
    .from('profiles').select('commission_code').eq('slug', 'forest-org').single();
  if (providerError) throw providerError;
  const code = provider.commission_code;

  // 3) シード著者の記事を全削除してから入れ直す(冪等)
  const authorIds = [ids['tanaka-hana'], ids['sato-kenta']];
  const { error: delError } = await db.from('articles').delete().in('author_id', authorIds);
  if (delError) throw delError;

  for (const a of ARTICLES) {
    const { error } = await db.from('articles').insert({
      author_id: ids[a.author],
      slug: a.slug,
      title: a.title,
      body: a.body,
      cover_image_url: a.cover ?? null,
      status: 'published',
      published_at: a.publishedAt,
      commission_code_input: a.commissioned ? code : null,
    });
    if (error) throw new Error(`article ${a.slug}: ${error.message}`);
  }

  // 4) 公開ページに出てはいけない下書きを1本
  const { error: draftError } = await db.from('articles').insert({
    author_id: ids['tanaka-hana'],
    title: '下書きメモ',
    body: 'まだ書きかけ。',
    status: 'draft',
  });
  if (draftError) throw draftError;

  console.log('Seed complete: 4 users, 5 published articles (2 commissioned), 1 draft');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 実行して検証**

Run: `npm run seed`
Expected: `Seed complete: 4 users, 5 published articles (2 commissioned), 1 draft`

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) filter (where status='published') as pub, count(*) filter (where commissioned_by is not null) as com, count(*) filter (where status='draft') as draft from articles;"`
Expected: `pub=5, com=2, draft=1`

- [ ] **Step 3: 冪等性を検証(もう一度実行)**

Run: `npm run seed && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from articles;"`
Expected: 再実行してもエラーなし、記事は 6 件のまま(重複しない)

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.mjs
git commit -m "feat: add idempotent local seed script"
```

---

### Task 3: コンテンツデータ層(content.ts)+ Vitest 統合テスト

**Files:**
- Create: `src/lib/content.ts`
- Test: `tests/content.test.ts`

**Interfaces:**
- Consumes: シード済みローカル DB(Task 2)。関数はすべて `SupabaseClient` を第1引数に取る(Astro からは `supabaseServer` を、テストからは自前クライアントを渡す)
- Produces(Task 4 と計画3が使う):
  - `fetchPublishedArticles(db): Promise<{ featured: ArticleSummary[]; normal: ArticleSummary[] }>`
  - `fetchArticleBySlug(db, slug: string): Promise<ArticleDetail | null>`
  - `fetchWriters(db): Promise<WriterSummary[]>`
  - `fetchWriterBySlug(db, slug: string): Promise<WriterDetail | null>`
  - `renderMarkdown(markdown: string): string`(sanitize 済み HTML)
  - 型: `ArticleSummary { id, slug, title, coverImageUrl, publishedAt, authorName, authorSlug, commissionedByName }` / `ArticleDetail = ArticleSummary & { bodyHtml }` / `WriterSummary { slug, name, bio }` / `WriterDetail = WriterSummary & { homepageUrl, snsLinks, priceInfo, contactUrl, articles: ArticleSummary[] }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/content.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `../src/lib/content` が存在しない旨のエラー

- [ ] **Step 3: content.ts を実装**

`src/lib/content.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string | null;
  publishedAt: string;
  authorName: string;
  authorSlug: string;
  commissionedByName: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  bodyHtml: string;
}

export interface WriterSummary {
  slug: string;
  name: string;
  bio: string;
}

export interface WriterDetail extends WriterSummary {
  homepageUrl: string | null;
  snsLinks: unknown;
  priceInfo: string | null;
  contactUrl: string | null;
  articles: ArticleSummary[];
}

// articles は profiles への FK を2本持つため、埋め込みは FK 名で曖昧性解消する
const ARTICLE_SELECT =
  'id, slug, title, cover_image_url, published_at, commissioned_by, ' +
  'author:profiles!articles_author_id_fkey(name, slug), ' +
  'commissioned:profiles!articles_commissioned_by_fkey(name)';

// PostgREST の to-one 埋め込みは環境により object / array 両方があり得るので吸収する
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toSummary(row: any): ArticleSummary {
  const author = one<{ name: string; slug: string }>(row.author);
  const commissioned = one<{ name: string }>(row.commissioned);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    coverImageUrl: row.cover_image_url ?? null,
    publishedAt: row.published_at,
    authorName: author?.name ?? '',
    authorSlug: author?.slug ?? '',
    commissionedByName: commissioned?.name ?? null,
  };
}

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });
}

export async function fetchPublishedArticles(
  db: SupabaseClient,
): Promise<{ featured: ArticleSummary[]; normal: ArticleSummary[] }> {
  const { data: settings, error: settingsError } = await db
    .from('settings')
    .select('featured_count')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;

  const { data, error } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []).map(toSummary);
  const featuredIds = new Set(
    rows
      .filter((r) => r.commissionedByName !== null)
      .slice(0, settings.featured_count)
      .map((r) => r.id),
  );
  return {
    featured: rows.filter((r) => featuredIds.has(r.id)),
    normal: rows.filter((r) => !featuredIds.has(r.id)),
  };
}

export async function fetchArticleBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<ArticleDetail | null> {
  const { data, error } = await db
    .from('articles')
    .select(`${ARTICLE_SELECT}, body`)
    .eq('status', 'published')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...toSummary(data), bodyHtml: renderMarkdown((data as any).body) };
}

export async function fetchWriters(db: SupabaseClient): Promise<WriterSummary[]> {
  const { data, error } = await db
    .from('profiles')
    .select('slug, name, bio')
    .eq('role', 'writer')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({ slug: row.slug, name: row.name, bio: row.bio }));
}

export async function fetchWriterBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<WriterDetail | null> {
  const { data: profile, error } = await db
    .from('profiles')
    .select('id, slug, name, bio, homepage_url, sns_links, price_info, contact_url')
    .eq('role', 'writer')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const { data: articles, error: articlesError } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .eq('author_id', profile.id)
    .order('published_at', { ascending: false });
  if (articlesError) throw articlesError;

  return {
    slug: profile.slug,
    name: profile.name,
    bio: profile.bio,
    homepageUrl: profile.homepage_url ?? null,
    snsLinks: profile.sns_links ?? [],
    priceInfo: profile.price_info ?? null,
    contactUrl: profile.contact_url ?? null,
    articles: (articles ?? []).map(toSummary),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 6 tests passed(renderMarkdown 1 + データ層 5)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content.ts tests/content.test.ts
git commit -m "feat: content data layer with markdown rendering and featured split"
```

---

### Task 4: 公開ページ(トップ / 記事 / ライター一覧 / ライター個別)

**Files:**
- Create: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`(Task 1 の仮ページを置き換え)
- Create: `src/pages/articles/[slug].astro`
- Create: `src/pages/writers/index.astro`
- Create: `src/pages/writers/[slug].astro`

**Interfaces:**
- Consumes: Task 3 の `fetchPublishedArticles` / `fetchArticleBySlug` / `fetchWriters` / `fetchWriterBySlug` と `supabaseServer`
- Produces: 静的ページ `dist/index.html`, `dist/articles/<slug>/index.html` ×5, `dist/writers/index.html`, `dist/writers/<slug>/index.html` ×2

- [ ] **Step 1: 共通レイアウト**

`src/layouts/Base.astro`:

```astro
---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Wild Media</a> | <a href="/writers">ライター一覧</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>Wild Media — ライターと環境のためのプラットフォーム</p>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: トップページ(Featured 優先)**

`src/pages/index.astro` を以下で置き換え:

```astro
---
import Base from '../layouts/Base.astro';
import { supabaseServer } from '../lib/supabase-server';
import { fetchPublishedArticles } from '../lib/content';

const { featured, normal } = await fetchPublishedArticles(supabaseServer);
const fmt = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');
---
<Base title="Wild Media">
  <h1>Wild Media</h1>

  {featured.length > 0 && (
    <section>
      <h2>Featured</h2>
      <ul>
        {featured.map((a) => (
          <li>
            <a href={`/articles/${a.slug}`}>{a.title}</a>
            — <a href={`/writers/${a.authorSlug}`}>{a.authorName}</a>
            <small>({fmt(a.publishedAt)} / 提供: {a.commissionedByName})</small>
          </li>
        ))}
      </ul>
    </section>
  )}

  <section>
    <h2>記事一覧</h2>
    <ul>
      {normal.map((a) => (
        <li>
          <a href={`/articles/${a.slug}`}>{a.title}</a>
          — <a href={`/writers/${a.authorSlug}`}>{a.authorName}</a>
          <small>({fmt(a.publishedAt)})</small>
        </li>
      ))}
    </ul>
  </section>
</Base>
```

- [ ] **Step 3: 記事ページ**

`src/pages/articles/[slug].astro`:

```astro
---
import Base from '../../layouts/Base.astro';
import { supabaseServer } from '../../lib/supabase-server';
import { fetchPublishedArticles, fetchArticleBySlug } from '../../lib/content';
import type { ArticleDetail } from '../../lib/content';

export async function getStaticPaths() {
  const { featured, normal } = await fetchPublishedArticles(supabaseServer);
  const details = await Promise.all(
    [...featured, ...normal].map((a) => fetchArticleBySlug(supabaseServer, a.slug)),
  );
  return details
    .filter((d): d is ArticleDetail => d !== null)
    .map((article) => ({ params: { slug: article.slug }, props: { article } }));
}

interface Props {
  article: ArticleDetail;
}
const { article } = Astro.props;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');
---
<Base title={`${article.title} | Wild Media`}>
  <article>
    <h1>{article.title}</h1>
    <p>
      <a href={`/writers/${article.authorSlug}`}>{article.authorName}</a>
      / {fmt(article.publishedAt)}
      {article.commissionedByName && <strong>(Featured — 提供: {article.commissionedByName})</strong>}
    </p>
    {article.coverImageUrl && <img src={article.coverImageUrl} alt="" width="800" />}
    <div set:html={article.bodyHtml} />
  </article>
</Base>
```

- [ ] **Step 4: ライター一覧・個別ページ**

`src/pages/writers/index.astro`:

```astro
---
import Base from '../../layouts/Base.astro';
import { supabaseServer } from '../../lib/supabase-server';
import { fetchWriters } from '../../lib/content';

const writers = await fetchWriters(supabaseServer);
---
<Base title="ライター一覧 | Wild Media">
  <h1>ライター一覧</h1>
  <ul>
    {writers.map((w) => (
      <li>
        <a href={`/writers/${w.slug}`}>{w.name}</a>
        <p>{w.bio}</p>
      </li>
    ))}
  </ul>
</Base>
```

`src/pages/writers/[slug].astro`:

```astro
---
import Base from '../../layouts/Base.astro';
import { supabaseServer } from '../../lib/supabase-server';
import { fetchWriters, fetchWriterBySlug } from '../../lib/content';
import type { WriterDetail } from '../../lib/content';

export async function getStaticPaths() {
  const writers = await fetchWriters(supabaseServer);
  const details = await Promise.all(
    writers.map((w) => fetchWriterBySlug(supabaseServer, w.slug)),
  );
  return details
    .filter((d): d is WriterDetail => d !== null)
    .map((writer) => ({ params: { slug: writer.slug }, props: { writer } }));
}

interface Props {
  writer: WriterDetail;
}
const { writer } = Astro.props;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');
---
<Base title={`${writer.name} | Wild Media`}>
  <h1>{writer.name}</h1>
  <p>{writer.bio}</p>
  <ul>
    {writer.homepageUrl && <li><a href={writer.homepageUrl}>ホームページ</a></li>}
    {Array.isArray(writer.snsLinks) &&
      writer.snsLinks.map((url) => <li><a href={String(url)}>{String(url)}</a></li>)}
    {writer.priceInfo && <li>料金: {writer.priceInfo}</li>}
    {writer.contactUrl && <li><a href={writer.contactUrl}>相談窓口</a></li>}
  </ul>

  <h2>記事</h2>
  <ul>
    {writer.articles.map((a) => (
      <li>
        <a href={`/articles/${a.slug}`}>{a.title}</a>
        <small>({fmt(a.publishedAt)}{a.commissionedByName ? ' / Featured' : ''})</small>
      </li>
    ))}
  </ul>
</Base>
```

- [ ] **Step 5: ビルドして検証**

Run: `npm run build`
Expected: エラーなし

Run: `ls dist/articles && ls dist/writers`
Expected: articles に `kawabe-kansatsu kigyou-no-mori koke-no-mori kaigan-seisou toshi-no-yachou` の5ディレクトリ、writers に `index.html sato-kenta tanaka-hana`

Run: `grep -o "海岸清掃の一日" dist/index.html | head -1 && grep -o "フォレスト再生機構" dist/index.html | head -1`
Expected: 両方ヒット(Featured 枠が出ている)

Run: `grep -q 'alert("xss")' dist/articles/kawabe-kansatsu/index.html && echo "LEAKED" || echo "sanitized"`
Expected: `sanitized`(本文の script が除去されている)

Run: `grep -r "下書きメモ" dist || echo "no drafts leaked"`
Expected: `no drafts leaked`

- [ ] **Step 6: 全テスト再実行**

Run: `npm test`
Expected: 6/6 passed

- [ ] **Step 7: Commit**

```bash
git add src/layouts src/pages
git commit -m "feat: public pages (top with featured, article, writer list/detail)"
```

---

### Task 5: README(ローカル開発の起動手順)

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: 新しい環境でプロジェクトを立ち上げる手順書

- [ ] **Step 1: README.md を書く**

````markdown
# Wild Media v2.0

ライターと環境のためのプラットフォーム。Astro(完全静的)+ Supabase + Cloudflare R2。

- 設計スペック: `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md`
- 実装計画: `docs/superpowers/plans/`

## ローカル開発

前提: Docker Desktop / Supabase CLI / Node 20+

```bash
supabase start          # ローカル Supabase(初回は数分)
supabase db reset       # マイグレーション適用
supabase test db        # DB層テスト(pgTAP)

cp .env.example .env    # supabase status のキーを転記
npm install
npm run seed            # サンプルデータ投入(冪等)
npm test                # データ層テスト(Vitest)
npm run build           # 静的ビルド
npm run preview         # http://localhost:4321
```

Edge Functions(招待・画像アップロードURL発行)の起動:

```bash
supabase functions serve --env-file supabase/functions/.env
```

## 構成

- `supabase/migrations/` — スキーマ・RLS・トリガー(権限とビジネスルールはすべてDB層で強制)
- `supabase/functions/` — invite-user / r2-upload-url
- `src/lib/content.ts` — ビルド時データ取得(service role)
- `src/pages/` — 公開ページ(トップ / articles / writers)
- `scripts/seed.mjs` — ローカル用シード
````

- [ ] **Step 2: 手順どおりに動くことを最終確認**

Run: `npm test && npm run build`
Expected: 6/6 passed、ビルド成功

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add local development quickstart"
```

---

## この計画のスコープ外

- CMS 画面一式(ログイン / ダッシュボード / プロフィール編集 / 記事エディタ / 画像クロップ&アップロード / 管理者画面)→ **計画3**
- Supabase Database Webhook → Cloudflare Pages Deploy Hook の再ビルド設定、ホスト版デプロイ → デプロイタスク
- デザイン / CSS(MVP は素の HTML)
