# Supabase バックエンド実装計画(計画1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ライターと環境のためのプラットフォームのバックエンド全体(スキーマ・RLS・トリガー・RPC・Edge Functions)を Supabase 上に構築し、pgTAP テストで検証可能な状態にする。

**Architecture:** Supabase(Postgres + Auth + RLS + Edge Functions)のみでバックエンドを構成し、別サーバーは作らない。権限・投稿頻度制限・依頼者コード解決はすべて DB 層(RLS/トリガー/制約)で強制する。Edge Functions は「ユーザー招待」と「R2 署名付きURL発行」の2つだけ。

**Tech Stack:** Supabase CLI(ローカル開発、Docker 必須)、Postgres、pgTAP(`supabase test db`)、Deno Edge Functions、Cloudflare R2(S3互換API、aws4fetch で署名)

**設計スペック:** `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md`(本計画はスペックのバックエンド部分を実装する。Astro フロントエンドは計画2で扱う)

## Global Constraints

- マイグレーションは `supabase/migrations/` に、pgTAP テストは `supabase/tests/database/` に置く
- 権限制御はすべて DB 層(RLS・トリガー・制約)で強制する。クライアント側チェックは UX 用の補助にすぎない
- role の値は `'admin' | 'writer' | 'provider'`、記事 status は `'draft' | 'published'`(いずれも enum)
- slug の形式は profiles・articles とも正規表現 `^[a-z0-9]+(-[a-z0-9]+)*$`
- settings は id=1 の1行のみ。初期値 `post_interval_days=10`, `featured_count=3`
- 依頼者コードの形式は `WM-` + 大文字16進数8桁(例 `WM-4F2A9C01`)。provider の作成時に自動生成
- 画像アップロード上限は 512,000 バイト。許可タイプは `image/webp`, `image/jpeg`, `image/png`
- エラー識別子は文字列 `INVALID_COMMISSION_CODE` と `POST_INTERVAL_NOT_ELAPSED` を含めること(フロントエンドがこの文字列でエラー判定する)
- コミットメッセージは Conventional Commits(`feat:`, `test:`, `chore:`)
- テスト実行は毎回 `supabase db reset && supabase test db`(reset でマイグレーションを再適用してから pgTAP を全件実行)

---

### Task 1: Supabase ローカル環境の初期化

**Files:**
- Create: `supabase/config.toml`(`supabase init` が生成)
- Create: `.gitignore`

**Interfaces:**
- Consumes: なし
- Produces: 以降の全タスクが使うローカル Supabase スタック(API: `http://127.0.0.1:54321`, DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Mailpit: `http://127.0.0.1:54324`)

- [ ] **Step 1: Supabase CLI と Docker の確認**

Run: `supabase --version || brew install supabase/tap/supabase`
Run: `docker info > /dev/null 2>&1 && echo "docker ok" || echo "Docker Desktop を起動してください"`
Expected: バージョン番号と `docker ok`

- [ ] **Step 2: プロジェクト初期化**

Run: `supabase init`
Expected: `Finished supabase init.` と `supabase/config.toml` の生成

- [ ] **Step 3: .gitignore を作成**

```gitignore
# Supabase
supabase/.branches
supabase/.temp
supabase/functions/.env

# misc
.DS_Store
node_modules/
```

- [ ] **Step 4: ローカルスタック起動**

Run: `supabase start`
Expected: `API URL: http://127.0.0.1:54321` などの一覧が表示される(初回は Docker イメージ取得で数分かかる)

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml .gitignore
git commit -m "chore: initialize supabase local project"
```

---

### Task 2: スキーママイグレーション(profiles / articles / settings)

**Files:**
- Create: `supabase/migrations/<timestamp>_create_schema.sql`(`supabase migration new create_schema` で生成されるファイル)
- Test: `supabase/tests/database/01_schema.test.sql`

**Interfaces:**
- Consumes: なし
- Produces: テーブル `public.profiles`(id uuid PK / role user_role / slug text / name text / bio text / homepage_url text / sns_links jsonb / price_info text / contact_url text / commission_code text)、`public.articles`(id uuid PK / author_id uuid / slug text / title text / body text / cover_image_url text / status article_status / published_at timestamptz / commission_code_input text / commissioned_by uuid)、`public.settings`(id=1 / post_interval_days int / featured_count int)。enum `public.user_role`, `public.article_status`

- [ ] **Step 1: 失敗するテストを書く**

`supabase/tests/database/01_schema.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'articles', 'articles table exists');
select has_table('public', 'settings', 'settings table exists');

