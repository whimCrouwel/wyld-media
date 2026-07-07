# 記事エディタ実装計画(計画4/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CMS(`admin/`)にログインしたライターが、記事を新規作成し、マークダウンで本文を書き、slug と依頼者コードを設定して、下書き保存・公開・再編集できる状態にする。カバー画像は当面URL入力欄(画像パイプラインは計画5)。管理者画面は計画6。

**Architecture:** 計画3の CMS 土台を踏襲。ブラウザから Supabase に直結(anon キー + セッション + RLS)。記事の作成/取得/更新/削除・slug 重複チェック・依頼者コード検証は `admin/src/lib/articles.ts`(SupabaseClient を引数に取る純粋関数群)に集約し、Vitest で seed 済みローカル DB に対して統合テストする(作成→検証→後始末で冪等)。エディタページはプレーンな Astro ページ + クライアント `<script>`。マークダウンプレビューは公開サイトと同じ `marked` + `sanitize-html` をブラウザで実行。DB トリガー(頻度制限・依頼コード解決・published_at サーバー権威・依頼リンク解除ガード)が最終防衛線で、エディタはそのエラーを日本語に翻訳して表示する。

**Tech Stack:** Astro 5(static + client `<script>`)、@supabase/supabase-js v2(anon)、marked + sanitize-html(admin に追加)、Vitest、Node 20+。EasyMDE 等の追加エディタライブラリは使わない(素の textarea + ライブプレビュー)。

**設計スペック:** `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md` / **前提:** 計画1〜3(バックエンド・公開サイト・CMS土台)は main にマージ済み。ローカル Supabase 起動 + `npm run seed` 済み。CMS は `cd admin && npm run dev`(4322)。

## Global Constraints

- CMS は anon キーのみ。service role キーを `admin/` に含めない
- すべて `admin/` 以下。ルート公開サイトは変更しない(例外は無し。README も `admin/` の話は計画3で済み)
- 認証必須ページはセッションが無ければ `/login` へ(計画3の else ブロックガードパターンを踏襲。`session!` を null セッションで参照しない)
- 権限・ビジネスルールは RLS + トリガーが強制。クライアントチェックは UX 補助
- **記事 UPDATE では必ず `commission_code_input` を現在値で送る**(送らない/null にすると依頼リンク `commissioned_by` が解除される。トリガー仕様)。編集フォームはロード時に `commission_code_input` を欄に入れ、保存時に送る
- **`published_at` はクライアントから送らない**(トリガーがサーバー権威で設定。untrusted クライアントの値は無視/不可)
- slug 形式は `^[a-z0-9]+(-[a-z0-9]+)*$`(articles も profiles と同じ)。公開には slug 必須(draft は任意)
- DB トリガー/制約のエラー文字列 → 日本語メッセージの対応(フロントが文字列判定):
  - `POST_INTERVAL_NOT_ELAPSED` → 「前回の通常記事の公開から一定期間が経過していません。」
  - `INVALID_COMMISSION_CODE` → 「依頼者コードが正しくありません。」
  - `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` → 「公開中の依頼記事から依頼リンクを外すには、一度下書きに戻してください。」
  - Postgres unique 違反(コード `23505`)で slug 起因 → 「このスラッグは既に使われています。」
- 依頼者コードの実在チェックは RPC `validate_commission_code(code)`(一致で provider 名を返す。列挙不可)。ライブ表示は UX、保存時の最終検証はトリガー
- URL 入力(cover_image_url)は `safeUrl`(http/https のみ)を通す。計画3の `admin/src/lib/profile.ts` の `safeUrl` を共有ユーティリティに切り出して再利用する
- UI テキストは日本語。デザインなし(素の HTML、CSS は書かない)
- コミットメッセージは Conventional Commits
- テスト: `cd admin && npm test`。ビルド: `cd admin && npm run build`

---

### Task 1: safeUrl を共有ユーティリティに切り出す(準備リファクタ)

**Files:**
- Create: `admin/src/lib/url.ts`
- Modify: `admin/src/lib/profile.ts`(`safeUrl` の定義を削除し `url.ts` から再export or import)
- Modify: `admin/tests/profile.test.ts`(import 元を変更、または url.test.ts に safeUrl テストを移設)
- Create: `admin/tests/url.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `safeUrl(value: unknown): string | null`(`admin/src/lib/url.ts` から export)。profile.ts と articles.ts(Task 2)が import する

- [ ] **Step 1: url.ts に safeUrl を移設**

`admin/src/lib/url.ts`:

```ts
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? trimmed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: profile.ts を url.ts 利用に変更**

