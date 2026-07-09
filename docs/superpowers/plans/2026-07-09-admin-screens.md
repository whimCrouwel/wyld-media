# 管理者画面 + 繰り越しUX(計画6)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者向けのユーザー管理(招待・種別変更・依頼者コード確認)とサイト設定(投稿間隔・Featured件数)画面を追加し、計画3〜4から繰り越したUX(GoTrueエラーの日本語化・孤児下書きフロー・not-found時の無効フォーム)を解消する。

**Architecture:** **新しいマイグレーションは不要。** 必要な権限はすべて既存のDB層にある — settings の UPDATE は RLS で admin のみ、profiles の role/commission_code 変更は `a_protect_profile_columns` トリガーで admin のみ、role を provider に上げると `a_set_commission_code`(BEFORE INSERT OR UPDATE)が依頼者コードを自動発行、ユーザー作成は `invite-user` Edge Function(関数内で呼び出し元の role を DB 照合)のみ。今回の追加はその上に乗る CMS の UI とロジック層だけであり、ページ側のロール確認はあくまで UX(本物の防壁は RLS/トリガー)。

**Tech Stack:** 既存スタックのまま(Astro 静的 + supabase-js anon クライアント + Vitest)。新規依存なし。

## Global Constraints

- **権限・ビジネスルールは DB 層(RLS・トリガー)で強制する。クライアント側のチェックは UX 目的でしかない**(CLAUDE.md)。このプランで新しいルールは追加しない(既存 DB 層で全部足りることを Architecture 節で確認済み)
- **service role key を `admin/` に入れない**(CLAUDE.md)
- UI 文言はすべて日本語。デザインなし(骨組みのみ)
- Astro ページの `<script>` はモジュールトップレベル(`return` 不可)。未ログインは `if (!session) { redirectTo('/login'); } else { ... }` パターンで包む(過去に TypeError を出した実績のある落とし穴)
- 動的な文字列は `textContent` で入れる(`innerHTML` に連結しない — dashboard.astro の既存パターンに従う)
- CMS テストは `cd admin && npm test`(現在 39)。ルート `npm test`(公開サイト 11)を壊さない
- **`docs/superpowers/specs/`・`docs/superpowers/plans/` は歴史として書き換えない**。コード変更に伴うドキュメント更新は README.md / CLAUDE.md / ARCHITECTURE.md / DEPLOYMENT-CHECKLIST.md へ(CLAUDE.md のドキュメント保守ルール)
- コミットは `feat:` / `fix:` / `test:` / `docs:` プレフィックス

## 前提(既存コードの契約)

