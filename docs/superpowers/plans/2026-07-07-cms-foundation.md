# CMS 土台(認証+ダッシュボード+プロフィール)実装計画(計画3/4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin.` サブドメイン用の独立した Astro アプリを立て、招待されたユーザーがログインし、自分の記事一覧を見て、自分のプロフィールを編集できる状態にする。記事エディタと管理者画面は計画4。

**Architecture:** 公開サイト(リポジトリ直下、静的、service role でビルド時取得)とは**オリジンを分離**するため、CMS は `admin/` 以下の別 Astro アプリとして作る。CMS はブラウザから Supabase に直結する(**anon キー + ユーザーセッション + RLS**)。service role キーは CMS に一切持ち込まない。各ページはプレーンな Astro ページ + クライアント `<script>`(Supabase JS を使う)で、認証ガードとデータ取得はブラウザで動く。純粋ロジック(バリデーション・データ整形)は `admin/src/lib/*.ts` に切り出して Vitest で単体テストし、画面フローはブラウザで手動確認する(MVP 方針、計画2と同じ)。

**Tech Stack:** Astro 5(static 出力 + client `<script>`)、@supabase/supabase-js v2(ブラウザ、anon キー、`persistSession: true`)、Vitest、Node 20+。フレームワーク(React 等)は追加しない。

**設計スペック:** `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md` / **前提:** 計画1(バックエンド)・計画2(公開サイト)は main にマージ済み。ローカル Supabase スタックが起動し、`npm run seed`(リポジトリ直下)でシード済みであること。

## Global Constraints

- **CMS は anon キーのみ使用。service role キーを CMS のコード・env・ビルド出力に絶対に含めない**(service role はビルド時の公開サイトと Edge Functions 専用)。CMS が使う env は `PUBLIC_SUPABASE_URL` と `PUBLIC_SUPABASE_ANON_KEY` の2つだけ
- CMS アプリはすべて `admin/` ディレクトリ以下に置く。リポジトリ直下の公開サイト(package.json, src/, astro.config.mjs 等)は**変更しない**(唯一の例外は最終タスクの README とルート `.gitignore` への追記)
- ローカル開発ポートは公開サイト(4321)と衝突させない。CMS dev は **4322**、preview も 4322
- 権限は RLS が強制する。クライアント側チェックは UX 補助にすぎない(サーバーが最終防衛線)。プロフィール更新で role/commission_code は触らない(DB トリガーが変更を拒否する)
- プロフィールの URL 入力(homepage_url, sns_links, contact_url)はクライアントでも `http:`/`https:` のみ許可する(公開サイトの `safeUrl` と同じ方針。DB が最終的な真実だが、保存前にUXとして弾く)
- 認証必須ページは、セッションが無ければ `/login` にリダイレクトする(クライアント側ガード。MVP では一瞬の描画は許容)
- UI テキストは日本語。デザインなし(素の HTML、CSS は書かない)
- コミットメッセージは Conventional Commits
- テスト実行: `cd admin && npm test`(Vitest)。ビルド検証: `cd admin && npm run build`

---

### Task 1: CMS アプリの雛形とブラウザ Supabase クライアント

**Files:**
- Create: `admin/package.json`, `admin/astro.config.mjs`, `admin/tsconfig.json`, `admin/vitest.config.ts`
- Create: `admin/src/env.d.ts`, `admin/src/lib/supabase-browser.ts`, `admin/src/pages/index.astro`(仮)
- Create: `admin/.env.example`, `admin/.env`(コミットしない)
- Modify: `.gitignore`(ルート。`admin/dist/`, `admin/.astro/`, `admin/.env`, `admin/node_modules/` を追記)

**Interfaces:**
- Consumes: ローカル Supabase スタック(`supabase status` の ANON_KEY)
- Produces: `cd admin && npm run dev/build/test` が動く CMS アプリ。`supabaseBrowser`(anon クライアント、`persistSession: true`、ブラウザ専用)。dev/preview は http://localhost:4322

