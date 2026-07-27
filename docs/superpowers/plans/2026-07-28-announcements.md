# お知らせ機能(announcements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アドミンが「ライター」「サービスプロバイダー」「エンドユーザー(公開サイト)」向けにお知らせを配信できるようにする。CMSではサイドバーにシンプルなリスト表示、公開サイトではクリックでポップアップが開くバナーとして表示する。

**Architecture:** 新しい `announcements` テーブル1つに全対象を集約し、`audiences text[]` カラムで出し分ける。可視性はすべて RLS(DB層)で強制する。CMS(ライター/事業者/アドミン)は既存の anon key + Supabase JS クライアント直結パターンをそのまま使う。公開サイトは初めて、ビルド時の service role 取得ではなく **ブラウザから直接 anon key + RLS で読む**(新しい経路。既存の検索はEdge Function経由でテーブル直読みではないため、本当に初めて)。

**Tech Stack:** Supabase(Postgres + RLS + pgTAP)、Astro、TypeScript、Vitest(jsdom / node)、既存の `@supabase/supabase-js` ブラウザクライアント。

## Global Constraints

- 権限・可視性は DB 層(RLS)で強制する。CMS 側のガードは UX 目的のみ(実際の壁ではない)。
- `admin/` に service role key を入れない。
- `audiences` の許容値は `writer` / `provider` / `end_user` の3つのみ。1件で複数対象可、空配列は不可。
- 公開期間(開始日・終了日)・既読のサーバー永続化は今回のスコープ外(YAGNI)。
- ローカル Supabase は他エージェントと共有中。`supabase db reset` / `supabase migration new` / `npm run seed` は実行しない。新しいマイグレーションは `supabase migration up` で非破壊的に適用する。
- `git add` は自分の宣言パスのみを個別に指定する(`git add -A` 禁止)。

---

### Task 1: DBスキーマ — announcements テーブル・RLS・pgTAP・ドキュメント

**Files:**
- Create: `supabase/migrations/20260728100000_announcements.sql`
- Create: `supabase/tests/database/18_announcements.test.sql`
- Modify: `docs/DATABASE.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Produces: テーブル `public.announcements(id uuid, title text, body text, audiences text[], published boolean, created_by uuid, created_at timestamptz, updated_at timestamptz)`。関数 `public.is_provider() returns boolean`(既存の `is_admin()`/`is_writer()` と同じ形)。RLS: admin は全件CRUD、writer/providerは`published=true`かつ自分のaudienceのみselect、anonは`published=true and 'end_user' = ANY(audiences)`のみselect。

- [ ] **Step 1: マイグレーションファイルを書く**

`supabase/migrations/20260728100000_announcements.sql`:

```sql
-- お知らせ機能。アドミンが対象(ライター/事業者/エンドユーザー)を指定して配信する。
-- 公開サイトはこのテーブルだけ、初めてブラウザから anon key + RLS で直接読む
-- (他の公開データは全てビルド時に service role で読む。既存の検索はテーブル直読みでは
-- なく search-articles Edge Function 経由)。

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  audiences text[] not null,
  published boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- array_length は空配列で NULL を返し CHECK を素通りしてしまうため、
  -- 空配列を確実に弾ける cardinality() を使う。
  constraint announcements_audiences_valid check (
    audiences <@ array['writer', 'provider', 'end_user']::text[]
    and cardinality(audiences) > 0
  )
);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function extensions.moddatetime(updated_at);

create or replace function public.is_provider()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'provider'
  );
$$;

grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.announcements to anon;

alter table public.announcements enable row level security;

create policy "admin selects all announcements"
  on public.announcements for select to authenticated
  using (public.is_admin());

create policy "writer or provider selects own audience announcements"
  on public.announcements for select to authenticated
  using (
    published = true
    and (
      (public.is_writer() and 'writer' = ANY(audiences))
      or (public.is_provider() and 'provider' = ANY(audiences))
    )
  );

create policy "admin inserts announcements"
  on public.announcements for insert to authenticated
  with check (public.is_admin());

create policy "admin updates announcements"
  on public.announcements for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin deletes announcements"
  on public.announcements for delete to authenticated
  using (public.is_admin());

create policy "anon reads published end user announcements"
  on public.announcements for select to anon
  using (published = true and 'end_user' = ANY(audiences));
```

- [ ] **Step 2: マイグレーションをローカルに適用する**

Run: `supabase migration up`
Expected: 新しいマイグレーションが適用され、エラーが出ない(他エージェントの未適用マイグレーションも一緒に前進するが、これは正常 — `db reset` ではなく非破壊的な forward migration なので既存データは消えない)。

- [ ] **Step 3: pgTAP テストを書く**

`supabase/tests/database/18_announcements.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000040', 'ann-admin@test.local'),
  ('00000000-0000-0000-0000-000000000041', 'ann-writer@test.local'),
  ('00000000-0000-0000-0000-000000000042', 'ann-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000040', 'admin', 'ann-admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000041', 'writer', 'ann-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000042', 'provider', 'ann-provider', 'Provider');

-- act as admin
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000040","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array[]::text[], true)$$,
  '%announcements_audiences_valid%',
  '空配列の audiences は拒否される');

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array['bogus'], true)$$,
  '%announcements_audiences_valid%',
  '許可されていない audience 値は拒否される');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000043', 'ライター向け', '本文w', array['writer'], true)$$,
  'admin はライター向けの公開お知らせを作成できる');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000044', '事業者向け下書き', '本文p', array['provider'], false)$$,
  'admin は非公開のお知らせを作成できる');

select lives_ok(
  $$insert into announcements (id, title, body, audiences, published)
    values ('00000000-0000-0000-0000-000000000045', 'エンドユーザー向け', '本文e', array['end_user'], true)$$,
  'admin はエンドユーザー向けの公開お知らせを作成できる');

select is(
  (select count(*)::int from announcements),
  3,
  'admin は下書き含む全件を select できる');

select lives_ok(
  $$update announcements set title = '更新後' where id = '00000000-0000-0000-0000-000000000043'$$,
  'admin は更新できる');

select lives_ok(
  $$delete from announcements where id = '00000000-0000-0000-0000-000000000044'$$,
  'admin は削除できる');

