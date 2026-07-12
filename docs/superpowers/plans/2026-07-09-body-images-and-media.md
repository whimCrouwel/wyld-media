# 本文画像・スラッシュメニュー・メディアライブラリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ライターが本文に画像を入れられるようにする。markdown を手打ちさせない(`/` でメニュー)、一度アップロードした画像は再利用できる(メディアライブラリ)。

**Architecture:** 保存形式は markdown のまま(公開サイトの `marked` + `sanitize-html` パイプラインをそのまま使う)。textarea で `/` を打つとコマンドメニューが開き、選ぶと markdown が差し込まれる。アップロードした画像は `media` テーブルに記録し、モーダルの一覧から再利用・削除できる。「本文の画像は5枚まで」「画像は許可ホストのものだけ」「使用中の画像は削除できない」というルールはすべて DB 層(トリガー)で強制する。R2 オブジェクトの削除にはブラウザから直接触れないため、Edge Function `r2-delete-object` を1本追加する。

**Tech Stack:** Postgres(トリガー + RLS + pgTAP)、Supabase Edge Functions(Deno + aws4fetch)、Astro + TypeScript、Vitest、marked + sanitize-html、Canvas API、Cloudflare R2

## Global Constraints

CLAUDE.md より(逐語):

- **権限・ビジネスルールは DB 層(RLS・トリガー)で強制する。** CMS はブラウザから anon key で Supabase に直結しており、クライアント側のチェックはUX目的でしかない。新ルールはまずマイグレーション+pgTAP テストで書く。
- **service role key を `admin/` に入れない。** 公開サイトのビルド時(`src/lib/supabase-server.ts`)専用。
- ホスティングは **Vercel**(Cloudflare Pages ではない)。画像ストレージは Cloudflare R2。
- `docs/superpowers/specs/`・`docs/superpowers/plans/` は過去の意思決定・作業の記録なので書き換えない。

この計画に固有の制約:

- 本文の保存形式は **markdown**(`articles.body text`)。HTML には変えない。
- 本文画像の上限は **5枚/記事**。定数は DB 側(`enforce_body_image_rules` の `max_images`)とクライアント側(`MAX_BODY_IMAGES`)の両方に置き、コメントで相互参照する。**権威は DB 側**。
- アップロードは **512,000 バイト以内**、長辺 **1600px 以内**、**image/webp**。既存の `MAX_UPLOAD_BYTES` / `MAX_EDGE` / `ENCODE_ATTEMPTS` を再利用し、値を複製しない。
- 本文に生の `<img>` タグを書くことは **禁止**(DB で例外)。画像は markdown の `![alt](url)` 記法のみ。この制約があるおかげでトリガーは HTML をパースせずに済む。
- 許可ホストは `settings.image_base_url`。既定は **空文字**で、空のときは画像を一切通さない(**fail closed**)。
- 例外メッセージ(逐語): `IMAGE_LIMIT_EXCEEDED` / `IMAGE_HOST_NOT_ALLOWED` / `HTML_IMG_NOT_ALLOWED` / `MEDIA_OWNER_MISMATCH` / `MEDIA_IN_USE`
- 既存の `uploadCover` は本文画像でも使うため **`uploadImage` に改名**する(呼び出し元とテストも追随)。
- ⚠️ **Vitest はテストファイルを並列に実行する。** 新しいテストは `settings` と `articles` を書き換えてはならない(`articles.test.ts` が同時に走り、両方に依存している)。`media.test.ts` は `settings` を **読むだけ** にし、自分が作った `media` 行だけを消すこと。
- コマンド: `supabase db reset` / `supabase test db` / `npm test`(ルート)/ `cd admin && npm test` / `supabase functions serve --env-file supabase/functions/.env`

## File Structure

| ファイル | 責務 |
|---|---|
| `supabase/migrations/20260709120000_body_image_rules.sql`(新規) | `settings.image_base_url` + `articles` の本文画像トリガー |
| `supabase/migrations/20260709120500_media_library.sql`(新規) | `media` テーブル + RLS + URL/所有者/使用中チェックのトリガー |
| `supabase/tests/database/07_body_image_rules.test.sql`(新規) | 本文画像ルールの pgTAP |
| `supabase/tests/database/08_media_library.test.sql`(新規) | media の RLS とトリガーの pgTAP |
| `supabase/functions/r2-delete-object/index.ts`(新規) | R2 のオブジェクト削除(呼び出し元の uid 配下のキーのみ) |
| `admin/src/lib/images.ts`(変更) | `uploadImage` へ改名、`MAX_BODY_IMAGES` / `countBodyImages` / `insertAtCursor` / `fetchImageBaseUrl` を追加 |
| `admin/src/lib/media.ts`(新規) | `media` のデータ層(一覧・記録・削除)とエラー翻訳 |
| `admin/src/lib/body-image.ts`(新規) | ファイル → 縮小 → WebP → PUT → `media` に記録 |
| `admin/src/lib/slash-menu.ts`(新規) | textarea の `/` コマンドメニュー |
| `admin/src/lib/media-picker.ts`(新規) | メディア一覧モーダル(再利用・削除) |
| `admin/src/lib/cover-widget.ts`(変更) | `uploadImage` への追随 + アップロード後に `media` へ記録 |
| `admin/src/lib/editor-helpers.ts`(変更) | `renderMarkdownPreview(md, imageBaseUrl)` + 新エラーの日本語化 |
| `admin/src/pages/articles/new.astro` / `edit.astro`(変更) | markup と配線 |
| `src/lib/content.ts`(変更) | `renderMarkdown(md, imageBaseUrl)` + `fetchImageBaseUrl` |
| `scripts/seed.mjs`・`.env.example`・`supabase/functions/.env.example`(変更) | `PUBLIC_IMAGE_BASE_URL` |
| `README.md`・`docs/superpowers/DEPLOYMENT-CHECKLIST.md`・`ARCHITECTURE.md`(変更) | 手順とルール |

---

### Task 1: 本文画像ルールを DB 層で強制する

**Files:**
- Create: `supabase/migrations/20260709120000_body_image_rules.sql`
- Create: `supabase/tests/database/07_body_image_rules.test.sql`

**Interfaces:**
- Consumes: 既存 `public.settings`(id=1 の単一行)、`public.articles(body text not null default '')`
- Produces: `settings.image_base_url text not null default ''`、トリガー `a_enforce_body_image_rules`、例外 `HTML_IMG_NOT_ALLOWED` / `IMAGE_LIMIT_EXCEEDED` / `IMAGE_HOST_NOT_ALLOWED`(すべて sqlstate `P0001`)

- [ ] **Step 1: 失敗する pgTAP テストを書く**

`supabase/tests/database/07_body_image_rules.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_column('public', 'settings', 'image_base_url', 'settings has image_base_url');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'body-image-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b1', 'writer', 'body-image-writer', 'BW');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'five', 'five-images',
      '![](https://img.test/a.webp) ![](https://img.test/b.webp) ![](https://img.test/c.webp) ![](https://img.test/d.webp) ![](https://img.test/e.webp)',
      'draft')$$,
  'five body images are allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'six', 'six-images',
      '![](https://img.test/a.webp) ![](https://img.test/b.webp) ![](https://img.test/c.webp) ![](https://img.test/d.webp) ![](https://img.test/e.webp) ![](https://img.test/f.webp)',
      'draft')$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'six body images are rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'foreign', 'foreign-host',
      '![](https://evil.example/x.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'foreign image host is rejected'
);

-- https://img.test が https://img.test.evil.example に前方一致する抜け道
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'prefix', 'prefix-attack',
      '![](https://img.test.evil.example/x.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'prefix-matching host is rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'html', 'html-img',
      '<img src="https://img.test/a.webp">', 'draft')$$,
  'P0001', 'HTML_IMG_NOT_ALLOWED', 'raw <img> tag is rejected'
);

update settings set image_base_url = '' where id = 1;
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'unset', 'unset-base',
      '![](https://img.test/a.webp)', 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'empty image_base_url rejects all images'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `supabase db reset && supabase test db`

Expected: FAIL。`07_body_image_rules.test.sql` が `column "image_base_url" does not exist` で落ちる。既存6ファイルは PASS。

- [ ] **Step 3: マイグレーションを書く**

`supabase/migrations/20260709120000_body_image_rules.sql`:

```sql
-- 本文画像のルールを DB 層で強制する。
--   1. 本文に生の <img> タグを書けない(markdown の ![alt](url) 記法のみ)
--   2. 本文の画像は 5 枚まで
--   3. 画像は settings.image_base_url 配下のものだけ
--
-- image_base_url の既定は空文字。設定しない限り本文に画像を置けない(fail closed)。
-- この値は Edge Function の R2_PUBLIC_BASE_URL と一致させること。ずれると
-- アップロードは成功するのに保存が IMAGE_HOST_NOT_ALLOWED で落ちる。