- RLS: profiles は「自分の行 or admin なら全行」を SELECT/UPDATE 可。settings(id=1 の1行のみ)は authenticated 全員 SELECT 可・UPDATE は admin のみ
- トリガー: 非 admin が role / commission_code を変更すると `role and commission_code can only be changed by an admin` で例外。role が provider になると commission_code(`WM-` + 8桁大文字hex)を自動発行
- `settings` 列: `post_interval_days`(初期値10・`>= 0` CHECK)、`featured_count`(初期値3・`>= 0` CHECK)
- Edge Function `invite-user`: POST `{ email, name, slug, role: 'writer'|'provider' }`。呼び出し元が admin でなければ 403 `{"error":"forbidden"}`。バリデーション失敗は 400(メッセージに `required` を含む)。成功で招待メール送信 + profiles 行作成
- `supabase.functions.invoke` はエラー時 `FunctionsHttpError` を返し、`.message` は汎用文言。EF の具体的な `{ error }` は `error.context`(Response)に入っている
- シードユーザー(パスワードは全員 `seed-pass-1234`): `admin@seed.local`(admin)/ `hana@seed.local`(writer, slug `tanaka-hana`)/ `kenta@seed.local`(writer, slug `sato-kenta`)/ `forest@seed.local`(provider)
- 統合テストの流儀: `admin/tests/articles.test.ts` と同じ(`createClient(env)` + `signInWithPassword` + 後始末で状態復元)
- ⚠️ **Vitest はテストファイルを並列実行する。** `post_interval_days` を書き換えるテストは articles.test.ts の頻度制限テストと競合するため**書かない**。設定変更の成功テストは `featured_count` だけを動かして復元する(featured_count はどのトリガーからも読まれない)
- ローカルの招待メールは Mailpit(http://127.0.0.1:54324)に届く。招待フローの実行には `supabase functions serve --env-file supabase/functions/.env` が必要

---

### Task 1: GoTrue エラーの日本語化(`translateAuthError`)

ログイン/パスワード設定ページは GoTrue の英語メッセージを生で表示している(計画3からの繰り越し)。既知メッセージを日本語に写像する。

**Files:**
- Modify: `admin/src/lib/auth.ts`(末尾に追記)
- Modify: `admin/src/pages/login.astro:38`
- Modify: `admin/src/pages/set-password.astro:37`
- Test: `admin/tests/auth.test.ts`(describe を追記)

**Interfaces:**
- Consumes: なし
- Produces: `translateAuthError(err: unknown): string`(Task 1 内でのみ使用。他タスクは依存しない)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/auth.test.ts` の末尾に追記:

```ts
import { translateAuthError } from '../src/lib/auth';

describe('translateAuthError', () => {
  it('ログイン失敗を日本語にする', () => {
    expect(translateAuthError(new Error('Invalid login credentials')))
      .toBe('メールアドレスまたはパスワードが正しくありません。');
  });
  it('メール未確認を日本語にする', () => {
    expect(translateAuthError(new Error('Email not confirmed')))
      .toContain('未確認');
  });
  it('レート制限を日本語にする', () => {
    expect(translateAuthError(new Error('Rate limit exceeded'))).toContain('しばらく待って');
    expect(translateAuthError(new Error('For security purposes, you can only request this after 60 seconds.')))
      .toContain('しばらく待って');
  });
  it('パスワード不足を日本語にする', () => {
    expect(translateAuthError(new Error('Password should be at least 8 characters')))
      .toContain('8文字以上');
  });
  it('同一パスワードを日本語にする', () => {
    expect(translateAuthError(new Error('New password should be different from the old password.')))
      .toContain('同じパスワード');
  });
  it('セッション切れを日本語にする', () => {
    expect(translateAuthError(new Error('Auth session missing!'))).toContain('招待リンク');
  });
  it('未知のエラーは汎用メッセージ', () => {
    expect(translateAuthError(new Error('boom'))).toContain('エラーが発生しました');
    expect(translateAuthError(undefined)).toContain('エラーが発生しました');
  });
});
```

(既存の import 行 `import { validateLoginInput, redirectTo } from '../src/lib/auth';` がある場合はそこに `translateAuthError` を足す形でもよい。二重 import にしないこと。)

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/auth.test.ts`
Expected: FAIL(`translateAuthError` が export されていない)

- [ ] **Step 3: 実装を書く**

`admin/src/lib/auth.ts` の末尾に追記:

```ts
// GoTrue の代表的なエラーメッセージを日本語へ。未知のものは汎用文言に落とす。
export function translateAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('Invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (msg.includes('Email not confirmed')) {
    return 'メールアドレスが未確認です。招待メールのリンクから開いてください。';
  }
  if (msg.toLowerCase().includes('rate limit') || msg.includes('you can only request this after')) {
    return '試行回数が多すぎます。しばらく待ってから再度お試しください。';
  }
  if (msg.includes('Password should be at least')) {
    return 'パスワードが短すぎます。8文字以上にしてください。';
  }
  if (msg.includes('New password should be different')) {
    return '現在と同じパスワードは設定できません。';
  }
  if (msg.includes('Auth session missing')) {
    return 'セッションが切れています。招待リンクをもう一度開いてください。';
  }
  return 'エラーが発生しました。時間をおいて再度お試しください。';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 5: ページに配線する**

`admin/src/pages/login.astro`:
- import 行を `import { validateLoginInput, redirectTo, translateAuthError } from '../lib/auth';` に変更
- `if (error) { errorEl.textContent = 'ログインに失敗しました: ' + error.message; return; }` を
  `if (error) { errorEl.textContent = translateAuthError(error); console.error(error); return; }` に変更

`admin/src/pages/set-password.astro`:
- import 行を `import { redirectTo, translateAuthError } from '../lib/auth';` に変更
- `if (error) { messageEl.textContent = '設定に失敗しました: ' + error.message; return; }` を
  `if (error) { messageEl.textContent = translateAuthError(error); console.error(error); return; }` に変更

- [ ] **Step 6: 全テスト + ビルドを確認**

Run: `cd admin && npm test && npm run build`
Expected: 全 PASS(46 前後)、7 ページビルド成功

- [ ] **Step 7: コミット**

```bash
git add admin/src/lib/auth.ts admin/tests/auth.test.ts admin/src/pages/login.astro admin/src/pages/set-password.astro
git commit -m "fix: translate GoTrue auth errors to Japanese on login/set-password"
```

---

### Task 2: 孤児下書きフローの解消 + not-found フォームの非表示

計画4の最終レビューからの繰り越し2件。(1) 新規ページで「公開する」が失敗すると下書きが孤児として残り、リトライでさらに増える → **新規ページは下書き作成専用にし、公開は編集ページからのみ**行う。(2) 編集ページで記事が見つからないとき、無効なフォームが表示されたまま → 隠す。

**Files:**
- Modify: `admin/src/pages/articles/new.astro`
- Modify: `admin/src/pages/articles/edit.astro`(not-found 分岐に1行)
- Modify: `README.md`(執筆フローの記述を1文更新)

**Interfaces:**
- Consumes: 既存の `createDraft(supabase, input): Promise<string>`(articles.ts。変更しない)
- Produces: なし(ページのみ)

- [ ] **Step 1: new.astro を下書き作成専用にする**

(a) マークアップ — ボタン行:

```html
        <p>
          <button type="button" id="save-draft">下書き保存</button>
          <button type="button" id="publish">公開する</button>
        </p>
```

を以下に置き換え:

```html
        <p>
          <button type="button" id="create-draft">下書きを作成して編集へ</button>
        </p>
        <p>公開は、下書き作成後の編集ページから行います。</p>
```

(b) スクリプト — import から `saveArticle` を外す:

```ts
      import { createDraft, validateCommissionCode, checkSlugAvailable } from '../../lib/articles';
```

(c) `const create = async (publish: boolean) => { ... }` と末尾2行のリスナー登録を、以下に置き換え:

```ts
        const create = async () => {
          messageEl.textContent = '';
          const input = collect();
          if (!input.title.trim()) { messageEl.textContent = 'タイトルを入力してください'; return; }
          try {
            const id = await createDraft(supabaseBrowser, input);
            // 公開は編集ページから(公開失敗時の孤児下書きをなくすため、新規作成は下書きのみ)
            redirectTo(`/articles/edit?id=${id}`);
          } catch (err) {
            messageEl.textContent = translateSaveError(err);
            console.error(err);
          }
        };

        document.getElementById('create-draft')!.addEventListener('click', () => create());
```

(slug・依頼者コードのライブチェック、カバー画像ウィジェット、プレビューはそのまま残す。`isValidArticleSlug` の import が publish ガードでしか使われていなかった場合も、slug ライブチェックで使用しているので残す。)

- [ ] **Step 2: edit.astro の not-found でフォームを隠す**

`admin/src/pages/articles/edit.astro` の

```ts
        if (!article) {
          messageEl.textContent = '記事が見つかりません(自分の記事のみ編集できます)。';
        } else {
```

を以下に置き換え:

```ts
        if (!article) {
          messageEl.textContent = '記事が見つかりません(自分の記事のみ編集できます)。';
          (document.getElementById('article-form') as HTMLElement).hidden = true;
        } else {
```

- [ ] **Step 3: README の執筆フロー記述を更新**

`README.md` の CMS セクションの行:

```markdown
ログイン後、ダッシュボードの「新しい記事を作成」から記事を執筆できる(マークダウン + ライブプレビュー、下書き保存 / 公開、依頼者コード・スラッグ設定)。
```

を以下に置き換え:

```markdown
ログイン後、ダッシュボードの「新しい記事を作成」で下書きを作成し、編集ページで執筆・公開する(マークダウン + ライブプレビュー、依頼者コード・スラッグ設定。公開は編集ページからのみ)。
```

⚠️ README.md にはリポジトリ所有者の未コミット編集が残っている可能性がある。`git add README.md` は使わず、自分のハンク(この1文)だけを `git apply --cached` 方式でステージし、`git diff --cached -- README.md` で自分の変更のみであることを確認すること(このブランチの過去タスクで実績のある手順)。

- [ ] **Step 4: テスト + ビルドを確認**

Run: `cd admin && npm test && npm run build`
Expected: 全 PASS、7 ページビルド成功

- [ ] **Step 5: コミット**

```bash
git add admin/src/pages/articles/new.astro admin/src/pages/articles/edit.astro
# README.md は自分のハンクのみ git apply --cached でステージ済みであること
git commit -m "fix: new-article page creates drafts only; hide inert form on not-found edit"
```

---

### Task 3: 管理ロジック(ロール): `fetchMyRole` / `fetchAllProfiles` / `updateUserRole`

管理者画面のデータ層その1。RLS・トリガーが実際に防壁として機能することを、admin と非 admin の両クライアントで統合テストする。

**Files:**
- Create: `admin/src/lib/admin.ts`
- Test: `admin/tests/admin.test.ts`

**Interfaces:**
- Consumes: RLS(profiles: 自分 or admin 全行)、トリガー `a_protect_profile_columns` / `a_set_commission_code`
- Produces(Task 4 が同ファイルに追記、Task 5・6 が使う):
  - `type Role = 'admin' | 'writer' | 'provider'`
  - `interface AdminProfile { id: string; role: Role; slug: string; name: string; commissionCode: string | null }`
  - `fetchMyRole(supabase: SupabaseClient): Promise<Role | null>`
  - `fetchAllProfiles(supabase: SupabaseClient): Promise<AdminProfile[]>`(created_at 昇順)
  - `updateUserRole(supabase: SupabaseClient, id: string, role: 'writer' | 'provider'): Promise<void>`(0行更新なら `Error('ROLE_UPDATE_DENIED')`)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/admin.test.ts` を新規作成:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchMyRole, fetchAllProfiles, updateUserRole } from '../src/lib/admin';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });

