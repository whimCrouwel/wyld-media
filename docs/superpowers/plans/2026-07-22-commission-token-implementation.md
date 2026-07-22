# 依頼トークン(プロバイダー→ライター)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static, provider-wide `commission_code` with per-writer, one-time `commission_tokens`, so admin can see which provider commissioned which writer (and whether that resulted in a published article) instead of only inferring it after the fact.

**Architecture:** Three additive/cutover Supabase migrations (create `commission_tokens` → cut `articles` over to it and delete the old code system → add revoke), a new `admin/src/lib/commissions.ts` data-access module, and two new CMS pages (`/commission` for providers, `/commissions` for admins) built from the existing `PageShell`/`Card`/`Button`/atomic-design components — no new component library, no new backend service.

**Tech Stack:** Postgres + pgTAP (`supabase/tests/database/`), Supabase RLS/triggers, Astro + TypeScript CMS (`admin/`), Vitest.

**Spec:** [docs/superpowers/specs/2026-07-22-commission-token-design.md](../specs/2026-07-22-commission-token-design.md)

## Global Constraints

- 権限・ビジネスルールは全て DB 層(RLS・トリガー)で強制する。CMS 側のチェックは UX のためだけ。
- 依頼トークンは1トークン=1記事(使い切り)。プロバイダーが特定のライター宛てに発行する。
- 依頼→承諾のような platform 内ステップは作らない(トークンを記事に貼る行為自体が同意)。
- 旧 `commission_code`(プロバイダー固有の静的コード)と `validate_commission_code` RPC は完全に廃止する(並存させない)。
- トークン失効(revoke)はこのプロジェクトのスコープに含める(provider は自分が発行した未使用トークンのみ、admin は誰のものでも取消可能。使用済みトークンは取消不可)。
- UI 文言は日本語。既存の CMS コンポーネント(`PageShell`/`Card`/`Button`/`Field`)とスタイルトークン(`bg-primary`/`text-muted-foreground`/`bg-secondary`/`bg-destructive` 等)に合わせる。新しい配色は作らない。
- CMS 側のロール出し分けは全て `fetchMyRole()` を使った UX 用の分岐(既存パターン)。本物の防壁は RLS/トリガー。
- 依頼の流れを説明するポップアップ UI はスコープ外([docs/TODO.md](../../TODO.md) 記載済み)。

---

## File Structure

| File | 役割 |
|---|---|
| `supabase/migrations/20260722100000_commission_tokens.sql` | `commission_tokens` テーブル・発行トリガー・RLS(新規) |
| `supabase/migrations/20260722100100_commission_token_resolution.sql` | `articles` をトークン方式へ切替、旧 `commission_code` 方式を撤去(新規) |
| `supabase/migrations/20260722100200_commission_token_revoke.sql` | トークン取消機能(新規) |
| `supabase/tests/database/12_commission_tokens.test.sql` | 依頼トークン一式の pgTAP テスト(新規) |
| `supabase/tests/database/04_commission.test.sql` | 削除(旧方式の全内容が対象消滅) |
| `supabase/tests/database/03_profile_protection.test.sql` | `commission_code` 関連の assertion を削除(修正) |
| `supabase/tests/database/05_publish_rules.test.sql` | `commission_code_input` → トークン方式へ書き換え(修正) |
| `supabase/tests/database/06_publish_hardening.test.sql` | 同上(修正) |
| `admin/src/lib/articles.ts` | フィールド名を `commissionCode*` → `commissionToken*` に全面リネーム(修正) |
| `admin/src/lib/admin.ts` | `AdminProfile.commissionCode` を削除(修正) |
| `admin/src/lib/editor-helpers.ts` | 新エラーコードのマッピング追加(修正) |
| `admin/src/lib/commissions.ts` | プロバイダー/管理者向けのトークン発行・一覧・取消ロジック(新規) |
| `admin/src/pages/articles/new.astro` / `edit.astro` | 依頼者コード欄 → 依頼トークン欄(修正) |
| `admin/src/pages/users.astro` | 「依頼者コード」列を削除(修正) |
| `admin/src/pages/commission.astro` | プロバイダー専用: ライターに依頼する画面(新規) |
| `admin/src/pages/commissions.astro` | 管理者専用: 全トークン一覧画面(新規) |
| `admin/src/pages/dashboard.astro` | provider 向けナビリンク追加、admin ナビに依頼トークン管理を追加(修正) |
| `admin/src/styles/global.css` | `.commission-list` / `.commission-pill--*` 追加(修正) |
| `admin/tests/admin.test.ts` | `commissionCode` 関連 assertion を削除(修正) |
| `admin/tests/articles.test.ts` | `commissionCode` → `commissionToken` 全面リネーム、関連テスト書き換え(修正) |
| `admin/tests/commissions.test.ts` | `commissions.ts` の統合テスト(新規) |
| `scripts/seed.mjs` | 依頼記事のシードをトークン発行フローに書き換え(修正) |
| `ARCHITECTURE.md` | 依頼者コードの記述をトークン方式へ更新(修正) |
| `docs/DATABASE.md` | ER図・関数一覧をトークン方式へ更新(修正) |

---

## Task 1: `commission_tokens` テーブルと発行

**Files:**
- Create: `supabase/tests/database/12_commission_tokens.test.sql`
- Create: `supabase/migrations/20260722100000_commission_tokens.sql`

**Interfaces:**
- Produces: table `public.commission_tokens(id, provider_id, writer_id, token, created_at)`; function `public.set_commission_token()`; trigger `a_set_commission_token`; RLS policies `"see own issued or received tokens, admin sees all"` (select) and `"provider issues own tokens"` (insert) on `commission_tokens`; RLS policy `"authenticated reads writer profiles"` (select, `role = 'writer'`) on `profiles`.
- Consumes: existing `public.is_admin()` (from `20260706031309_rls_policies.sql`), existing `public.user_role` enum, existing `extensions.gen_random_bytes`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/12_commission_tokens.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000010', 'tok-writer@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'tok-provider@test.local'),
  ('00000000-0000-0000-0000-000000000012', 'tok-other-writer@test.local'),
  ('00000000-0000-0000-0000-000000000013', 'tok-other-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000010', 'writer', 'tok-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000011', 'provider', 'tok-provider', 'Provider'),
  ('00000000-0000-0000-0000-000000000012', 'writer', 'tok-other-writer', 'Other Writer'),
  ('00000000-0000-0000-0000-000000000013', 'provider', 'tok-other-provider', 'Other Provider');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into commission_tokens (id, writer_id)
    values ('50000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000010')$$,
  'provider issues a token to a writer');

select matches(
  (select token from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '^WM-[0-9A-F]{8}$',
  'issued token has the expected format');

select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'provider_id is forced to the caller');

select lives_ok(
  $$insert into commission_tokens (id, writer_id, provider_id)
    values ('50000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000013')$$,
  'a spoofed provider_id does not error (silently overwritten)');
select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'the spoofed provider_id is forced back to the actual caller');

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000013')$$,
  '%INVALID_WRITER%',
  'the target must have role=writer (a provider id is rejected)');

-- act as a writer (not a provider)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000012')$$,
  '%NOT_A_PROVIDER%',
  'a writer cannot issue commission tokens');

select ok(
  exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'the target writer can see a token issued to them');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select ok(
  not exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'an unrelated provider cannot see another provider''s token');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select ok(
  exists(select 1 from commission_tokens where writer_id = '00000000-0000-0000-0000-000000000010'),
  'the issuing provider can see their own issued tokens');

select ok(
  exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000000010'),
  'an authenticated provider can read a writer profile (needed for the "pick a writer" UI)');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "commission_tokens" does not exist` (or similar) from `12_commission_tokens.test.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260722100000_commission_tokens.sql`:

```sql
-- 依頼トークン(プロバイダー→ライター)。1トークン=1記事の使い切り。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