-- act as writer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from announcements),
  1,
  'writer には公開済みかつ writer 向けの1件だけ見える(事業者/エンドユーザー向けは見えない)');

-- UPDATE の USING 句にマッチする行が無い場合、DELETE/UPDATE はエラーにならず
-- 単に対象0行として静かに成功する(エラーになるのは INSERT の WITH CHECK 違反だけ)。
-- そのため lives_ok で「エラーにならないこと」を確認した上で、実際に書き換わって
-- いないことを別途 postgres ロールで確認する。
select lives_ok(
  $$update announcements set title = '書き換え試行' where id = '00000000-0000-0000-0000-000000000043'$$,
  'writer の update 文自体はエラーにならない(RLSにマッチする行が無く0行が対象)');

select throws_like(
  $$insert into announcements (title, body, audiences, published)
    values ('t', 'b', array['writer'], true)$$,
  '%',
  'writer は作成できない(insertはRLSのwith check違反でエラーになる)');

set local role postgres;
select is(
  (select title from announcements where id = '00000000-0000-0000-0000-000000000043'),
  '更新後',
  'writer の update 試行はタイトルを書き換えられていない(RLSにより対象0行だった)');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from announcements),
  0,
  'provider には(writer向け1件のみ存在する現状で)何も見えない');

-- act as anon
set local role anon;
reset request.jwt.claims;

select is(
  (select count(*)::int from announcements),
  1,
  'anon には公開済みかつ end_user 向けの1件だけ見える');