let hanaId: string;
let kentaId: string;

beforeAll(async () => {
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
  const h = await hanaClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (h.error) throw h.error;
  hanaId = h.data.user!.id;

  const { data, error } = await adminClient
    .from('profiles').select('id').eq('slug', 'sato-kenta').single();
  if (error) throw error;
  kentaId = data.id;
});

describe('fetchMyRole', () => {
  it('admin は admin、writer は writer を返す', async () => {
    expect(await fetchMyRole(adminClient)).toBe('admin');
    expect(await fetchMyRole(hanaClient)).toBe('writer');
  });
});

describe('fetchAllProfiles', () => {
  it('admin は全ユーザーを見られる', async () => {
    const all = await fetchAllProfiles(adminClient);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const slugs = all.map((p) => p.slug);
    for (const s of ['seed-admin', 'tanaka-hana', 'sato-kenta', 'forest-org']) {
      expect(slugs).toContain(s);
    }
    const forest = all.find((p) => p.slug === 'forest-org')!;
    expect(forest.commissionCode).toMatch(/^WM-[0-9A-F]{8}$/);
  });

  it('非 admin は RLS により自分の行しか見えない', async () => {
    const mine = await fetchAllProfiles(hanaClient);
    expect(mine.map((p) => p.slug)).toEqual(['tanaka-hana']);
  });
});

