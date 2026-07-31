# ユーザー削除機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CMS のユーザー管理ページから、管理者が確認ポップアップを経てユーザーを削除できるようにする。

**Architecture:** `articles.author_id` の FK を `on delete cascade` から `on delete restrict` に変更し「記事を持つユーザーは削除不可」を DB 層(宣言的制約)で強制する。削除自体は `auth.admin.deleteUser` が必要なため新規 Edge Function `delete-user` を追加し、CMS は既存の共通確認モーダル(`ConfirmDialog` / `initConfirmDialog`)を再利用して呼び出す。

**Tech Stack:** Supabase (Postgres, pgTAP, Deno Edge Functions), Astro + TypeScript(admin)、Vitest。

## Global Constraints

- 権限・ビジネスルールは DB 層(RLS・トリガー・制約)で強制する。クライアント側の非表示はUXのみで、実際の防壁ではない(CLAUDE.md)。
- service role key は `admin/` に置かない。`auth.admin.deleteUser` は Edge Function からのみ呼ぶ。
- 新ルールはマイグレーション + pgTAP テストで書く。
- 自分自身(呼び出し中の管理者)は削除不可。他の管理者は削除可。
- 記事を持つユーザーは削除をブロックする(連鎖削除しない)。
- 確認ポップアップは新規コンポーネントを作らず、既存の `ConfirmDialog.astro` + `admin/src/lib/confirm-dialog.ts` を再利用する。

---

### Task 1: FK を restrict に変更するマイグレーション + DATABASE.md 更新

**Files:**
- Create: `supabase/migrations/20260731150000_restrict_article_author_delete.sql`
- Modify: `docs/DATABASE.md:16` (ER図の凡例), `docs/DATABASE.md:48` (articles.author_id の説明)

**Interfaces:**
- Produces: 制約名 `articles_author_id_fkey` を `on delete restrict` で再作成する(Task 2 のテスト、Task 3 の Edge Function エラー判定で参照する制約名)。

- [ ] **Step 1: マイグレーションファイルを作成**

`supabase/migrations/20260731150000_restrict_article_author_delete.sql`:

```sql
-- ユーザー削除機能: 記事を持つユーザーの削除を FK でブロックする。
-- 従来は on delete cascade でユーザー削除時に記事も連鎖削除していたが、
-- 誤削除防止のため「記事があれば削除不可」に方針変更する(restrict)。
alter table public.articles
  drop constraint articles_author_id_fkey;

alter table public.articles
  add constraint articles_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete restrict;
```

- [ ] **Step 2: ローカル DB に適用**

Run: `supabase migration up`
Expected: マイグレーションが適用され、エラーなく完了する。

- [ ] **Step 3: `docs/DATABASE.md` を更新**

`docs/DATABASE.md:16` の凡例行:

```
    profiles ||--o{ articles : "author_id"
```
は変更不要(1:多の記号自体は変わらない)が、`docs/DATABASE.md:48` のコメントを更新する。

変更前:
```
        uuid author_id FK "-> profiles.id, cascade delete"
```
変更後:
```
        uuid author_id FK "-> profiles.id, restrict delete(記事があれば著者を削除不可)"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260731150000_restrict_article_author_delete.sql docs/DATABASE.md
git commit -m "feat(db): articles.author_id のFKをrestrictに変更し記事ありユーザーの削除をブロック"
```

---

### Task 2: pgTAP テスト

**Files:**
- Create: `supabase/tests/database/20_user_deletion.test.sql`

**Interfaces:**
- Consumes: Task 1 で再作成した `articles_author_id_fkey`(restrict)。

- [ ] **Step 1: テストファイルを作成**