`admin/src/lib/profile.ts` の先頭で `safeUrl` の定義を削除し、代わりに:

```ts
import { safeUrl } from './url';
```

を追加(`parseSnsLinks` や `buildProfileUpdate` はそのまま `safeUrl` を使う)。profile.ts が `safeUrl` を re-export していた場合はそのまま export 継続してよいが、他所は url.ts から取る。

- [ ] **Step 3: テストを用意**

`admin/tests/url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safeUrl } from '../src/lib/url';

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('rejects javascript:, malformed, empty, non-string', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});
```

`admin/tests/profile.test.ts` の中の `safeUrl` を直接テストしている `describe('safeUrl', ...)` ブロックは削除する(url.test.ts に移ったため)。`parseSnsLinks` / `buildProfileUpdate` のテストは残す。import 行から `safeUrl` を除き、`parseSnsLinks, buildProfileUpdate` のみ import する。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: すべて green。安全のため件数を確認: url 2 + profile(parseSnsLinks 1 + buildProfileUpdate 2 = 3)+ auth 4 + dashboard 1 = 10(合計は変わらず、safeUrl 2件が profile から url へ移動しただけ)

- [ ] **Step 5: ビルド確認とコミット**

Run: `cd admin && npm run build`
Expected: 成功

```bash
git add admin/src/lib/url.ts admin/src/lib/profile.ts admin/tests/url.test.ts admin/tests/profile.test.ts
git commit -m "refactor: extract safeUrl into shared url util"
```

---

### Task 2: 記事データ層(articles.ts)+ 統合テスト

**Files:**
- Create: `admin/src/lib/articles.ts`
- Create: `admin/tests/articles.test.ts`

**Interfaces:**
- Consumes: Task 1 の `safeUrl`。seed 済み DB(writer hana@seed.local、provider forest-org の commission_code)
- Produces(Task 4 のエディタページが使う):
  - `ArticleInput { title, slug, body, coverUrl, commissionCode }`(フォーム由来。coverUrl/commissionCode/slug は空文字可)
  - `buildArticlePayload(input): { title, slug, body, cover_image_url, commission_code_input }`(空→null、cover は safeUrl。status/published_at/commissioned_by は含めない)
  - `createDraft(supabase, input): Promise<string>`(author は RLS/セッション。status=draft で insert、新規 id を返す)
  - `fetchArticleForEdit(supabase, id): Promise<EditableArticle | null>`(自分の記事のみ。commission_code_input と status も返す)
  - `saveArticle(supabase, id, input, publish: boolean): Promise<void>`(update。publish=true なら status=published、false なら現状維持。commission_code_input を必ず送る)
  - `deleteArticle(supabase, id): Promise<void>`
  - `checkSlugAvailable(supabase, slug, excludeId?): Promise<boolean>`(articles に同 slug が無ければ true。RLS で他人の記事は見えないため、DB unique 制約が最終判定 — この関数は自分の記事内の重複と「空きの可能性」を返す UX 補助)
  - `validateCommissionCode(supabase, code): Promise<string | null>`(RPC 呼び出し。provider 名 or null)
  - 型 `EditableArticle { id, title, slug, body, coverImageUrl, commissionCodeInput, status }`

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/articles.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npm test`
Expected: FAIL — `../src/lib/articles` が存在しない

- [ ] **Step 3: articles.ts を実装**

`admin/src/lib/articles.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeUrl } from './url';

export interface ArticleInput {
  title: string;
  slug: string;
  body: string;
  coverUrl: string;
  commissionCode: string;
}

export interface ArticlePayload {
  title: string;
  slug: string | null;
  body: string;
  cover_image_url: string | null;
  commission_code_input: string | null;
}

export interface EditableArticle {
  id: string;
  title: string;
  slug: string | null;
  body: string;
  coverImageUrl: string | null;
  commissionCodeInput: string | null;
  status: 'draft' | 'published';
}

function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

export function buildArticlePayload(input: ArticleInput): ArticlePayload {
  return {
    title: input.title.trim(),
    slug: emptyToNull(input.slug),
    body: input.body,
    cover_image_url: safeUrl(input.coverUrl),
    commission_code_input: emptyToNull(input.commissionCode),
  };
}