create table public.commission_tokens (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  writer_id uuid not null references public.profiles (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  constraint commission_tokens_token_format
    check (token ~ '^WM-[0-9A-F]{8}$')
);

create or replace function public.set_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  provider_role public.user_role;
  writer_role public.user_role;
begin
  -- provider_id はクライアント指定を無視し、必ず呼び出し本人にする
  new.provider_id := auth.uid();

  select role into provider_role from profiles where id = new.provider_id;
  if provider_role is distinct from 'provider' then
    raise exception 'NOT_A_PROVIDER: only providers can issue commission tokens';
  end if;

  select role into writer_role from profiles where id = new.writer_id;
  if writer_role is distinct from 'writer' then
    raise exception 'INVALID_WRITER: target profile is not a writer';
  end if;

  new.token := 'WM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  return new;
end;
$$;

create trigger a_set_commission_token
  before insert on public.commission_tokens
  for each row execute function public.set_commission_token();

alter table public.commission_tokens enable row level security;

grant select, insert on public.commission_tokens to authenticated;

create policy "see own issued or received tokens, admin sees all"
  on public.commission_tokens for select to authenticated
  using (provider_id = auth.uid() or writer_id = auth.uid() or public.is_admin());

create policy "provider issues own tokens"
  on public.commission_tokens for insert to authenticated
  with check (provider_id = auth.uid());

-- プロバイダーが依頼先ライターを選べるよう、ライターの基本情報を全認証ユーザーに公開する。
-- 公開サイトで既に同じ情報が誰でも見られるため、新たな情報漏えいにはならない。
create policy "authenticated reads writer profiles"
  on public.profiles for select to authenticated
  using (role = 'writer');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase test db`
Expected: PASS — `12_commission_tokens.test.sql` shows `1..11` all ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260722100000_commission_tokens.sql supabase/tests/database/12_commission_tokens.test.sql
git commit -m "$(cat <<'EOF'
feat(db): add commission_tokens table for provider->writer commissions

Providers can now issue a one-time token to a specific writer instead
of sharing a single static, provider-wide code.
EOF
)"
```

---

## Task 2: `articles` をトークン方式へ切替、旧方式を撤去

**Files:**
- Modify: `supabase/tests/database/12_commission_tokens.test.sql`
- Delete: `supabase/tests/database/04_commission.test.sql`
- Modify: `supabase/tests/database/03_profile_protection.test.sql`
- Modify: `supabase/tests/database/05_publish_rules.test.sql`
- Modify: `supabase/tests/database/06_publish_hardening.test.sql`
- Create: `supabase/migrations/20260722100100_commission_token_resolution.sql`
- Modify: `admin/src/lib/articles.ts`
- Modify: `admin/src/lib/admin.ts`
- Modify: `admin/src/lib/editor-helpers.ts`
- Modify: `admin/src/pages/articles/new.astro`
- Modify: `admin/src/pages/articles/edit.astro`
- Modify: `admin/src/pages/users.astro`
- Modify: `admin/tests/admin.test.ts`
- Modify: `admin/tests/articles.test.ts`
- Modify: `scripts/seed.mjs`

**Interfaces:**
- Consumes: `commission_tokens` table + `a_set_commission_token` trigger from Task 1.
- Produces: `articles.commission_token_input` (renamed from `commission_code_input`), `articles.commission_token_id`; function `public.resolve_commission_token()`; trigger `a_resolve_commission_token`; RPC `public.validate_commission_token(token text, article_id uuid default null) returns text`. `ArticleInput.commissionToken` / `ArticlePayload.commission_token_input` / `EditableArticle.commissionTokenInput` (renamed in `articles.ts`) consumed by Tasks 4-6 do not depend on this task, but the astro pages in this task consume `validateCommissionToken()` produced here.

This task is a single atomic cutover (old and new commission systems cannot coexist per the Global Constraints), so it is one task with several ordered sub-steps rather than split further.

- [ ] **Step 1: Extend the pgTAP test for the resolve trigger and RPC (still failing)**

Add to `supabase/tests/database/12_commission_tokens.test.sql`, replacing `select plan(11);` with `select plan(25);` and inserting the following block right before `select * from finish();`:

```sql
-- resolve: articles への解決
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, title, commission_token_input)
    values ('60000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000010',
            'commissioned draft',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'))$$,
  'writer publishes using a token issued to them');

select is(
  (select commissioned_by from articles where id = '60000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'commissioned_by resolved from the token''s provider');

select is(
  (select commission_token_id from articles where id = '60000000-0000-0000-0000-000000000001'),
  '50000000-0000-0000-0000-000000000001'::uuid,
  'commission_token_id resolved to the matching token');

select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
    '60000000-0000-0000-0000-000000000001'),
  'Provider',
  'RPC still returns the provider name when article_id excludes the article that legitimately holds the token');

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'bad token', 'WM-NOPE0000')$$,
  '%INVALID_COMMISSION_TOKEN%',
  'an unknown token is rejected');

-- act as a different writer the token was not issued to
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000012', 'wrong writer',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'))$$,
  '%COMMISSION_TOKEN_WRONG_WRITER%',
  'a token issued to a different writer is rejected');

-- back to the token's actual writer: reusing an already-linked token is rejected
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'second use',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'))$$,
  '%COMMISSION_TOKEN_ALREADY_USED%',
  'a token already linked to another article cannot be reused');

select lives_ok(
  $$update articles set commission_token_input = null
    where id = '60000000-0000-0000-0000-000000000001'$$,
  'the commission link can be cleared');
select is(
  (select commissioned_by from articles where id = '60000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the token input clears commissioned_by');
select is(
  (select commission_token_id from articles where id = '60000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the token input clears commission_token_id');

-- validate_commission_token RPC (used by the editor's blur-time preview)
select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002')),
  'Provider',
  'RPC returns the provider name for a valid, unused token belonging to the caller');
select is(
  public.validate_commission_token('WM-NOPE0000'),
  null::text,
  'RPC returns null for an unknown token');

select lives_ok(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'second commissioned',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002'))$$,
  'writer publishes a second commissioned article using token #2');
select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002')),
  null::text,
  'RPC returns null once the token has been used by an article');
```

(11 existing + 14 new = 25, matching `plan(25)`.)

- [ ] **Step 2: Delete the obsolete commission test file**

```bash
rm supabase/tests/database/04_commission.test.sql
```

- [ ] **Step 3: Update `03_profile_protection.test.sql`**

Replace the entire file content with:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000004', 'prot-writer@test.local'),
  ('00000000-0000-0000-0000-000000000006', 'prot-admin@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000004', 'writer', 'prot-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000006', 'admin', 'prot-admin', 'Admin');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update profiles set name = 'Writer Renamed'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  'writer can update own name');
select throws_like(
  $$update profiles set role = 'admin'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  '%only be changed by an admin%',
  'writer cannot change own role');

set local role postgres;
select is(
  (select name from profiles
    where id = '00000000-0000-0000-0000-000000000004'),
  'Writer Renamed', 'name change was persisted');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update profiles set role = 'provider'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  'admin can change roles');

set local role postgres;
select is(
  (select role from profiles
    where id = '00000000-0000-0000-0000-000000000004')::text,
  'provider', 'role change by admin was persisted');

select * from finish();
rollback;
```

- [ ] **Step 4: Update `05_publish_rules.test.sql`**

Replace the `insert into profiles` fixture (lines 9-11) with (drop the `commission_code` column and its literal value):

```sql
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000009', 'writer', 'pub-writer', 'Writer'),
  ('00000000-0000-0000-0000-00000000000b', 'provider', 'pub-provider', 'Provider');
```

Insert this block immediately after that fixture (before the "act as writer" JWT block), to issue the tokens the commissioned-article assertions further down will use:

```sql
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
insert into commission_tokens (id, writer_id) values
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000009'),
  ('50000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000009');
```

Then replace the two `commission_code_input` inserts (originally lines 56-67) with:

```sql
select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_token_input, body, region)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-c', 'commissioned 1', 'published',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000005'),
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'commissioned article publishes immediately (exempt)');
select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_token_input, body, region)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-d', 'commissioned 2', 'published',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000006'),
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'multiple commissioned articles are all exempt');
```

The `act as writer` JWT is re-set right before these two by the existing surrounding code in the file — keep that as-is; only the fixture block and these two inserts change. `plan(10)` stays correct (assertion count unchanged, only their bodies changed).

- [ ] **Step 5: Update `06_publish_hardening.test.sql`**

Replace the `insert into profiles` fixture (lines 9-11) with:

```sql
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-00000000000c', 'writer', 'hard-writer', 'Writer'),
  ('00000000-0000-0000-0000-00000000000d', 'provider', 'hard-provider', 'Provider');