alter table public.settings
  add column image_base_url text not null default '';

create or replace function public.enforce_body_image_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- admin/src/lib/images.ts の MAX_BODY_IMAGES と一致させること。権威はこちら。
  max_images constant int := 5;
  base text;
  urls text[];
  u text;
begin
  -- ルール1。これがあるおかげで markdown 記法だけを数えればよく、
  -- トリガーで HTML をパースせずに済む。
  if new.body ~* '<img' then
    raise exception 'HTML_IMG_NOT_ALLOWED';
  end if;

  select image_base_url into base from settings where id = 1;

  select array_agg(m[1]) into urls
    from regexp_matches(new.body, '!\[[^\]]*\]\(\s*([^)\s]+)', 'g') as m;

  if urls is null then
    return new;
  end if;

  -- ルール2
  if array_length(urls, 1) > max_images then
    raise exception 'IMAGE_LIMIT_EXCEEDED';
  end if;

  -- ルール3。base が空なら必ず落ちる(fail closed)。
  -- base || '/' で比較するのは、https://img.test が
  -- https://img.test.evil.example に前方一致するのを防ぐため。
  foreach u in array urls loop
    if base = '' or left(u, length(base) + 1) <> base || '/' then
      raise exception 'IMAGE_HOST_NOT_ALLOWED';
    end if;
  end loop;

  return new;
end;
$$;

create trigger a_enforce_body_image_rules
  before insert or update on public.articles
  for each row execute function public.enforce_body_image_rules();
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `supabase db reset && supabase test db`

Expected: PASS。7ファイルすべて green。

- [ ] **Step 5: 既存のテストが壊れていないことを確認する**

Run: `npm test && cd admin && npm test && cd ..`

Expected: PASS(ルート11、CMS 64)。シード記事は本文に画像を持たないので新トリガーに触れない。

- [ ] **Step 6: コミット**

```bash
git add supabase/migrations/20260709120000_body_image_rules.sql supabase/tests/database/07_body_image_rules.test.sql
git commit -m "feat: enforce body-image rules in the DB layer"
```

---

### Task 2: media テーブルを作る

**Files:**
- Create: `supabase/migrations/20260709120500_media_library.sql`
- Create: `supabase/tests/database/08_media_library.test.sql`

**Interfaces:**
- Consumes: `settings.image_base_url`(Task 1)、`public.is_admin()`(既存)
- Produces: テーブル `public.media(id uuid, owner_id uuid, url text unique, bytes int, created_at timestamptz)`、トリガー `a_enforce_media_url`(insert)/ `a_block_media_in_use`(delete)、例外 `IMAGE_HOST_NOT_ALLOWED` / `MEDIA_OWNER_MISMATCH` / `MEDIA_IN_USE`

なぜ「使用中の画像を削除できない」ルールを DB に置くのか: 削除は R2 のオブジェクト削除を伴い取り消せない。参照している記事があれば画像が 404 になる。クライアントで防いでも、PostgREST を直接叩けば通ってしまう。

`url` を `unique` にするのは、同じオブジェクトが二重に記録されるのを防ぐため。

- [ ] **Step 1: 失敗する pgTAP テストを書く**

`supabase/tests/database/08_media_library.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public', 'media', 'media table exists');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'media-writer1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'media-writer2@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'writer', 'media-writer-one', 'M1'),
  ('00000000-0000-0000-0000-0000000000c2', 'writer', 'media-writer-two', 'M2');

-- writer1 として振る舞う
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp', 1234)$$,
  'writer1 can record own media'
);

select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://evil.example/00000000-0000-0000-0000-0000000000c1/b.webp', 10)$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'media url must live under image_base_url'
);

-- 他人の uid 配下のキーは記録できない(自分の owner_id では所有者不一致になる)
select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c1',
            'https://img.test/00000000-0000-0000-0000-0000000000c2/c.webp', 10)$$,
  'P0001', 'MEDIA_OWNER_MISMATCH', 'media key prefix must be the owner uid'
);

-- 他人になりすまして insert はできない(RLS)
select throws_ok(
  $$insert into media (owner_id, url, bytes)
    values ('00000000-0000-0000-0000-0000000000c2',
            'https://img.test/00000000-0000-0000-0000-0000000000c2/d.webp', 10)$$,
  '42501', null, 'writer1 cannot record media as writer2'
);

-- 未使用なら削除できる
select lives_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp'$$,
  'unused media can be deleted'
);

-- 本文から参照されている画像は削除できない
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp', 10);
insert into articles (author_id, title, body)
values ('00000000-0000-0000-0000-0000000000c1', 'uses image',
        '![](https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp)');

select throws_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/used.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'media referenced by an article body cannot be deleted'
);

-- カバー画像として参照されている画像も削除できない
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp', 10);
insert into articles (author_id, title, cover_image_url)
values ('00000000-0000-0000-0000-0000000000c1', 'uses cover',
        'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp');

select throws_ok(
  $$delete from media
     where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/cover.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'media used as a cover image cannot be deleted'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `supabase db reset && supabase test db`

Expected: FAIL。`08_media_library.test.sql` が `relation "media" does not exist` で落ちる。

- [ ] **Step 3: マイグレーションを書く**

`supabase/migrations/20260709120500_media_library.sql`:

```sql
-- アップロード済み画像の記録。メディアライブラリの一覧・再利用・削除の土台。
-- R2 のオブジェクトそのものはここにはない(URL だけを持つ)。

create table public.media (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  url text not null unique,
  bytes int not null check (bytes > 0),
  created_at timestamptz not null default now()
);

create index media_owner_created_idx on public.media (owner_id, created_at desc);

alter table public.media enable row level security;
grant select, insert, delete on public.media to authenticated;

create policy "select own media or admin all"
  on public.media for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy "insert own media"
  on public.media for insert to authenticated
  with check (owner_id = auth.uid());
create policy "delete own media or admin all"
  on public.media for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- URL は許可ホスト配下でなければならず、キーの先頭は所有者の uid でなければ
-- ならない(r2-upload-url が uid/uuid.ext の形で発行する)。
-- これを欠くと、PostgREST を直接叩いて他人のオブジェクトを自分のライブラリに
-- 登録し、後述の削除経路で消せてしまう。
create or replace function public.enforce_media_url()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  base text;
begin
  select image_base_url into base from settings where id = 1;

  if base = '' or left(new.url, length(base) + 1) <> base || '/' then
    raise exception 'IMAGE_HOST_NOT_ALLOWED';
  end if;

  if left(new.url, length(base) + 1 + 36) <> base || '/' || new.owner_id::text then
    raise exception 'MEDIA_OWNER_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger a_enforce_media_url
  before insert on public.media
  for each row execute function public.enforce_media_url();

-- 使用中の画像は消せない。削除は R2 のオブジェクト削除を伴い取り消せないため、
-- 参照が残っていると記事の画像が 404 になる。
create or replace function public.block_media_in_use()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from articles
     where cover_image_url = old.url
        or position(old.url in body) > 0
  ) then
    raise exception 'MEDIA_IN_USE';
  end if;
  return old;
end;
$$;

create trigger a_block_media_in_use
  before delete on public.media
  for each row execute function public.block_media_in_use();
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `supabase db reset && supabase test db`

Expected: PASS。8ファイルすべて green。

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20260709120500_media_library.sql supabase/tests/database/08_media_library.test.sql
git commit -m "feat: media table with owner, host, and in-use guards"
```

---

### Task 3: R2 オブジェクト削除の Edge Function

**Files:**
- Create: `supabase/functions/r2-delete-object/index.ts`

**Interfaces:**
- Consumes: 環境変数 `R2_ENDPOINT` / `R2_REGION` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_PUBLIC_BASE_URL`、`supabase/functions/_shared/cors.ts`
- Produces: `POST /functions/v1/r2-delete-object` body `{ url: string }` → `200 {ok:true}` / `400` / `401` / `403`