export async function createDraft(supabase: SupabaseClient, input: ArticleInput): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const payload = buildArticlePayload(input);
  const { data, error } = await supabase
    .from('articles')
    .insert({ ...payload, author_id: user.id, status: 'draft' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function fetchArticleForEdit(
  supabase: SupabaseClient, id: string,
): Promise<EditableArticle | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, slug, body, cover_image_url, commission_code_input, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    body: data.body,
    coverImageUrl: data.cover_image_url,
    commissionCodeInput: data.commission_code_input,
    status: data.status,
  };
}

export async function saveArticle(
  supabase: SupabaseClient, id: string, input: ArticleInput, publish: boolean,
): Promise<void> {
  const payload = buildArticlePayload(input);
  // publish=true のときだけ status を published に上げる。false なら status を触らない
  // (未指定にすると現状維持)。published_at は送らない(トリガーが権威)。
  const update: Record<string, unknown> = { ...payload };
  if (publish) update.status = 'published';
  const { error } = await supabase.from('articles').update(update).eq('id', id);
  if (error) throw error;
}

export async function deleteArticle(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) throw error;
}

export async function checkSlugAvailable(
  supabase: SupabaseClient, slug: string, excludeId?: string,
): Promise<boolean> {
  let query = supabase.from('articles').select('id').eq('slug', slug);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length === 0;
}