`supabase/tests/database/20_user_deletion.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'del-with-articles@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'del-without-articles@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'writer', 'del-with-articles', 'W1'),
  ('00000000-0000-0000-0000-0000000000e2', 'writer', 'del-without-articles', 'W2');

insert into articles (author_id, title) values
  ('00000000-0000-0000-0000-0000000000e1', '記事あり');

-- 記事を持つユーザーの削除は FK 違反(23503)でブロックされる
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23503', null, '記事を持つユーザーの削除はFK違反でブロックされる'
);

select is(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000e1')::int,
  1, 'ブロックされた場合プロフィールは残る'
);

-- 記事を持たないユーザーの削除は成功し、profiles にも cascade する
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000e2'$$,
  '記事を持たないユーザーの削除は成功する'
);

select is(
  (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000e2')::int,
  0, '削除成功時はprofilesもcascadeで消える'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストを実行して通ることを確認**

Run: `supabase test db`
Expected: `20_user_deletion.test.sql` の4アサーションすべて PASS。

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/20_user_deletion.test.sql
git commit -m "test(db): 記事ありユーザーの削除ブロックをpgTAPで検証"
```

---

### Task 3: Edge Function `delete-user`

**Files:**
- Create: `supabase/functions/delete-user/index.ts`

**Interfaces:**
- Consumes: `supabase/functions/_shared/cors.ts` の `corsHeaders`(`invite-user/index.ts:2` と同じ import)。Task 1 の FK 制約名 `articles_author_id_fkey`。
- Produces: POST `{ userId: string }` を受け取り、成功時 `{ ok: true }` を返す HTTP エンドポイント `delete-user`。エラー時は `{ error: string }` を返す(`self`/`forbidden`/`unauthorized`/`user has articles` などの文言は Task 4 の `translateDeleteUserError` が判定に使う)。

- [ ] **Step 1: Edge Function を作成**

`supabase/functions/delete-user/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // identify the caller and require the admin role
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: callerData } = await admin.auth.getUser(jwt);
  if (!callerData?.user) return json({ error: 'unauthorized' }, 401);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();
  if (callerProfile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: { userId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { userId } = payload;
  if (!userId) return json({ error: 'userId is required' }, 400);
  if (userId === callerData.user.id) {
    return json({ error: 'cannot delete yourself' }, 400);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // 記事を持つユーザーは articles_author_id_fkey の restrict 制約で
    // 削除に失敗する。GoTrue はその DB エラーメッセージをそのまま返す。
    return json({ error: error.message }, 400);
  }

  return json({ ok: true });
});
```

- [ ] **Step 2: ローカルで Edge Function を起動し確認**

Run: `npm run dev:fn`
Expected: `delete-user` がエラーなくロードされる(コンソールに `serving delete-user` 相当のログ)。

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/delete-user/index.ts
git commit -m "feat(functions): admin専用のdelete-user Edge Functionを追加"
```

---

### Task 4: `admin/src/lib/admin.ts` に `deleteUser` / エラー変換を追加

**Files:**
- Modify: `admin/src/lib/admin.ts:98-117`(`inviteUser`/`translateInviteError` の直後に追記、共通処理を抽出)
- Modify: `admin/tests/admin.test.ts`(既存 `describe('inviteUser', ...)` ブロックの直後に新規 `describe` を追加)

**Interfaces:**
- Consumes: Task 3 の Edge Function `delete-user`(body: `{ userId: string }`)。
- Produces: `deleteUser(supabase: SupabaseClient, userId: string): Promise<void>` と `translateDeleteUserError(err: unknown): string`(Task 5 の `users.astro` が import して使う)。

- [ ] **Step 1: 失敗するテストを書く(admin.test.ts に追加)**

`admin/tests/admin.test.ts` の `describe('translateInviteError', ...)` ブロック(既存 227〜242行目)の直後に追加:

```ts
describe('deleteUser', () => {
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

  it('delete-user に userId を送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await deleteUser(supabase, 'user-1');
    expect(calls[0]).toEqual(['delete-user', { body: { userId: 'user-1' } }]);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(deleteUser(supabase, 'user-1')).rejects.toThrow('forbidden');
  });

  it('userId が空文字なら呼び出さずに例外', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await expect(deleteUser(supabase, '')).rejects.toThrow('USER_ID_REQUIRED');
    expect(calls.length).toBe(0);
  });
});