ブラウザは R2 の削除権限を持てない(署名付き URL を出すと誰でも消せる)。サーバ側で **呼び出し元の uid 配下のキーだけ**を消す。

- [ ] **Step 1: Edge Function を書く**

`supabase/functions/r2-delete-object/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';
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
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData } = await admin.auth.getUser(jwt);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { url?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const publicBase = (Deno.env.get('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
  const url = payload.url ?? '';
  if (!publicBase || !url.startsWith(`${publicBase}/`)) {
    return json({ error: 'url must live under R2_PUBLIC_BASE_URL' }, 400);
  }

  const key = url.slice(publicBase.length + 1);
  // 自分の uid 配下のオブジェクトしか消せない。
  // r2-upload-url が発行するキーは `${uid}/${uuid}.${ext}`。
  if (!key.startsWith(`${userData.user.id}/`)) {
    return json({ error: 'forbidden' }, 403);
  }

  const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '');
  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  });

  const res = await r2.fetch(`${endpoint}/${Deno.env.get('R2_BUCKET')}/${key}`, {
    method: 'DELETE',
  });
  // S3 の DELETE は存在しないキーでも 204 を返す(冪等)。
  if (!res.ok && res.status !== 404) {
    return json({ error: `delete failed: ${res.status}` }, 502);
  }

  return json({ ok: true });
});
```

- [ ] **Step 2: 手で動作を確認する**

```bash
supabase functions serve --env-file supabase/functions/.env &
ANON=$(supabase status -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['ANON_KEY'])")
JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"hana@seed.local","password":"seed-pass-1234"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
```

未認証: `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/r2-delete-object -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"url":"x"}'`
Expected: `401`

他人の uid 配下(`$R2_PUBLIC_BASE_URL/00000000-0000-0000-0000-000000000000/x.webp`)を指定:
Expected: `403`

許可ホスト外の URL(`https://evil.example/x.webp`)を指定:
Expected: `400`

自分の uid 配下の存在しないキー:
Expected: `200 {"ok":true}`(S3 の DELETE は冪等)

実際にアップロードしたオブジェクトを指定 → `200`、その後の公開 GET が `404` になること。

- [ ] **Step 3: コミット**

```bash
git add supabase/functions/r2-delete-object/index.ts
git commit -m "feat: r2-delete-object edge function scoped to the caller's uid"
```

---

### Task 4: images.ts のヘルパと uploadImage への改名

**Files:**
- Modify: `admin/src/lib/images.ts`
- Modify: `admin/src/lib/cover-widget.ts`(import と呼び出しのみ)
- Modify: `admin/tests/images-upload.test.ts`(`uploadCover` → `uploadImage`)
- Modify: `admin/tests/images.test.ts`(追記)

**Interfaces:**
- Consumes: 既存 `MAX_UPLOAD_BYTES` / `MAX_EDGE` / `ENCODE_ATTEMPTS` / `encodeUnderLimit` / `scaledSize` / `requestUploadUrl` / `translateUploadError`
- Produces:
  - `export const MAX_BODY_IMAGES = 5`
  - `export function countBodyImages(markdown: string): number`
  - `export function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void`
  - `export async function uploadImage(supabase: SupabaseClient, blob: Blob, fetchFn?: typeof fetch): Promise<string>`(旧 `uploadCover`、挙動は同一)
  - `export async function fetchImageBaseUrl(supabase: SupabaseClient): Promise<string>`

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/images.test.ts` の末尾に追記(import 行はファイル先頭の既存 import にまとめる):

```ts
import {
  MAX_BODY_IMAGES, countBodyImages, insertAtCursor, fetchImageBaseUrl,
} from '../src/lib/images';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('countBodyImages', () => {
  it('markdown 画像記法の数を数える', () => {
    expect(countBodyImages('![a](x) text ![](y)')).toBe(2);
  });

  it('画像がなければ 0', () => {
    expect(countBodyImages('# 見出し\n\nただの本文')).toBe(0);
  });

  it('リンク記法は画像として数えない', () => {
    expect(countBodyImages('[リンク](https://example.com)')).toBe(0);
  });

  it('DB 側の上限と同じ 5 を公開している', () => {
    expect(MAX_BODY_IMAGES).toBe(5);
  });
});

describe('insertAtCursor', () => {
  it('カーソル位置に差し込む', () => {
    const ta = document.createElement('textarea');
    ta.value = 'ab';
    ta.selectionStart = 1;
    ta.selectionEnd = 1;
    insertAtCursor(ta, 'X');
    expect(ta.value).toBe('aXb');
    expect(ta.selectionStart).toBe(2);
  });

  it('選択されたテキストを置き換える', () => {
    const ta = document.createElement('textarea');
    ta.value = 'abc';
    ta.selectionStart = 1;
    ta.selectionEnd = 2;
    insertAtCursor(ta, 'ZZ');
    expect(ta.value).toBe('aZZc');
  });
});

describe('fetchImageBaseUrl', () => {
  it('settings.image_base_url を返す', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { image_base_url: 'https://img.test' }, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await fetchImageBaseUrl(supabase)).toBe('https://img.test');
  });

  it('エラーなら throw する', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: null, error: new Error('denied') }) }),
        }),
      }),
    } as unknown as SupabaseClient;
    await expect(fetchImageBaseUrl(supabase)).rejects.toThrow('denied');
  });
});
```

`admin/tests/images-upload.test.ts` の `uploadCover` を `uploadImage` に置換する(import 行、`describe` 名、本文中の呼び出し2か所)。

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `cd admin && npx vitest run tests/images.test.ts tests/images-upload.test.ts`

Expected: FAIL。`countBodyImages is not a function` / `uploadImage` が export されていない。

- [ ] **Step 3: images.ts を実装する**

`admin/src/lib/images.ts` の `uploadCover` を次で置き換え、ヘルパを追加する:

```ts
// 本文画像の上限。supabase の enforce_body_image_rules の max_images と一致させること。
// 権威は DB 側。ここでの判定は UX(ボタンを止める)目的でしかない。
export const MAX_BODY_IMAGES = 5;

// カバー画像・本文画像の両方で使う。
export async function uploadImage(
  supabase: SupabaseClient, blob: Blob, fetchFn: typeof fetch = fetch,
): Promise<string> {
  const ticket = await requestUploadUrl(supabase, blob);
  const res = await fetchFn(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: blob,
  });
  if (!res.ok) throw new Error(`UPLOAD_FAILED: ${res.status}`);
  return ticket.publicUrl;
}

// markdown の画像記法 ![alt](url) の数。DB 側の regexp と同じ形。
// リンク記法 [text](url) は先頭の ! がないので数えない。
export function countBodyImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*\]\(\s*[^)\s]+/g) ?? []).length;
}

export function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const caret = start + text.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