```

Insert this block immediately after (before section "1)"), to issue the token section 5 will use:

```sql
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
insert into commission_tokens (id, writer_id) values
  ('50000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000c');
```

In section "5)", replace the `commission_code_input` insert (originally lines 84-90) with:

```sql
select lives_ok(
  $$insert into articles (id, author_id, slug, title, status, commission_token_input, body, region)
    values ('40000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-00000000000c',
            'hard-c', 'commissioned post', 'published',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000007'),
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'writer publishes a commissioned article (rate limit exempt)');
```

In section "5)", replace the `commission_code_input = null` clearing assertion (originally lines 92-96) with (same assertion, only the column name changes):

```sql
select throws_like(
  $$update articles set commission_token_input = null
    where id = '40000000-0000-0000-0000-000000000003'$$,
  '%COMMISSION_UNLINK_REQUIRES_UNPUBLISH%',
  'clearing the commission link while still published is rejected');
```

In section "6)", replace the `commission_code_input = null` clearing assertion (originally lines 109-112) the same way:

```sql
select lives_ok(
  $$update articles set commission_token_input = null
    where id = '40000000-0000-0000-0000-000000000003'$$,
  'commission link can be cleared once the article is a draft');
```

`plan(11)` stays correct (assertion count unchanged).

- [ ] **Step 6: Run the tests to verify Steps 1-5 fail correctly**

Run: `supabase test db`
Expected: FAIL — errors referencing `commission_token_input`/`resolve_commission_token`/`validate_commission_token` not existing yet (the migration hasn't been written).

- [ ] **Step 7: Write the migration**

Create `supabase/migrations/20260722100100_commission_token_resolution.sql`:

```sql
-- 依頼トークンへの一本化: articles を新しいトークン方式に切り替え、
-- 旧・依頼者コード方式(profiles.commission_code 等)を撤去する。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

alter table public.articles
  rename column commission_code_input to commission_token_input;

alter table public.articles
  add column commission_token_id uuid references public.commission_tokens (id),
  add constraint articles_commission_token_id_key unique (commission_token_id);

drop trigger if exists a_resolve_commission_code on public.articles;
drop function if exists public.resolve_commission_code();
drop function if exists public.validate_commission_code(text);

create or replace function public.resolve_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  tok record;
begin
  if new.commission_token_input is null then
    new.commissioned_by := null;
    new.commission_token_id := null;
  elsif tg_op = 'INSERT'
        or new.commission_token_input is distinct from old.commission_token_input then
    select id, provider_id, writer_id into tok
      from commission_tokens
     where token = new.commission_token_input;

    if tok.id is null then
      raise exception 'INVALID_COMMISSION_TOKEN: no token matches this value';
    end if;
    if tok.writer_id <> new.author_id then
      raise exception 'COMMISSION_TOKEN_WRONG_WRITER: this token was issued to a different writer';
    end if;
    if exists (
      select 1 from articles
       where commission_token_id = tok.id and id <> new.id
    ) then
      raise exception 'COMMISSION_TOKEN_ALREADY_USED: this token has already been used on another article';
    end if;

    new.commissioned_by := tok.provider_id;
    new.commission_token_id := tok.id;
  else
    new.commissioned_by := old.commissioned_by;
    new.commission_token_id := old.commission_token_id;
  end if;
  return new;
end;
$$;

create trigger a_resolve_commission_token
  before insert or update on public.articles
  for each row execute function public.resolve_commission_token();

create or replace function public.validate_commission_token(token text, article_id uuid default null)
returns text
language sql stable security definer
set search_path = public
as $$
  select p.name
    from commission_tokens t
    join profiles p on p.id = t.provider_id
   where t.token = token
     and t.writer_id = auth.uid()
     and not exists (
       select 1 from articles a
        where a.commission_token_id = t.id
          and a.id is distinct from article_id
     );
$$;

revoke execute on function public.validate_commission_token(text, uuid) from public, anon;
grant execute on function public.validate_commission_token(text, uuid)
  to authenticated, service_role;

-- 旧・依頼者コード方式の撤去
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'role can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists a_set_commission_code on public.profiles;
drop function if exists public.set_commission_code();

alter table public.profiles drop column commission_code;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `supabase test db`
Expected: PASS — all files including `12_commission_tokens.test.sql` (`1..25`) green.

- [ ] **Step 9: Update `admin/src/lib/articles.ts`**

Replace the entire file content with:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JSONContent } from '@tiptap/core';
import { safeUrl } from './url';
import { isRegion } from './regions';

export interface ArticleInput {
  title: string;
  slug: string;
  body: JSONContent[];
  coverUrl: string;
  commissionToken: string;
  region: string;
}

export interface ArticlePayload {
  title: string;
  slug: string | null;
  body: JSONContent[];
  cover_image_url: string | null;
  commission_token_input: string | null;
  region: string | null;
}

export interface EditableArticle {
  id: string;
  title: string;
  slug: string | null;
  body: JSONContent[];
  coverImageUrl: string | null;
  commissionTokenInput: string | null;
  region: string | null;
  status: 'draft' | 'published';
  updatedAt: string;
}

export interface SaveResult {
  updatedAt: string;
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
    commission_token_input: emptyToNull(input.commissionToken),
    // 想定外の値は送らず null にする(最終的な拒否は DB の check 制約)
    region: isRegion(input.region.trim()) ? input.region.trim() : null,
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
    .select('id, title, slug, body, cover_image_url, commission_token_input, region, status, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    body: (data.body ?? []) as JSONContent[],
    coverImageUrl: data.cover_image_url,
    commissionTokenInput: data.commission_token_input,
    region: data.region,
    status: data.status,
    updatedAt: data.updated_at,
  };
}

export async function saveArticle(
  supabase: SupabaseClient, id: string, input: ArticleInput, publish: boolean,
  expectedUpdatedAt?: string,
): Promise<SaveResult> {
  const payload = buildArticlePayload(input);
  // publish=true のときだけ status を published に上げる。false なら status を触らない
  // (未指定にすると現状維持)。published_at は送らない(トリガーが権威)。
  const update: Record<string, unknown> = { ...payload };
  if (publish) update.status = 'published';

  let query = supabase.from('articles').update(update).eq('id', id);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

  const { data, error } = await query.select('updated_at').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(expectedUpdatedAt ? 'CONFLICT' : 'NOT_FOUND');
  return { updatedAt: data.updated_at as string };
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

export async function validateCommissionToken(
  supabase: SupabaseClient, token: string, articleId?: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('validate_commission_token', {
    token, article_id: articleId ?? null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}
```

- [ ] **Step 10: Update `admin/src/lib/admin.ts`**

Remove the `commissionCode` field from `AdminProfile` and its mapping in `fetchAllProfiles`:

```typescript
export interface AdminProfile {
  id: string;
  role: Role;
  slug: string;
  name: string;
}
```

```typescript
export async function fetchAllProfiles(supabase: SupabaseClient): Promise<AdminProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, slug, name')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as Role,
    slug: r.slug,
    name: r.name,
  }));
}
```

- [ ] **Step 11: Update `admin/src/lib/editor-helpers.ts`**

Replace the `INVALID_COMMISSION_CODE` block with the three new token error codes (keep `POST_INTERVAL_NOT_ELAPSED` and everything after `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` unchanged):

```typescript
  if (msg.includes('INVALID_COMMISSION_TOKEN')) {
    return '依頼トークンが正しくありません。';
  }
  if (msg.includes('COMMISSION_TOKEN_WRONG_WRITER')) {
    return 'この依頼トークンは別のライター宛てです。';
  }
  if (msg.includes('COMMISSION_TOKEN_ALREADY_USED')) {
    return 'この依頼トークンは使用済みです。';
  }
  if (msg.includes('COMMISSION_UNLINK_REQUIRES_UNPUBLISH')) {
    return '公開中の依頼記事から依頼リンクを外すには、一度下書きに戻してください。';
  }