- [ ] **Step 1: admin/package.json を作成**

```json
{
  "name": "wild-media-admin",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev --port 4322",
    "build": "astro build",
    "preview": "astro preview --port 4322",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "astro": "^5.0.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 設定ファイル群を作成**

`admin/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  server: { port: 4322 },
});
```

`admin/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "src/**/*", "tests/**/*"],
  "exclude": ["dist"]
}
```

`admin/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

`admin/src/env.d.ts`:

```ts
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: env ファイル**

`admin/.env.example`(コミットする):

```env
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

`admin/.env`(コミットしない): `supabase status` を実行し、**ANON_KEY のみ**を転記する(SERVICE_ROLE_KEY は入れない)。

ルート `.gitignore` の末尾に追記:

```gitignore
# Admin (CMS) app
admin/dist/
admin/.astro/
admin/.env
admin/node_modules/
```

- [ ] **Step 4: ブラウザ Supabase クライアント**

`admin/src/lib/supabase-browser.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を admin/.env に設定してください',
  );
}

// ブラウザ専用クライアント。anon キー + ユーザーセッション(localStorage)。
// service role キーはここに絶対に入れないこと。
export const supabaseBrowser = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

`admin/src/pages/index.astro`(Task 2 以降で置き換える仮ページ):

```astro
---
const title = 'Wild Media CMS';
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

- [ ] **Step 5: インストールとビルド確認**

Run: `cd admin && npm install`
Expected: エラーなし

Run: `cd admin && npm run build`
Expected: `admin/dist/index.html` が生成される

Run: `cd admin && npm test`
Expected: 0 tests、正常終了(--passWithNoTests)

- [ ] **Step 6: service role キーが混入していないことを確認**

Run: `grep -rE 'service_role|SERVICE_ROLE' admin/src admin/.env.example admin/astro.config.mjs || echo "no service role refs"`
Expected: `no service role refs`

- [ ] **Step 7: Commit**

```bash
git add admin/package.json admin/package-lock.json admin/astro.config.mjs admin/tsconfig.json admin/vitest.config.ts admin/src admin/.env.example .gitignore
git commit -m "chore: scaffold admin CMS app with browser supabase client"
```

---

### Task 2: 認証 — ログイン / ログアウト / 認証ガード

**Files:**
- Create: `admin/src/lib/auth.ts`
- Create: `admin/tests/auth.test.ts`
- Create: `admin/src/pages/login.astro`
- Modify: `admin/src/pages/index.astro`(認証済みなら /dashboard、未認証なら /login へ振り分ける)

**Interfaces:**
- Consumes: Task 1 の `supabaseBrowser`
- Produces:
  - `validateLoginInput(email, password): string | null`(エラーメッセージ or null。純粋関数、テスト対象)
  - `requireSession(supabase): Promise<Session | null>` は使わず、各保護ページの `<script>` が `guardOrRedirect()` を呼ぶ。`admin/src/lib/auth.ts` は `validateLoginInput` と `redirectTo(path)` を export(後者は薄い window.location ラッパ)。認証チェック自体はページの script で `supabaseBrowser.auth.getSession()` を直接呼ぶ(DOM/window 依存のためユニットテストせず手動確認)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateLoginInput } from '../src/lib/auth';