select * from finish();
rollback;
```

- [ ] **Step 4: pgTAP テストを実行して確認する**

Run: `supabase test db`
Expected: 全13アサーションが PASS。

- [ ] **Step 5: docs/DATABASE.md を更新する**

`docs/DATABASE.md` の ER 図(mermaid の `erDiagram` ブロック内、`profiles ||--o{ articles : "author_id"` などが並ぶ箇所)に以下を追加:

```
    profiles |o--o{ announcements : "created_by (nullable)"
```

同じファイルの `announcements` エンティティ定義を `post_chunks {` ブロックの直前に追加:

```
    announcements {
        uuid id PK
        text title
        text body
        text_array audiences "writer/provider/end_user の組み合わせ、空不可"
        boolean published
        uuid created_by FK "-> profiles.id, nullable"
        timestamptz created_at
        timestamptz updated_at
    }
```

「テーブルごとの補足」の表に行を追加:

```
| `announcements` | RLS: admin は全件CRUD。writer/providerはpublished=trueかつ自分のaudienceのみselect。anonはpublished=trueかつend_user向けのみselect | 公開サイトが初めてブラウザから直接(anon key + RLS)読むテーブル。他の公開データはビルド時にservice roleで読む |
```

「主なDB関数」の表に行を追加:

```
| `is_provider()` | RLSポリシー内で使用 | 呼び出しユーザーがprovider roleかを判定(`announcements` select の対象出し分けに使用) |
```

- [ ] **Step 6: ARCHITECTURE.md を更新する**

`ARCHITECTURE.md` の「信頼境界(最重要)」セクションに1行追加(既存の3項目の後に追加):

```
- `announcements` テーブルは唯一、公開サイトのブラウザが anon key + RLS で直接読む(他の公開データはビルド時に service role で取得)。RLS(`published=true and 'end_user' = ANY(audiences)`)が可視範囲の実体。
```

- [ ] **Step 7: コミットする**

```bash
git add supabase/migrations/20260728100000_announcements.sql supabase/tests/database/18_announcements.test.sql docs/DATABASE.md ARCHITECTURE.md
git commit -m "feat(db): add announcements table with audience-scoped RLS"
```

---

### Task 2: 管理系データ関数(admin/src/lib/announcements.ts)

**Files:**
- Create: `admin/src/lib/announcements.ts`
- Test: `admin/tests/announcements.test.ts`

**Interfaces:**
- Consumes: Task 1 の `announcements` テーブル・RLS。
- Produces: `type AnnouncementAudience = 'writer' | 'provider' | 'end_user'`、`interface Announcement { id, title, body, audiences: AnnouncementAudience[], published, createdAt, updatedAt }`、`interface AnnouncementInput { title, body, audiences, published }`、`validateAnnouncementInput(input): string | null`、`fetchAnnouncements(supabase, opts？: { limit?: number }): Promise<Announcement[]>`、`createAnnouncement(supabase, input): Promise<void>`、`updateAnnouncement(supabase, id, input): Promise<void>`、`deleteAnnouncement(supabase, id): Promise<void>`。Task 3(ダイアログ)・Task 4(管理画面)・Task 5(CMS表示)がこれらを import する。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/announcements.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  validateAnnouncementInput, fetchAnnouncements,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  type AnnouncementInput,
} from '../src/lib/announcements';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const writerClient = createClient(url, anon, { auth: { persistSession: false } });
const providerClient = createClient(url, anon, { auth: { persistSession: false } });

beforeAll(async () => {
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
  const w = await writerClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (w.error) throw w.error;
  const p = await providerClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (p.error) throw p.error;
});

afterEach(async () => {
  // 各テストで作った行を掃除する(admin なら全件消せる)。
  await adminClient.from('announcements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

describe('validateAnnouncementInput', () => {
  const base: AnnouncementInput = {
    title: 'タイトル', body: '本文', audiences: ['writer'], published: false,
  };

  it('正しい入力は null を返す', () => {
    expect(validateAnnouncementInput(base)).toBeNull();
  });

  it('タイトルが空なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, title: '  ' })).toBe('タイトルを入力してください');
  });

  it('本文が空なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, body: '' })).toBe('本文を入力してください');
  });

  it('対象が0件なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, audiences: [] })).toBe('対象を1つ以上選択してください');
  });
});

describe('createAnnouncement / fetchAnnouncements', () => {
  it('admin が作成した非公開のお知らせも fetchAnnouncements(admin) に含まれる', async () => {
    await createAnnouncement(adminClient, {
      title: '下書き', body: '本文', audiences: ['writer'], published: false,
    });
    const list = await fetchAnnouncements(adminClient);
    expect(list.some((a) => a.title === '下書き' && a.published === false)).toBe(true);
  });

  it('writer は公開済み・自分向けのお知らせだけ fetchAnnouncements で見える', async () => {
    await createAnnouncement(adminClient, {
      title: 'ライター向け公開', body: 'w', audiences: ['writer'], published: true,
    });
    await createAnnouncement(adminClient, {
      title: '事業者向け公開', body: 'p', audiences: ['provider'], published: true,
    });
    await createAnnouncement(adminClient, {
      title: 'ライター向け非公開', body: 'w2', audiences: ['writer'], published: false,
    });

    const list = await fetchAnnouncements(writerClient);
    const titles = list.map((a) => a.title);
    expect(titles).toContain('ライター向け公開');
    expect(titles).not.toContain('事業者向け公開');
    expect(titles).not.toContain('ライター向け非公開');
  });

  it('provider は公開済み・自分向けのお知らせだけ見える', async () => {
    await createAnnouncement(adminClient, {
      title: '事業者向け公開2', body: 'p', audiences: ['provider'], published: true,
    });
    const list = await fetchAnnouncements(providerClient);
    expect(list.map((a) => a.title)).toContain('事業者向け公開2');
  });

  it('writer は作成できない(insert が RLS で拒否される)', async () => {
    await expect(createAnnouncement(writerClient, {
      title: 't', body: 'b', audiences: ['writer'], published: true,
    })).rejects.toThrow();
  });

  it('opts.limit を渡すと件数を絞れる', async () => {
    for (let i = 0; i < 3; i++) {
      await createAnnouncement(adminClient, {
        title: `件数テスト${i}`, body: 'b', audiences: ['writer'], published: true,
      });
    }
    const list = await fetchAnnouncements(adminClient, { limit: 2 });
    expect(list.length).toBeLessThanOrEqual(2);
  });
});

describe('updateAnnouncement / deleteAnnouncement', () => {
  it('admin は更新・削除できる', async () => {
    await createAnnouncement(adminClient, {
      title: '更新前', body: 'b', audiences: ['writer'], published: false,
    });
    const [created] = await fetchAnnouncements(adminClient);
    await updateAnnouncement(adminClient, created.id, {
      title: '更新後', body: 'b2', audiences: ['provider'], published: true,
    });
    const afterUpdate = (await fetchAnnouncements(adminClient)).find((a) => a.id === created.id)!;
    expect(afterUpdate.title).toBe('更新後');
    expect(afterUpdate.audiences).toEqual(['provider']);

    await deleteAnnouncement(adminClient, created.id);
    const afterDelete = (await fetchAnnouncements(adminClient)).find((a) => a.id === created.id);
    expect(afterDelete).toBeUndefined();
  });

  it('writer は更新できない(0行 denied)', async () => {
    await createAnnouncement(adminClient, {
      title: '保護対象', body: 'b', audiences: ['writer'], published: true,
    });
    const target = (await fetchAnnouncements(adminClient)).find((a) => a.title === '保護対象')!;
    await expect(updateAnnouncement(writerClient, target.id, {
      title: '書き換え', body: 'b', audiences: ['writer'], published: true,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd admin && npx vitest run tests/announcements.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/announcements'`)

- [ ] **Step 3: 実装を書く**

`admin/src/lib/announcements.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type AnnouncementAudience = 'writer' | 'provider' | 'end_user';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
}

const VALID_AUDIENCES: AnnouncementAudience[] = ['writer', 'provider', 'end_user'];

export function validateAnnouncementInput(input: AnnouncementInput): string | null {
  if (!input.title.trim()) return 'タイトルを入力してください';
  if (!input.body.trim()) return '本文を入力してください';
  if (input.audiences.length === 0) return '対象を1つ以上選択してください';
  if (input.audiences.some((a) => !VALID_AUDIENCES.includes(a))) return '対象の指定が不正です';
  return null;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
  created_at: string;
  updated_at: string;
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audiences: row.audiences,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// admin: 下書き含む全件。writer/provider: 自分向け公開済みのみ(RLSが出し分ける)。
export async function fetchAnnouncements(
  supabase: SupabaseClient, opts?: { limit?: number },
): Promise<Announcement[]> {
  let query = supabase
    .from('announcements')
    .select('id, title, body, audiences, published, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (opts?.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toAnnouncement);
}

export async function createAnnouncement(
  supabase: SupabaseClient, input: AnnouncementInput,
): Promise<void> {
  const validationError = validateAnnouncementInput(input);
  if (validationError) throw new Error(validationError);
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('announcements').insert({
    title: input.title.trim(),
    body: input.body.trim(),
    audiences: input.audiences,
    published: input.published,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
}

export async function updateAnnouncement(
  supabase: SupabaseClient, id: string, input: AnnouncementInput,
): Promise<void> {
  const validationError = validateAnnouncementInput(input);
  if (validationError) throw new Error(validationError);
  const { data, error } = await supabase
    .from('announcements')
    .update({
      title: input.title.trim(),
      body: input.body.trim(),
      audiences: input.audiences,
      published: input.published,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('ANNOUNCEMENT_UPDATE_DENIED');
}

export async function deleteAnnouncement(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('ANNOUNCEMENT_DELETE_DENIED');
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `cd admin && npx vitest run tests/announcements.test.ts`
Expected: PASS(前提: `supabase start` 済み・Task 1 のマイグレーション適用済み)

- [ ] **Step 5: コミットする**

```bash
git add admin/src/lib/announcements.ts admin/tests/announcements.test.ts
git commit -m "feat(admin): add announcements data functions with RLS-backed tests"
```

---

### Task 3: お知らせ閲覧ダイアログ(CMS共通)

**Files:**
- Create: `admin/src/components/atoms/AnnouncementViewDialog.astro`
- Create: `admin/src/lib/announcement-dialog.ts`
- Test: `admin/tests/announcement-dialog.test.ts`
- Modify: `admin/src/layouts/AdminLayout.astro`

**Interfaces:**
- Consumes: なし(自己完結)。
- Produces: `initAnnouncementDialog(dialogEl: HTMLDialogElement): { show(title: string, body: string): void }`。Task 5(CMS表示)がこれを import して使う。`<dialog id="announcement-dialog">` が全ページ共通で `AdminLayout.astro` に存在する。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/announcement-dialog.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initAnnouncementDialog } from '../src/lib/announcement-dialog';

function polyfillDialog(dialogEl: HTMLDialogElement) {
  dialogEl.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogEl.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function setup() {
  document.body.innerHTML = `
    <dialog id="announcement-dialog">
      <h2 data-announcement-title></h2>
      <p data-announcement-body></p>
      <button type="button" data-role="close"></button>
    </dialog>
  `;
  const dialogEl = document.getElementById('announcement-dialog') as HTMLDialogElement;
  polyfillDialog(dialogEl);
  return dialogEl;
}

describe('initAnnouncementDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show() でタイトルと本文を反映してダイアログを開く', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);

    dialog.show('お知らせ タイトル', 'お知らせ 本文');

    expect(dialogEl.open).toBe(true);
    expect(dialogEl.querySelector('[data-announcement-title]')!.textContent).toBe('お知らせ タイトル');
    expect(dialogEl.querySelector('[data-announcement-body]')!.textContent).toBe('お知らせ 本文');
  });

  it('閉じるボタンでダイアログが閉じる', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);
    dialog.show('t', 'b');

    (dialogEl.querySelector('[data-role="close"]') as HTMLButtonElement).click();

    expect(dialogEl.open).toBe(false);
  });

  it('背景クリックで閉じる', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);
    dialog.show('t', 'b');

    dialogEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dialogEl.open).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd admin && npx vitest run tests/announcement-dialog.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/announcement-dialog'`)

- [ ] **Step 3: 実装を書く**

`admin/src/lib/announcement-dialog.ts`:

```ts
export interface AnnouncementDialogController {
  show(title: string, body: string): void;
}

// お知らせ本文を表示するだけの読み取り専用ダイアログ。confirm-dialog.ts と違い
// 選択肢は無く「閉じる」のみ。
export function initAnnouncementDialog(dialogEl: HTMLDialogElement): AnnouncementDialogController {
  const titleEl = dialogEl.querySelector<HTMLElement>('[data-announcement-title]')!;
  const bodyEl = dialogEl.querySelector<HTMLElement>('[data-announcement-body]')!;
  const closeBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="close"]')!;

  closeBtn.addEventListener('click', () => dialogEl.close());
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });

  function show(title: string, body: string): void {
    titleEl.textContent = title;
    bodyEl.textContent = body;
    dialogEl.showModal();
  }

  return { show };
}
```

`admin/src/components/atoms/AnnouncementViewDialog.astro`:

```astro
---
import { cn } from '../../lib/cn';
import Button from './Button.astro';

interface Props {
  id: string;
  class?: string;
}

const { id, class: className } = Astro.props;
---
<dialog
  id={id}
  class={cn(
    'fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50',
    className,
  )}
>
  <h2 data-announcement-title class="text-lg font-semibold"></h2>
  <p data-announcement-body class="mt-3 whitespace-pre-wrap text-sm text-muted-foreground"></p>
  <div class="mt-6 flex justify-end">
    <Button type="button" variant="outline" size="sm" data-role="close">閉じる</Button>
  </div>
</dialog>
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `cd admin && npx vitest run tests/announcement-dialog.test.ts`
Expected: PASS

- [ ] **Step 5: AdminLayout.astro に配置する**

`admin/src/layouts/AdminLayout.astro` を編集(既存の `ConfirmDialog` インポート・配置のすぐ下に追加):

```astro
---
import '../styles/global.css';
import ConfirmDialog from '../components/atoms/ConfirmDialog.astro';
import AnnouncementViewDialog from '../components/atoms/AnnouncementViewDialog.astro';

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
  <body class="min-h-screen bg-background text-foreground antialiased">
    <slot />
    <ConfirmDialog id="confirm-dialog" />
    <AnnouncementViewDialog id="announcement-dialog" />
  </body>
</html>
```

- [ ] **Step 6: コミットする**

```bash
git add admin/src/lib/announcement-dialog.ts admin/tests/announcement-dialog.test.ts admin/src/components/atoms/AnnouncementViewDialog.astro admin/src/layouts/AdminLayout.astro
git commit -m "feat(admin): add read-only announcement view dialog"
```

---

### Task 4: アドミン管理画面(作成・編集・削除)

**Files:**
- Create: `admin/src/pages/announcements.astro`
- Modify: `admin/src/components/templates/AdminShell.astro`

**Interfaces:**
- Consumes: Task 2 の `fetchAnnouncements`/`createAnnouncement`/`updateAnnouncement`/`deleteAnnouncement`/`AnnouncementAudience`。既存の `initShellChrome`(`admin/src/lib/shell.ts`)・`initConfirmDialog`(`admin/src/lib/confirm-dialog.ts`、`#confirm-dialog` は Task 3 以前から `AdminLayout.astro` に存在)。
- Produces: `/announcements` ページ。`AdminShell.astro` の `#admin-nav` に「お知らせ管理」リンク。

- [ ] **Step 1: AdminShell.astro にナビリンクを追加する**

`admin/src/components/templates/AdminShell.astro` の `#admin-nav` 内、「依頼トークン管理」リンクの直後に追加:

```astro
          <a href="/announcements" class={`${navLink} ${isActive('/announcements') ? navLinkActive : ''}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            お知らせ管理
          </a>
```

- [ ] **Step 2: 管理画面ページを書く**

`admin/src/pages/announcements.astro`:

```astro
---
import AdminShell from '../components/templates/AdminShell.astro';
import Card from '../components/atoms/Card.astro';
import Button from '../components/atoms/Button.astro';
import Field from '../components/molecules/Field.astro';

const title = 'お知らせ管理 | Wild Media CMS';
---
<AdminShell title={title} heading="お知らせ管理" wide>
  <div class="space-y-6">
    <Card class="p-6">
      <h2 id="form-heading" class="mb-4 text-lg font-semibold tracking-tight">新しいお知らせを作成</h2>
      <form id="announcement-form" class="space-y-4">
        <Field id="ann-title" label="タイトル" type="text" required />
        <Field id="ann-body" label="本文" as="textarea" rows={5} required />
        <div class="space-y-2">
          <span class="text-sm font-medium">対象</span>
          <div class="flex flex-col gap-2">
            <label class="flex items-center gap-2 text-sm">
              <input id="ann-audience-writer" type="checkbox" class="h-4 w-4 rounded border-input" />
              ライター
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input id="ann-audience-provider" type="checkbox" class="h-4 w-4 rounded border-input" />
              サービスプロバイダー
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input id="ann-audience-end_user" type="checkbox" class="h-4 w-4 rounded border-input" />
              エンドユーザー(公開サイト)
            </label>
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input id="ann-published" type="checkbox" class="h-4 w-4 rounded border-input" />
          公開する
        </label>
        <div class="flex items-center gap-2 pt-2">
          <Button type="submit" id="ann-submit">作成</Button>
          <Button type="button" id="ann-cancel-edit" variant="outline" hidden>編集をキャンセル</Button>
        </div>
      </form>
    </Card>

    <Card class="p-6">
      <h2 class="mb-4 text-lg font-semibold tracking-tight">お知らせ一覧</h2>
      <table class="admin-table">
        <thead>
          <tr><th>タイトル</th><th>対象</th><th>状態</th><th></th></tr>
        </thead>
        <tbody id="announcement-rows"><tr><td colspan="4">読み込み中…</td></tr></tbody>
      </table>
    </Card>

    <p id="message" role="alert" class="text-sm text-muted-foreground"></p>
  </div>

  <script>
    import { supabaseBrowser } from '../lib/supabase-browser';
    import { redirectTo } from '../lib/auth';
    import {
      fetchAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
      type AnnouncementAudience,
    } from '../lib/announcements';
    import { initShellChrome } from '../lib/shell';
    import { initConfirmDialog } from '../lib/confirm-dialog';

    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) {
      redirectTo('/login');
    } else {
      const { role, roleLookupFailed } = await initShellChrome(supabaseBrowser);
      if (roleLookupFailed) {
        document.getElementById('message')!.textContent =
          '権限の確認に失敗しました。ページを再読み込みしてください。';
      } else if (role !== 'admin') {
        // UX のためのリダイレクト。実際の防壁は RLS。
        redirectTo('/dashboard');
      } else {
        const messageEl = document.getElementById('message')!;
        const tbody = document.getElementById('announcement-rows')!;
        const form = document.getElementById('announcement-form') as HTMLFormElement;
        const submitBtn = document.getElementById('ann-submit') as HTMLButtonElement;
        const cancelEditBtn = document.getElementById('ann-cancel-edit') as HTMLButtonElement;
        const formHeading = document.getElementById('form-heading')!;
        const titleEl = document.getElementById('ann-title') as HTMLInputElement;
        const bodyEl = document.getElementById('ann-body') as HTMLTextAreaElement;
        const publishedEl = document.getElementById('ann-published') as HTMLInputElement;
        const audienceEls: Record<AnnouncementAudience, HTMLInputElement> = {
          writer: document.getElementById('ann-audience-writer') as HTMLInputElement,
          provider: document.getElementById('ann-audience-provider') as HTMLInputElement,
          end_user: document.getElementById('ann-audience-end_user') as HTMLInputElement,
        };
        const confirmDialog = initConfirmDialog(
          document.getElementById('confirm-dialog') as HTMLDialogElement,
        );

        let editingId: string | null = null;
        let inFlight = false;

        const resetForm = () => {
          editingId = null;
          form.reset();
          formHeading.textContent = '新しいお知らせを作成';
          submitBtn.textContent = '作成';
          cancelEditBtn.hidden = true;
        };

        const audienceLabel: Record<AnnouncementAudience, string> = {
          writer: 'ライター', provider: '事業者', end_user: 'エンドユーザー',
        };

        const renderRows = async () => {
          const list = await fetchAnnouncements(supabaseBrowser);
          tbody.innerHTML = '';
          if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">お知らせはまだありません。</td></tr>';
            return;
          }
          for (const a of list) {
            const tr = document.createElement('tr');
            const titleTd = document.createElement('td');
            titleTd.textContent = a.title;
            const audiencesTd = document.createElement('td');
            audiencesTd.textContent = a.audiences.map((x) => audienceLabel[x]).join(' / ');
            const statusTd = document.createElement('td');
            statusTd.textContent = a.published ? '公開中' : '下書き';
            const actionsTd = document.createElement('td');

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.textContent = '編集';
            editBtn.addEventListener('click', () => {
              editingId = a.id;
              titleEl.value = a.title;
              bodyEl.value = a.body;
              publishedEl.checked = a.published;
              for (const key of Object.keys(audienceEls) as AnnouncementAudience[]) {
                audienceEls[key].checked = a.audiences.includes(key);
              }
              formHeading.textContent = 'お知らせを編集';
              submitBtn.textContent = '更新';
              cancelEditBtn.hidden = false;
              titleEl.focus();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.textContent = '削除';
            deleteBtn.addEventListener('click', async () => {
              const ok = await confirmDialog.confirm({
                title: 'このお知らせを削除しますか?',
                body: '元に戻せません。',
              });
              if (!ok) return;
              messageEl.textContent = '';
              try {
                await deleteAnnouncement(supabaseBrowser, a.id);
              } catch (err) {
                messageEl.textContent = '削除に失敗しました。';
                console.error(err);
                return;
              }
              if (editingId === a.id) resetForm();
              try {
                await renderRows();
              } catch (err) {
                messageEl.textContent = '一覧の再読み込みに失敗しました。ページを再読み込みしてください。';
                console.error(err);
              }
            });

            actionsTd.appendChild(editBtn);
            actionsTd.appendChild(deleteBtn);
            tr.appendChild(titleTd);
            tr.appendChild(audiencesTd);
            tr.appendChild(statusTd);
            tr.appendChild(actionsTd);
            tbody.appendChild(tr);
          }
        };

        try {
          await renderRows();
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="4">読み込みに失敗しました。</td></tr>';
          console.error(err);
        }

        cancelEditBtn.addEventListener('click', resetForm);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (inFlight) return;
          messageEl.textContent = '';
          const input = {
            title: titleEl.value,
            body: bodyEl.value,
            audiences: (Object.keys(audienceEls) as AnnouncementAudience[]).filter(
              (key) => audienceEls[key].checked,
            ),
            published: publishedEl.checked,
          };
          inFlight = true;
          submitBtn.disabled = true;
          try {
            try {
              if (editingId) {
                await updateAnnouncement(supabaseBrowser, editingId, input);
              } else {
                await createAnnouncement(supabaseBrowser, input);
              }
            } catch (err) {
              messageEl.textContent = err instanceof Error ? err.message : '保存に失敗しました。';
              console.error(err);
              return;
            }
            messageEl.textContent = editingId ? '更新しました。' : '作成しました。';
            resetForm();
            try {
              await renderRows();
            } catch (err) {
              messageEl.textContent += ' 一覧の再読み込みに失敗しました。ページを再読み込みしてください。';
              console.error(err);
            }
          } finally {
            inFlight = false;
            submitBtn.disabled = false;
          }
        });
      }
    }
  </script>