describe('translateDeleteUserError', () => {
  it('既知のエラーを日本語にする', () => {
    expect(translateDeleteUserError(new Error('cannot delete yourself')))
      .toContain('自分自身');
    expect(translateDeleteUserError(new Error('forbidden'))).toContain('管理者のみ');
    expect(translateDeleteUserError(
      new Error('update or delete on table "profiles" violates foreign key constraint "articles_author_id_fkey" on table "articles"'),
    )).toContain('記事');
  });
  it('未知は汎用メッセージ', () => {
    expect(translateDeleteUserError(new Error('boom'))).toContain('削除に失敗');
  });
});
```

また、`admin/tests/admin.test.ts:6` の import 行を変更:

変更前:
```ts
  validateInviteInput, inviteUser, translateInviteError,
```
変更後:
```ts
  validateInviteInput, inviteUser, translateInviteError,
  deleteUser, translateDeleteUserError,
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd admin && npm test -- admin.test.ts -t "deleteUser"`
Expected: FAIL(`deleteUser is not a function` 等、未定義エラー)。

- [ ] **Step 3: `admin/src/lib/admin.ts` に実装を追加**

まず既存の `inviteUser`(98-108行目)を共通ヘルパー抽出でリファクタリング。

変更前(`admin/src/lib/admin.ts:98-108`):
```ts
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
```

変更後:
```ts
// Edge Function のエラーを掘り出して throw する共通処理。
// FunctionsHttpError の .message は汎用文言で、EF が返した { error: "..." } は
// context(Response)側にある。invite-user / delete-user など admin 専用 EF 呼び出しで共有する。
async function invokeAdminFunction(
  supabase: SupabaseClient, name: string, body: unknown,
): Promise<void> {
  const { error } = await supabase.functions.invoke(name, { body });
  if (!error) return;
  const ctx = (error as { context?: Response }).context;
  const errBody = ctx && typeof ctx.json === 'function'
    ? await ctx.json().catch(() => null)
    : null;
  const msg = errBody && typeof errBody === 'object' && 'error' in errBody
    ? String(errBody.error) : null;
  throw new Error(msg ?? (error instanceof Error ? error.message : String(error)));
}

export async function inviteUser(supabase: SupabaseClient, input: InviteInput): Promise<void> {
  await invokeAdminFunction(supabase, 'invite-user', input);
}
```

次に、`admin/src/lib/admin.ts:110-117` の `translateInviteError` 関数の直後(118行目相当)に追記:

```ts
export async function deleteUser(supabase: SupabaseClient, userId: string): Promise<void> {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  await invokeAdminFunction(supabase, 'delete-user', { userId });
}

export function translateDeleteUserError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('cannot delete yourself')) return '自分自身のアカウントは削除できません。';
  if (msg.includes('forbidden')) return '管理者のみ実行できます。';
  if (msg.includes('articles_author_id_fkey')) {
    return 'このユーザーは記事を持っているため削除できません。先に記事を削除してください。';
  }
  return '削除に失敗しました。時間をおいて再度お試しください。';
}
```

- [ ] **Step 4: テストを実行して全て通ることを確認**

Run: `cd admin && npm test -- admin.test.ts`
Expected: 既存テストを含め全て PASS(`inviteUser` のリファクタリングで既存テストが壊れていないことも確認)。

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/admin.ts admin/tests/admin.test.ts
git commit -m "feat(admin): admin.ts にdeleteUserとエラー変換を追加、EF呼び出しを共通化"
```

---

### Task 5: `users.astro` に削除ボタン + 確認モーダルを配線

**Files:**
- Modify: `admin/src/pages/users.astro`

**Interfaces:**
- Consumes: Task 4 の `deleteUser`/`translateDeleteUserError`(`admin/src/lib/admin.ts`)。既存の `initConfirmDialog`(`admin/src/lib/confirm-dialog.ts`)、`AdminLayout.astro` が既にマウントしている `#confirm-dialog`(`admin/src/layouts/AdminLayout.astro:22`)。

- [ ] **Step 1: テーブルヘッダーに列を追加**

`admin/src/pages/users.astro:43` を変更:

変更前:
```astro
          <tr><th>名前</th><th>スラッグ</th><th>種別</th><th>認定</th></tr>
```
変更後:
```astro
          <tr><th>名前</th><th>スラッグ</th><th>種別</th><th>認定</th><th>操作</th></tr>
```