describe('validateLoginInput', () => {
  it('returns null for a valid email + non-empty password', () => {
    expect(validateLoginInput('user@example.com', 'secret123')).toBeNull();
  });
  it('rejects an empty email', () => {
    expect(validateLoginInput('', 'secret123')).toMatch(/メール/);
  });
  it('rejects a malformed email', () => {
    expect(validateLoginInput('not-an-email', 'secret123')).toMatch(/メール/);
  });
  it('rejects an empty password', () => {
    expect(validateLoginInput('user@example.com', '')).toMatch(/パスワード/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npm test`
Expected: FAIL — `../src/lib/auth` が存在しない

- [ ] **Step 3: auth.ts を実装**

`admin/src/lib/auth.ts`:

```ts
// メール形式は「@ を含み前後に文字がある」程度の緩いチェック(最終検証は Supabase 側)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginInput(email: string, password: string): string | null {
  if (!email || !EMAIL_RE.test(email)) {
    return 'メールアドレスを正しく入力してください';
  }
  if (!password) {
    return 'パスワードを入力してください';
  }
  return null;
}

export function redirectTo(path: string): void {
  window.location.assign(path);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: 4 tests passed

- [ ] **Step 5: ログインページ**

`admin/src/pages/login.astro`:

```astro
---
const title = 'ログイン | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <h1>ログイン</h1>
    <form id="login-form">
      <p><label>メールアドレス <input type="email" id="email" required /></label></p>
      <p><label>パスワード <input type="password" id="password" required /></label></p>
      <p><button type="submit">ログイン</button></p>
    </form>
    <p id="error" role="alert"></p>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { validateLoginInput, redirectTo } from '../lib/auth';

      const form = document.getElementById('login-form') as HTMLFormElement;
      const errorEl = document.getElementById('error')!;

      // 既にログイン済みならダッシュボードへ
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (session) redirectTo('/dashboard');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        const email = (document.getElementById('email') as HTMLInputElement).value.trim();
        const password = (document.getElementById('password') as HTMLInputElement).value;

        const validationError = validateLoginInput(email, password);
        if (validationError) { errorEl.textContent = validationError; return; }

        const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
        if (error) { errorEl.textContent = 'ログインに失敗しました: ' + error.message; return; }
        redirectTo('/dashboard');
      });
    </script>
  </body>
</html>
```

- [ ] **Step 6: index を振り分けに変更**

`admin/src/pages/index.astro` を以下で置き換え:

```astro
---
const title = 'Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>{title}</title></head>
  <body>
    <p>読み込み中…</p>
    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      redirectTo(session ? '/dashboard' : '/login');
    </script>
  </body>
</html>
```

- [ ] **Step 7: ビルドして手動確認**

Run: `cd admin && npm run build && npm run preview` (バックグラウンドで起動)

ブラウザで確認(シードのライター `hana@seed.local` / パスワード `seed-pass-1234` を使う):
- http://localhost:4322/login にアクセス → ログインフォームが出る
- 空メールで送信 → 「メールアドレスを正しく入力してください」
- `hana@seed.local` + 誤ったパスワード → 「ログインに失敗しました…」
- `hana@seed.local` + `seed-pass-1234` → `/dashboard` にリダイレクト(まだ Task 4 未実装なので 404 で可。URL が `/dashboard` になることを確認)
- http://localhost:4322/ にアクセス → 未ログインなら /login、ログイン済みなら /dashboard に飛ぶ

(preview サーバーは確認後に停止する)

- [ ] **Step 8: Commit**

```bash
git add admin/src/lib/auth.ts admin/tests/auth.test.ts admin/src/pages/login.astro admin/src/pages/index.astro
git commit -m "feat: cms login page with client-side auth and validation"
```

---

### Task 3: 招待受諾 / パスワード設定ページ

**Files:**
- Create: `admin/src/pages/set-password.astro`
- Modify: `supabase/config.toml`(`auth.site_url` と `auth.additional_redirect_urls` に CMS のURLを追加)

**Interfaces:**
- Consumes: Task 1 の `supabaseBrowser`、Task 2 の `redirectTo`。計画1の `invite-user` Edge Function(招待メール送信)
- Produces: 招待メールのリンク先ページ。招待/リカバリのトークンで確立されたセッション下で新しいパスワードを設定し、`/dashboard` へ進む

**背景:** Supabase の招待メールのリンクは、設定した redirect URL にトークン付きで戻り、その状態で `supabase.auth.updateUser({ password })` を呼ぶと初回パスワードを設定できる。ローカルではリンク先が CMS(4322)になるよう config を通す必要がある。

- [ ] **Step 1: config.toml に CMS の URL を許可**

`supabase/config.toml` の `[auth]` セクションを確認し、以下を設定(既存キーがあれば書き換え、無ければ `[auth]` 直下に追加):

```toml
site_url = "http://localhost:4322"
additional_redirect_urls = ["http://localhost:4322", "http://localhost:4322/set-password"]
```

Run: `supabase stop && supabase start` (config を反映) の後 `supabase db reset && npm run seed`(リポジトリ直下で。データを戻す)

注意: `site_url` を CMS(4322)にするのはローカルの招待フロー検証のため。公開サイト(4321)は静的で認証を持たないので site_url とは無関係。デプロイ時はホスト値に置き換える(デプロイタスクで扱う)。

- [ ] **Step 2: set-password ページ**

`admin/src/pages/set-password.astro`:

```astro
---
const title = 'パスワード設定 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <h1>パスワードの設定</h1>
    <p>招待メールから続けてパスワードを設定してください。</p>
    <form id="pw-form">
      <p><label>新しいパスワード(8文字以上) <input type="password" id="password" minlength="8" required /></label></p>
      <p><button type="submit">設定する</button></p>
    </form>
    <p id="message" role="alert"></p>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';

      const form = document.getElementById('pw-form') as HTMLFormElement;
      const messageEl = document.getElementById('message')!;

      // 招待/リカバリのリンクで戻ってくるとセッションが確立される。
      // 少し待ってからセッションを確認する。
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        messageEl.textContent = '有効な招待リンクが必要です。メールのリンクから開いてください。';
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageEl.textContent = '';
        const password = (document.getElementById('password') as HTMLInputElement).value;
        if (password.length < 8) { messageEl.textContent = 'パスワードは8文字以上にしてください'; return; }

        const { error } = await supabaseBrowser.auth.updateUser({ password });
        if (error) { messageEl.textContent = '設定に失敗しました: ' + error.message; return; }
        redirectTo('/dashboard');
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: 招待→パスワード設定フローを手動確認**

Edge Functions と CMS preview を起動:

```bash
# 端末A: Edge Functions
supabase functions serve --env-file supabase/functions/.env
# 端末B: CMS
cd admin && npm run build && npm run preview
```

管理者トークンを用意して(計画1 Task 7 の手順: `admin@seed.local` は seed で作成済みだが admin ロール。seed の admin でサインインしてトークン取得 → invite-user を叩く)、新しいライターを招待:

```bash
# admin@seed.local でサインインしてトークン取得(ANON_KEY は supabase status)
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"admin@seed.local","password":"seed-pass-1234"}'   # access_token を控える

curl -s -X POST 'http://127.0.0.1:54321/functions/v1/invite-user' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"newwriter@local.test","name":"新人 ライター","slug":"newbie-writer","role":"writer"}'
```

確認:
- Mailpit(http://127.0.0.1:54324)に招待メールが届く
- メール内のリンクを開くと CMS の set-password(4322)に着地し、セッションが確立されている(「有効な招待リンク…」が出ない)
- パスワード(例 `newpass1234`)を設定 → `/dashboard` に進む
- 一度ログアウト状態にして(別タブや preview 再訪)、http://localhost:4322/login から `newwriter@local.test` + `newpass1234` でログインできる

うまくいかない場合(リンクがセッションを確立しない等)は、config の redirect URL 設定と Mailpit のリンク URL を確認し、原因を報告する(推測で set-password のロジックを変えない)。

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/set-password.astro supabase/config.toml
git commit -m "feat: invite-acceptance password-set page and auth redirect config"
```

---

### Task 4: ダッシュボード(自分の記事一覧)

**Files:**
- Create: `admin/src/lib/dashboard.ts`
- Create: `admin/tests/dashboard.test.ts`
- Create: `admin/src/pages/dashboard.astro`

**Interfaces:**
- Consumes: Task 1 の `supabaseBrowser`、Task 2 の `redirectTo`
- Produces:
  - `fetchMyArticles(supabase): Promise<MyArticle[]>` — ログイン中ユーザーの記事(RLS が自動で自分の行に限定、下書き含む)を published_at/created_at 降順で返す。型 `MyArticle { id, slug, title, status, publishedAt, isCommissioned }`
  - ダッシュボードページ(認証ガード + 記事一覧 + プロフィール編集/ログアウトへの導線 + 記事作成/編集のスタブリンク)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/dashboard.test.ts`(認証済みクライアントを作り、シードのライター hana でログインして自分の記事だけ返ることを検証):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchMyArticles } from '../src/lib/dashboard';

// .env は vitest.config の setupFiles: ['dotenv/config'] で読み込まれる
const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: 'hana@seed.local',
    password: 'seed-pass-1234',
  });
  if (error) throw error;
});

describe('fetchMyArticles (requires seeded local Supabase)', () => {
  it('returns only the logged-in writer own articles including the draft', async () => {
    const articles = await fetchMyArticles(supabase);
    // hana の記事: 公開4本(通常2 + 依頼2)+ 下書き1本 = 5本
    expect(articles.length).toBe(5);
    // 下書きが含まれる
    expect(articles.some((a) => a.status === 'draft')).toBe(true);
    // 依頼記事フラグが立つものがある
    expect(articles.some((a) => a.isCommissioned)).toBe(true);
    // 他人(sato-kenta)の記事は入らない = すべて自分のもの。slug で確認
    const slugs = articles.map((a) => a.slug);
    expect(slugs).not.toContain('toshi-no-yachou');
    expect(slugs).toContain('kawabe-kansatsu');
  });
});
```

この統合テストはシード済み DB に接続するため、`.env` の読み込みが要る。以下2点を行う:

1. `admin/package.json` の devDependencies に `"dotenv": "^16.4.0"` を追加し、`cd admin && npm install`。
2. `admin/vitest.config.ts` を以下に更新(Task 1 版に `setupFiles` を追加。cwd が `admin/` なので `admin/.env` が読まれる):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
  },
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npm test`
Expected: FAIL — `../src/lib/dashboard` が存在しない

- [ ] **Step 3: dashboard.ts を実装**

`admin/src/lib/dashboard.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyArticle {
  id: string;
  slug: string | null;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  isCommissioned: boolean;
}

export async function fetchMyArticles(supabase: SupabaseClient): Promise<MyArticle[]> {
  // RLS により自分の記事だけが返る(下書き含む)
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, status, published_at, commissioned_by, created_at')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    isCommissioned: row.commissioned_by !== null,
  }));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: 5 tests passed(auth 4 + dashboard 1)