</AdminShell>
```

- [ ] **Step 3: 型チェックを通す**

Run: `cd admin && npx astro check`
Expected: エラーなし(既存のエラーが元々ある場合はこの変更で新規エラーが増えていないことを確認する)

- [ ] **Step 4: コミットする**

```bash
git add admin/src/pages/announcements.astro admin/src/components/templates/AdminShell.astro
git commit -m "feat(admin): add announcements management page"
```

---

### Task 5: CMSサイドバー表示(ライター・事業者向け)

**Files:**
- Modify: `admin/src/components/templates/AdminShell.astro`
- Modify: `admin/src/lib/shell.ts`

**Interfaces:**
- Consumes: Task 2 の `fetchAnnouncements`。Task 3 の `initAnnouncementDialog`(`#announcement-dialog` は `AdminLayout.astro` に既に存在)。
- Produces: `initShellChrome` の副作用として、writer/provider ログイン時に `#announcement-section` が表示され、クリックでダイアログが開く(既存の呼び出し元・戻り値の型は変更しない)。

- [ ] **Step 1: AdminShell.astro にお知らせセクションを追加する**

`admin/src/components/templates/AdminShell.astro` の `</nav>` と `<div class="mt-auto ...">`(ログアウトボタンの外枠)の間に追加:

```astro
      <div id="announcement-section" hidden class="mt-4 flex flex-col gap-1 border-t border-sidebar-border pt-3">
        <p class="px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">お知らせ</p>
        <ul id="announcement-list" class="flex flex-col gap-1"></ul>
      </div>
```