select results_eq(
  'select post_interval_days, featured_count from settings where id = 1',
  $$values (10, 3)$$,
  'settings has initial row with defaults'
);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000000a', 'schema-writer@test.local');

select throws_ok(
  $$insert into profiles (id, role, slug, name)
    values ('00000000-0000-0000-0000-00000000000a', 'writer', 'Bad_Slug!', 'W')$$,
  '23514', null, 'profile slug format is enforced'
);

insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-00000000000a', 'writer', 'schema-writer', 'W');

select throws_ok(
  $$insert into articles (author_id, slug, title)
    values ('00000000-0000-0000-0000-00000000000a', 'Bad Slug', 't')$$,
  '23514', null, 'article slug format is enforced'
);

select throws_ok(
  $$insert into articles (author_id, status, published_at, title)
    values ('00000000-0000-0000-0000-00000000000a', 'published', now(), 't')$$,
  '23514', null, 'published article requires slug'
);

select lives_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-00000000000a', 'draft without slug')$$,
  'draft without slug is allowed'
);

select is(
  (select count(*) from articles
    where author_id = '00000000-0000-0000-0000-00000000000a')::int,
  1, 'draft row inserted'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `supabase db reset && supabase test db`
Expected: `not ok` — `profiles` テーブルが存在しない旨の失敗

- [ ] **Step 3: マイグレーションを書く**

Run: `supabase migration new create_schema`
生成された `supabase/migrations/<timestamp>_create_schema.sql` に以下を記述:

```sql
create extension if not exists moddatetime with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('admin', 'writer', 'provider');
create type public.article_status as enum ('draft', 'published');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  bio text not null default '',
  homepage_url text,
  sns_links jsonb not null default '[]',
  price_info text,
  contact_url text,
  commission_code text unique,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  slug text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null default '',
  body text not null default '',
  cover_image_url text,
  status public.article_status not null default 'draft',
  published_at timestamptz,
  commission_code_input text,
  commissioned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_requires_slug
    check (status = 'draft' or slug is not null),
  constraint published_requires_published_at
    check (status = 'draft' or published_at is not null)
);

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function extensions.moddatetime(updated_at);

create table public.settings (
  id int primary key check (id = 1),
  post_interval_days int not null default 10 check (post_interval_days >= 0),
  featured_count int not null default 3 check (featured_count >= 0)
);

insert into public.settings (id) values (1);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `supabase db reset && supabase test db`
Expected: `01_schema.test.sql .. ok`(9 tests passed)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: add profiles, articles, settings schema"
```

---

### Task 3: RLS ポリシーと is_admin()

**Files:**
- Create: `supabase/migrations/<timestamp>_rls_policies.sql`
- Test: `supabase/tests/database/02_rls.test.sql`

**Interfaces:**
- Consumes: Task 2 のテーブル
- Produces: `public.is_admin() returns boolean`(security definer。以降のトリガーが利用)、全テーブルの RLS ポリシー

- [ ] **Step 1: 失敗するテストを書く**

`supabase/tests/database/02_rls.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- fixtures (as postgres, bypasses RLS)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'rls-admin@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'rls-writer1@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'rls-writer2@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'rls-admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000002', 'writer', 'rls-writer-one', 'Writer One'),
  ('00000000-0000-0000-0000-000000000003', 'writer', 'rls-writer-two', 'Writer Two');

insert into articles (id, author_id, title) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'w1 draft'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'w2 draft');
insert into articles (author_id, slug, title, status, published_at) values
  ('00000000-0000-0000-0000-000000000002', 'rls-w1-published', 'w1 published', 'published', now());

-- act as writer1
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from articles)::int, 2,
  'writer1 sees only own articles (drafts included)');
select is((select count(*) from articles
  where author_id = '00000000-0000-0000-0000-000000000003')::int, 0,
  'writer1 cannot see writer2 articles');
select lives_ok(
  $$update articles set title = 'hacked'
    where id = '10000000-0000-0000-0000-000000000002'$$,
  'updating an invisible row affects 0 rows without error');
select throws_ok(
  $$insert into articles (author_id, title)
    values ('00000000-0000-0000-0000-000000000003', 'spoofed')$$,
  '42501', null, 'writer1 cannot insert an article as writer2');
select throws_ok(
  $$insert into profiles (id, role, slug, name)
    values ('00000000-0000-0000-0000-000000000003', 'writer', 'dup', 'X')$$,
  '42501', null, 'writer1 cannot insert profiles');
select lives_ok(
  $$update profiles set name = 'Writer One Renamed'
    where id = '00000000-0000-0000-0000-000000000002'$$,
  'writer1 can update own profile');
select is((select count(*) from settings)::int, 1,
  'authenticated users can read settings');
select lives_ok(
  $$update settings set post_interval_days = 99 where id = 1$$,
  'non-admin settings update affects 0 rows without error');

-- back to postgres: verify nothing leaked through
set local role postgres;
select is((select title from articles
  where id = '10000000-0000-0000-0000-000000000002'), 'w2 draft',
  'writer2 draft title unchanged');
select is((select post_interval_days from settings where id = 1), 10,
  'settings unchanged by non-admin');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from articles)::int, 3, 'admin sees all articles');
select lives_ok(
  $$update settings set featured_count = 5 where id = 1$$,
  'admin can update settings');
select is((select featured_count from settings where id = 1), 5,
  'admin settings update applied');

select * from finish();
rollback;
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `supabase db reset && supabase test db`
Expected: `02_rls.test.sql .. not ok` — RLS 無効のため writer1 に全記事が見えて件数が合わない

- [ ] **Step 3: マイグレーションを書く**

Run: `supabase migration new rls_policies`
生成されたファイルに以下を記述:

```sql
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.articles enable row level security;
alter table public.settings enable row level security;

-- profiles
create policy "select own profile or admin all"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "update own profile or admin all"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy "admin inserts profiles"
  on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy "admin deletes profiles"
  on public.profiles for delete to authenticated
  using (public.is_admin());

-- articles
create policy "select own articles or admin all"
  on public.articles for select to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy "insert own articles or admin"
  on public.articles for insert to authenticated
  with check (author_id = auth.uid() or public.is_admin());
create policy "update own articles or admin all"
  on public.articles for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());