```

- [ ] **Step 12: Update `admin/src/pages/articles/new.astro`**

Change the field label (line 34):

```astro
        <Field id="commission" label="依頼トークン(任意)" type="text" />
```

Update the import (line 100):

```typescript
      import { createDraft, validateCommissionToken, checkSlugAvailable } from '../../lib/articles';
```

Update the blur handler (lines 223-228):

```typescript
        $('commission').addEventListener('blur', async () => {
          const token = $('commission').value.trim();
          if (!token) { commissionStatus.textContent = ''; return; }
          const name = await validateCommissionToken(supabaseBrowser, token);
          commissionStatus.textContent = name ? `依頼者: ${name}` : 'トークンが見つかりません';
        });
```

Update `collect()` (line 232):

```typescript
        const collect = () => ({
          title: $('title').value, slug: $('slug').value, body: getBodyBlocks(editor),
          coverUrl: cover.getUrl(), commissionToken: $('commission').value, region: defaultRegion,
        });
```

- [ ] **Step 13: Update `admin/src/pages/articles/edit.astro`**

Change the field label (mirrors new.astro's Field, same line number pattern near the top of the form).

Update the import list to include `validateCommissionToken` instead of `validateCommissionCode`.

Update the population line (line 153):

```typescript
          $('commission').value = article.commissionTokenInput ?? '';
```

Update the blur handler (lines 251-256):

```typescript
          $('commission').addEventListener('blur', async () => {
            const token = $('commission').value.trim();
            if (!token) { commissionStatus.textContent = ''; return; }
            const name = await validateCommissionToken(supabaseBrowser, token, id);
            commissionStatus.textContent = name ? `依頼者: ${name}` : 'トークンが見つかりません';
          });
```

Update `collect()` (line 260):

```typescript
          const collect = () => ({
            title: $('title').value, slug: $('slug').value, body: getBodyBlocks(editor),
            coverUrl: cover.getUrl(), commissionToken: $('commission').value, region: $('region').value,
          });
```

Update the unpublish handler (line 301):

```typescript
                .update({ status: 'draft', commission_token_input: input.commissionToken.trim() || null })
```

- [ ] **Step 14: Update `admin/src/pages/users.astro`**

Remove the 依頼者コード column. Change the header row (line 34):

```astro
          <tr><th>名前</th><th>スラッグ</th><th>種別</th></tr>
```

Change the loading/error colspan from `4` to `3` (lines 36, 137).

Remove the `codeTd` block (lines 124-125 and the `tr.appendChild(codeTd);` line).

- [ ] **Step 15: Update `admin/tests/admin.test.ts`**

In the `fetchAllProfiles` describe block, remove the `forest`/`commissionCode` assertion:

```typescript
  it('admin は全ユーザーを見られる', async () => {
    const all = await fetchAllProfiles(adminClient);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const slugs = all.map((p) => p.slug);
    for (const s of ['seed-admin', 'tanaka-hana', 'sato-kenta', 'forest-org']) {
      expect(slugs).toContain(s);
    }
  });
```

Replace the `updateUserRole` promotion test:

```typescript
  it('admin が writer を provider に上げると role が更新される', async () => {
    try {
      await updateUserRole(adminClient, kentaId, 'provider');
      const { data } = await adminClient
        .from('profiles').select('role').eq('id', kentaId).single();
      expect(data!.role).toBe('provider');
    } finally {
      // 後始末: role をシード状態へ戻す(admin はトリガーを通過できる)
      await adminClient.from('profiles').update({ role: 'writer' }).eq('id', kentaId);
    }
  });
```

- [ ] **Step 16: Update `admin/tests/articles.test.ts`**

Rename every `commissionCode: '...'` field in every test call to `commissionToken: '...'` (same values), and every `commission_code_input` assertion to `commission_token_input` (there are ~15 occurrences across `buildArticlePayload`, `article CRUD`, and `optimistic concurrency` describe blocks — mechanical rename, no other changes to those blocks).

Update the import (line 10):

```typescript
  validateCommissionToken,
```

Replace the `validateCommissionCode (seeded)` describe block:

```typescript
describe('validateCommissionToken (seeded)', () => {
  it('returns the provider name for a token issued to hana, and null for an unknown token', async () => {
    expect(await validateCommissionToken(supabase, 'WM-00000000')).toBeNull();

    const providerClient = createClient(
      process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: signInError } = await providerClient.auth.signInWithPassword({
      email: 'forest@seed.local', password: 'seed-pass-1234',
    });
    if (signInError) throw signInError;

    const { data: { user } } = await supabase.auth.getUser();
    const { data: tokenRow, error: tokenError } = await providerClient
      .from('commission_tokens').insert({ writer_id: user!.id }).select('token').single();
    if (tokenError) throw tokenError;

    expect(await validateCommissionToken(supabase, tokenRow.token)).toBe('フォレスト再生機構');
  });
});
```

Replace the "bad code" test:

```typescript
  it('publishing a commissioned draft with an unknown token raises INVALID_COMMISSION_TOKEN', async () => {
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }];
    const id = await createDraft(supabase, {
      title: '依頼下書き', slug: 'commissioned-draft-test', body, coverUrl: '', commissionToken: '', region: '関東',
    });
    created.push(id);
    await expect(
      saveArticle(supabase, id, {
        title: '依頼下書き', slug: 'commissioned-draft-test', body,
        coverUrl: '', commissionToken: 'WM-BADTOKEN', region: '関東',
      }, true),
    ).rejects.toThrow(/INVALID_COMMISSION_TOKEN/);
  });
```

- [ ] **Step 17: Update `scripts/seed.mjs`**

Replace step "2) provider の依頼コード…" (originally lines 95-99) with:

```javascript
  // 2) 依頼記事の数だけ、provider(forest-org)から著者(tanaka-hana)宛ての
  //    依頼トークンを発行する(1トークン=1記事、使い切り)。
  //    トークン発行は commission_tokens の RLS で provider_id = auth.uid() を要求するため、
  //    service role では作れない。forest@seed.local としてサインインして発行する。
  const anonKeyForTokens = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKeyForTokens) {
    throw new Error('PUBLIC_SUPABASE_ANON_KEY を .env に設定してください(依頼トークン発行に必要)');
  }
  const providerClient = createClient(url, anonKeyForTokens, { auth: { persistSession: false } });
  const { error: providerSignInError } = await providerClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (providerSignInError) {
    throw new Error(`依頼トークン発行用のサインインに失敗しました(forest@seed.local): ${providerSignInError.message}`);
  }
  const commissionedCount = ARTICLES.filter((a) => a.commissioned).length;
  const tokens = [];
  for (let i = 0; i < commissionedCount; i++) {
    const { data, error } = await providerClient
      .from('commission_tokens')
      .insert({ writer_id: ids['tanaka-hana'] })
      .select('token')
      .single();
    if (error) throw new Error(`commission_tokens insert ${i}: ${error.message}`);
    tokens.push(data.token);
  }
```

Replace the article insert's `commission_code_input` field (originally line 116):

```javascript
      commission_token_input: a.commissioned ? tokens.shift() : null,
```

- [ ] **Step 18: Run the full test suites**

Run: `supabase db reset && supabase test db`
Expected: PASS — all pgTAP files green.

Run: `cd admin && npm test`
Expected: PASS — all Vitest files green (fix any remaining `commissionCode`/`commission_code_input` references the grep in Step 19 finds).

- [ ] **Step 19: Grep for any missed references**

Run: `grep -rn "commission_code\|commissionCode" --include="*.sql" --include="*.ts" --include="*.astro" --include="*.mjs" . | grep -v node_modules`
Expected: no output (everything renamed or removed).

- [ ] **Step 20: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(db,admin): cut articles over to per-writer commission tokens

Removes the old provider-wide static commission_code entirely
(profiles.commission_code, set_commission_code, validate_commission_code)
and resolves articles.commissioned_by from commission_tokens instead.
EOF
)"
```

---

## Task 3: トークン取消(revoke)

**Files:**
- Modify: `supabase/tests/database/12_commission_tokens.test.sql`
- Create: `supabase/migrations/20260722100200_commission_token_revoke.sql`
- Modify: `admin/src/lib/editor-helpers.ts`