(挿入位置は既存の `</nav>` の直後、`<div class="mt-auto ...">` より前。)

- [ ] **Step 2: shell.ts を拡張する**

`admin/src/lib/shell.ts` を編集:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMyRole, fetchMyProfile, type Role } from './admin';
import { fetchAnnouncements } from './announcements';
import { initAnnouncementDialog } from './announcement-dialog';
import { toAvatarViewModel, applyAvatar } from './avatar';
import { redirectTo } from './auth';

export interface ShellChrome {
  role: Role | null;
  roleLookupFailed: boolean;
}

export async function initShellChrome(supabase: SupabaseClient): Promise<ShellChrome> {
  document.getElementById('logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    redirectTo('/login');
  });

  let role: Role | null = null;
  let roleLookupFailed = false;
  try {
    role = await fetchMyRole(supabase);
    if (role === 'admin') {
      const adminNav = document.getElementById('admin-nav');
      if (adminNav) adminNav.hidden = false;
    }
  } catch (err) {
    roleLookupFailed = true;
    console.error(err);
  }

  try {
    const profile = await fetchMyProfile(supabase);
    if (profile) {
      const vm = toAvatarViewModel(profile.name, profile.avatarUrl);
      const avatarEl = document.getElementById('profile-nav-avatar');
      if (avatarEl) applyAvatar(avatarEl, vm);
      const nameEl = document.getElementById('profile-nav-name');
      if (nameEl) nameEl.textContent = profile.name;
      const navEl = document.getElementById('profile-nav');
      if (navEl) navEl.hidden = false;

      if (role === 'provider' && profile.certified) {
        const badgeEl = document.getElementById('certified-badge');
        if (badgeEl) badgeEl.hidden = false;
        const serviceNavEl = document.getElementById('nav-profile-service');
        if (serviceNavEl) serviceNavEl.hidden = false;
      }
      if (role === 'writer') {
        const pricingNavEl = document.getElementById('nav-profile-pricing');
        if (pricingNavEl) pricingNavEl.hidden = false;
      }
    }
  } catch (err) {
    console.error(err);
  }

  // ライター/事業者向けのお知らせ一覧。RLSが自分向け・公開済みのみ返す。
  if (role === 'writer' || role === 'provider') {
    try {
      const announcements = await fetchAnnouncements(supabase, { limit: 5 });
      if (announcements.length > 0) {
        const sectionEl = document.getElementById('announcement-section');
        const listEl = document.getElementById('announcement-list');
        const dialogEl = document.getElementById('announcement-dialog') as HTMLDialogElement | null;
        if (sectionEl && listEl && dialogEl) {
          const dialog = initAnnouncementDialog(dialogEl);
          for (const a of announcements) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
              'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
            btn.textContent = a.title;
            btn.addEventListener('click', () => dialog.show(a.title, a.body));
            li.appendChild(btn);
            listEl.appendChild(li);
          }
          sectionEl.hidden = false;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  return { role, roleLookupFailed };
}
```

- [ ] **Step 2: 既存の admin テストを実行して壊れていないことを確認する**

Run: `cd admin && npm test`
Expected: 既存の全テスト(`admin.test.ts` 等)が引き続き PASS(shell.ts 自体には既存の単体テストが無いため、ここでは他ファイルの回帰が無いことだけを確認する)。

- [ ] **Step 3: コミットする**

```bash
git add admin/src/components/templates/AdminShell.astro admin/src/lib/shell.ts
git commit -m "feat(admin): show audience-scoped announcements in CMS sidebar"
```

---

### Task 6: 公開サイト側データ関数(src/lib/announcements.ts)

**Files:**
- Create: `src/lib/announcements.ts`
- Test: `tests/announcements.test.ts`

**Interfaces:**
- Consumes: Task 1 の anon 向け RLS ポリシー。既存の `src/lib/supabase-browser.ts`(`supabaseBrowser` エクスポート)。
- Produces: `interface EndUserAnnouncement { id, title, body }`、`fetchLatestEndUserAnnouncement(supabase): Promise<EndUserAnnouncement | null>`、`shouldShowAnnouncement(id, dismissedId): boolean`、`getDismissedAnnouncementId(): string | null`、`setDismissedAnnouncementId(id): void`。Task 7(バナー)がこれらを import する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/announcements.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchLatestEndUserAnnouncement, shouldShowAnnouncement,
} from '../src/lib/announcements';

describe('shouldShowAnnouncement', () => {
  it('未表示(dismissedIdがnull)なら表示する', () => {
    expect(shouldShowAnnouncement('abc', null)).toBe(true);
  });

  it('同じIDを閉じていれば表示しない', () => {
    expect(shouldShowAnnouncement('abc', 'abc')).toBe(false);
  });

  it('別のIDを閉じていた場合は表示する(新しいお知らせ)', () => {
    expect(shouldShowAnnouncement('new-id', 'old-id')).toBe(true);
  });
});

describe('fetchLatestEndUserAnnouncement (RLS)', () => {
  const serviceClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const anonClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const ids = {
    publishedEndUser: '00000000-0000-0000-0000-0000000000a1',
    unpublishedEndUser: '00000000-0000-0000-0000-0000000000a2',
    publishedWriterOnly: '00000000-0000-0000-0000-0000000000a3',
  };

  beforeAll(async () => {
    const { error } = await serviceClient.from('announcements').insert([
      { id: ids.publishedEndUser, title: '公開バナー', body: '本文e',
        audiences: ['end_user'], published: true },
      { id: ids.unpublishedEndUser, title: '下書きバナー', body: '本文d',
        audiences: ['end_user'], published: false },
      { id: ids.publishedWriterOnly, title: 'ライター向け', body: '本文w',
        audiences: ['writer'], published: true },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    await serviceClient.from('announcements').delete().in('id', Object.values(ids));
  });

  it('anon には公開済み・end_user向けの最新1件だけが見える', async () => {
    const result = await fetchLatestEndUserAnnouncement(anonClient);
    expect(result).toEqual({
      id: ids.publishedEndUser, title: '公開バナー', body: '本文e',
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run tests/announcements.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/announcements'`)

- [ ] **Step 3: 実装を書く**

`src/lib/announcements.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EndUserAnnouncement {
  id: string;
  title: string;
  body: string;
}

// end_user向けに公開中の最新1件だけを取得する。anon key + RLS
// (published=true and 'end_user' = ANY(audiences) の行のみ anon から見える)。
export async function fetchLatestEndUserAnnouncement(
  supabase: SupabaseClient,
): Promise<EndUserAnnouncement | null> {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const DISMISSED_KEY = 'wm-dismissed-announcement-id';

// 一度 × で閉じたお知らせは、別のお知らせ(別ID)が出るまで再表示しない。
export function shouldShowAnnouncement(id: string, dismissedId: string | null): boolean {
  return id !== dismissedId;
}

export function getDismissedAnnouncementId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function setDismissedAnnouncementId(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // プライベートモード等でlocalStorageが使えなくても致命的ではないので握りつぶす
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `npx vitest run tests/announcements.test.ts`
Expected: PASS(前提: `supabase start` 済み・Task 1 のマイグレーション適用済み・ルート `.env` に `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` 設定済み)

- [ ] **Step 5: コミットする**

```bash
git add src/lib/announcements.ts tests/announcements.test.ts
git commit -m "feat(site): add end-user announcement fetch + dismissal logic"
```

---

### Task 7: 公開サイトのバナー・ポップアップ

**Files:**
- Modify: `src/components/organisms/NavDrawer.astro`
- Create: `src/components/organisms/AnnouncementModal.astro`
- Create: `src/scripts/announcement-banner.ts`
- Modify: `src/layouts/Base.astro`

**Interfaces:**
- Consumes: Task 6 の `fetchLatestEndUserAnnouncement`/`shouldShowAnnouncement`/`getDismissedAnnouncementId`/`setDismissedAnnouncementId`。既存の `src/lib/supabase-browser.ts`(`supabaseBrowser`)、`src/scripts/scroll-lock.ts`(`lockPageScroll`/`unlockPageScroll`)。
- Produces: NavDrawer 内のバナーDOM(`#announcement-banner` 等)と `AnnouncementModal.astro` のポップアップ(`#announcement-modal`)。

- [ ] **Step 1: NavDrawer.astro にバナーのマークアップを追加する**

`src/components/organisms/NavDrawer.astro` の `.nav-drawer-body` 内、`<MetaLabel class="area-heading-en">` の直前に追加:

```astro
      <div id="announcement-banner" class="announcement-banner" hidden data-lenis-prevent>
        <button type="button" id="announcement-banner-open" class="announcement-banner-open">
          <span id="announcement-banner-title" class="announcement-banner-title"></span>
        </button>
        <button
          type="button"
          id="announcement-banner-dismiss"
          class="announcement-banner-dismiss"
          aria-label="お知らせを閉じる"
        >
          ×
        </button>
      </div>
```

同じファイルの `<script>` タグに import を追加:

```astro
<script>
  import '../../scripts/nav-drawer';
  import '../../scripts/area-sheet';
  import '../../scripts/announcement-banner';
</script>
```

同じファイルの `<style>` ブロックに追加(既存の `.nav-drawer-body` 関連スタイルの近くに置く):

```css
  .announcement-banner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.9rem;
    padding: 0.5rem 0.6rem;
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }

  .announcement-banner-open {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-bg);
  }

  .announcement-banner-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }

  .announcement-banner-dismiss {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--color-meta);
    font-size: 14px;
    line-height: 1;
  }

  html.drawer-closed .announcement-banner {
    display: none;
  }
```

- [ ] **Step 2: ポップアップ用の organism を書く**

`src/components/organisms/AnnouncementModal.astro`:

```astro
---
import MetaLabel from '../atoms/MetaLabel.astro';
---
<dialog id="announcement-modal" class="announcement-modal" aria-label="お知らせ" data-lenis-prevent>
  <form method="dialog" class="close-row">
    <button type="submit" aria-label="閉じる"><MetaLabel>Close ×</MetaLabel></button>
  </form>
  <h2 id="announcement-modal-title" class="announcement-modal-title"></h2>
  <p id="announcement-modal-body" class="announcement-modal-body"></p>
</dialog>

<style>
  .announcement-modal {
    position: relative;
    width: min(28rem, calc(100vw - 3rem));
    max-height: calc(100dvh - 4rem);
    margin: auto;
    padding: 1.5rem;
    border: none;
    border-radius: 20px;
    background-color: var(--color-bg);
    color: var(--color-ink);
  }

  .announcement-modal[open] {
    display: flex;
    flex-direction: column;
  }

  .close-row {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
  }

  .announcement-modal::backdrop {
    background-color: rgba(53, 48, 31, 0.4);
  }

  .announcement-modal-title {
    margin-top: 0.5rem;
    font-family: var(--font-heading);
    font-size: 20px;
    flex-shrink: 0;
  }

  .announcement-modal-body {
    margin-top: 1rem;
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 0;
  }
</style>
```

- [ ] **Step 3: バナー・ポップアップの配線スクリプトを書く**

`src/scripts/announcement-banner.ts`:

```ts
// サイドバーのお知らせバナー。公開中の end_user 向けお知らせを1件取得して表示し、
// クリックでポップアップに全文を表示する。× で閉じたら同じお知らせは再表示しない。
import { supabaseBrowser } from '../lib/supabase-browser';
import { lockPageScroll, unlockPageScroll } from './scroll-lock';
import {
  fetchLatestEndUserAnnouncement, shouldShowAnnouncement,
  getDismissedAnnouncementId, setDismissedAnnouncementId,
} from '../lib/announcements';

const banner = document.getElementById('announcement-banner');
const openBtn = document.getElementById('announcement-banner-open');
const dismissBtn = document.getElementById('announcement-banner-dismiss');
const titleEl = document.getElementById('announcement-banner-title');
const modal = document.getElementById('announcement-modal') as HTMLDialogElement | null;
const modalTitleEl = document.getElementById('announcement-modal-title');
const modalBodyEl = document.getElementById('announcement-modal-body');

if (banner && openBtn && dismissBtn && titleEl && modal && modalTitleEl && modalBodyEl) {
  (async () => {
    try {
      const announcement = await fetchLatestEndUserAnnouncement(supabaseBrowser);
      if (!announcement) return;
      if (!shouldShowAnnouncement(announcement.id, getDismissedAnnouncementId())) return;

      titleEl.textContent = announcement.title;
      banner.hidden = false;

      openBtn.addEventListener('click', () => {
        modalTitleEl.textContent = announcement.title;
        modalBodyEl.textContent = announcement.body;
        lockPageScroll();
        modal.showModal();
      });

      dismissBtn.addEventListener('click', () => {
        setDismissedAnnouncementId(announcement.id);
        banner.hidden = true;
      });
    } catch (err) {
      console.error(err);
    }
  })();

  new MutationObserver(() => {
    if (!modal.open) unlockPageScroll();
  }).observe(modal, { attributes: true, attributeFilter: ['open'] });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.close();
    }
  });
}
```

- [ ] **Step 4: Base.astro に組み込む**

`src/layouts/Base.astro` を編集。既存の `import SearchModal from '../components/organisms/SearchModal.astro';` の直後に追加:

```astro
import AnnouncementModal from '../components/organisms/AnnouncementModal.astro';
```

既存の `<SearchModal />` の直後に追加:

```astro
    <AnnouncementModal />
```

- [ ] **Step 5: 型チェックを通す**

Run: `npx astro check`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add src/components/organisms/NavDrawer.astro src/components/organisms/AnnouncementModal.astro src/scripts/announcement-banner.ts src/layouts/Base.astro
git commit -m "feat(site): show dismissible end-user announcement banner in sidebar"
```

---

### Task 8: 手動確認(3つの画面を実際に動かして確認)

**Files:** なし(検証のみ)

**Interfaces:**
- Consumes: Task 1〜7 の全成果物。

- [ ] **Step 1: 開発環境を起動する**

Run: `supabase start && npm run dev:all`(既に起動していれば流用してよい。並列開発中は「先着1エージェントのみ起動」ルールに従う)

- [ ] **Step 2: アドミンとして `/announcements` を確認する**

`admin@seed.local` / `seed-pass-1234` でログインし、`http://localhost:4322/announcements` を開く。
確認項目:
- 「ライター」対象・公開ONで作成 → 一覧に「公開中」で表示される
- 「編集」→ 内容が読み込まれフォームが「更新」ボタンになる → 対象を「事業者」に変えて更新 → 一覧に反映される
- 「削除」→ 確認ダイアログが出る → 確定すると一覧から消える

- [ ] **Step 3: ライター/事業者としてCMSサイドバーを確認する**

「ライター」対象・公開ONのお知らせを作成した状態で `hana@seed.local` でログインし、サイドバーに「お知らせ」欄とタイトルが出ることを確認。クリックしてポップアップに本文が表示されることを確認。
`forest@seed.local`(事業者)でログインし、ライター向けのお知らせは出ず、事業者向けのお知らせだけ出ることを確認。

- [ ] **Step 4: 公開サイトのバナーを確認する**

`admin@seed.local` で「エンドユーザー」対象・公開ONのお知らせを作成し、`http://localhost:4321/` を開いてサイドバーにバナーが出ることを確認。クリックしてポップアップに本文が表示されること、× で閉じると再読み込みしても再表示されないこと(同じお知らせの間)を確認。

- [ ] **Step 5: 作業完了後の後片付け**

`AGENTS-ACTIVE.local.md` から自分の `## announcements` ブロックを削除する(git管理外のファイルなのでコミット不要)。