create policy "delete own articles or admin all"
  on public.articles for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- settings
create policy "authenticated read settings"
  on public.settings for select to authenticated
  using (true);
create policy "admin updates settings"
  on public.settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
```

- [ ] **Step 4: テストが通ることを確認**

Run: `supabase db reset && supabase test db`
Expected: `01_schema` `02_rls` とも ok(合計 22 tests passed)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: enable RLS with per-role policies and is_admin helper"
```

---

### Task 4: プロフィール保護トリガー(role/コード変更拒否・依頼者コード自動生成)

**Files:**
- Create: `supabase/migrations/<timestamp>_profile_protection.sql`
- Test: `supabase/tests/database/03_profile_protection.test.sql`

**Interfaces:**
- Consumes: Task 3 の `public.is_admin()`
- Produces: provider 作成時に `commission_code` が `WM-XXXXXXXX` 形式で自動生成される保証。非 admin による `role` / `commission_code` 変更は例外 `role and commission_code can only be changed by an admin` で拒否される保証

- [ ] **Step 1: 失敗するテストを書く**

`supabase/tests/database/03_profile_protection.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000004', 'prot-writer@test.local'),
  ('00000000-0000-0000-0000-000000000005', 'prot-provider@test.local'),
  ('00000000-0000-0000-0000-000000000006', 'prot-admin@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000004', 'writer', 'prot-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000005', 'provider', 'prot-provider', 'Provider'),
  ('00000000-0000-0000-0000-000000000006', 'admin', 'prot-admin', 'Admin');

select matches(
  (select commission_code from profiles
    where id = '00000000-0000-0000-0000-000000000005'),
  '^WM-[0-9A-F]{8}$',
  'provider gets an auto-generated commission code');

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
select throws_like(
  $$update profiles set commission_code = 'WM-DEADBEEF'
    where id = '00000000-0000-0000-0000-000000000004'$$,
  '%only be changed by an admin%',
  'writer cannot set own commission code');

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

- [ ] **Step 2: テストが失敗することを確認**

Run: `supabase db reset && supabase test db`
Expected: `03_profile_protection.test.sql .. not ok` — commission_code が null で matches が失敗

- [ ] **Step 3: マイグレーションを書く**

Run: `supabase migration new profile_protection`
生成されたファイルに以下を記述:

```sql
create or replace function public.set_commission_code()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role = 'provider' and new.commission_code is null then
    new.commission_code :=
      'WM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  end if;
  return new;