export async function validateCommissionCode(
  supabase: SupabaseClient, code: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('validate_commission_code', { code });
  if (error) throw error;
  return (data as string | null) ?? null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: すべて green(url 2 + profile 3 + auth 4 + dashboard 1 + articles: buildArticlePayload 3 + validate 1 + CRUD 3 = 7 → 合計 17)

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/articles.ts admin/tests/articles.test.ts
git commit -m "feat: article data layer with slug/commission helpers"
```

---

### Task 3: エラー翻訳 + マークダウンプレビュー ユーティリティ

**Files:**
- Create: `admin/src/lib/editor-helpers.ts`
- Create: `admin/tests/editor-helpers.test.ts`
- Modify: `admin/package.json`(dependencies に `marked` と `sanitize-html`、devDependencies に `@types/sanitize-html` を追加)

**Interfaces:**
- Consumes: なし(marked/sanitize-html は追加)
- Produces:
  - `translateSaveError(err: unknown): string`(DB エラー → 日本語。既知の文字列/コードを判定、未知は汎用文言)
  - `isValidArticleSlug(slug: string): boolean`(形式チェック `^[a-z0-9]+(-[a-z0-9]+)*$`)
  - `renderMarkdownPreview(md: string): string`(marked + sanitize-html。公開サイトと同じ sanitize 方針)

- [ ] **Step 1: marked/sanitize-html を admin に追加**

`admin/package.json` の dependencies に追加:

```json
"marked": "^14.0.0",
"sanitize-html": "^2.13.0"
```

devDependencies に追加:

```json
"@types/sanitize-html": "^2.11.0"
```

Run: `cd admin && npm install`

- [ ] **Step 2: 失敗するテストを書く**

`admin/tests/editor-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { translateSaveError, isValidArticleSlug, renderMarkdownPreview } from '../src/lib/editor-helpers';

describe('isValidArticleSlug', () => {
  it('accepts lowercase-hyphen slugs', () => {
    expect(isValidArticleSlug('forest-2026')).toBe(true);
    expect(isValidArticleSlug('abc')).toBe(true);
  });
  it('rejects uppercase, spaces, leading/trailing/double hyphen, empty', () => {
    expect(isValidArticleSlug('Bad')).toBe(false);
    expect(isValidArticleSlug('a b')).toBe(false);
    expect(isValidArticleSlug('-x')).toBe(false);
    expect(isValidArticleSlug('x-')).toBe(false);
    expect(isValidArticleSlug('a--b')).toBe(false);
    expect(isValidArticleSlug('')).toBe(false);
  });
});

describe('translateSaveError', () => {
  it('maps known trigger error strings to Japanese', () => {
    expect(translateSaveError({ message: 'POST_INTERVAL_NOT_ELAPSED: ...' })).toMatch(/期間/);
    expect(translateSaveError({ message: 'INVALID_COMMISSION_CODE: ...' })).toMatch(/依頼者コード/);
    expect(translateSaveError({ message: 'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: ...' })).toMatch(/下書き/);
  });
  it('maps unique-violation code 23505 to a slug message', () => {
    expect(translateSaveError({ code: '23505', message: 'duplicate key ... articles_slug_key' })).toMatch(/スラッグ/);
  });
  it('falls back to a generic message for unknown errors', () => {
    expect(translateSaveError({ message: 'something else' })).toMatch(/保存/);
    expect(translateSaveError(null)).toMatch(/保存/);
  });
});

describe('renderMarkdownPreview', () => {
  it('renders markdown and strips scripts', () => {
    const html = renderMarkdownPreview('## 見出し\n\n**強調** <script>alert(1)</script>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd admin && npm test`
Expected: FAIL — `../src/lib/editor-helpers` が存在しない

- [ ] **Step 4: editor-helpers.ts を実装**

`admin/src/lib/editor-helpers.ts`:

```ts
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidArticleSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function translateSaveError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? '';
  if (msg.includes('POST_INTERVAL_NOT_ELAPSED')) {
    return '前回の通常記事の公開から一定期間が経過していません。';
  }
  if (msg.includes('INVALID_COMMISSION_CODE')) {
    return '依頼者コードが正しくありません。';
  }
  if (msg.includes('COMMISSION_UNLINK_REQUIRES_UNPUBLISH')) {
    return '公開中の依頼記事から依頼リンクを外すには、一度下書きに戻してください。';
  }
  if (e?.code === '23505') {
    return 'このスラッグは既に使われています。';
  }
  return '保存に失敗しました。入力内容を確認して再度お試しください。';
}

export function renderMarkdownPreview(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: すべて green(前タスクまでの 17 + editor-helpers: slug 2 + translate 3 + preview 1 = 6 → 合計 23)

- [ ] **Step 6: Commit**

```bash
git add admin/src/lib/editor-helpers.ts admin/tests/editor-helpers.test.ts admin/package.json admin/package-lock.json
git commit -m "feat: editor helpers for error translation, slug check, markdown preview"
```

---

### Task 4: 記事エディタページ(新規/編集・下書き/公開)

**Files:**
- Create: `admin/src/pages/articles/new.astro`
- Create: `admin/src/pages/articles/edit.astro`(記事 id はクエリ文字列 `?id=` で受ける。**理由:** admin は `output: 'static'` なので `[id]` 動的ルートは `getStaticPaths` 必須 or アダプタ必須でビルドできない。クエリ文字列なら完全静的な1ページで済む)
- Modify: `admin/src/pages/dashboard.astro`(「新しい記事を作成」を `/articles/new` に、各記事の「編集」を `/articles/edit?id={id}` に実リンク化し「(準備中)」表記を外す)

**Interfaces:**
- Consumes: Task 2 の articles.ts 全関数、Task 3 の editor-helpers、計画3の `supabaseBrowser` / `redirectTo`
- Produces: 新規作成ページと編集ページ。両者は共通のフォーム構造。動作はブラウザで controller が検証

**背景/共通フォーム:** new と edit はほぼ同じフォーム。重複を避けるため、フォーム DOM は各ページに書くが、ロジック(下書き保存/公開/ライブプレビュー/slug チェック/コード検証)は同じ関数群(articles.ts / editor-helpers.ts)を呼ぶ。new は「作成→そのまま編集 URL へ遷移」、edit は「既存ロード→更新」。

- [ ] **Step 1: 新規作成ページ**

`admin/src/pages/articles/new.astro`:

```astro
---
const title = '新しい記事 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header><nav><a href="/dashboard">← ダッシュボード</a></nav></header>
    <main>
      <h1>新しい記事</h1>
      <form id="article-form">
        <p><label>タイトル <input type="text" id="title" required /></label></p>
        <p><label>スラッグ(公開時は必須・小文字英数字とハイフン) <input type="text" id="slug" /></label>
           <span id="slug-status"></span></p>
        <p><label>カバー画像URL(任意) <input type="url" id="cover" /></label></p>
        <p><label>依頼者コード(任意) <input type="text" id="commission" /></label>
           <span id="commission-status"></span></p>
        <div style="display:flex; gap:1rem;">
          <div style="flex:1;">
            <label>本文(マークダウン)<br />
              <textarea id="body" rows="16" style="width:100%;"></textarea></label>
          </div>
          <div style="flex:1;">
            <p>プレビュー</p>
            <div id="preview"></div>
          </div>
        </div>
        <p>
          <button type="button" id="save-draft">下書き保存</button>
          <button type="button" id="publish">公開する</button>
        </p>
      </form>
      <p id="message" role="alert"></p>
    </main>

    <script>
      import { supabaseBrowser } from '../../lib/supabase-browser';
      import { redirectTo } from '../../lib/auth';
      import { createDraft, saveArticle, validateCommissionCode, checkSlugAvailable } from '../../lib/articles';
      import { translateSaveError, isValidArticleSlug, renderMarkdownPreview } from '../../lib/editor-helpers';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else {
        const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement;
        const messageEl = document.getElementById('message')!;
        const previewEl = document.getElementById('preview')!;
        const slugStatus = document.getElementById('slug-status')!;
        const commissionStatus = document.getElementById('commission-status')!;

        // ライブプレビュー(sanitize 済み)
        const updatePreview = () => { previewEl.innerHTML = renderMarkdownPreview($('body').value); };
        $('body').addEventListener('input', updatePreview);

        // slug ライブチェック
        $('slug').addEventListener('blur', async () => {
          const slug = $('slug').value.trim();
          if (!slug) { slugStatus.textContent = ''; return; }
          if (!isValidArticleSlug(slug)) { slugStatus.textContent = '形式が不正です'; return; }
          slugStatus.textContent = (await checkSlugAvailable(supabaseBrowser, slug)) ? '利用可能' : '使用済み';
        });

        // 依頼者コード ライブチェック
        $('commission').addEventListener('blur', async () => {
          const code = $('commission').value.trim();
          if (!code) { commissionStatus.textContent = ''; return; }
          const name = await validateCommissionCode(supabaseBrowser, code);
          commissionStatus.textContent = name ? `依頼者: ${name}` : 'コードが見つかりません';
        });

        const collect = () => ({
          title: $('title').value, slug: $('slug').value, body: $('body').value,
          coverUrl: $('cover').value, commissionCode: $('commission').value,
        });

        const create = async (publish: boolean) => {
          messageEl.textContent = '';
          const input = collect();
          if (!input.title.trim()) { messageEl.textContent = 'タイトルを入力してください'; return; }
          if (publish && !isValidArticleSlug(input.slug.trim())) {
            messageEl.textContent = '公開にはスラッグが必要です(小文字英数字とハイフン)'; return;
          }
          try {
            const id = await createDraft(supabaseBrowser, input);
            if (publish) {
              await saveArticle(supabaseBrowser, id, input, true);
            }
            // 作成後は編集ページへ(クエリ文字列で id を渡す)
            redirectTo(`/articles/edit?id=${id}`);
          } catch (err) {
            messageEl.textContent = translateSaveError(err);
            console.error(err);
          }
        };

        document.getElementById('save-draft')!.addEventListener('click', () => create(false));
        document.getElementById('publish')!.addEventListener('click', () => create(true));
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: 編集ページ**

`admin/src/pages/articles/edit.astro`(id はクエリ文字列 `?id=`。動的ルートは使わない):

```astro
---
const title = '記事の編集 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header><nav><a href="/dashboard">← ダッシュボード</a></nav></header>
    <main>
      <h1>記事の編集</h1>
      <p id="status-label"></p>
      <form id="article-form">
        <p><label>タイトル <input type="text" id="title" required /></label></p>
        <p><label>スラッグ(公開時は必須) <input type="text" id="slug" /></label>
           <span id="slug-status"></span></p>
        <p><label>カバー画像URL(任意) <input type="url" id="cover" /></label></p>
        <p><label>依頼者コード(任意) <input type="text" id="commission" /></label>
           <span id="commission-status"></span></p>
        <div style="display:flex; gap:1rem;">
          <div style="flex:1;">
            <label>本文(マークダウン)<br />
              <textarea id="body" rows="16" style="width:100%;"></textarea></label>
          </div>
          <div style="flex:1;">
            <p>プレビュー</p>
            <div id="preview"></div>
          </div>
        </div>
        <p>
          <button type="button" id="save-draft">下書き保存</button>
          <button type="button" id="publish">公開する</button>
          <button type="button" id="unpublish">下書きに戻す</button>
          <button type="button" id="delete">削除</button>
        </p>
      </form>
      <p id="message" role="alert"></p>
    </main>

    <script>
      import { supabaseBrowser } from '../../lib/supabase-browser';
      import { redirectTo } from '../../lib/auth';
      import { fetchArticleForEdit, saveArticle, deleteArticle, validateCommissionCode, checkSlugAvailable } from '../../lib/articles';
      import { translateSaveError, isValidArticleSlug, renderMarkdownPreview } from '../../lib/editor-helpers';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else {
        const id = new URLSearchParams(window.location.search).get('id') ?? '';
        const $ = (elId: string) => document.getElementById(elId) as HTMLInputElement & HTMLTextAreaElement;
        const messageEl = document.getElementById('message')!;
        const previewEl = document.getElementById('preview')!;
        const statusLabel = document.getElementById('status-label')!;
        const slugStatus = document.getElementById('slug-status')!;
        const commissionStatus = document.getElementById('commission-status')!;

        const article = await fetchArticleForEdit(supabaseBrowser, id);
        if (!article) {
          messageEl.textContent = '記事が見つかりません(自分の記事のみ編集できます)。';
        } else {
          $('title').value = article.title;
          $('slug').value = article.slug ?? '';
          $('cover').value = article.coverImageUrl ?? '';
          $('commission').value = article.commissionCodeInput ?? '';
          $('body').value = article.body;
          statusLabel.textContent = `状態: ${article.status === 'draft' ? '下書き' : '公開中'}`;
          previewEl.innerHTML = renderMarkdownPreview(article.body);

          $('body').addEventListener('input', () => { previewEl.innerHTML = renderMarkdownPreview($('body').value); });

          $('slug').addEventListener('blur', async () => {
            const slug = $('slug').value.trim();
            if (!slug) { slugStatus.textContent = ''; return; }
            if (!isValidArticleSlug(slug)) { slugStatus.textContent = '形式が不正です'; return; }
            slugStatus.textContent = (await checkSlugAvailable(supabaseBrowser, slug, id)) ? '利用可能' : '使用済み';
          });

          $('commission').addEventListener('blur', async () => {
            const code = $('commission').value.trim();
            if (!code) { commissionStatus.textContent = ''; return; }
            const name = await validateCommissionCode(supabaseBrowser, code);
            commissionStatus.textContent = name ? `依頼者: ${name}` : 'コードが見つかりません';
          });

          const collect = () => ({
            title: $('title').value, slug: $('slug').value, body: $('body').value,
            coverUrl: $('cover').value, commissionCode: $('commission').value,
          });

          const save = async (publish: boolean) => {
            messageEl.textContent = '';
            const input = collect();
            if (!input.title.trim()) { messageEl.textContent = 'タイトルを入力してください'; return; }
            if (publish && !isValidArticleSlug(input.slug.trim())) {
              messageEl.textContent = '公開にはスラッグが必要です(小文字英数字とハイフン)'; return;
            }
            try {
              await saveArticle(supabaseBrowser, id, input, publish);
              messageEl.textContent = publish ? '公開しました。' : '保存しました。';
              const fresh = await fetchArticleForEdit(supabaseBrowser, id);
              if (fresh) statusLabel.textContent = `状態: ${fresh.status === 'draft' ? '下書き' : '公開中'}`;
            } catch (err) {
              messageEl.textContent = translateSaveError(err);
              console.error(err);
            }
          };

          document.getElementById('save-draft')!.addEventListener('click', () => save(false));
          document.getElementById('publish')!.addEventListener('click', () => save(true));

          // 下書きに戻す: status を draft に更新(published_at は据え置き。トリガーは公開遷移時のみ発火)
          document.getElementById('unpublish')!.addEventListener('click', async () => {
            messageEl.textContent = '';
            const input = collect();
            try {
              // commission_code_input を送りつつ status=draft に。saveArticle は publish=false で status を触らないため、
              // 明示的に draft へ落とす専用更新を行う。
              const { error } = await supabaseBrowser
                .from('articles')
                .update({ status: 'draft', commission_code_input: input.commissionCode.trim() || null })
                .eq('id', id);
              if (error) throw error;
              messageEl.textContent = '下書きに戻しました。';
              statusLabel.textContent = '状態: 下書き';
            } catch (err) {
              messageEl.textContent = translateSaveError(err);
              console.error(err);
            }
          });

          document.getElementById('delete')!.addEventListener('click', async () => {
            messageEl.textContent = '';
            try {
              await deleteArticle(supabaseBrowser, id);
              redirectTo('/dashboard');
            } catch (err) {
              messageEl.textContent = translateSaveError(err);
              console.error(err);
            }
          });
        }
      }
    </script>
  </body>
</html>
```

- [ ] **Step 3: ダッシュボードのリンクを実リンク化**

`admin/src/pages/dashboard.astro`:
- 「＋ 新しい記事を作成(準備中)」を `/articles/new` へのリンクにし「(準備中)」を外す
- 記事行の編集リンクの href を `/articles/${a.id}/edit` から `/articles/edit?id=${a.id}` に変更し、`edit.textContent = ' 編集(準備中)';` を `edit.textContent = ' 編集';` に変更する

- [ ] **Step 4: ビルド確認**

Run: `cd admin && npm run build`
Expected: 成功。`admin/dist/articles/new/index.html` と `admin/dist/articles/edit/index.html` が生成される(どちらも静的。編集ページは id をクエリ文字列で受けるので動的ルート不要)

**ブラウザバンドルのリスク:** `renderMarkdownPreview` は `sanitize-html` を使う(公開サイトと同じ・Node のユニットテストは通る)。ただし `sanitize-html` はブラウザ向けバンドルで失敗することがある。**もし `npm run build` が sanitize-html 起因の bundle エラーで落ちる場合**は、`editor-helpers.ts` の `renderMarkdownPreview` だけをブラウザネイティブの `DOMPurify`(`npm i dompurify` を admin に追加)に差し替える: `import DOMPurify from 'dompurify'; export function renderMarkdownPreview(md){ return DOMPurify.sanitize(marked.parse(md, {async:false})); }`。その場合、DOMPurify は DOM を要するため `renderMarkdownPreview` のユニットテスト(editor-helpers.test.ts の該当 describe)は削除し(件数は 23→22)、プレビューのサニタイズはブラウザで controller が検証する(`<script>` が実行されない/描画されないこと)。`translateSaveError` と `isValidArticleSlug` のテストは残す。どちらの方式を採ったか報告すること。

- [ ] **Step 5: 手動確認(controller 実施のため実装者はビルドまで)**

実装者はビルド成功 + 全テスト green までを担保する。ブラウザでの一連(新規作成→下書き保存→編集で再ロード→公開→公開サイトに反映、依頼者コード検証、slug 重複、頻度制限エラー表示)は controller が検証する。

Run: `cd admin && npm test`
Expected: 23 tests green(変更なし)

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/articles admin/src/pages/dashboard.astro
git commit -m "feat: article editor pages (create/edit, draft/publish)"
```

---

### Task 5: README に記事作成の記述を追記

**Files:**
- Modify: `README.md`(ルート)

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: CMS セクションに記事作成フローの一文を追記

- [ ] **Step 1: README の CMS セクションに追記**

`README.md` の CMS セクション末尾(ログインの説明の後)に1行:

```markdown
ログイン後、ダッシュボードの「新しい記事を作成」から記事を執筆できる(マークダウン + ライブプレビュー、下書き保存 / 公開、依頼者コード・スラッグ設定)。
```

- [ ] **Step 2: 破綻していないことを確認**

Run: `cd admin && npm test && npm run build`
Expected: 23 tests、admin ビルド成功

Run: `npm test && npm run build`(ルート公開サイトが無傷)
Expected: 11 tests、9 ページ

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: mention article authoring in CMS section"
```

---

## この計画のスコープ外

- 画像パイプライン(Cropper.js クロップ→リサイズ→WebP→`r2-upload-url`→R2 PUT)で cover_image_url 欄を置き換え → **計画5**
- 管理者画面(ユーザー招待UI・ロール設定・依頼者コード発行・サイト設定 post_interval_days/featured_count)→ **計画6**
- ホスト版デプロイ(`docs/superpowers/DEPLOYMENT-CHECKLIST.md`)→ デプロイタスク

## 計画1〜3から引き継いだ注意点(この計画で守る)

- 記事 UPDATE は `commission_code_input` を必ず現在値で再送(依頼リンク保持)
- `published_at` はクライアントから送らない(トリガー権威)
- 公開中の依頼記事の依頼リンク解除は不可(`COMMISSION_UNLINK_REQUIRES_UNPUBLISH`)→ エディタは「下書きに戻す」導線を用意
- 通常記事の公開は頻度制限あり(`POST_INTERVAL_NOT_ELAPSED`)→ エラーを日本語表示
- CMS は anon キーのみ・RLS が認可・DOM 生データは textContent(プレビューのみ sanitize 済み HTML を innerHTML で描画)