// 許可ホスト。settings は authenticated なら誰でも select できる(RLS)。
export async function fetchImageBaseUrl(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('settings')
    .select('image_base_url')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { image_base_url: string }).image_base_url;
}
```

`admin/src/lib/cover-widget.ts` の import を `uploadImage` に変え、呼び出し1か所を `uploadImage(` にする。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd admin && npm test && npm run build`

Expected: PASS(64 → 72 tests)、9 pages built。

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/images.ts admin/src/lib/cover-widget.ts admin/tests/images.test.ts admin/tests/images-upload.test.ts
git commit -m "feat: body-image helpers, rename uploadCover to uploadImage"
```

---

### Task 5: media のデータ層

**Files:**
- Create: `admin/src/lib/media.ts`
- Create: `admin/tests/media.test.ts`

**Interfaces:**
- Consumes: `supabaseBrowser`(`admin/src/lib/supabase-browser.ts`)
- Produces:
  - `export interface MediaItem { id: string; url: string; bytes: number; createdAt: string }`
  - `export async function listMyMedia(supabase: SupabaseClient): Promise<MediaItem[]>`(新しい順)
  - `export async function recordMedia(supabase: SupabaseClient, url: string, bytes: number): Promise<MediaItem>`
  - `export async function deleteMedia(supabase: SupabaseClient, item: MediaItem): Promise<void>`
  - `export function translateMediaError(err: unknown): string`

削除の順序は **DB 行 → R2 オブジェクト**。行の削除が `MEDIA_IN_USE` で落ちればオブジェクトは無傷。逆順にすると、使用中と分かる前にオブジェクトを消してしまう。オブジェクト削除に失敗した場合は R2 に孤児が残るだけで、見た目には影響しない。

`media.test.ts` は実 DB に当たる統合テスト(`articles.test.ts` と同じ流儀)。⚠️ `settings` と `articles` は **読むだけ**。自分が insert した `media` 行は `finally` で消すこと。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/media.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { listMyMedia, recordMedia, deleteMedia, translateMediaError } from '../src/lib/media';

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

let uid = '';
let base = '';
const created: string[] = [];

beforeAll(async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'hana@seed.local',
    password: 'seed-pass-1234',
  });
  if (error) throw error;
  uid = data.user!.id;

  // settings は読むだけ(他のテストファイルが並列で依存している)
  const { data: s, error: se } = await supabase
    .from('settings').select('image_base_url').eq('id', 1).single();
  if (se) throw se;
  base = (s as { image_base_url: string }).image_base_url;
  expect(base).not.toBe('');
});

afterEach(async () => {
  for (const url of created.splice(0)) {
    await supabase.from('media').delete().eq('url', url);
  }
});

describe('recordMedia / listMyMedia', () => {
  it('記録した画像が一覧に出る', async () => {
    const url = `${base}/${uid}/rec-${crypto.randomUUID()}.webp`;
    created.push(url);
    const item = await recordMedia(supabase, url, 4321);

    expect(item.url).toBe(url);
    expect(item.bytes).toBe(4321);

    const list = await listMyMedia(supabase);
    expect(list.map((m) => m.url)).toContain(url);
  });

  it('許可ホスト外の URL は拒否される', async () => {
    await expect(
      recordMedia(supabase, `https://evil.example/${uid}/x.webp`, 1),
    ).rejects.toThrow(/IMAGE_HOST_NOT_ALLOWED/);
  });

  it('他人の uid 配下のキーは拒否される', async () => {
    const other = '00000000-0000-0000-0000-000000000000';
    await expect(
      recordMedia(supabase, `${base}/${other}/x.webp`, 1),
    ).rejects.toThrow(/MEDIA_OWNER_MISMATCH/);
  });
});