end;
$$;

create trigger a_set_commission_code
  before insert on public.profiles
  for each row execute function public.set_commission_code();

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.commission_code is distinct from old.commission_code then
      raise exception
        'role and commission_code can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger a_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();
```

注意: `protect_profile_columns` は `security definer` だが、判定は「呼び出しユーザーの JWT(auth.uid())が admin か」で行うため、postgres ロール(マイグレーション・テストのセットアップ)からの直接更新は `is_admin()=false` になる。ただし postgres は RLS もトリガーの例外も踏まない位置(セットアップは insert のみ)なので影響しない。admin ユーザーの操作は JWT 経由で `is_admin()=true` となり許可される。

- [ ] **Step 4: テストが通ることを確認**

Run: `supabase db reset && supabase test db`
Expected: 3ファイルとも ok(合計 29 tests passed)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: protect role/commission_code and auto-generate provider codes"
```

---

### Task 5: 依頼者コードの解決トリガーと実在チェックRPC

**Files:**
- Create: `supabase/migrations/<timestamp>_commission_resolution.sql`
- Test: `supabase/tests/database/04_commission.test.sql`

**Interfaces:**
- Consumes: Task 2 の `articles.commission_code_input` / `articles.commissioned_by` カラム
- Produces:
  - `articles.commissioned_by` は常に `commission_code_input` から導出される(クライアントが直接セットしても無効化される)。不正コードは例外 `INVALID_COMMISSION_CODE`
  - RPC `public.validate_commission_code(code text) returns text` — 完全一致した provider の `name` を返す。一致なしなら null。authenticated のみ実行可(フロントエンドのエディタがコード入力時のインラインチェックに使う)

- [ ] **Step 1: 失敗するテストを書く**