describe('updateUserRole', () => {
  it('admin が writer を provider に上げると依頼者コードが自動発行される', async () => {
    try {
      await updateUserRole(adminClient, kentaId, 'provider');
      const { data } = await adminClient
        .from('profiles').select('role, commission_code').eq('id', kentaId).single();
      expect(data!.role).toBe('provider');
      expect(data!.commission_code).toMatch(/^WM-[0-9A-F]{8}$/);
    } finally {
      // 後始末: role と commission_code をシード状態へ戻す(admin はトリガーを通過できる)
      await adminClient.from('profiles')
        .update({ role: 'writer', commission_code: null }).eq('id', kentaId);
    }
  });

  it('非 admin は自分の role を変えられない(トリガーで拒否)', async () => {
    await expect(updateUserRole(hanaClient, hanaId, 'provider'))
      .rejects.toThrow(/admin/);
  });

  it('非 admin は他人の行に触れない(RLS で 0 行 → ROLE_UPDATE_DENIED)', async () => {
    await expect(updateUserRole(hanaClient, kentaId, 'provider'))
      .rejects.toThrow('ROLE_UPDATE_DENIED');
  });

  it('writer/provider 以外の role は受け付けない', async () => {
    await expect(
      updateUserRole(adminClient, kentaId, 'admin' as unknown as 'writer'),
    ).rejects.toThrow('INVALID_ROLE');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/admin.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/admin'`)

- [ ] **Step 3: 実装を書く**

`admin/src/lib/admin.ts` を新規作成:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'admin' | 'writer' | 'provider';

export interface AdminProfile {
  id: string;
  role: Role;
  slug: string;
  name: string;
  commissionCode: string | null;
}

// ページのロール出し分けに使う。本物の防壁は RLS/トリガー(これは UX)。
export async function fetchMyRole(supabase: SupabaseClient): Promise<Role | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return (data?.role as Role) ?? null;
}

export async function fetchAllProfiles(supabase: SupabaseClient): Promise<AdminProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, slug, name, commission_code')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as Role,
    slug: r.slug,
    name: r.name,
    commissionCode: r.commission_code ?? null,
  }));
}