- [ ] **Step 5: ダッシュボードページ**

`admin/src/pages/dashboard.astro`:

```astro
---
const title = 'ダッシュボード | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header>
      <nav>
        <a href="/dashboard">ダッシュボード</a> |
        <a href="/profile">プロフィール編集</a> |
        <button id="logout" type="button">ログアウト</button>
      </nav>
    </header>
    <main>
      <h1>自分の記事</h1>
      <p><a href="/articles/new">＋ 新しい記事を作成</a>(準備中)</p>
      <ul id="article-list"><li>読み込み中…</li></ul>
    </main>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import { fetchMyArticles } from '../lib/dashboard';

      // 認証ガード
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { redirectTo('/login'); }

      document.getElementById('logout')!.addEventListener('click', async () => {
        await supabaseBrowser.auth.signOut();
        redirectTo('/login');
      });

      const listEl = document.getElementById('article-list')!;
      try {
        const articles = await fetchMyArticles(supabaseBrowser);
        if (articles.length === 0) {
          listEl.innerHTML = '<li>まだ記事がありません。</li>';
        } else {
          listEl.innerHTML = '';
          for (const a of articles) {
            const li = document.createElement('li');
            const status = a.status === 'draft' ? '下書き' : '公開';
            const featured = a.isCommissioned ? ' / 依頼記事' : '';
            // 編集リンクはスタブ(計画4で実装)。テキストは textContent で安全に入れる
            const label = document.createElement('span');
            label.textContent = `${a.title}(${status}${featured})`;
            const edit = document.createElement('a');
            edit.href = `/articles/${a.id}/edit`;
            edit.textContent = ' 編集(準備中)';
            li.appendChild(label);
            li.appendChild(edit);
            listEl.appendChild(li);
          }
        }
      } catch (err) {
        listEl.innerHTML = '<li>読み込みに失敗しました。</li>';
        console.error(err);
      }
    </script>
  </body>
</html>
```