`supabase/tests/database/04_commission.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000007', 'com-writer@test.local'),
  ('00000000-0000-0000-0000-000000000008', 'com-provider@test.local');

insert into profiles (id, role, slug, name, commission_code) values
  ('00000000-0000-0000-0000-000000000007', 'writer', 'com-writer', 'Writer', null),
  ('00000000-0000-0000-0000-000000000008', 'provider', 'com-provider', 'Green Provider', 'WM-11AA22BB');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, title, commission_code_input)
    values ('20000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000007',
            'commissioned draft', 'WM-11AA22BB')$$,
  'valid commission code is accepted');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000008'::uuid,
  'commissioned_by resolved from code');

select throws_like(
  $$insert into articles (author_id, title, commission_code_input)
    values ('00000000-0000-0000-0000-000000000007', 'bad code', 'WM-NOPE0000')$$,
  '%INVALID_COMMISSION_CODE%',
  'invalid commission code is rejected');

select lives_ok(
  $$insert into articles (id, author_id, title, commissioned_by)
    values ('20000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000007',
            'spoofed', '00000000-0000-0000-0000-000000000008')$$,
  'direct commissioned_by insert does not error');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000002'),
  null::uuid,
  'directly-set commissioned_by is nulled out (must come from a code)');

select is(
  public.validate_commission_code('WM-11AA22BB'),
  'Green Provider',
  'validate RPC returns provider name on exact match');
select is(
  public.validate_commission_code('WM-NOPE0000'),
  null::text,
  'validate RPC returns null when no match');

select lives_ok(
  $$update articles set commission_code_input = null
    where id = '20000000-0000-0000-0000-000000000001'$$,
  'commission code can be cleared');
select is(
  (select commissioned_by from articles
    where id = '20000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the code clears commissioned_by');

select * from finish();
rollback;
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `supabase db reset && supabase test db`
Expected: `04_commission.test.sql .. not ok` — commissioned_by が解決されず null のまま

- [ ] **Step 3: マイグレーションを書く**

Run: `supabase migration new commission_resolution`
生成されたファイルに以下を記述:

```sql
create or replace function public.resolve_commission_code()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  if new.commission_code_input is null then
    new.commissioned_by := null;
  elsif tg_op = 'INSERT'
        or new.commission_code_input is distinct from old.commission_code_input then
    select id into provider_id
      from profiles
     where commission_code = new.commission_code_input
       and role = 'provider';
    if provider_id is null then
      raise exception 'INVALID_COMMISSION_CODE: no provider matches this code';
    end if;
    new.commissioned_by := provider_id;
  else
    new.commissioned_by := old.commissioned_by;
  end if;
  return new;
end;
$$;

create trigger a_resolve_commission_code
  before insert or update on public.articles
  for each row execute function public.resolve_commission_code();

create or replace function public.validate_commission_code(code text)
returns text
language sql stable security definer
set search_path = public
as $$
  select name from profiles
   where commission_code = code and role = 'provider';
$$;

revoke execute on function public.validate_commission_code(text) from public, anon;
grant execute on function public.validate_commission_code(text)
  to authenticated, service_role;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `supabase db reset && supabase test db`
Expected: 4ファイルとも ok(合計 38 tests passed)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: resolve commission codes via trigger and add validate RPC"
```

---

### Task 6: 公開ルールトリガー(投稿頻度制限・published_at 管理)

**Files:**
- Create: `supabase/migrations/<timestamp>_publish_rules.sql`
- Test: `supabase/tests/database/05_publish_rules.test.sql`

**Interfaces:**
- Consumes: Task 5 の `a_resolve_commission_code` トリガー(**トリガー名のアルファベット順で本トリガー `b_enforce_publish_rules` より先に実行される**ことに依存。頻度チェック時点で `commissioned_by` が解決済みである必要がある)、`settings.post_interval_days`
- Produces: draft→published 遷移時に `published_at` を自動設定。`commissioned_by is null` の記事の公開は、同著者の直近の通常公開から `post_interval_days` 日経過していなければ例外 `POST_INTERVAL_NOT_ELAPSED`。依頼記事(`commissioned_by` あり)は制限対象外

- [ ] **Step 1: 失敗するテストを書く**

`supabase/tests/database/05_publish_rules.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000009', 'pub-writer@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'pub-provider@test.local');

insert into profiles (id, role, slug, name, commission_code) values
  ('00000000-0000-0000-0000-000000000009', 'writer', 'pub-writer', 'Writer', null),
  ('00000000-0000-0000-0000-00000000000b', 'provider', 'pub-provider', 'Provider', 'WM-33CC44DD');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status)
    values ('30000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000009',
            'pub-a', 'first post', 'published')$$,
  'first normal publish succeeds');
select ok(
  (select published_at from articles
    where id = '30000000-0000-0000-0000-000000000001') is not null,
  'published_at is set automatically');

select throws_like(
  $$insert into articles (author_id, slug, title, status)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-too-soon', 'too soon', 'published')$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'second normal publish within the interval is rejected');

set local role postgres;
update articles set published_at = now() - interval '11 days'
 where id = '30000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status)
    values ('30000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000009',
            'pub-b', 'second post', 'published')$$,
  'normal publish succeeds after the interval elapsed');