describe('translateMediaError', () => {
  it('MEDIA_IN_USE を訳す', () => {
    expect(translateMediaError(new Error('MEDIA_IN_USE'))).toContain('使われて');
  });

  it('IMAGE_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateMediaError(new Error('IMAGE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
  });

  it('未知のエラーは汎用文言に落とす', () => {
    expect(translateMediaError(new Error('boom'))).toContain('失敗');
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `cd admin && npx vitest run tests/media.test.ts`

Expected: FAIL。`Failed to resolve import "../src/lib/media"`。

- [ ] **Step 3: media.ts を実装する**

`admin/src/lib/media.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MediaItem {
  id: string;
  url: string;
  bytes: number;
  createdAt: string;
}

interface MediaRow {
  id: string;
  url: string;
  bytes: number;
  created_at: string;
}

const toItem = (row: MediaRow): MediaItem => ({
  id: row.id,
  url: row.url,
  bytes: row.bytes,
  createdAt: row.created_at,
});

// RLS により自分の画像だけが返る(管理者は全件)。
export async function listMyMedia(supabase: SupabaseClient): Promise<MediaItem[]> {
  const { data, error } = await supabase
    .from('media')
    .select('id, url, bytes, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toItem(row as MediaRow));
}

export async function recordMedia(
  supabase: SupabaseClient, url: string, bytes: number,
): Promise<MediaItem> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const owner = userData.user;
  if (!owner) throw new Error('NOT_AUTHENTICATED');

  const { data, error } = await supabase
    .from('media')
    .insert({ owner_id: owner.id, url, bytes })
    .select('id, url, bytes, created_at')
    .single();
  if (error) throw error;
  return toItem(data as MediaRow);
}

// 順序が重要: 先に DB 行を消す。使用中なら MEDIA_IN_USE で落ち、R2 の
// オブジェクトは無傷のまま残る。逆順だと、使用中と分かる前に消してしまう。
// オブジェクト削除に失敗しても R2 に孤児が残るだけで見た目に影響はない。
export async function deleteMedia(supabase: SupabaseClient, item: MediaItem): Promise<void> {
  const { error, count } = await supabase
    .from('media')
    .delete({ count: 'exact' })
    .eq('id', item.id);
  if (error) throw error;
  if (count === 0) throw new Error('MEDIA_DELETE_DENIED');

  const { error: fnError } = await supabase.functions.invoke('r2-delete-object', {
    body: { url: item.url },
  });
  if (fnError) throw fnError;
}

export function translateMediaError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('MEDIA_IN_USE')) {
    return 'この画像は記事で使われているため削除できません。先に記事から外してください。';
  }
  if (msg.includes('IMAGE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所の画像です。';
  }
  if (msg.includes('MEDIA_OWNER_MISMATCH') || msg.includes('MEDIA_DELETE_DENIED')) {
    return '自分がアップロードした画像だけを操作できます。';
  }
  return '画像の操作に失敗しました。時間をおいて再度お試しください。';
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `supabase db reset && PUBLIC_IMAGE_BASE_URL=https://img.test npm run seed && cd admin && npm test && cd ..`

(`PUBLIC_IMAGE_BASE_URL` の設定は Task 9 で seed.mjs に入るが、この時点では `supabase db reset` 後に手で `update settings set image_base_url = '<R2_PUBLIC_BASE_URL と同じ値>' where id = 1;` を実行してもよい)

Expected: PASS(72 → 78 tests)。

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/media.ts admin/tests/media.test.ts
git commit -m "feat: media data layer (list, record, delete)"
```

---

### Task 6: 画像をアップロードして media に記録する

**Files:**
- Create: `admin/src/lib/body-image.ts`
- Create: `admin/tests/body-image.test.ts`
- Modify: `admin/src/lib/cover-widget.ts`(アップロード後に `recordMedia` を呼ぶ)

**Interfaces:**
- Consumes: `MAX_EDGE` / `encodeUnderLimit` / `scaledSize` / `uploadImage`(`./images`)、`recordMedia`(`./media`)
- Produces: `export async function uploadAndRecord(supabase: SupabaseClient, file: File): Promise<string>` — 縮小 → WebP → PUT → `media` へ記録 → 公開 URL を返す

`uploadAndRecord` はカバー画像ウィジェットからも使う。`media` に記録しておかないと、カバー画像がライブラリに出てこない(かつ孤児になる)。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/body-image.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fitWithin } from '../src/lib/body-image';

describe('fitWithin', () => {
  it('長辺が上限以内ならそのまま', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('横長は幅を上限に合わせる', () => {
    expect(fitWithin(2400, 1800, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('縦長は高さを上限に合わせる', () => {
    expect(fitWithin(1800, 2400, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('拡大はしない', () => {
    expect(fitWithin(100, 100, 1600)).toEqual({ width: 100, height: 100 });
  });
});
```

Canvas と `toBlob` は jsdom に存在しないため、`uploadAndRecord` 全体は実ブラウザ(Task 10)で確認する。ここでは純粋関数だけを単体テストする。

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `cd admin && npx vitest run tests/body-image.test.ts`

Expected: FAIL。`Failed to resolve import "../src/lib/body-image"`。

- [ ] **Step 3: body-image.ts を実装する**

`admin/src/lib/body-image.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_EDGE, encodeUnderLimit, scaledSize, uploadImage } from './images';
import { recordMedia } from './media';

// 長辺を maxEdge 以内に収める。元が小さければ拡大しない。
export function fitWithin(
  width: number, height: number, maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  return scaledSize(width, height, maxEdge / longest);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = src;
  });
}

// 縮小 → WebP → 署名付き PUT → media に記録。公開 URL を返す。
// カバー画像ウィジェットからも使う(記録しないとライブラリに出ず、孤児になる)。
export async function uploadAndRecord(
  supabase: SupabaseClient, file: File,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('NOT_AN_IMAGE');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const blob = await encodeUnderLimit(({ quality, scale }) => {
      const fitted = fitWithin(img.naturalWidth, img.naturalHeight, MAX_EDGE);
      const { width, height } = scaledSize(fitted.width, fitted.height, scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      return new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
    });

    const url = await uploadImage(supabase, blob);
    await recordMedia(supabase, url, blob.size);
    return url;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
```

- [ ] **Step 4: cover-widget.ts でも記録する**

`admin/src/lib/cover-widget.ts` の import に追加:

```ts
import { recordMedia } from './media';
```

`uploadImage(supabase, blob)` の呼び出しを次に置き換える(戻り値の `url` を使っている行はそのまま):

```ts
      const url = await uploadImage(supabase, blob);
      await recordMedia(supabase, url, blob.size);
```

`selectionId` によるトークン確認は既存のまま残すこと(`recordMedia` の後に再確認する)。

- [ ] **Step 5: テストとビルドを確認する**

Run: `cd admin && npm test && npm run build`

Expected: PASS(78 → 82 tests)、9 pages built。

- [ ] **Step 6: コミット**

```bash
git add admin/src/lib/body-image.ts admin/tests/body-image.test.ts admin/src/lib/cover-widget.ts
git commit -m "feat: upload images and record them in the media library"
```

---

### Task 7: スラッシュメニュー

**Files:**
- Create: `admin/src/lib/slash-menu.ts`
- Create: `admin/tests/slash-menu.test.ts`

**Interfaces:**
- Consumes: なし(純粋な DOM 操作)
- Produces:
  - `export interface SlashCommand { id: string; label: string; run(): void | Promise<void> }`
  - `export function matchSlashQuery(textBeforeCaret: string): string | null` — `/` コマンド入力中なら検索語を返す(`/` 直後なら空文字)、そうでなければ `null`
  - `export function initSlashMenu(textarea: HTMLTextAreaElement, menuEl: HTMLElement, commands: SlashCommand[]): void`

**開き方**: 行頭の `/`(直前が改行か文字列先頭)に限る。URL の `https://…` などで誤発火しないため。

**表示位置**: textarea の直下に固定(キャレット位置に追従させない)。textarea 内のキャレット座標を取るにはミラー要素が要り、割に合わない。

**キー操作**: ↑↓ で選択、Enter で決定、Esc で閉じる。開いている間はこれらの既定動作を `preventDefault` する。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/slash-menu.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchSlashQuery, initSlashMenu } from '../src/lib/slash-menu';

describe('matchSlashQuery', () => {
  it('行頭の / で開く', () => {
    expect(matchSlashQuery('/')).toBe('');
  });

  it('改行直後の / で開く', () => {
    expect(matchSlashQuery('本文\n/')).toBe('');
  });

  it('検索語を返す', () => {
    expect(matchSlashQuery('本文\n/画像')).toBe('画像');
  });

  it('行の途中の / では開かない', () => {
    expect(matchSlashQuery('あ/')).toBe(null);
  });

  it('URL の // では開かない', () => {
    expect(matchSlashQuery('https://example.com')).toBe(null);
  });

  it('空白が入ったら閉じる', () => {
    expect(matchSlashQuery('/画像 ')).toBe(null);
  });

  it('/ がなければ null', () => {
    expect(matchSlashQuery('ただの本文')).toBe(null);
  });
});

function setup() {
  document.body.innerHTML = `
    <textarea id="body"></textarea>
    <div id="slash-menu" hidden></div>
  `;
  return {
    textarea: document.getElementById('body') as HTMLTextAreaElement,
    menu: document.getElementById('slash-menu') as HTMLElement,
  };
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('initSlashMenu', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('/ でメニューが開き、コマンドが並ぶ', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [
      { id: 'image', label: '画像を挿入', run: () => {} },
      { id: 'heading', label: '見出し', run: () => {} },
    ]);
    typeInto(textarea, '/');
    expect(menu.hidden).toBe(false);
    expect(menu.querySelectorAll('button')).toHaveLength(2);
  });

  it('検索語でコマンドを絞る', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [
      { id: 'image', label: '画像を挿入', run: () => {} },
      { id: 'heading', label: '見出し', run: () => {} },
    ]);
    typeInto(textarea, '/見出');
    expect(menu.querySelectorAll('button')).toHaveLength(1);
    expect(menu.querySelector('button')!.textContent).toBe('見出し');
  });

  it('Enter で実行し、/検索語 を本文から取り除く', () => {
    const { textarea, menu } = setup();
    const run = vi.fn();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run }]);
    typeInto(textarea, '本文\n/画像');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(run).toHaveBeenCalledOnce();
    expect(textarea.value).toBe('本文\n');
    expect(menu.hidden).toBe(true);
  });

  it('Escape で閉じ、本文は変えない', () => {
    const { textarea, menu } = setup();
    const run = vi.fn();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run }]);
    typeInto(textarea, '/');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu.hidden).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(textarea.value).toBe('/');
  });

  it('一致するコマンドがなければ閉じる', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run: () => {} }]);
    typeInto(textarea, '/zzz');
    expect(menu.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `cd admin && npx vitest run tests/slash-menu.test.ts`

Expected: FAIL。`Failed to resolve import "../src/lib/slash-menu"`。

- [ ] **Step 3: slash-menu.ts を実装する**

`admin/src/lib/slash-menu.ts`:

```ts
export interface SlashCommand {
  id: string;
  label: string;
  run(): void | Promise<void>;
}

// キャレットの直前が「行頭の / + 空白なしの文字列」なら検索語を返す。
// 行の途中の / (URL の https:// など)では開かない。
export function matchSlashQuery(textBeforeCaret: string): string | null {
  const m = textBeforeCaret.match(/(?:^|\n)\/([^\s\n]*)$/);
  return m ? m[1] : null;
}

export function initSlashMenu(
  textarea: HTMLTextAreaElement,
  menuEl: HTMLElement,
  commands: SlashCommand[],
): void {
  let visible: SlashCommand[] = [];
  let activeIndex = 0;
  let query: string | null = null;

  const close = () => {
    query = null;
    visible = [];
    activeIndex = 0;
    menuEl.hidden = true;
    menuEl.replaceChildren();
  };

  // 「/検索語」をキャレットの手前から取り除く。run() が本文を触る前に消す。
  const removeQuery = () => {
    if (query === null) return;
    const caret = textarea.selectionStart;
    const start = caret - (query.length + 1);
    textarea.value = textarea.value.slice(0, start) + textarea.value.slice(caret);
    textarea.selectionStart = start;
    textarea.selectionEnd = start;
  };

  const select = (cmd: SlashCommand) => {
    removeQuery();
    close();
    textarea.focus();
    void cmd.run();
  };

  const render = () => {
    menuEl.replaceChildren();
    visible.forEach((cmd, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cmd.label; // ユーザー入力ではないが innerHTML は使わない
      btn.setAttribute('aria-selected', String(i === activeIndex));
      // mousedown で処理する: click だと先に textarea が blur してキャレットが失われる
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(cmd);
      });
      menuEl.append(btn);
    });
    menuEl.hidden = visible.length === 0;
  };

  textarea.addEventListener('input', () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    query = matchSlashQuery(before);
    if (query === null) {
      close();
      return;
    }
    const q = query.toLowerCase();
    visible = commands.filter((c) => c.label.toLowerCase().includes(q));
    activeIndex = 0;
    if (visible.length === 0) {
      close();
      return;
    }
    render();
  });

  textarea.addEventListener('keydown', (e) => {
    if (menuEl.hidden) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % visible.length;
      render();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + visible.length) % visible.length;
      render();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      select(visible[activeIndex]);
    }
  });

  textarea.addEventListener('blur', () => {
    // mousedown で選択済みなので、ここで閉じても取りこぼさない
    close();
  });
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd admin && npm test`

Expected: PASS(82 → 94 tests)。

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/slash-menu.ts admin/tests/slash-menu.test.ts
git commit -m "feat: slash command menu for the markdown editor"
```

---

### Task 8: メディアライブラリのモーダル

**Files:**
- Create: `admin/src/lib/media-picker.ts`
- Create: `admin/tests/media-picker.test.ts`

**Interfaces:**
- Consumes: `listMyMedia` / `deleteMedia` / `translateMediaError` / `MediaItem`(`./media`)
- Produces: `export function initMediaPicker(supabase: SupabaseClient, opts: { modalEl: HTMLElement; gridEl: HTMLElement; statusEl: HTMLElement; closeBtn: HTMLButtonElement; onPick: (url: string) => void }): { open(): Promise<void> }`

固定 ID の要素(`media-modal` / `media-grid` / `media-status` / `media-close`)を配線する。

削除は、記事の削除と同じ **2クリック確認**(1回目でラベルが「本当に削除?(もう一度押す)」に変わる)。DB が `MEDIA_IN_USE` で拒否したら、そのメッセージを出して一覧はそのまま。

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/media-picker.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initMediaPicker } from '../src/lib/media-picker';
import * as media from '../src/lib/media';

const ITEM = {
  id: 'm1', url: 'https://img.test/uid/a.webp', bytes: 1000,
  createdAt: '2026-07-09T00:00:00Z',
};

function setup() {
  document.body.innerHTML = `
    <div id="media-modal" hidden>
      <div id="media-grid"></div>
      <p id="media-status"></p>
      <button id="media-close">閉じる</button>
    </div>
  `;
  return {
    modalEl: document.getElementById('media-modal') as HTMLElement,
    gridEl: document.getElementById('media-grid') as HTMLElement,
    statusEl: document.getElementById('media-status') as HTMLElement,
    closeBtn: document.getElementById('media-close') as HTMLButtonElement,
  };
}

const supabase = {} as SupabaseClient;

describe('initMediaPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('open で一覧を描画する', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();

    expect(els.modalEl.hidden).toBe(false);
    const img = els.gridEl.querySelector('img')!;
    expect(img.src).toBe(ITEM.url);
  });

  it('画像を押すと onPick が呼ばれモーダルが閉じる', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const els = setup();
    const onPick = vi.fn();
    const picker = initMediaPicker(supabase, { ...els, onPick });

    await picker.open();
    (els.gridEl.querySelector('button[data-role="pick"]') as HTMLButtonElement).click();

    expect(onPick).toHaveBeenCalledWith(ITEM.url);
    expect(els.modalEl.hidden).toBe(true);
  });

  it('削除は2クリック必要', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const del = vi.spyOn(media, 'deleteMedia').mockResolvedValue(undefined);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    const btn = els.gridEl.querySelector('button[data-role="delete"]') as HTMLButtonElement;
    btn.click();
    expect(del).not.toHaveBeenCalled();
    expect(btn.textContent).toContain('もう一度');

    btn.click();
    await vi.waitFor(() => expect(del).toHaveBeenCalledOnce());
  });

  it('使用中なら日本語のエラーを出す', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    vi.spyOn(media, 'deleteMedia').mockRejectedValue(new Error('MEDIA_IN_USE'));
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    const btn = els.gridEl.querySelector('button[data-role="delete"]') as HTMLButtonElement;
    btn.click();
    btn.click();

    await vi.waitFor(() => expect(els.statusEl.textContent).toContain('使われて'));
  });

  it('画像が無ければその旨を出す', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([]);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    expect(els.statusEl.textContent).toContain('まだ画像がありません');
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `cd admin && npx vitest run tests/media-picker.test.ts`

Expected: FAIL。`Failed to resolve import "../src/lib/media-picker"`。

- [ ] **Step 3: media-picker.ts を実装する**

`admin/src/lib/media-picker.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { listMyMedia, deleteMedia, translateMediaError, type MediaItem } from './media';

export interface MediaPicker {
  open(): Promise<void>;
}

export interface MediaPickerOptions {
  modalEl: HTMLElement;
  gridEl: HTMLElement;
  statusEl: HTMLElement;
  closeBtn: HTMLButtonElement;
  onPick: (url: string) => void;
}

export function initMediaPicker(
  supabase: SupabaseClient, opts: MediaPickerOptions,
): MediaPicker {
  const { modalEl, gridEl, statusEl, closeBtn, onPick } = opts;

  const close = () => {
    modalEl.hidden = true;
    gridEl.replaceChildren();
    statusEl.textContent = '';
  };

  closeBtn.addEventListener('click', close);

  const render = (items: MediaItem[]) => {
    gridEl.replaceChildren();
    if (items.length === 0) {
      statusEl.textContent = 'まだ画像がありません。「画像を挿入」からアップロードしてください。';
      return;
    }
    for (const item of items) {
      const figure = document.createElement('figure');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.dataset.role = 'pick';
      const img = document.createElement('img');
      // URL は DB のトリガーで許可ホスト配下に限定済み。
      img.src = item.url;
      img.alt = '';
      img.width = 160;
      img.loading = 'lazy';
      pick.append(img);
      pick.addEventListener('click', () => {
        onPick(item.url);
        close();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.role = 'delete';
      del.textContent = '削除';
      // 記事削除と同じ2クリック確認
      let armed = false;
      del.addEventListener('click', async () => {
        statusEl.textContent = '';
        if (!armed) {
          armed = true;
          del.textContent = '本当に削除?(もう一度押す)';
          return;
        }
        del.disabled = true;
        try {
          await deleteMedia(supabase, item);
          await refresh();
        } catch (err) {
          statusEl.textContent = translateMediaError(err);
          console.error(err);
          del.disabled = false;
          armed = false;
          del.textContent = '削除';
        }
      });

      const caption = document.createElement('figcaption');
      caption.textContent = `${Math.round(item.bytes / 1024)} KB`;

      figure.append(pick, caption, del);
      gridEl.append(figure);
    }
  };

  const refresh = async () => {
    statusEl.textContent = '読み込み中…';
    try {
      const items = await listMyMedia(supabase);
      statusEl.textContent = '';
      render(items);
    } catch (err) {
      statusEl.textContent = translateMediaError(err);
      console.error(err);
    }
  };

  return {
    async open() {
      modalEl.hidden = false;
      await refresh();
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd admin && npm test`

Expected: PASS(94 → 99 tests)。

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/media-picker.ts admin/tests/media-picker.test.ts
git commit -m "feat: media library modal with reuse and guarded delete"
```

---

### Task 9: サニタイズでホストを絞り、エディタに配線する

**Files:**
- Modify: `src/lib/content.ts`
- Modify: `tests/content.test.ts`
- Modify: `admin/src/lib/editor-helpers.ts`
- Modify: `admin/tests/editor-helpers.test.ts`
- Modify: `admin/src/pages/articles/new.astro`
- Modify: `admin/src/pages/articles/edit.astro`

**Interfaces:**
- Consumes: `settings.image_base_url`(Task 1)、`fetchImageBaseUrl`(Task 4)、`uploadAndRecord`(Task 6)、`initSlashMenu`(Task 7)、`initMediaPicker`(Task 8)、`countBodyImages` / `insertAtCursor` / `MAX_BODY_IMAGES`(Task 4)
- Produces: `renderMarkdown(markdown: string, imageBaseUrl: string): string`(公開サイト)、`renderMarkdownPreview(md: string, imageBaseUrl: string): string`(CMS)

`sanitize-html` の `exclusiveFilter` は `true` を返した要素を丸ごと落とす。許可ホスト配下でない `img` だけに `true` を返す。

- [ ] **Step 1: 公開サイトの失敗するテストを書く**

`tests/content.test.ts` の `describe('renderMarkdown')` を置き換える:

```ts
describe('renderMarkdown', () => {
  const BASE = 'https://img.test';

  it('renders markdown and strips scripts', () => {
    const html = renderMarkdown('## 見出し\n\n**強調** <script>alert(1)</script>', BASE);
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', () => {
    expect(renderMarkdown(`![a](${BASE}/x.webp)`, BASE)).toContain(`src="${BASE}/x.webp"`);
  });

  it('許可ホスト以外の画像は落とす', () => {
    expect(renderMarkdown('![a](https://evil.example/x.webp)', BASE)).not.toContain('<img');
  });

  it('前方一致の抜け道を塞ぐ', () => {
    expect(renderMarkdown('![a](https://img.test.evil.example/x.webp)', BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', () => {
    expect(renderMarkdown(`![a](${BASE}/x.webp)`, '')).not.toContain('<img');
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run tests/content.test.ts`

Expected: FAIL。「許可ホスト以外の画像は落とす」で `<img` が残る。

- [ ] **Step 3: content.ts を実装する**

`src/lib/content.ts` の `renderMarkdown` を置き換え、ヘルパを追加する:

```ts
// imageBaseUrl 配下でない img は丸ごと落とす。空文字なら画像を一切通さない
// (settings.image_base_url 未設定時の fail closed)。
// base + '/' で比較するのは https://img.test が
// https://img.test.evil.example に前方一致するのを防ぐため。
export function renderMarkdown(markdown: string, imageBaseUrl: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  const prefix = imageBaseUrl === '' ? null : `${imageBaseUrl}/`;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      (prefix === null || !(frame.attribs.src ?? '').startsWith(prefix)),
  });
}

export async function fetchImageBaseUrl(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from('settings')
    .select('image_base_url')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { image_base_url: string }).image_base_url;
}
```

`fetchArticleBySlug`(130行目付近)の最終行を置き換える:

```ts
  const imageBaseUrl = await fetchImageBaseUrl(db);
  return { ...toSummary(data), bodyHtml: renderMarkdown((data as any).body, imageBaseUrl) };
```

- [ ] **Step 4: 公開サイトのテストが通ることを確認する**

Run: `npm test && npm run build`

Expected: PASS(11 → 15 tests)、9 pages built。

- [ ] **Step 5: CMS プレビューのテストを書く**

`admin/tests/editor-helpers.test.ts` の `renderMarkdownPreview` の describe を置き換え、`translateSaveError` の describe に追記する:

```ts
describe('renderMarkdownPreview', () => {
  const BASE = 'https://img.test';

  it('markdown を描画し script を落とす', () => {
    const html = renderMarkdownPreview('## 見出し\n\n<script>alert(1)</script>', BASE);
    expect(html).toContain('<h2>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', () => {
    expect(renderMarkdownPreview(`![a](${BASE}/x.webp)`, BASE)).toContain('<img');
  });

  it('許可ホスト以外の画像は落とす', () => {
    expect(renderMarkdownPreview('![a](https://evil.example/x.webp)', BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', () => {
    expect(renderMarkdownPreview(`![a](${BASE}/x.webp)`, '')).not.toContain('<img');
  });
});
```

```ts
  it('IMAGE_LIMIT_EXCEEDED を訳す', () => {
    expect(translateSaveError(new Error('IMAGE_LIMIT_EXCEEDED'))).toContain('5枚');
  });

  it('IMAGE_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('IMAGE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
  });

  it('HTML_IMG_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('HTML_IMG_NOT_ALLOWED'))).toContain('<img>');
  });
```

- [ ] **Step 6: editor-helpers.ts を実装する**

`renderMarkdownPreview` を置き換える:

```ts
// 公開サイトの renderMarkdown(src/lib/content.ts)と同じ規則で img を絞る。
// 片方だけ緩いと「プレビューで見えたのに公開ページで消える」ことになる。
export function renderMarkdownPreview(md: string, imageBaseUrl: string): string {
  const html = marked.parse(md, { async: false }) as string;
  const prefix = imageBaseUrl === '' ? null : `${imageBaseUrl}/`;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      (prefix === null || !(frame.attribs.src ?? '').startsWith(prefix)),
  });
}
```

`translateSaveError` の `POST_INTERVAL_NOT_ELAPSED` の分岐の下に追加:

```ts
  if (msg.includes('IMAGE_LIMIT_EXCEEDED')) {
    return '本文に入れられる画像は5枚までです。';
  }
  if (msg.includes('IMAGE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所の画像は使えません。「/」から画像を挿入してください。';
  }
  if (msg.includes('HTML_IMG_NOT_ALLOWED')) {
    return '本文に <img> タグは書けません。「/」から画像を挿入してください。';
  }
```

- [ ] **Step 7: new.astro に markup を足す**

`admin/src/pages/articles/new.astro` の本文 textarea を含む `<label>` の直後、プレビュー用 `<div>` の前に挿入する:

```html
<p id="editor-hint">本文で「/」を入力するとコマンドが出ます。</p>
<div id="slash-menu" role="listbox" hidden></div>
<input type="file" id="body-image-file" accept="image/*" hidden />
<span id="body-image-status" role="status"></span>

<div id="media-modal" role="dialog" aria-label="メディアライブラリ" hidden>
  <button type="button" id="media-close">閉じる</button>
  <p id="media-status" role="status"></p>
  <div id="media-grid"></div>
</div>
```

同じ markup を `admin/src/pages/articles/edit.astro` の本文 textarea(35行目付近)の直後にも入れる。

- [ ] **Step 8: new.astro を配線する**

`<script>` の import に追加:

```ts
import {
  fetchImageBaseUrl, countBodyImages, insertAtCursor, MAX_BODY_IMAGES, translateUploadError,
} from '../../lib/images';
import { uploadAndRecord } from '../../lib/body-image';
import { initSlashMenu } from '../../lib/slash-menu';
import { initMediaPicker } from '../../lib/media-picker';
```

セッション確認の `else` ブロック内、`updatePreview` の定義より前に:

```ts
const imageBaseUrl = await fetchImageBaseUrl(supabaseBrowser);
```

`updatePreview` を書き換える:

```ts
const updatePreview = () => {
  previewEl.innerHTML = renderMarkdownPreview($('body').value, imageBaseUrl);
};
```

その後に、共有の配線ブロックを置く(edit.astro でも同一のものを使う):

```ts
const bodyEl = $('body') as HTMLTextAreaElement;
const fileInput = document.getElementById('body-image-file') as HTMLInputElement;
const uploadStatus = document.getElementById('body-image-status')!;

// 本文に markdown 画像を差し込む。上限チェックは UX 目的(権威は DB)。
const insertImage = (url: string) => {
  if (countBodyImages(bodyEl.value) >= MAX_BODY_IMAGES) {
    uploadStatus.textContent = `本文の画像は${MAX_BODY_IMAGES}枚までです。`;
    return;
  }
  insertAtCursor(bodyEl, `\n\n![](${url})\n\n`);
  updatePreview();
};

const picker = initMediaPicker(supabaseBrowser, {
  modalEl: document.getElementById('media-modal') as HTMLElement,
  gridEl: document.getElementById('media-grid') as HTMLElement,
  statusEl: document.getElementById('media-status') as HTMLElement,
  closeBtn: document.getElementById('media-close') as HTMLButtonElement,
  onPick: insertImage,
});

// 同じファイルを続けて選べるよう、毎回 value を空にしてから開く
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;

  if (countBodyImages(bodyEl.value) >= MAX_BODY_IMAGES) {
    uploadStatus.textContent = `本文の画像は${MAX_BODY_IMAGES}枚までです。`;
    return;
  }

  uploadStatus.textContent = 'アップロード中…';
  try {
    const url = await uploadAndRecord(supabaseBrowser, file);
    insertImage(url);
    uploadStatus.textContent = '画像を挿入しました。';
  } catch (err) {
    uploadStatus.textContent = translateUploadError(err);
    console.error(err);
  }
});

initSlashMenu(bodyEl, document.getElementById('slash-menu') as HTMLElement, [
  { id: 'image', label: '画像を挿入', run: () => fileInput.click() },
  { id: 'media', label: 'メディアから選ぶ', run: () => picker.open() },
  { id: 'heading', label: '見出し', run: () => { insertAtCursor(bodyEl, '## '); updatePreview(); } },
  { id: 'list', label: '箇条書き', run: () => { insertAtCursor(bodyEl, '- '); updatePreview(); } },
  { id: 'quote', label: '引用', run: () => { insertAtCursor(bodyEl, '> '); updatePreview(); } },
]);
```

- [ ] **Step 9: edit.astro を配線する**

同じ import を足し、記事の取得より前に `const imageBaseUrl = await fetchImageBaseUrl(supabaseBrowser);` を置く。`renderMarkdownPreview(...)` の呼び出し2か所(83行目・85行目)に第2引数 `imageBaseUrl` を足す。

`$('body').value = article.body;` の**後**に、Step 8 の配線ブロックをそのまま置く。ただし `updatePreview` は edit.astro には無いので、先に定義する:

```ts
const updatePreview = () => {
  previewEl.innerHTML = renderMarkdownPreview($('body').value, imageBaseUrl);
};
```

既存の `$('body').addEventListener('input', ...)` は `updatePreview` を呼ぶ形に置き換える。

- [ ] **Step 10: すべてのテストとビルドを確認する**

Run: `npm test && npm run build && cd admin && npm test && npm run build && cd ..`

Expected: すべて PASS。ルートは 15 tests / 9 pages。CMS は 99 tests に、`renderMarkdownPreview` の describe を4件へ置き換えた差分と `translateSaveError` の3件を足した数(= 既存の preview テスト件数によって決まる)/ 9 pages。**件数が合わないより、赤いテストが1つも無いことを確認すること。**

- [ ] **Step 11: コミット**

```bash
git add src/lib/content.ts tests/content.test.ts admin/src/lib/editor-helpers.ts admin/tests/editor-helpers.test.ts admin/src/pages/articles/new.astro admin/src/pages/articles/edit.astro
git commit -m "feat: slash menu, media picker, and host-restricted image rendering"
```

---

### Task 10: シード・環境変数・ドキュメント

**Files:**
- Modify: `scripts/seed.mjs`
- Modify: `.env.example`
- Modify: `supabase/functions/.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/DEPLOYMENT-CHECKLIST.md`
- Modify: `ARCHITECTURE.md`

`settings.image_base_url` と Edge Function の `R2_PUBLIC_BASE_URL` は**必ず同じ値**にする。ずれると「アップロードは成功するのに保存が `IMAGE_HOST_NOT_ALLOWED` で落ちる」という分かりにくい壊れ方をする。

- [ ] **Step 1: seed.mjs が image_base_url を設定するようにする**

`scripts/seed.mjs` の設定を触っている箇所の近くに追加する:

```js
const imageBaseUrl = process.env.PUBLIC_IMAGE_BASE_URL;
if (!imageBaseUrl) {
  throw new Error(
    'PUBLIC_IMAGE_BASE_URL を .env に設定してください(Edge Function の R2_PUBLIC_BASE_URL と同じ値)',
  );
}
const { error: settingsError } = await db
  .from('settings')
  .update({ image_base_url: imageBaseUrl })
  .eq('id', 1);
if (settingsError) throw settingsError;
```

- [ ] **Step 2: .env.example を更新する**

`.env.example` に追記:

```
# 画像の公開URLのホスト。supabase/functions/.env の R2_PUBLIC_BASE_URL と
# 必ず同じ値にすること(ずれると記事の保存が IMAGE_HOST_NOT_ALLOWED で落ちる)。
# 末尾にスラッシュを付けない。
PUBLIC_IMAGE_BASE_URL=https://pub-xxxxxxxx.r2.dev
```

`supabase/functions/.env.example` の `R2_PUBLIC_BASE_URL` の行の上に追記:

```
# ルートの .env の PUBLIC_IMAGE_BASE_URL、および DB の settings.image_base_url と
# 同じ値にすること。三者がずれると記事の保存が IMAGE_HOST_NOT_ALLOWED で落ちる。
```

- [ ] **Step 3: シードが通ることを確認する**

Run: `supabase db reset && PUBLIC_IMAGE_BASE_URL=https://img.test npm run seed`

Expected: `Seed complete: 4 users, 5 published articles (2 commissioned), 1 draft`

Run: `docker exec supabase_db_wild-media-v2-0 psql -U postgres -d postgres -tAc "select image_base_url from settings where id = 1;"`

Expected: `https://img.test`

- [ ] **Step 4: README を更新する**

ローカルセットアップ手順に `.env` の `PUBLIC_IMAGE_BASE_URL` の説明を1行足す。**`git add README.md` を使わないこと**(このリポジトリには README の未コミット編集が別途ある)。自分のハンクだけをステージする:

```bash
git diff README.md      # 自分の変更だけであることを目視で確認
git add -p README.md    # 自分のハンクだけ 'y'、他は 'n'
```

- [ ] **Step 5: デプロイチェックリストを更新する**

`docs/superpowers/DEPLOYMENT-CHECKLIST.md` の R2 の節に追加:

```markdown
- [ ] DB の `settings.image_base_url` を `R2_PUBLIC_BASE_URL` と同じ値に設定する
      (`update settings set image_base_url = 'https://...' where id = 1;`)。
      未設定だと本文に画像を入れられず、値がずれると記事の保存が
      `IMAGE_HOST_NOT_ALLOWED` で落ちる。
- [ ] Edge Function `r2-delete-object` をデプロイする(`supabase functions deploy r2-delete-object`)
- [ ] 画像ホストを後から変える場合は、この値と既存のURLを同時に書き換える:
      `update articles set cover_image_url = replace(cover_image_url, '<旧>', '<新>'), body = replace(body, '<旧>', '<新>');`
      `update media set url = replace(url, '<旧>', '<新>');`
```

- [ ] **Step 6: ARCHITECTURE.md を更新する**

「主要ルール」に相当する箇所に追記:

```markdown
- 本文の画像は 5 枚まで、かつ `settings.image_base_url` 配下のものだけ
  (`articles` のトリガー `a_enforce_body_image_rules`)。本文に生の `<img>`
  タグは書けない(markdown の `![](url)` のみ)。
- アップロード済み画像は `media` テーブルに記録される。記事から参照されている
  画像は削除できない(`a_block_media_in_use`)。R2 のオブジェクト削除は
  Edge Function `r2-delete-object` が行い、呼び出し元の uid 配下のキーに限る。
```

- [ ] **Step 7: 全テスト・全ビルドを確認する**

Run: `supabase test db && npm test && npm run build && cd admin && npm test && npm run build && cd ..`

Expected: pgTAP 8ファイル green、ルート 15 tests / 9 pages、CMS 全 green / 9 pages。赤いテストが1つも無いこと。

- [ ] **Step 8: コミット**

```bash
git add scripts/seed.mjs .env.example supabase/functions/.env.example docs/superpowers/DEPLOYMENT-CHECKLIST.md ARCHITECTURE.md
git commit -m "docs: keep image_base_url in sync across DB, env, and deploy steps"
```

---

### Task 11: 実ブラウザでの確認

**Files:** なし(検証のみ)

jsdom には Canvas も `toBlob` も無いため、縮小・WebP 化・アップロード・R2 削除の一連は実ブラウザでしか確認できない。単体テストが見ているのは純粋関数と DOM の配線だけ。

- [ ] **Step 1: 環境を起動する**

```bash
supabase start
supabase db reset && PUBLIC_IMAGE_BASE_URL=<R2_PUBLIC_BASE_URL と同じ値> npm run seed
supabase functions serve --env-file supabase/functions/.env &
cd admin && npm run dev &
```

`http://localhost:4322/login` に `hana@seed.local` / `seed-pass-1234` でログインし、`/articles/new` を開く。

- [ ] **Step 2: スラッシュメニューを確認する**

- 本文の行頭で `/` を打つ → メニューが開き5項目出る
- `/見出` と打つ → 「見出し」だけに絞られる
- ↑↓ で選択が動き、Enter で決定、`/見出` が本文から消えて `## ` が入る
- Esc で閉じる。本文は変わらない
- 本文中に `https://example.com` と打つ → メニューは開かない(`//` で誤発火しない)

- [ ] **Step 3: 画像の挿入を確認する**

`/` → 「画像を挿入」で 1600px を超える画像を選ぶ。

- 本文のカーソル位置に `![](https://.../<uuid>.webp)` が入る
- プレビューに画像が出る
- 公開URLを `curl -I` すると `200` / `content-type: image/webp` / 512,000 バイト未満
- `select url, bytes from media order by created_at desc limit 1;` に行がある

- [ ] **Step 4: メディアからの再利用を確認する**

`/` → 「メディアから選ぶ」でモーダルが開き、サムネイルが出る。押すと本文に同じ URL が挿入され、モーダルが閉じる。**R2 への新しいアップロードは発生しない**(`media` の行数が増えない)。

- [ ] **Step 5: 上限と拒否を確認する**

- 画像を5枚入れたあと6枚目を挿入しようとする → 「本文の画像は5枚までです。」、アップロードは走らない
- 本文に手で `![](https://evil.example/x.webp)` と書いて保存 → 「許可されていない場所の画像は使えません。」
- 本文に手で `<img src="...">` と書いて保存 → 「本文に <img> タグは書けません。」
- 記事で使っている画像をモーダルから削除しようとする → 「この画像は記事で使われているため削除できません。」。R2 のオブジェクトは残っていること(公開 GET が `200`)

- [ ] **Step 6: 削除を確認する**

どの記事にも使っていない画像をモーダルから削除する(2クリック)。

- 一覧から消える
- `select count(*) from media;` が減る
- その公開URLの GET が `404` になる(R2 のオブジェクトも消えている)

- [ ] **Step 7: 公開サイトに出ることを確認する**

画像入りの記事を公開し、`npm run build && npm run preview` で `http://localhost:4321/articles/<slug>` を開く。本文の `<img>` が描画されること。

- [ ] **Step 8: 後片付け**

`supabase db reset && PUBLIC_IMAGE_BASE_URL=... npm run seed` でシード状態に戻し、起動したサーバを止める。R2 の dev バケットに残った検証用オブジェクトは削除してよい。