**Interfaces:**
- Consumes: `commission_tokens`, `resolve_commission_token()`, `validate_commission_token()` from Task 2.
- Produces: `commission_tokens.revoked_at` / `revoked_by`; function `public.guard_commission_token_revoke()`; trigger `a_guard_commission_token_revoke`; RLS policy `"provider or admin revokes a token"` (update). `resolve_commission_token()` and `validate_commission_token()` are re-created (same names/signatures) to also reject revoked tokens.

- [ ] **Step 1: Extend the pgTAP test (failing)**

Add to `supabase/tests/database/12_commission_tokens.test.sql`, replacing `select plan(25);` with `select plan(33);` and inserting this block right before `select * from finish();`:

```sql
-- revoke
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into commission_tokens (id, writer_id)
    values ('50000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000010')$$,
  'a third, still-unused token is issued for revoke testing');

select lives_ok(
  $$update commission_tokens set revoked_at = now()
    where id = '50000000-0000-0000-0000-000000000003'$$,
  'the issuing provider revokes their own unused token');
select is(
  (select revoked_by from commission_tokens
    where id = '50000000-0000-0000-0000-000000000003'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'revoked_by is forced to the caller');

select throws_like(
  $$update commission_tokens set revoked_at = now()
    where id = '50000000-0000-0000-0000-000000000003'$$,
  '%COMMISSION_TOKEN_ALREADY_REVOKED%',
  'revoking an already-revoked token is rejected');

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'revoked token use',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000003'))$$,
  '%COMMISSION_TOKEN_REVOKED%',
  'a revoked token cannot be used to publish');

select throws_like(
  $$update commission_tokens set revoked_at = now()
    where id = '50000000-0000-0000-0000-000000000001'$$,
  '%TOKEN_IN_USE_CANNOT_REVOKE%',
  'a token already linked to an article cannot be revoked');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update commission_tokens set revoked_at = now()
    where id = '50000000-0000-0000-0000-000000000002'$$,
  'an unrelated provider''s revoke attempt on someone else''s token does not error (RLS silently matches 0 rows)');

set local role postgres;
select ok(
  (select revoked_at from commission_tokens
    where id = '50000000-0000-0000-0000-000000000002') is null,
  'the token is not actually revoked (RLS blocked the row)');

select * from finish();
rollback;
```

(25 existing + 8 new = 33, matching `plan(33)`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `column "revoked_at" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260722100200_commission_token_revoke.sql`:

```sql
-- 依頼トークンの取消(revoke)。未使用のトークンのみ、発行元プロバイダーまたは admin が取消可能。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

alter table public.commission_tokens
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.profiles (id);

create or replace function public.resolve_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  tok record;
begin
  if new.commission_token_input is null then
    new.commissioned_by := null;
    new.commission_token_id := null;
  elsif tg_op = 'INSERT'
        or new.commission_token_input is distinct from old.commission_token_input then
    select id, provider_id, writer_id, revoked_at into tok
      from commission_tokens
     where token = new.commission_token_input;

    if tok.id is null then
      raise exception 'INVALID_COMMISSION_TOKEN: no token matches this value';
    end if;
    if tok.revoked_at is not null then
      raise exception 'COMMISSION_TOKEN_REVOKED: this token has been revoked';
    end if;
    if tok.writer_id <> new.author_id then
      raise exception 'COMMISSION_TOKEN_WRONG_WRITER: this token was issued to a different writer';
    end if;
    if exists (
      select 1 from articles
       where commission_token_id = tok.id and id <> new.id
    ) then
      raise exception 'COMMISSION_TOKEN_ALREADY_USED: this token has already been used on another article';
    end if;

    new.commissioned_by := tok.provider_id;
    new.commission_token_id := tok.id;
  else
    new.commissioned_by := old.commissioned_by;
    new.commission_token_id := old.commission_token_id;
  end if;
  return new;
end;
$$;

create or replace function public.validate_commission_token(token text, article_id uuid default null)
returns text
language sql stable security definer
set search_path = public
as $$
  select p.name
    from commission_tokens t
    join profiles p on p.id = t.provider_id
   where t.token = token
     and t.writer_id = auth.uid()
     and t.revoked_at is null
     and not exists (
       select 1 from articles a
        where a.commission_token_id = t.id
          and a.id is distinct from article_id
     );
$$;

create or replace function public.guard_commission_token_revoke()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.token is distinct from old.token
     or new.provider_id is distinct from old.provider_id
     or new.writer_id is distinct from old.writer_id
     or new.created_at is distinct from old.created_at then
    raise exception 'COMMISSION_TOKEN_IMMUTABLE: only revoked_at can be changed';
  end if;

  if old.revoked_at is not null then
    raise exception 'COMMISSION_TOKEN_ALREADY_REVOKED: this token has already been revoked';
  end if;

  if new.revoked_at is null then
    return new;
  end if;

  if exists (
    select 1 from articles where commission_token_id = old.id
  ) then
    raise exception 'TOKEN_IN_USE_CANNOT_REVOKE: a token already linked to an article cannot be revoked';
  end if;

  new.revoked_at := now();
  new.revoked_by := auth.uid();
  return new;
end;
$$;

create trigger a_guard_commission_token_revoke
  before update on public.commission_tokens
  for each row execute function public.guard_commission_token_revoke();

grant update on public.commission_tokens to authenticated;

create policy "provider or admin revokes a token"
  on public.commission_tokens for update to authenticated
  using (provider_id = auth.uid() or public.is_admin())
  with check (provider_id = auth.uid() or public.is_admin());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase test db`
Expected: PASS — `12_commission_tokens.test.sql` shows `1..33` all ok.

- [ ] **Step 5: Add the revoked-token error mapping**

In `admin/src/lib/editor-helpers.ts`, add alongside the other `COMMISSION_TOKEN_*` checks added in Task 2:

```typescript
  if (msg.includes('COMMISSION_TOKEN_REVOKED')) {
    return 'この依頼トークンは取り消されています。';
  }
```

- [ ] **Step 6: Run the full DB test suite once more**

Run: `supabase db reset && supabase test db`
Expected: PASS — all files green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260722100200_commission_token_revoke.sql supabase/tests/database/12_commission_tokens.test.sql admin/src/lib/editor-helpers.ts
git commit -m "feat(db): allow providers/admin to revoke an unused commission token"
```

---

## Task 4: `admin/src/lib/commissions.ts`

**Files:**
- Create: `admin/src/lib/commissions.ts`
- Create: `admin/tests/commissions.test.ts`

**Interfaces:**
- Consumes: `commission_tokens` table + RLS from Tasks 1-3; `profiles!commission_tokens_provider_id_fkey` / `profiles!commission_tokens_writer_id_fkey` / `articles_commission_token_id_fkey` implicit FK names (Postgres default naming; same pattern already used in `src/lib/content.ts:58-59`).
- Produces: `WriterOption`, `fetchWriters()`, `issueCommissionToken()`, `TokenStatus`, `CommissionToken`, `fetchMyIssuedTokens()`, `fetchAllTokens()`, `revokeCommissionToken()`, `translateCommissionError()` — all consumed by Tasks 5-6.

- [ ] **Step 1: Write the failing integration test**

Create `admin/tests/commissions.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchWriters, issueCommissionToken, fetchMyIssuedTokens,
  fetchAllTokens, revokeCommissionToken, translateCommissionError,
} from '../src/lib/commissions';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const forestClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });
const adminClient = createClient(url, anon, { auth: { persistSession: false } });

let hanaId: string;

beforeAll(async () => {
  const f = await forestClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (f.error) throw f.error;
  const h = await hanaClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (h.error) throw h.error;
  hanaId = h.data.user!.id;
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
});

describe('fetchWriters', () => {
  it('lists writer profiles (visible to any authenticated user)', async () => {
    const writers = await fetchWriters(hanaClient);
    const slugs = writers.map((w) => w.slug);
    expect(slugs).toContain('tanaka-hana');
    expect(slugs).toContain('sato-kenta');
  });
});