select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_code_input)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-c', 'commissioned 1', 'published', 'WM-33CC44DD')$$,
  'commissioned article publishes immediately (exempt)');
select lives_ok(
  $$insert into articles (author_id, slug, title, status, commission_code_input)
    values ('00000000-0000-0000-0000-000000000009',
            'pub-d', 'commissioned 2', 'published', 'WM-33CC44DD')$$,
  'multiple commissioned articles are all exempt');

select lives_ok(
  $$insert into articles (id, author_id, title)
    values ('30000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000009', 'draft e')$$,
  'drafts are never rate-limited');
select throws_like(
  $$update articles set status = 'published', slug = 'pub-e'
    where id = '30000000-0000-0000-0000-000000000003'$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'draft-to-published transition is also rate-limited');

set local role postgres;
update articles set published_at = now() - interval '11 days'
 where id = '30000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update articles set status = 'published', slug = 'pub-e'
    where id = '30000000-0000-0000-0000-000000000003'$$,
  'draft publishes via update after interval elapsed');
select ok(
  (select published_at from articles
    where id = '30000000-0000-0000-0000-000000000003') is not null,
  'published_at set on update transition');

select * from finish();
rollback;
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `supabase db reset && supabase test db`
Expected: `05_publish_rules.test.sql .. not ok` — 公開直後の2件目が例外にならず throws_like が失敗(かつ最初の insert が `published_requires_published_at` 制約で失敗する)

- [ ] **Step 3: マイグレーションを書く**

Run: `supabase migration new publish_rules`
生成されたファイルに以下を記述:

```sql
create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  interval_days int;
  last_pub timestamptz;
begin
  -- run only when the row is becoming published
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if new.published_at is null then
      new.published_at := now();
    end if;

    if new.commissioned_by is null then
      select post_interval_days into interval_days
        from settings where id = 1;

      select max(published_at) into last_pub
        from articles
       where author_id = new.author_id
         and status = 'published'
         and commissioned_by is null
         and id <> new.id;

      if last_pub is not null
         and last_pub > now() - make_interval(days => interval_days) then
        raise exception
          'POST_INTERVAL_NOT_ELAPSED: next normal post allowed after %',
          last_pub + make_interval(days => interval_days);
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger b_enforce_publish_rules
  before insert or update on public.articles
  for each row execute function public.enforce_publish_rules();
```

- [ ] **Step 4: テストが通ることを確認**

Run: `supabase db reset && supabase test db`
Expected: 5ファイルとも ok(合計 48 tests passed)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: enforce post interval and auto-set published_at on publish"
```

---

### Task 7: Edge Function — invite-user(管理者専用のユーザー招待)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/invite-user/index.ts`

**Interfaces:**
- Consumes: Task 2-4 の profiles テーブルとトリガー(profile insert 時に provider ならコード自動生成)
- Produces: `POST /functions/v1/invite-user`。リクエスト `{ email, name, slug, role }`(role は `'writer' | 'provider'`)。呼び出し元が admin でなければ 403。成功時 `{ ok: true, userId }` を返し、招待メールが送信され profiles 行が作成される(フロントエンドの管理画面が使う)

- [ ] **Step 1: 共有 CORS ヘッダーを書く**

`supabase/functions/_shared/cors.ts`:

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};
```

- [ ] **Step 2: invite-user 本体を書く**

`supabase/functions/invite-user/index.ts`:

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

  // validate payload
  let payload: { email?: string; name?: string; slug?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { email, name, slug, role } = payload;
  if (
    !email || !name || !slug ||
    !['writer', 'provider'].includes(role ?? '') ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
  ) {
    return json(
      { error: 'email, name, slug, and role (writer|provider) are required' },
      400,
    );
  }

  // invite, then create the profile; roll back the auth user on failure
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError) return json({ error: inviteError.message }, 400);

  const { error: profileError } = await admin.from('profiles').insert({
    id: invited.user.id,
    role,
    slug,
    name,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ ok: true, userId: invited.user.id });
});
```