- [ ] **Step 6: ビルドして手動確認**

Run: `cd admin && npm run build && npm run preview`(バックグラウンド)

ブラウザで:
- 未ログイン状態で http://localhost:4322/dashboard → /login にリダイレクトされる
- `hana@seed.local` / `seed-pass-1234` でログイン → ダッシュボードに hana の記事5本(下書き1本含む、依頼記事に「依頼記事」表示)が並ぶ。sato-kenta の記事(都市の野鳥観察)は出ない
- ログアウトボタン → /login に戻り、再度 /dashboard に行くと /login に弾かれる

(preview 停止)

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/dashboard.ts admin/tests/dashboard.test.ts admin/src/pages/dashboard.astro admin/package.json admin/package-lock.json admin/vitest.config.ts
git commit -m "feat: cms dashboard listing own articles with auth guard"
```

---

### Task 5: プロフィール編集

**Files:**
- Create: `admin/src/lib/profile.ts`
- Create: `admin/tests/profile.test.ts`
- Create: `admin/src/pages/profile.astro`

**Interfaces:**
- Consumes: Task 1 の `supabaseBrowser`、Task 2 の `redirectTo`
- Produces:
  - `safeUrl(value): string | null`(`http:`/`https:` のみ許可。公開サイトと同方針)
  - `parseSnsLinks(raw: string): string[]`(改行区切りテキスト → 安全な URL 配列。空行と不正 URL は除外)
  - `buildProfileUpdate(form): { name, bio, homepage_url, sns_links, price_info, contact_url }`(フォーム値 → 更新ペイロード。role/commission_code は含めない)
  - プロフィール編集ページ(現在値ロード → 編集 → 保存)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safeUrl, parseSnsLinks, buildProfileUpdate } from '../src/lib/profile';

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('rejects javascript: and malformed and empty', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('')).toBeNull();
  });
});

describe('parseSnsLinks', () => {
  it('splits lines, keeps safe urls, drops blanks and unsafe', () => {
    const raw = 'https://a.example\n\n javascript:bad \nhttps://b.example\nnope';
    expect(parseSnsLinks(raw)).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('buildProfileUpdate', () => {
  it('builds a payload without role or commission_code', () => {
    const payload = buildProfileUpdate({
      name: '田中 花', bio: '自己紹介',
      homepageUrl: 'https://hana.example', snsRaw: 'https://x.example',
      priceInfo: '1本 3万円', contactUrl: 'https://contact.example',
    });
    expect(payload).toEqual({
      name: '田中 花', bio: '自己紹介',
      homepage_url: 'https://hana.example',
      sns_links: ['https://x.example'],
      price_info: '1本 3万円',
      contact_url: 'https://contact.example',
    });
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('commission_code');
  });
  it('nulls out empty optional fields and unsafe urls', () => {
    const payload = buildProfileUpdate({
      name: '佐藤', bio: '', homepageUrl: 'javascript:x', snsRaw: '',
      priceInfo: '', contactUrl: '',
    });
    expect(payload.homepage_url).toBeNull();
    expect(payload.sns_links).toEqual([]);
    expect(payload.price_info).toBeNull();
    expect(payload.contact_url).toBeNull();
    expect(payload.bio).toBe('');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npm test`