`admin/src/pages/users.astro:45` の `colspan="4"` を2箇所とも `colspan="5"` に変更(45行目の初期表示、166行目の読み込み失敗表示)。

- [ ] **Step 2: import を追加し、ログイン中ユーザーの id を取得**

`admin/src/pages/users.astro:55-58` を変更:

変更前:
```ts
      import {
        fetchAllProfiles, updateUserRole, updateProviderCertification,
        validateInviteInput, inviteUser, translateInviteError,
      } from '../lib/admin';
      import { initShellChrome } from '../lib/shell';
```
変更後:
```ts
      import {
        fetchAllProfiles, updateUserRole, updateProviderCertification,
        validateInviteInput, inviteUser, translateInviteError,
        deleteUser, translateDeleteUserError,
      } from '../lib/admin';
      import { initShellChrome } from '../lib/shell';
      import { initConfirmDialog } from '../lib/confirm-dialog';
```

`admin/src/pages/users.astro:74-76`(`messageEl`/`tbody`/`$` の定義)の直後に追加:

```ts
        const myId = session.user.id;
        const confirmDialog = initConfirmDialog(
          document.getElementById('confirm-dialog') as HTMLDialogElement,
        );
```

- [ ] **Step 3: 行に削除ボタンを追加**

`admin/src/pages/users.astro:123-153`(`certifiedTd` の組み立て〜)の直後、`tr.appendChild(nameTd);`(155行目)の手前に、削除セルの組み立てを追加:

変更前(153-159行目):
```ts
            tr.appendChild(nameTd);
            tr.appendChild(slugTd);
            tr.appendChild(roleTd);
            tr.appendChild(certifiedTd);
            tbody.appendChild(tr);
          }
        };
```
変更後:
```ts
            const actionsTd = document.createElement('td');
            if (p.id !== myId) {
              const delBtn = document.createElement('button');
              delBtn.type = 'button';
              delBtn.textContent = '削除';
              delBtn.addEventListener('click', async () => {
                messageEl.textContent = '';
                const ok = await confirmDialog.confirm({
                  title: 'ユーザーを削除しますか?',
                  body: `「${p.name}」を削除します。この操作は取り消せません。`,
                  confirmLabel: '削除する',
                });
                if (!ok) return;
                try {
                  await deleteUser(supabaseBrowser, p.id);
                } catch (err) {
                  messageEl.textContent = translateDeleteUserError(err);
                  console.error(err);
                  return;
                }
                messageEl.textContent = `${p.name} を削除しました。`;
                try {
                  await renderRows();
                } catch (err) {
                  messageEl.textContent += ' 一覧の再読み込みに失敗しました。ページを再読み込みしてください。';
                  console.error(err);
                }
              });
              actionsTd.appendChild(delBtn);
            }

            tr.appendChild(nameTd);
            tr.appendChild(slugTd);
            tr.appendChild(roleTd);
            tr.appendChild(certifiedTd);
            tr.appendChild(actionsTd);
            tbody.appendChild(tr);
          }
        };
```

- [ ] **Step 4: ローカルで動作確認**

Run: `npm run dev:all`(既に起動していれば不要)

`admin@seed.local` でログインし `/users` を開く。手順:
1. 記事を持たないユーザー(例: 新規招待したテストユーザー)の行で「削除」→確認ダイアログが出る→キャンセルすると何も起きないこと。
2. 再度「削除」→「削除する」→行が消え「◯◯ を削除しました。」と表示されること。
3. 記事を持つユーザー(例: `hana@seed.local` = 田中花、シードで記事あり)の行で削除を試み、「このユーザーは記事を持っているため削除できません。」が表示され、行が残ること。
4. 自分自身(`admin@seed.local` の行)には削除ボタンが表示されないこと。

Expected: 上記4点すべて確認どおりに動作する。

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/users.astro
git commit -m "feat(admin): ユーザー一覧に確認モーダル付きの削除ボタンを追加"
```

---

## 完了確認

- [ ] `supabase test db` が全件 PASS
- [ ] `cd admin && npm test` が全件 PASS
- [ ] `AGENTS-ACTIVE.local.md` から自分の作業ブロックを削除する