- [ ] **Step 3: ローカルで関数を起動**

Run: `supabase functions serve`
Expected: `Serving supabase/functions/invite-user` を含む起動ログ

- [ ] **Step 4: ローカル admin ユーザーを作成(手動テストの準備)**

別ターミナルで、まず `supabase status` を実行して `anon key` と `service_role key` を控える。以下 `$SERVICE_KEY` `$ANON_KEY` は読み替え。

```bash
# 1) admin ユーザーを auth に作成
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"admin-pass-1234","email_confirm":true}'
# レスポンス JSON の "id" を控える(以下 $ADMIN_ID)

# 2) admin の profiles 行を作成
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "insert into profiles (id, role, slug, name) values ('$ADMIN_ID', 'admin', 'site-admin', 'Site Admin');"

# 3) admin としてサインインしてアクセストークンを取得
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"admin-pass-1234"}'
# レスポンスの "access_token" を控える(以下 $ADMIN_TOKEN)
```

Expected: 各 curl が 200 で JSON を返す

- [ ] **Step 5: 招待の成功パスを検証**

```bash
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/invite-user' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"writer1@local.test","name":"Writer One","slug":"writer-one","role":"writer"}'
```

Expected: `{"ok":true,"userId":"..."}`。さらに:
- `http://127.0.0.1:54324`(Mailpit)に招待メールが届いている
- `psql ... -c "select role, slug from profiles where slug = 'writer-one';"` が `writer | writer-one` を返す
- provider を招待した場合(`"role":"provider"`)は `commission_code` が `WM-` で始まる値になっている

- [ ] **Step 6: 未認証の呼び出しが 401 になることを検証**

(非 admin ユーザーの 403 も確認したいが、招待したばかりの writer1 はパスワード未設定でサインインできないため、ここでは未認証 401 のみ検証する。403 パスはコード上 `callerProfile?.role !== 'admin'` で担保):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  'http://127.0.0.1:54321/functions/v1/invite-user' \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"x@local.test","name":"X","slug":"x-x","role":"writer"}'
```

Expected: `401`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions
git commit -m "feat: add admin-only invite-user edge function"
```

---

### Task 8: Edge Function — r2-upload-url(サイズ上限つき署名付きURL発行)

**Files:**
- Create: `supabase/functions/r2-upload-url/index.ts`
- Create: `supabase/functions/.env`(gitignore 済み。R2 の秘密情報)

**Interfaces:**
- Consumes: Task 7 の `_shared/cors.ts`
- Produces: `POST /functions/v1/r2-upload-url`。リクエスト `{ contentType, contentLength }`。認証必須。512,000 バイト超過・許可外タイプは 400。成功時 `{ uploadUrl, publicUrl, headers }` — フロントエンドは `uploadUrl` へ `headers` を付けて PUT し、記事には `publicUrl` を保存する。キーは `<userId>/<uuid>.<ext>`

- [ ] **Step 1: 環境変数ファイルを作成**

`supabase/functions/.env`(値は Cloudflare ダッシュボード → R2 → API トークンで発行したものに差し替える。R2 バケット未作成の場合は後述 Step 4 の署名検証まではダミー値で進められる):

```env
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET=wild-media
R2_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev
```

- [ ] **Step 2: 関数本体を書く**