describe('issueCommissionToken / fetchMyIssuedTokens / fetchAllTokens / revokeCommissionToken', () => {
  it('provider issues a token, sees it pending, admin sees it too, then revokes it', async () => {
    const token = await issueCommissionToken(forestClient, hanaId);
    expect(token).toMatch(/^WM-[0-9A-F]{8}$/);

    const mine = await fetchMyIssuedTokens(forestClient);
    const issued = mine.find((t) => t.token === token);
    expect(issued).toBeDefined();
    expect(issued!.status).toBe('pending');
    expect(issued!.writerName).toBe('田中 花');

    const all = await fetchAllTokens(adminClient);
    expect(all.some((t) => t.token === token)).toBe(true);

    await revokeCommissionToken(forestClient, issued!.id);
    const mineAfter = await fetchMyIssuedTokens(forestClient);
    expect(mineAfter.find((t) => t.token === token)!.status).toBe('revoked');
  });

  it('a writer cannot issue a token (NOT_A_PROVIDER)', async () => {
    await expect(issueCommissionToken(hanaClient, hanaId)).rejects.toThrow(/NOT_A_PROVIDER/);
  });

  it('revoking a used token fails', async () => {
    const token = await issueCommissionToken(forestClient, hanaId);
    const mine = await fetchMyIssuedTokens(forestClient);
    const issued = mine.find((t) => t.token === token)!;

    const { error } = await hanaClient.from('articles').insert({
      author_id: hanaId, title: 'commissions.test 用', body: [], commission_token_input: token,
    });
    expect(error).toBeNull();

    await expect(revokeCommissionToken(forestClient, issued.id)).rejects.toThrow();

    await hanaClient.from('articles').delete().eq('commission_token_input', token);
  });
});