export async function updateUserRole(
  supabase: SupabaseClient, id: string, role: 'writer' | 'provider',
): Promise<void> {
  if (role !== 'writer' && role !== 'provider') throw new Error('INVALID_ROLE');
  const { data, error } = await supabase
    .from('profiles').update({ role }).eq('id', id).select('id');
  if (error) throw error;
  // RLS で行にマッチしなかった場合は静かに 0 行になる — 明示的にエラー化する
  if ((data ?? []).length === 0) throw new Error('ROLE_UPDATE_DENIED');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npx vitest run tests/admin.test.ts`
Expected: PASS(7 tests)。前提: ローカル Supabase 起動済み + シード済み(`supabase start` / `npm run seed`)

- [ ] **Step 5: 全テストを確認**

Run: `cd admin && npm test`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add admin/src/lib/admin.ts admin/tests/admin.test.ts
git commit -m "feat: admin role management lib (RLS/trigger-backed, integration-tested)"
```

---

### Task 4: 管理ロジック(招待・設定): `inviteUser` / `validateInviteInput` / `fetchSettings` / `updateSettings`

管理者画面のデータ層その2。招待は Edge Function 経由(スタブでテスト)、設定は RLS 直(統合テスト)。

**Files:**
- Modify: `admin/src/lib/admin.ts`(末尾に追記)
- Test: `admin/tests/admin.test.ts`(describe を追記)

**Interfaces:**
- Consumes: Edge Function `invite-user` の契約(前提節)、settings の RLS
- Produces(Task 5・6 が使う):
  - `interface InviteInput { email: string; name: string; slug: string; role: 'writer' | 'provider' }`
  - `validateInviteInput(input: InviteInput): string | null`(問題なければ null、あれば日本語メッセージ)
  - `inviteUser(supabase: SupabaseClient, input: InviteInput): Promise<void>`(EF の `{error}` 本文を掘り出して throw)
  - `translateInviteError(err: unknown): string`
  - `interface SiteSettings { postIntervalDays: number; featuredCount: number }`
  - `fetchSettings(supabase: SupabaseClient): Promise<SiteSettings>`
  - `updateSettings(supabase: SupabaseClient, s: SiteSettings): Promise<void>`(0行更新なら `Error('SETTINGS_UPDATE_DENIED')`、不正値は `Error('INVALID_SETTINGS')`)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/admin.test.ts` の import に追記:

```ts
import {
  fetchMyRole, fetchAllProfiles, updateUserRole,
  validateInviteInput, inviteUser, translateInviteError,
  fetchSettings, updateSettings,
} from '../src/lib/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
```

末尾に describe を追記:

```ts
describe('validateInviteInput', () => {
  const ok = { email: 'x@example.com', name: '山田', slug: 'yamada', role: 'writer' as const };
  it('正しい入力は null', () => {
    expect(validateInviteInput(ok)).toBeNull();
  });
  it('不正なメール・空の名前・不正な slug を弾く', () => {
    expect(validateInviteInput({ ...ok, email: 'ダメ' })).toContain('メールアドレス');
    expect(validateInviteInput({ ...ok, name: '  ' })).toContain('名前');
    expect(validateInviteInput({ ...ok, slug: 'Bad_Slug' })).toContain('スラッグ');
  });
});

describe('inviteUser', () => {
  function stubInvoke(result: { error: unknown }) {
    const calls: unknown[] = [];
    const supabase = {
      functions: {
        invoke: async (name: string, opts: unknown) => {
          calls.push([name, opts]);
          return result;
        },
      },
    } as unknown as SupabaseClient;
    return { supabase, calls };
  }
  const input = { email: 'x@example.com', name: '山田', slug: 'yamada', role: 'writer' as const };

  it('invite-user にペイロードを送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await inviteUser(supabase, input);
    expect(calls[0]).toEqual(['invite-user', { body: input }]);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(inviteUser(supabase, input)).rejects.toThrow('forbidden');
  });

  it('本文が JSON でなければ元のメッセージで throw する', async () => {
    const err = Object.assign(new Error('non-2xx'), {
      context: new Response('oops', { status: 500 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(inviteUser(supabase, input)).rejects.toThrow('non-2xx');
  });
});

describe('translateInviteError', () => {
  it('既知のエラーを日本語にする', () => {
    expect(translateInviteError(new Error('A user with this email address has already been registered')))
      .toContain('既に登録');
    expect(translateInviteError(new Error('duplicate key value violates unique constraint "profiles_slug_key"')))
      .toContain('スラッグ');
    expect(translateInviteError(new Error('forbidden'))).toContain('管理者のみ');
    expect(translateInviteError(new Error('email, name, slug, and role (writer|provider) are required')))
      .toContain('入力内容');
  });
  it('未知は汎用メッセージ', () => {
    expect(translateInviteError(new Error('boom'))).toContain('招待に失敗');
  });
});

describe('settings', () => {
  it('authenticated なら誰でも読める', async () => {
    const s = await fetchSettings(hanaClient);
    expect(s.postIntervalDays).toBeGreaterThanOrEqual(0);
    expect(s.featuredCount).toBeGreaterThanOrEqual(0);
  });

  it('非 admin の更新は RLS で 0 行 → SETTINGS_UPDATE_DENIED', async () => {
    const current = await fetchSettings(hanaClient);
    await expect(updateSettings(hanaClient, current)).rejects.toThrow('SETTINGS_UPDATE_DENIED');
  });

  it('admin は featured_count を更新できる(post_interval_days は現値のまま)', async () => {
    // ⚠️ post_interval_days は並列実行中の articles.test.ts(頻度制限)が読むため変更しない。
    // featured_count はどのトリガーからも読まれないので安全に動かせる。
    const before = await fetchSettings(adminClient);
    try {
      await updateSettings(adminClient, { ...before, featuredCount: before.featuredCount + 1 });
      const after = await fetchSettings(adminClient);
      expect(after.featuredCount).toBe(before.featuredCount + 1);
      expect(after.postIntervalDays).toBe(before.postIntervalDays);
    } finally {
      await updateSettings(adminClient, before);
    }
  });

  it('不正な値は送信前に弾く', async () => {
    await expect(updateSettings(adminClient, { postIntervalDays: -1, featuredCount: 3 }))
      .rejects.toThrow('INVALID_SETTINGS');
    await expect(updateSettings(adminClient, { postIntervalDays: 10, featuredCount: 1.5 }))
      .rejects.toThrow('INVALID_SETTINGS');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/admin.test.ts`
Expected: FAIL(`validateInviteInput` などが export されていない)

- [ ] **Step 3: 実装を追記**

`admin/src/lib/admin.ts` の末尾に追記:

```ts
export interface InviteInput {
  email: string;
  name: string;
  slug: string;
  role: 'writer' | 'provider';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateInviteInput(input: InviteInput): string | null {
  if (!EMAIL_RE.test(input.email)) return 'メールアドレスを正しく入力してください';
  if (!input.name.trim()) return '名前を入力してください';
  if (!SLUG_RE.test(input.slug)) return 'スラッグは小文字英数字とハイフンで入力してください';
  if (input.role !== 'writer' && input.role !== 'provider') return '種別を選択してください';
  return null;
}

export async function inviteUser(supabase: SupabaseClient, input: InviteInput): Promise<void> {
  const { error } = await supabase.functions.invoke('invite-user', { body: input });
  if (!error) return;
  // FunctionsHttpError の .message は汎用文言。EF の { error: "..." } は context(Response)にある。
  const ctx = (error as { context?: Response }).context;
  const body = ctx && typeof ctx.json === 'function'
    ? await ctx.json().catch(() => null)
    : null;
  const msg = body && typeof body === 'object' && 'error' in body ? String(body.error) : null;
  throw new Error(msg ?? (error instanceof Error ? error.message : String(error)));
}

export function translateInviteError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('already been registered')) return 'このメールアドレスは既に登録されています。';
  if (msg.includes('profiles_slug_key')) return 'このスラッグは既に使われています。';
  if (msg.includes('forbidden')) return '管理者のみ実行できます。';
  if (msg.includes('required')) return '入力内容を確認してください。';
  return '招待に失敗しました。時間をおいて再度お試しください。';
}

export interface SiteSettings {
  postIntervalDays: number;
  featuredCount: number;
}

export async function fetchSettings(supabase: SupabaseClient): Promise<SiteSettings> {
  const { data, error } = await supabase
    .from('settings').select('post_interval_days, featured_count').eq('id', 1).single();
  if (error) throw error;
  return { postIntervalDays: data.post_interval_days, featuredCount: data.featured_count };
}

export async function updateSettings(supabase: SupabaseClient, s: SiteSettings): Promise<void> {
  if (!Number.isInteger(s.postIntervalDays) || s.postIntervalDays < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.featuredCount) || s.featuredCount < 0) throw new Error('INVALID_SETTINGS');
  const { data, error } = await supabase
    .from('settings')
    .update({ post_interval_days: s.postIntervalDays, featured_count: s.featuredCount })
    .eq('id', 1)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('SETTINGS_UPDATE_DENIED');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npx vitest run tests/admin.test.ts`
Expected: PASS(20 tests 前後)

- [ ] **Step 5: 全テストを確認**

Run: `cd admin && npm test`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add admin/src/lib/admin.ts admin/tests/admin.test.ts
git commit -m "feat: invite and site-settings lib (EF error unwrapping, RLS-tested)"
```

---

### Task 5: ユーザー管理ページ + ダッシュボードの管理者ナビ

`/users` に一覧(名前・slug・種別・依頼者コード)+ 種別変更 + 招待フォーム。ダッシュボードには admin のときだけナビリンクを出す。ページのロール確認は UX(非 admin は RLS で何も見えない・変えられない)。

**Files:**
- Create: `admin/src/pages/users.astro`
- Modify: `admin/src/pages/dashboard.astro`

**Interfaces:**
- Consumes: Task 3・4 の `fetchMyRole` / `fetchAllProfiles` / `updateUserRole` / `validateInviteInput` / `inviteUser` / `translateInviteError`
- Produces: ページ `/users`、dashboard の `#admin-nav`(Task 6 も同じ span にリンクを持つ)

- [ ] **Step 1: users.astro を作成**

`admin/src/pages/users.astro` を新規作成:

```astro
---
const title = 'ユーザー管理 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header><nav><a href="/dashboard">← ダッシュボード</a></nav></header>
    <main>
      <h1>ユーザー管理</h1>

      <section>
        <h2>新しいユーザーを招待</h2>
        <form id="invite-form">
          <p><label>メールアドレス <input type="email" id="inv-email" required /></label></p>
          <p><label>名前 <input type="text" id="inv-name" required /></label></p>
          <p><label>スラッグ(小文字英数字とハイフン) <input type="text" id="inv-slug" required /></label></p>
          <p><label>種別
            <select id="inv-role">
              <option value="writer">ライター</option>
              <option value="provider">サービスプロバイダー</option>
            </select></label></p>
          <p><button type="submit">招待メールを送信</button></p>
        </form>
      </section>

      <section>
        <h2>ユーザー一覧</h2>
        <table>
          <thead>
            <tr><th>名前</th><th>スラッグ</th><th>種別</th><th>依頼者コード</th></tr>
          </thead>
          <tbody id="user-rows"><tr><td colspan="4">読み込み中…</td></tr></tbody>
        </table>
      </section>

      <p id="message" role="alert"></p>
    </main>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import {
        fetchMyRole, fetchAllProfiles, updateUserRole,
        validateInviteInput, inviteUser, translateInviteError,
      } from '../lib/admin';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else if ((await fetchMyRole(supabaseBrowser)) !== 'admin') {
        // UX のためのリダイレクト。実際の防壁は RLS/トリガー。
        redirectTo('/dashboard');
      } else {
        const messageEl = document.getElementById('message')!;
        const tbody = document.getElementById('user-rows')!;
        const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;

        const renderRows = async () => {
          const profiles = await fetchAllProfiles(supabaseBrowser);
          tbody.innerHTML = '';
          for (const p of profiles) {
            const tr = document.createElement('tr');
            const nameTd = document.createElement('td');
            nameTd.textContent = p.name;
            const slugTd = document.createElement('td');
            slugTd.textContent = p.slug;
            const roleTd = document.createElement('td');
            if (p.role === 'admin') {
              roleTd.textContent = '管理者';
            } else {
              const sel = document.createElement('select');
              for (const [value, label] of [['writer', 'ライター'], ['provider', 'サービスプロバイダー']] as const) {
                const o = document.createElement('option');
                o.value = value;
                o.textContent = label;
                o.selected = p.role === value;
                sel.appendChild(o);
              }
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = '変更';
              btn.addEventListener('click', async () => {
                messageEl.textContent = '';
                try {
                  await updateUserRole(supabaseBrowser, p.id, sel.value as 'writer' | 'provider');
                  messageEl.textContent = `${p.name} の種別を変更しました。`;
                  await renderRows();
                } catch (err) {
                  messageEl.textContent = '種別の変更に失敗しました。';
                  console.error(err);
                }
              });
              roleTd.appendChild(sel);
              roleTd.appendChild(btn);
            }
            const codeTd = document.createElement('td');
            codeTd.textContent = p.commissionCode ?? '—';
            tr.appendChild(nameTd);
            tr.appendChild(slugTd);
            tr.appendChild(roleTd);
            tr.appendChild(codeTd);
            tbody.appendChild(tr);
          }
        };

        try {
          await renderRows();
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="4">読み込みに失敗しました。</td></tr>';
          console.error(err);
        }

        document.getElementById('invite-form')!.addEventListener('submit', async (e) => {
          e.preventDefault();
          messageEl.textContent = '';
          const input = {
            email: $('inv-email').value.trim(),
            name: $('inv-name').value.trim(),
            slug: $('inv-slug').value.trim(),
            role: $('inv-role').value as 'writer' | 'provider',
          };
          const validationError = validateInviteInput(input);
          if (validationError) { messageEl.textContent = validationError; return; }
          try {
            await inviteUser(supabaseBrowser, input);
            messageEl.textContent = `${input.email} に招待メールを送信しました。`;
            ($('invite-form') as unknown as HTMLFormElement).reset();
            await renderRows();
          } catch (err) {
            messageEl.textContent = translateInviteError(err);
            console.error(err);
          }
        });
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: dashboard.astro に管理者ナビを追加**

(a) マークアップ — nav 内の `<button id="logout" ...>` の直前に追記:

```html
        <span id="admin-nav" hidden><a href="/users">ユーザー管理</a> |
        <a href="/settings">サイト設定</a> |</span>
```

(b) スクリプト — import に追記:

```ts
      import { fetchMyRole } from '../lib/admin';
```

else ブロック内(logout リスナー登録の直後)に追記:

```ts
        // admin にだけ管理ナビを見せる(出し分けは UX。防壁は RLS/トリガー)
        if ((await fetchMyRole(supabaseBrowser)) === 'admin') {
          document.getElementById('admin-nav')!.hidden = false;
        }
```

- [ ] **Step 3: テスト + ビルドを確認**

Run: `cd admin && npm test && npm run build`
Expected: 全 PASS、**8 ページ**ビルド成功(users が増える)

- [ ] **Step 4: コミット**

```bash
git add admin/src/pages/users.astro admin/src/pages/dashboard.astro
git commit -m "feat: user management page (invite, role change, commission codes) + admin nav"
```

---

### Task 6: サイト設定ページ + ドキュメント

`/settings` で `post_interval_days` / `featured_count` を編集。README に管理者画面の1文を追記。ARCHITECTURE.md は信頼境界・主要ルールに変更がないため触らない(設定値・依頼者コードの記述は既にある)。

**Files:**
- Create: `admin/src/pages/settings.astro`
- Modify: `README.md`(CMS セクションに1文)

**Interfaces:**
- Consumes: Task 3・4 の `fetchMyRole` / `fetchSettings` / `updateSettings`
- Produces: ページ `/settings`(dashboard のリンクは Task 5 で設置済み)

- [ ] **Step 1: settings.astro を作成**

`admin/src/pages/settings.astro` を新規作成:

```astro
---
const title = 'サイト設定 | Wild Media CMS';
---
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title></head>
  <body>
    <header><nav><a href="/dashboard">← ダッシュボード</a></nav></header>
    <main>
      <h1>サイト設定</h1>
      <form id="settings-form">
        <p><label>通常記事の投稿間隔(日)
          <input type="number" id="interval" min="0" step="1" required /></label></p>
        <p><label>Featured 表示件数(最新の依頼記事)
          <input type="number" id="featured" min="0" step="1" required /></label></p>
        <p><button type="submit">保存</button></p>
      </form>
      <p>変更は次回の公開サイト再ビルドから反映されます。</p>
      <p id="message" role="alert"></p>
    </main>

    <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import { fetchMyRole, fetchSettings, updateSettings } from '../lib/admin';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else if ((await fetchMyRole(supabaseBrowser)) !== 'admin') {
        redirectTo('/dashboard');
      } else {
        const messageEl = document.getElementById('message')!;
        const intervalEl = document.getElementById('interval') as HTMLInputElement;
        const featuredEl = document.getElementById('featured') as HTMLInputElement;

        try {
          const s = await fetchSettings(supabaseBrowser);
          intervalEl.value = String(s.postIntervalDays);
          featuredEl.value = String(s.featuredCount);
        } catch (err) {
          messageEl.textContent = '設定の読み込みに失敗しました。';
          console.error(err);
        }

        document.getElementById('settings-form')!.addEventListener('submit', async (e) => {
          e.preventDefault();
          messageEl.textContent = '';
          try {
            await updateSettings(supabaseBrowser, {
              postIntervalDays: Number(intervalEl.value),
              featuredCount: Number(featuredEl.value),
            });
            messageEl.textContent = '保存しました。';
          } catch (err) {
            messageEl.textContent = '保存に失敗しました。入力値を確認してください。';
            console.error(err);
          }
        });
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: README に管理者画面の1文を追記**

`README.md` の CMS セクション、Task 2 で更新した執筆フローの行の直後に追記:

```markdown
管理者でログインすると、ダッシュボードに「ユーザー管理」(招待・種別変更・依頼者コードの確認)と「サイト設定」(投稿間隔・Featured 件数)が表示される。シードの管理者は `admin@seed.local` / `seed-pass-1234`。
```

⚠️ Task 2 と同様、README.md は自分のハンクだけを `git apply --cached` 方式でステージし、所有者の未コミット編集を巻き込まないこと。

- [ ] **Step 3: テスト + ビルドを確認**

Run: `cd admin && npm test && npm run build`
Expected: 全 PASS、**9 ページ**ビルド成功(settings が増える)

ルートでも: `npm test` → 11 PASS(影響なしの確認)

- [ ] **Step 4: コミット**

```bash
git add admin/src/pages/settings.astro
# README.md は自分のハンクのみステージ済みであること
git commit -m "feat: site settings page (post interval, featured count) + docs"
```

---

## コントローラによる最終ブラウザ検証(サブエージェントのタスクではない)

前提: `supabase start` + シード済み、`supabase functions serve --env-file supabase/functions/.env`、`cd admin && npm run dev`。

1. `admin@seed.local` でログイン → ダッシュボードに「ユーザー管理 / サイト設定」リンクが見える
2. `hana@seed.local` でログイン → リンクが見えない。`/users` 直叩き → dashboard へリダイレクト
3. `/users`: 4ユーザーが一覧表示、forest-org に依頼者コード表示。kenta を provider に変更 → コードが発行されて表示 → writer に戻す(コードは残るが仕様どおり)
4. 招待フォーム: 新規メール(例 `e2e-invite@seed.local`)で writer を招待 → 成功メッセージ + 一覧に出現 + Mailpit(http://127.0.0.1:54324)に招待メールが届き、リンクが `/set-password` に向いている
5. 重複 slug で再招待 → 「このスラッグは既に使われています。」
6. `/settings`: 現値(10 / 3)が読み込まれる → featured を 4 に保存 → 「保存しました。」→ 3 に戻す
7. ログイン失敗(誤パスワード)→ 「メールアドレスまたはパスワードが正しくありません。」(英語が出ないこと)
8. 新規記事: 「下書きを作成して編集へ」→ 編集ページに遷移し、公開ボタンはそこにだけある
9. 編集ページに偽 id(`/articles/edit?id=00000000-0000-0000-0000-000000000000`)→ メッセージ表示 + フォームが隠れている
10. 検証で作ったユーザー・変更した設定は `supabase db reset && npm run seed` で復元

## 備考(スコープ外・既知の割り切り)

- **ユーザー削除・無効化**: MVP 外(spec の管理者要件は一覧・招待・ロール設定・コード発行のみ)
- **admin の自己降格**: UI では admin 行の種別を変更不可にしている(DB 上は admin 同士なら可能だが、管理者は信頼済み)
- **依頼者コードのローテーション**: 自動発行のみ。再発行 UI は必要になってから
- **provider → writer に戻したときコードが残る**: 実害なし(コードの有効性は commissioned_by 解決時に profiles を引くため、provider でなくなった元コードの扱いは既存トリガーの仕様に従う)。気になれば計画7で
- **設定変更の反映**: 公開サイトは静的なので次回ビルドから。ページ内に注記済み