`supabase/functions/r2-upload-url/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';
import { corsHeaders } from '../_shared/cors.ts';

const MAX_BYTES = 512_000;
const ALLOWED_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

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

  // any authenticated user may upload
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData } = await admin.auth.getUser(jwt);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { contentType?: string; contentLength?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { contentType, contentLength } = payload;

  const ext = ALLOWED_TYPES[contentType ?? ''];
  if (!ext) {
    return json(
      { error: `contentType must be one of: ${Object.keys(ALLOWED_TYPES).join(', ')}` },
      400,
    );
  }
  if (
    !Number.isInteger(contentLength) ||
    contentLength! <= 0 ||
    contentLength! > MAX_BYTES
  ) {
    return json({ error: `contentLength must be 1..${MAX_BYTES} bytes` }, 400);
  }

  const key = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;
  const objectUrl = new URL(
    `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/` +
      `${Deno.env.get('R2_BUCKET')}/${key}`,
  );
  objectUrl.searchParams.set('X-Amz-Expires', '300');

  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: 'auto',
  });

  // Content-Length / Content-Type を署名に含める → クライアントは
  // この値と異なるサイズ・タイプでは PUT できない(R2 が拒否する)
  const signed = await r2.sign(
    new Request(objectUrl.toString(), {
      method: 'PUT',
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': contentType!,
      },
    }),
    { aws: { signQuery: true } },
  );

  return json({
    uploadUrl: signed.url,
    publicUrl: `${Deno.env.get('R2_PUBLIC_BASE_URL')}/${key}`,
    headers: { 'Content-Type': contentType },
  });
});
```

- [ ] **Step 3: env 付きで関数を起動**

Run: `supabase functions serve --env-file supabase/functions/.env`
Expected: `invite-user` と `r2-upload-url` の両方が Serving される

- [ ] **Step 4: バリデーションと署名発行を検証**

Task 7 で取得した `$ADMIN_TOKEN` を使う(認証済みユーザーなら誰でもよい):

```bash
# 正常系: 署名付きURLが返る
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/r2-upload-url' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentType":"image/webp","contentLength":100000}'
# Expected: {"uploadUrl":"https://...r2.cloudflarestorage.com/...X-Amz-Signature=...","publicUrl":"...","headers":{...}}

# サイズ超過: 400
curl -s -o /dev/null -w "%{http_code}" -X POST \
  'http://127.0.0.1:54321/functions/v1/r2-upload-url' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentType":"image/webp","contentLength":9999999}'
# Expected: 400

# 許可外タイプ: 400
curl -s -o /dev/null -w "%{http_code}" -X POST \
  'http://127.0.0.1:54321/functions/v1/r2-upload-url' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentType":"application/zip","contentLength":1000}'
# Expected: 400

# 未認証: 401
curl -s -o /dev/null -w "%{http_code}" -X POST \
  'http://127.0.0.1:54321/functions/v1/r2-upload-url' \
  -H 'Content-Type: application/json' \
  -d '{"contentType":"image/webp","contentLength":1000}'
# Expected: 401
```

- [ ] **Step 5: (任意・R2 実バケットがある場合のみ)実アップロードを検証**

Cloudflare ダッシュボードで R2 バケット `wild-media` と APIトークン(Object Read & Write)を作成し、`.env` を実値にして serve を再起動した上で:

```bash
# 100KB のダミー webp を作って、返ってきた uploadUrl へ PUT
head -c 100000 /dev/urandom > /tmp/dummy.webp
UPLOAD_URL=$(curl -s -X POST 'http://127.0.0.1:54321/functions/v1/r2-upload-url' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentType":"image/webp","contentLength":100000}' | jq -r .uploadUrl)
curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  -H 'Content-Type: image/webp' --data-binary @/tmp/dummy.webp
```

Expected: `200`(異なるサイズのファイルを送ると R2 が 403 で拒否することも確認できる)

- [ ] **Step 6: 最終確認とコミット**

Run: `supabase db reset && supabase test db`
Expected: 全5ファイル・48 テストすべて ok

```bash
git add supabase/functions
git commit -m "feat: add r2-upload-url edge function with size/type limits"
```

---

## この計画のスコープ外(計画2: Astro フロントエンドで扱う)

- Astro プロジェクトの雛形、公開ページ(トップ/記事/ライター)、CMS 画面(ログイン/エディタ/管理)
- マークダウンエディタ(EasyMDE)、Cropper.js によるクロップ、ブラウザ内リサイズ・WebP 圧縮
- Supabase Database Webhook → Cloudflare Pages Deploy Hook の再ビルド設定
- ホスト版 Supabase へのデプロイ(`supabase link` / `supabase db push` / `supabase functions deploy`)と R2 本番設定