Expected: FAIL — `../src/lib/profile` が存在しない

- [ ] **Step 3: profile.ts を実装**

`admin/src/lib/profile.ts`:

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

export function parseSnsLinks(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => safeUrl(line))
    .filter((u): u is string => u !== null);
}

export interface ProfileFormInput {
  name: string;
  bio: string;
  homepageUrl: string;
  snsRaw: string;
  priceInfo: string;
  contactUrl: string;
}

export interface ProfileUpdate {
  name: string;
  bio: string;
  homepage_url: string | null;
  sns_links: string[];
  price_info: string | null;
  contact_url: string | null;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function buildProfileUpdate(input: ProfileFormInput): ProfileUpdate {
  return {
    name: input.name.trim(),
    bio: input.bio,
    homepage_url: safeUrl(input.homepageUrl),
    sns_links: parseSnsLinks(input.snsRaw),
    price_info: emptyToNull(input.priceInfo),
    contact_url: safeUrl(input.contactUrl),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: すべて passed(auth 4 + dashboard 1 + profile 5 = 10)

- [ ] **Step 5: プロフィール編集ページ**

`admin/src/pages/profile.astro`:

```astro
---
const title = 'プロフィール編集 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header>
      <nav><a href="/dashboard">← ダッシュボード</a></nav>
    </header>
    <main>
      <h1>プロフィール編集</h1>
      <form id="profile-form">
        <p><label>名前 <input type="text" id="name" required /></label></p>
        <p><label>自己紹介<br /><textarea id="bio" rows="4"></textarea></label></p>
        <p><label>ホームページURL <input type="url" id="homepage" /></label></p>
        <p><label>SNSリンク(1行に1つ)<br /><textarea id="sns" rows="3"></textarea></label></p>
        <p><label>料金 <input type="text" id="price" /></label></p>
        <p><label>相談窓口URL <input type="url" id="contact" /></label></p>
        <p><button type="submit">保存</button></p>
      </form>
      <p id="message" role="alert"></p>
    </main>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import { buildProfileUpdate } from '../lib/profile';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { redirectTo('/login'); }

      const messageEl = document.getElementById('message')!;
      const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement;

      // 現在のプロフィールをロード(RLS: 自分の行のみ取得可)
      const { data: profile, error: loadError } = await supabaseBrowser
        .from('profiles')
        .select('name, bio, homepage_url, sns_links, price_info, contact_url')
        .eq('id', session!.user.id)
        .single();
      if (loadError) {
        messageEl.textContent = 'プロフィールの読み込みに失敗しました';
      } else if (profile) {
        $('name').value = profile.name ?? '';
        $('bio').value = profile.bio ?? '';
        $('homepage').value = profile.homepage_url ?? '';
        $('sns').value = Array.isArray(profile.sns_links) ? profile.sns_links.join('\n') : '';
        $('price').value = profile.price_info ?? '';
        $('contact').value = profile.contact_url ?? '';
      }

      document.getElementById('profile-form')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageEl.textContent = '';
        const payload = buildProfileUpdate({
          name: $('name').value,
          bio: $('bio').value,
          homepageUrl: $('homepage').value,
          snsRaw: $('sns').value,
          priceInfo: $('price').value,
          contactUrl: $('contact').value,
        });
        if (!payload.name) { messageEl.textContent = '名前を入力してください'; return; }

        // RLS: 自分の行のみ更新可。role/commission_code は payload に含めない(トリガーが変更を拒否)
        const { error } = await supabaseBrowser
          .from('profiles')
          .update(payload)
          .eq('id', session!.user.id);
        if (error) { messageEl.textContent = '保存に失敗しました: ' + error.message; return; }
        messageEl.textContent = '保存しました。';
      });
    </script>
  </body>
</html>
```

- [ ] **Step 6: ビルドして手動確認**

Run: `cd admin && npm run build && npm run preview`(バックグラウンド)

ブラウザで(`hana@seed.local` でログイン後):
- /profile にアクセス → 現在の名前「田中 花」・自己紹介が入っている
- 自己紹介を書き換え、SNS欄に `https://x.example` を1行入れて保存 → 「保存しました。」
- ページを再読み込み → 変更が保持されている(DB に入った)
- SNS欄に `javascript:alert(1)` を入れて保存 → その行は保存されない(再読み込みで消えている)
- 別端末で確認(任意): `docker exec supabase_db_wild-media-v2-0 psql -U postgres -d postgres -c "select name, sns_links from profiles where slug='tanaka-hana';"` で反映を確認

(preview 停止。手動確認でプロフィールを変更したら、後続の一貫性のため `npm run seed`(ルート)で戻してよい)

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/profile.ts admin/tests/profile.test.ts admin/src/pages/profile.astro
git commit -m "feat: cms profile edit with url-scheme validation"
```

---

### Task 6: README に CMS 開発手順を追記

**Files:**
- Modify: `README.md`(ルート)

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: CMS(admin アプリ)のローカル開発手順とサブドメイン分離の説明

- [ ] **Step 1: README に CMS セクションを追記**

`README.md` の「## 構成」の前に以下のセクションを挿入:

````markdown
## CMS(管理画面)

CMS はオリジン分離のため別 Astro アプリ(`admin/`)として動き、本番では `admin.` サブドメインに配置する。ブラウザから Supabase に直結(anon キー + RLS)し、service role キーは持たない。

```bash
cd admin
cp .env.example .env    # supabase status の ANON_KEY のみを転記(service role は入れない)
npm install
npm test                # ロジックの単体テスト(Vitest)
npm run dev             # http://localhost:4322
```

ログインはシードユーザー(例 `hana@seed.local` / `seed-pass-1234`)。招待フローの確認には Edge Functions(`supabase functions serve`)が必要。
````

そして「## 構成」のリストに追記:

```markdown
- `admin/` — CMS(別 Astro アプリ、admin. サブドメイン、ブラウザから Supabase 直結)
```

- [ ] **Step 2: 追記後にビルドが壊れていないことを確認**

Run: `cd admin && npm test && npm run build`
Expected: 10 tests passed、admin ビルド成功

Run: `npm test && npm run build`(ルート、公開サイトが無傷であることの確認)
Expected: 11 tests passed(公開サイト側)、9 ページビルド成功

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CMS local development section"
```

---

## この計画のスコープ外(計画4)

- 記事エディタ(マークダウン EasyMDE、slug 入力+重複チェック、依頼者コード入力+実在チェック RPC、下書き保存/公開)
- 画像パイプライン(Cropper.js クロップ → ブラウザ内リサイズ・WebP 圧縮 → `r2-upload-url` Edge Function で署名付き URL 取得 → R2 へ PUT)
- 管理者画面(ユーザー招待 UI・ロール設定・依頼者コード発行・サイト設定 post_interval_days/featured_count)
- Supabase Database Webhook → Vercel Deploy Hook の再ビルド、ホスト版デプロイ(公開 + admin の2プロジェクト)→ デプロイタスク

## 計画1・2から引き継いだ注意点(この計画で守る)

- CMS に service role キーを持ち込まない(anon + RLS のみ)
- プロフィール URL はクライアントでも `http:`/`https:` に限定(公開サイトの `safeUrl` と同方針)。計画4以降で DB check 制約化も検討
- 記事 UPDATE(計画4)では `commission_code_input` をラウンドトリップしないと依頼リンクが消える(トリガー仕様)
- 公開後の記事は untrusted クライアントからは `published_at` 変更不可・依頼リンク解除不可(`COMMISSION_UNLINK_REQUIRES_UNPUBLISH`)— 計画4のエディタはこれを踏まえる