describe('translateCommissionError', () => {
  it('known codes map to Japanese messages', () => {
    expect(translateCommissionError(new Error('NOT_A_PROVIDER: x'))).toContain('プロバイダー');
    expect(translateCommissionError(new Error('boom'))).toContain('失敗');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx vitest run tests/commissions.test.ts`
Expected: FAIL — cannot find module `../src/lib/commissions`.

- [ ] **Step 3: Write `admin/src/lib/commissions.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WriterOption {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  bio: string;
}

export async function fetchWriters(supabase: SupabaseClient): Promise<WriterOption[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, slug, name, region, bio')
    .eq('role', 'writer')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, region: r.region, bio: r.bio,
  }));
}

export async function issueCommissionToken(
  supabase: SupabaseClient, writerId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('commission_tokens')
    .insert({ writer_id: writerId })
    .select('token')
    .single();
  if (error) throw error;
  return data.token as string;
}

export type TokenStatus = 'pending' | 'used' | 'revoked';

export interface CommissionToken {
  id: string;
  token: string;
  providerName: string;
  writerName: string;
  createdAt: string;
  status: TokenStatus;
  articleId: string | null;
  articleTitle: string | null;
}

interface TokenRow {
  id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
  provider: { name: string } | null;
  writer: { name: string } | null;
  articles: { id: string; title: string } | null;
}

function toTokenStatus(revokedAt: string | null, article: { id: string } | null): TokenStatus {
  if (article) return 'used';
  if (revokedAt) return 'revoked';
  return 'pending';
}

function mapTokenRow(r: TokenRow): CommissionToken {
  return {
    id: r.id,
    token: r.token,
    providerName: r.provider?.name ?? '',
    writerName: r.writer?.name ?? '',
    createdAt: r.created_at,
    status: toTokenStatus(r.revoked_at, r.articles),
    articleId: r.articles?.id ?? null,
    articleTitle: r.articles?.title ?? null,
  };
}

const TOKEN_SELECT =
  'id, token, created_at, revoked_at, ' +
  'provider:profiles!commission_tokens_provider_id_fkey(name), ' +
  'writer:profiles!commission_tokens_writer_id_fkey(name), ' +
  'articles(id, title)';

// provider: 自分が発行したトークンの履歴
export async function fetchMyIssuedTokens(supabase: SupabaseClient): Promise<CommissionToken[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const { data, error } = await supabase
    .from('commission_tokens')
    .select(TOKEN_SELECT)
    .eq('provider_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as TokenRow[]).map(mapTokenRow);
}

// admin: 全プロバイダー分のトークン一覧
export async function fetchAllTokens(supabase: SupabaseClient): Promise<CommissionToken[]> {
  const { data, error } = await supabase
    .from('commission_tokens')
    .select(TOKEN_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as TokenRow[]).map(mapTokenRow);
}

export async function revokeCommissionToken(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase
    .from('commission_tokens')
    // revoked_at の実値は DB トリガーが now() で上書きする(サーバー権威)。
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('REVOKE_DENIED');
}

export function translateCommissionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('NOT_A_PROVIDER')) return 'プロバイダーのみ依頼を作成できます。';
  if (msg.includes('INVALID_WRITER')) return '依頼先がライターではありません。';
  if (msg.includes('TOKEN_IN_USE_CANNOT_REVOKE')) return '使用済みのトークンは取り消せません。';
  if (msg.includes('COMMISSION_TOKEN_ALREADY_REVOKED')) return 'このトークンは既に取り消されています。';
  return '操作に失敗しました。時間をおいて再度お試しください。';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx vitest run tests/commissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/commissions.ts admin/tests/commissions.test.ts
git commit -m "feat(admin): add commissions.ts data-access module for commission tokens"
```

---

## Task 5: プロバイダー画面 `/commission`

**Files:**
- Modify: `admin/src/styles/global.css`
- Create: `admin/src/pages/commission.astro`

**Interfaces:**
- Consumes: `fetchMyRole` (`admin/src/lib/admin.ts`); `fetchWriters`, `issueCommissionToken`, `fetchMyIssuedTokens`, `revokeCommissionToken`, `translateCommissionError` (Task 4); `PageShell`, `Card`, `Button` components.

- [ ] **Step 1: Add the status-pill CSS**

In `admin/src/styles/global.css`, immediately after the `.article-list .article-action` rules (following the existing `@layer` block that contains `.article-badge--*`), add:

```css
  .commission-list {
    @apply divide-y divide-border overflow-hidden rounded-lg border bg-card;
  }
  .commission-list li {
    @apply flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3;
  }
  .commission-pill {
    @apply inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium;
  }
  .commission-pill--pending {
    @apply bg-secondary text-secondary-foreground;
  }
  .commission-pill--used {
    @apply bg-primary/10 text-primary;
  }
  .commission-pill--revoked {
    @apply bg-destructive/10 text-destructive;
  }
```

- [ ] **Step 2: Create `admin/src/pages/commission.astro`**

```astro
---
import PageShell from '../components/templates/PageShell.astro';
import Card from '../components/atoms/Card.astro';
import Button from '../components/atoms/Button.astro';

const title = 'ライターに依頼する | Wild Media CMS';
---
<PageShell title={title} heading="ライターに依頼する" wide>
  <div class="space-y-6">
    <Card class="p-6">
      <h2 class="mb-4 text-lg font-semibold tracking-tight">ライター一覧</h2>
      <ul id="writer-rows" class="commission-list"><li>読み込み中…</li></ul>
    </Card>

    <Card id="issued-card" class="p-6" hidden>
      <p class="text-sm">
        <span id="issued-writer" class="font-medium"></span> さんへのトークンを発行しました
      </p>
      <div class="mt-2 flex items-center gap-2">
        <code id="issued-token" class="rounded bg-secondary px-2 py-1 text-sm font-medium"></code>
        <Button id="issued-copy" type="button" variant="outline" size="sm">コピー</Button>
      </div>
    </Card>

    <Card class="p-6">
      <h2 class="mb-4 text-lg font-semibold tracking-tight">発行済みトークン</h2>
      <table class="admin-table">
        <thead>
          <tr><th>ライター</th><th>トークン</th><th>状態</th><th></th></tr>
        </thead>
        <tbody id="token-rows"><tr><td colspan="4">読み込み中…</td></tr></tbody>
      </table>
    </Card>

    <p id="message" role="alert" class="text-sm text-muted-foreground"></p>
  </div>

  <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import { fetchMyRole } from '../lib/admin';
      import {
        fetchWriters, issueCommissionToken, fetchMyIssuedTokens,
        revokeCommissionToken, translateCommissionError, type CommissionToken,
      } from '../lib/commissions';

      const STATUS_LABEL: Record<CommissionToken['status'], string> =
        { pending: '未使用', used: '使用済み', revoked: '取消済み' };

      const { data: { session } } = await supabaseBrowser.auth.getSession();

      let myRole: string | null = null;
      let roleLookupFailed = false;
      if (session) {
        try {
          myRole = await fetchMyRole(supabaseBrowser);
        } catch (err) {
          roleLookupFailed = true;
          console.error(err);
        }
      }

      const messageEl = document.getElementById('message')!;

      if (!session) {
        redirectTo('/login');
      } else if (roleLookupFailed) {
        messageEl.textContent = '権限の確認に失敗しました。ページを再読み込みしてください。';
      } else if (myRole !== 'provider') {
        // UX のためのリダイレクト。実際の防壁は RLS/トリガー。
        redirectTo('/dashboard');
      } else {
        const writerRowsEl = document.getElementById('writer-rows')!;
        const tokenRowsEl = document.getElementById('token-rows')!;
        const issuedCard = document.getElementById('issued-card')!;
        const issuedWriterEl = document.getElementById('issued-writer')!;
        const issuedTokenEl = document.getElementById('issued-token')!;

        const renderTokens = async () => {
          const tokens = await fetchMyIssuedTokens(supabaseBrowser);
          tokenRowsEl.innerHTML = '';
          if (tokens.length === 0) {
            tokenRowsEl.innerHTML = '<tr><td colspan="4">まだ依頼していません。</td></tr>';
            return;
          }
          for (const t of tokens) {
            const tr = document.createElement('tr');

            const writerTd = document.createElement('td');
            writerTd.textContent = t.writerName;

            const tokenTd = document.createElement('td');
            tokenTd.textContent = t.token;

            const statusTd = document.createElement('td');
            const pill = document.createElement('span');
            pill.className = `commission-pill commission-pill--${t.status}`;
            pill.textContent = STATUS_LABEL[t.status];
            statusTd.appendChild(pill);

            const actionTd = document.createElement('td');
            if (t.status === 'pending') {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = '取消す';
              btn.addEventListener('click', async () => {
                messageEl.textContent = '';
                try {
                  await revokeCommissionToken(supabaseBrowser, t.id);
                } catch (err) {
                  messageEl.textContent = translateCommissionError(err);
                  console.error(err);
                  return;
                }
                await renderTokens();
              });
              actionTd.appendChild(btn);
            }

            tr.appendChild(writerTd);
            tr.appendChild(tokenTd);
            tr.appendChild(statusTd);
            tr.appendChild(actionTd);
            tokenRowsEl.appendChild(tr);
          }
        };

        const renderWriters = async () => {
          const writers = await fetchWriters(supabaseBrowser);
          writerRowsEl.innerHTML = '';
          if (writers.length === 0) {
            writerRowsEl.innerHTML = '<li>ライターがいません。</li>';
            return;
          }
          for (const w of writers) {
            const li = document.createElement('li');

            const info = document.createElement('div');
            const nameEl = document.createElement('div');
            nameEl.className = 'font-medium';
            nameEl.textContent = w.name;
            const metaEl = document.createElement('div');
            metaEl.className = 'text-xs text-muted-foreground';
            metaEl.textContent = [w.region, w.bio].filter(Boolean).join(' ・ ');
            info.appendChild(nameEl);
            info.appendChild(metaEl);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '依頼する';
            btn.addEventListener('click', async () => {
              messageEl.textContent = '';
              try {
                const token = await issueCommissionToken(supabaseBrowser, w.id);
                issuedWriterEl.textContent = w.name;
                issuedTokenEl.textContent = token;
                issuedCard.hidden = false;
              } catch (err) {
                messageEl.textContent = translateCommissionError(err);
                console.error(err);
                return;
              }
              try {
                await renderTokens();
              } catch (err) {
                messageEl.textContent = '一覧の再読み込みに失敗しました。ページを再読み込みしてください。';
                console.error(err);
              }
            });

            li.appendChild(info);
            li.appendChild(btn);
            writerRowsEl.appendChild(li);
          }
        };

        document.getElementById('issued-copy')!.addEventListener('click', () => {
          navigator.clipboard.writeText(issuedTokenEl.textContent ?? '');
        });

        try {
          await renderWriters();
        } catch (err) {
          writerRowsEl.innerHTML = '<li>読み込みに失敗しました。</li>';
          console.error(err);
        }
        try {
          await renderTokens();
        } catch (err) {
          tokenRowsEl.innerHTML = '<tr><td colspan="4">読み込みに失敗しました。</td></tr>';
          console.error(err);
        }
      }
    </script>
</PageShell>
```

- [ ] **Step 3: Manual check**

Run: `npm run dev:all`, sign in as `forest@seed.local` / `seed-pass-1234`, open `http://localhost:4322/commission`. Confirm the writer list loads, "依頼する" issues and displays a token, the token appears in 発行済みトークン as 未使用, and 取消す removes it (status flips to 取消済み, action button disappears).

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/commission.astro admin/src/styles/global.css
git commit -m "feat(admin): add provider commission page (/commission)"
```

---

## Task 6: 管理画面 `/commissions`

**Files:**
- Create: `admin/src/pages/commissions.astro`

**Interfaces:**
- Consumes: `fetchMyRole`; `fetchAllTokens`, `revokeCommissionToken`, `translateCommissionError` (Task 4).

- [ ] **Step 1: Create `admin/src/pages/commissions.astro`**

```astro
---
import PageShell from '../components/templates/PageShell.astro';
import Card from '../components/atoms/Card.astro';

const title = '依頼トークン管理 | Wild Media CMS';
---
<PageShell title={title} heading="依頼トークン管理" wide>
  <Card class="p-6">
    <table class="admin-table">
      <thead>
        <tr><th>プロバイダー</th><th>ライター</th><th>トークン</th><th>発行日</th><th>状態</th><th>記事</th><th></th></tr>
      </thead>
      <tbody id="token-rows"><tr><td colspan="7">読み込み中…</td></tr></tbody>
    </table>
  </Card>
  <p id="message" role="alert" class="mt-4 text-sm text-muted-foreground"></p>

  <script>
      import { supabaseBrowser } from '../lib/supabase-browser';
      import { redirectTo } from '../lib/auth';
      import { fetchMyRole } from '../lib/admin';
      import {
        fetchAllTokens, revokeCommissionToken, translateCommissionError, type CommissionToken,
      } from '../lib/commissions';

      const STATUS_LABEL: Record<CommissionToken['status'], string> =
        { pending: '未使用', used: '使用済み', revoked: '取消済み' };

      const { data: { session } } = await supabaseBrowser.auth.getSession();

      let myRole: string | null = null;
      let roleLookupFailed = false;
      if (session) {
        try {
          myRole = await fetchMyRole(supabaseBrowser);
        } catch (err) {
          roleLookupFailed = true;
          console.error(err);
        }
      }

      const messageEl = document.getElementById('message')!;

      if (!session) {
        redirectTo('/login');
      } else if (roleLookupFailed) {
        messageEl.textContent = '権限の確認に失敗しました。ページを再読み込みしてください。';
      } else if (myRole !== 'admin') {
        redirectTo('/dashboard');
      } else {
        const tokenRowsEl = document.getElementById('token-rows')!;

        const renderTokens = async () => {
          const tokens = await fetchAllTokens(supabaseBrowser);
          tokenRowsEl.innerHTML = '';
          if (tokens.length === 0) {
            tokenRowsEl.innerHTML = '<tr><td colspan="7">まだ依頼がありません。</td></tr>';
            return;
          }
          for (const t of tokens) {
            const tr = document.createElement('tr');

            const providerTd = document.createElement('td');
            providerTd.textContent = t.providerName;
            const writerTd = document.createElement('td');
            writerTd.textContent = t.writerName;
            const tokenTd = document.createElement('td');
            tokenTd.textContent = t.token;
            const createdTd = document.createElement('td');
            createdTd.textContent = new Date(t.createdAt).toLocaleDateString('ja-JP');

            const statusTd = document.createElement('td');
            const pill = document.createElement('span');
            pill.className = `commission-pill commission-pill--${t.status}`;
            pill.textContent = STATUS_LABEL[t.status];
            statusTd.appendChild(pill);

            const articleTd = document.createElement('td');
            if (t.articleId) {
              const a = document.createElement('a');
              a.href = `/articles/edit?id=${t.articleId}`;
              a.className = 'text-primary underline';
              a.textContent = t.articleTitle ?? '(無題)';
              articleTd.appendChild(a);
            } else {
              articleTd.textContent = '—';
            }

            const actionTd = document.createElement('td');
            if (t.status === 'pending') {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = '取消す';
              btn.addEventListener('click', async () => {
                messageEl.textContent = '';
                try {
                  await revokeCommissionToken(supabaseBrowser, t.id);
                } catch (err) {
                  messageEl.textContent = translateCommissionError(err);
                  console.error(err);
                  return;
                }
                await renderTokens();
              });
              actionTd.appendChild(btn);
            }

            tr.appendChild(providerTd);
            tr.appendChild(writerTd);
            tr.appendChild(tokenTd);
            tr.appendChild(createdTd);
            tr.appendChild(statusTd);
            tr.appendChild(articleTd);
            tr.appendChild(actionTd);
            tokenRowsEl.appendChild(tr);
          }
        };

        try {
          await renderTokens();
        } catch (err) {
          tokenRowsEl.innerHTML = '<tr><td colspan="7">読み込みに失敗しました。</td></tr>';
          console.error(err);
        }
      }
    </script>
</PageShell>
```

- [ ] **Step 2: Manual check**

Run: `npm run dev:all`, sign in as `admin@seed.local` / `seed-pass-1234`, open `http://localhost:4322/commissions`. Confirm all providers' tokens are listed with correct status pills, and revoking one that's still 未使用 works.

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/commissions.astro
git commit -m "feat(admin): add admin commissions overview page (/commissions)"
```

---

## Task 7: ナビゲーションリンク

**Files:**
- Modify: `admin/src/pages/dashboard.astro`

**Interfaces:**
- Consumes: `fetchMyRole` (unchanged signature).

- [ ] **Step 1: Add the nav markup**

Replace the `admin-nav` span (line 15-18) with:

```astro
        <span id="admin-nav" hidden>
          <a href="/users" class={`mr-4 ${navLink}`}>ユーザー管理</a>
          <a href="/commissions" class={`mr-4 ${navLink}`}>依頼トークン管理</a>
          <a href="/settings" class={navLink}>サイト設定</a>
        </span>
        <span id="provider-nav" hidden>
          <a href="/commission" class={navLink}>ライターに依頼する</a>
        </span>
```

- [ ] **Step 2: Update the role branch in the script**

Replace (lines 88-95):

```typescript
        try {
          if ((await fetchMyRole(supabaseBrowser)) === 'admin') {
            document.getElementById('admin-nav')!.hidden = false;
          }
        } catch (err) {
          console.error(err);
        }
```

with:

```typescript
        try {
          const role = await fetchMyRole(supabaseBrowser);
          if (role === 'admin') {
            document.getElementById('admin-nav')!.hidden = false;
          } else if (role === 'provider') {
            document.getElementById('provider-nav')!.hidden = false;
          }
        } catch (err) {
          console.error(err);
        }
```

- [ ] **Step 3: Manual check**

Sign in as `forest@seed.local`; confirm the "ライターに依頼する" nav link appears and navigates to `/commission`. Sign in as `admin@seed.local`; confirm "依頼トークン管理" appears alongside the existing admin links and navigates to `/commissions`. Sign in as `hana@seed.local`; confirm neither extra link appears.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/dashboard.astro
git commit -m "feat(admin): add nav links for the commission-token pages"
```

---

## Task 8: ドキュメント更新

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/DATABASE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `ARCHITECTURE.md`**

Replace the 依頼者コード bullet (line 53):

```markdown
- 依頼トークン: プロバイダーが特定のライター宛てに発行する使い切りの文字列(`WM-XXXXXXXX`)。
  ライターがエディタで入力すると `commissioned_by` が解決される。プロバイダー1人につき
  複数のライター・複数の依頼を並行して持てる(1トークン=1記事)。実在チェックは
  SECURITY DEFINER RPC `validate_commission_token`(列挙攻撃防止のため、呼び出し本人
  宛てのトークンとの完全一致のみ応答)。未使用のトークンは発行元プロバイダーまたは
  admin が取り消せる。管理者は `/commissions`(CMS)で全プロバイダー分のトークンと
  その状態(未使用/使用済み/取消済み)を確認できる。
```

- [ ] **Step 2: Update `docs/DATABASE.md`**

Replace line 10:

```
    profiles |o--o{ commission_tokens : "provider_id"
    profiles |o--o{ commission_tokens : "writer_id"
    commission_tokens |o--o| articles : "commission_token_id (nullable, unique)"
    profiles |o--o{ articles : "commissioned_by (nullable)"
```

Remove line 32 (`text commission_code UK ...`).

Replace lines 46-47:

```
        text commission_token_input "入力値、トリガーがcommissioned_by/commission_token_idへ解決"
        uuid commission_token_id FK "-> commission_tokens.id, nullable, unique"
        uuid commissioned_by FK "-> profiles.id, nullable"
```

Add a new entity block near the `articles`/`profiles` entities:

```
    commission_tokens {
        uuid id PK
        uuid provider_id FK "-> profiles.id"
        uuid writer_id FK "-> profiles.id"
        text token UK "WM-XXXXXXXX形式"
        timestamptz created_at
        timestamptz revoked_at "nullable"
        uuid revoked_by FK "-> profiles.id, nullable"
    }
```

Replace line 85:

```
| `profiles` | RLS: 本人 or admin(select/update)。writer は全認証ユーザーに公開(select、依頼先選択用) | `role`(admin/writer/provider) |
```

Replace lines 96-98:

```
| `set_commission_token()` | トリガー | `commission_tokens` insert時、provider_idを呼び出し本人に強制し、トークンを自動採番 |
| `guard_commission_token_revoke()` | トリガー | `revoked_at` の null→非null 変更のみ許可し、使用済みトークンの取消を拒否 |
| `validate_commission_token(token, article_id)` | RPC | 依頼トークンの実在チェック(呼び出し本人宛て・未取消・未使用〈article_idは自分自身を除外〉のみ応答) |
| `resolve_commission_token()` | トリガー | 記事保存時、`commission_token_input` から `commissioned_by`/`commission_token_id` を解決 |
```

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md docs/DATABASE.md
git commit -m "docs: update ARCHITECTURE.md and docs/DATABASE.md for commission tokens"
```

---

## Self-Review Notes

- **Spec coverage:** データモデル → Tasks 1-3. CMS UI(プロバイダー画面/管理画面/エディタ欄)→ Tasks 2, 5, 6, 7. エラーハンドリング表 → Tasks 2, 3 (`editor-helpers.ts`), 4 (`translateCommissionError`). テスト方針(pgTAP/Vitest/seed)→ every DB/lib task. 移行・影響範囲(旧方式の完全撤去、ARCHITECTURE.md/DATABASE.md 更新)→ Task 2, Task 8. スコープ外の説明ポップアップ → already in `docs/TODO.md`, no task needed.
- **Deviation from the spec worth flagging:** the spec's データモデル section says `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` "は commission_token_id の変更も同時に見るよう拡張する." Reading `enforce_publish_rules()` closely (Task 2, Step 7 context) shows this guard already keys off `commissioned_by`, which `resolve_commission_token()` always clears in lockstep with `commission_token_id` — so no separate extension is needed; the existing trigger logic (unmodified) already covers it. No behavior gap, just an implementation simplification versus the spec's wording.
- **Placeholder scan:** none found — every step has complete code.
- **Type consistency:** `CommissionToken`/`TokenStatus`/`WriterOption` (Task 4) are used with identical shapes in Tasks 5-6's `.astro` scripts. `ArticleInput.commissionToken` (Task 2) matches usage in `new.astro`/`edit.astro`'s `collect()` and `admin/tests/articles.test.ts`. `validateCommissionToken(supabase, token, articleId?)` signature (Task 2) matches its two call sites (`new.astro` omits `articleId`; `edit.astro` passes `id`).
