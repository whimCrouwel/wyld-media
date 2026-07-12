# ブロックエディタ(note.com相当) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現行の素の `textarea` + Markdown 記事エディタを、Tiptap(ProseMirror)ベースのブロック型WYSIWYGエディタに置き換える(Phase 1 + Phase 2、Phase 3は対象外)。

**Architecture:** 本文を `articles.body`(jsonb、ブロック配列)として保存する。ブロックのスキーマとHTML変換は新規npmワークスペースパッケージ `packages/blocks-renderer/` に集約し、admin(CMS)のエディタ・プレビューと公開サイトのビルド時レンダリングの両方がこれをimportして使う(重複実装をなくす)。DBによる強制(ホスト制限・枚数上限・公開時バリデーション)は既存の `enforce_body_image_rules` トリガーをJSONB対応に書き換える形で継続する。

**Tech Stack:** Tiptap 2.27.2(`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/suggestion`, `@tiptap/extension-bubble-menu`, `@tiptap/extension-character-count`, `@tiptap/extension-link`, `@tiptap/extension-text-align`)、npm workspaces、Supabase Postgres(pgTAP)、既存のvitest/Astro構成。

## Global Constraints

- 権限・ビジネスルールは必ずDB層(トリガー)で強制する。クライアント側の検証はUX目的のみ(CLAUDE.md)。
- service role keyは `admin/` に置かない(CLAUDE.md)。
- ホスティングはVercel(Cloudflare Pagesではない)。
- Tiptap関連パッケージはすべて `2.27.2` に固定する。
- 本文の画像ブロック数上限は5件を維持する(既存 `MAX_BODY_IMAGES` を踏襲)。
- 埋め込みブロックは許可ドメインのみ: `www.youtube.com`, `youtu.be`, `twitter.com`, `x.com`, `player.vimeo.com`, `vimeo.com`。クライアント側とDBトリガー側で同じリストを保つ。
- 本番データは存在しない(初回デプロイ未実施)。既存記事データの移行処理は不要。
- admin画面はReact/Vue等のUIフレームワークを導入しない(既存踏襲、Tiptapはvanilla `@tiptap/core` で組み込む)。
- Phase 3(公開設定の別画面化・タグ・カテゴリ・シリーズ・変更履歴)は対象外。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `package.json`(root) | npm workspaces設定(`admin`, `packages/*`)、`marked`/`sanitize-html`依存を撤去 |
| `admin/package.json` | Tiptap依存一式・`@wild-media/blocks-renderer`を追加、`marked`/`sanitize-html`を撤去 |
| `packages/blocks-renderer/package.json` | 新規共有パッケージ本体 |
| `packages/blocks-renderer/src/extensions.ts` | admin・公開サイト共通のTiptapブロックスキーマ(`blockExtensions`) |
| `packages/blocks-renderer/src/render.ts` | `renderBlocksToHtml()` — ブロックJSON→サニタイズ済みHTML |
| `packages/blocks-renderer/src/index.ts` | パッケージの公開エントリ(`renderBlocksToHtml`を再エクスポート) |
| `supabase/migrations/20260712090100_body_image_rules_jsonb.sql` | `articles.body`をjsonb化、画像/ファイルのホスト・枚数制限をJSONB対応に書き換え |
| `supabase/migrations/20260712090200_body_embed_rules.sql` | 埋め込みブロックのドメイン許可リスト強制 |
| `supabase/migrations/20260712090300_publish_requires_body.sql` | 公開時に本文へのテキスト存在を要求 |
| `supabase/tests/database/07_body_image_rules.test.sql` | JSONB形式向けに書き換え |
| `supabase/tests/database/09_body_blocks_rules.test.sql` | ファイル/埋め込み/公開バリデーションのpgTAP |
| `scripts/seed.mjs` | シード記事のbodyをブロックJSONに変更 |
| `supabase/functions/r2-upload-url/index.ts` | `kind`パラメータでファイルアップロードにも対応 |
| `admin/src/lib/r2-upload.ts` | 画像/ファイル共通のR2アップロード原始関数 |
| `admin/src/lib/embed-dialog.ts` | 埋め込みプロバイダ判定・埋め込みブロック挿入 |
| `admin/src/lib/block-editor.ts` | Tiptap `Editor` の生成・本文JSON取得 |
| `admin/src/lib/insert-menu.ts` | 「＋」/スラッシュ挿入メニュー |
| `admin/src/lib/bubble-toolbar.ts` | 選択時ツールバー |
| `admin/src/lib/block-uploads.ts` | 画像・ファイルブロックの挿入(アップロード込み/URL直接) |
| `admin/src/lib/toc-panel.ts` | 目次パネル |
| `admin/src/lib/editor-preview.ts` | プレビューHTML生成 |
| `admin/src/lib/char-count.ts` | 文字数カウント表示 |
| `admin/src/lib/autosave.ts` | 自動保存・競合検知・下書きのlocalStorage退避 |
| `admin/src/lib/articles.ts` | `body`をJSONContent[]化、楽観的排他制御を追加 |
| `admin/src/pages/articles/edit.astro` / `new.astro` | 上記すべてを組み上げる編集画面 |
| `admin/src/lib/editor-helpers.ts` | Markdownプレビュー関数を撤去、エラー翻訳のみ残す |
| `admin/src/lib/slash-menu.ts` | 削除(Tiptapのinsert-menuに置き換え) |
| `src/lib/content.ts` | `renderMarkdown`を撤去、`renderBlocksToHtml`を使用 |
| `ARCHITECTURE.md` | body形式・DB強制ルールの記述を更新 |

---

### Task 1: npm workspaces化と `packages/blocks-renderer/` の雛形

**Files:**
- Modify: `package.json`(root)
- Delete: `admin/package-lock.json`
- Create: `packages/blocks-renderer/package.json`
- Create: `packages/blocks-renderer/tsconfig.json`
- Create: `packages/blocks-renderer/src/index.ts`
- Test: `packages/blocks-renderer/tests/index.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `@wild-media/blocks-renderer` パッケージの存在(中身はTask 6で実装)。`admin`と root の両方からworkspace参照で解決できること

- [ ] **Step 1: root `package.json` にworkspacesを追加**

```json
{
  "name": "wild-media",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["admin", "packages/*"],
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

(`marked`/`sanitize-html`はTask 23で撤去する。ここでは触らない。)

- [ ] **Step 2: `admin/package-lock.json` を削除し、`packages/blocks-renderer/` を雛形作成**

```bash
rm admin/package-lock.json
mkdir -p packages/blocks-renderer/src packages/blocks-renderer/tests
```

```json
// packages/blocks-renderer/package.json
{
  "name": "@wild-media/blocks-renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./extensions": "./src/extensions.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

(依存関係 `@tiptap/*`/`sanitize-html` はTask 7で追加する。)

```json
// packages/blocks-renderer/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```ts
// packages/blocks-renderer/src/index.ts
export const BLOCKS_RENDERER_READY = true;
```

(`renderBlocksToHtml` の実エクスポートはTask 6で追加する。ここではworkspace解決を確認するためのプレースホルダのみ。)

- [ ] **Step 3: Write the failing test**

```ts
// packages/blocks-renderer/tests/index.test.ts
import { describe, it, expect } from 'vitest';
import { BLOCKS_RENDERER_READY } from '../src/index';

describe('@wild-media/blocks-renderer scaffold', () => {
  it('exports a truthy readiness flag', () => {
    expect(BLOCKS_RENDERER_READY).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then install and verify it passes**

Run: `npm install` (repo root — this creates the workspace symlinks for `admin` and `packages/blocks-renderer`)
Run: `cd packages/blocks-renderer && npx vitest run tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Verify workspace resolution from both `admin` and root**

Run: `npm ls @wild-media/blocks-renderer --workspace=admin`
Expected: prints `@wild-media/blocks-renderer@0.1.0 -> ./packages/blocks-renderer` (symlinked, not a copy)

Run: `cd admin && npm test && cd ..`
Expected: PASS(既存のadminテストが壊れていないことを確認)

- [ ] **Step 6: Commit**

```bash
git add package.json admin/package-lock.json packages/blocks-renderer
git commit -m "chore: set up npm workspaces and scaffold packages/blocks-renderer"
```

---

### Task 2: `articles.body` をjsonb化し、画像/ファイルのDB強制ルールを書き換える

**Files:**
- Create: `supabase/migrations/20260712090100_body_image_rules_jsonb.sql`
- Modify: `supabase/tests/database/07_body_image_rules.test.sql`

**Interfaces:**
- Consumes: なし
- Produces: `public.body_asset_urls(body jsonb, asset_type text) returns setof text`(Task 3・Task 5でも使用)。例外 `IMAGE_LIMIT_EXCEEDED` / `IMAGE_HOST_NOT_ALLOWED` / `FILE_HOST_NOT_ALLOWED`(Task 21の`translateSaveError`が参照)

- [ ] **Step 1: Write the failing test(既存07を新形式に書き換え)**

```sql
-- supabase/tests/database/07_body_image_rules.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_column('public', 'settings', 'image_base_url', 'settings has image_base_url');

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'body-image-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b1', 'writer', 'body-image-writer', 'BW');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'five', 'five-images', $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'five body images are allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'six', 'six-images', $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/f.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'six body images are rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'foreign', 'foreign-host',
      '[{"type":"image","attrs":{"url":"https://evil.example/x.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'foreign image host is rejected'
);

-- https://img.test が https://img.test.evil.example に前方一致する抜け道
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'prefix', 'prefix-attack',
      '[{"type":"image","attrs":{"url":"https://img.test.evil.example/x.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'prefix-matching host is rejected'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'file-foreign', 'file-foreign-host',
      '[{"type":"file","attrs":{"url":"https://evil.example/x.pdf","filename":"x.pdf"}}]'::jsonb, 'draft')$$,
  'P0001', 'FILE_HOST_NOT_ALLOWED', 'foreign file host is rejected'
);

-- nested content(リスト項目の中の画像など)も走査対象であることを確認
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'nested', 'nested-image', $j$[
      {"type":"bulletList","content":[
        {"type":"listItem","content":[
          {"type":"image","attrs":{"url":"https://img.test/nested.webp"}}
        ]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'image nested inside a list item is still validated and allowed'
);

-- UPDATE path: 既存記事のbodyを上限超過に書き換えるのも同様に拒否される
select throws_ok(
  $$update articles set body = $j$[
      {"type":"image","attrs":{"url":"https://img.test/a.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/b.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/c.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/d.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/e.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/f.webp"}}
    ]$j$::jsonb
    where slug = 'five-images'$$,
  'P0001', 'IMAGE_LIMIT_EXCEEDED', 'updating body past the image limit is rejected'
);

update settings set image_base_url = '' where id = 1;
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b1', 'unset', 'unset-base',
      '[{"type":"image","attrs":{"url":"https://img.test/a.webp"}}]'::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'empty image_base_url rejects all images'
);

-- UPDATE path, unchanged body: ホストローテーション後も body 以外は編集できる
select lives_ok(
  $$update articles set title = 'renamed' where slug = 'five-images'$$,
  'updating a non-body column leaves a stale-host body untouched'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `column "body" is of type text but expression is of type jsonb`(bodyがまだtextのため)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260712090100_body_image_rules_jsonb.sql
-- articles.body を markdown文字列から Tiptap ブロックJSON配列(jsonb)へ移行する。
-- 本番データは存在しない(初回デプロイ未実施)ため、既存データの変換は行わない。

alter table public.articles drop column body;
alter table public.articles add column body jsonb not null default '[]'::jsonb;

drop function if exists public.body_image_urls(text);

-- body(jsonbのブロック配列)を再帰的に走査し、指定した type のノードが持つ
-- attrs.url をすべて集める。image/file/embed のいずれの検証にも使う。
-- リスト項目などネストしたcontent配下のブロックも対象。
create or replace function public.body_asset_urls(body jsonb, asset_type text)
returns setof text
language plpgsql
immutable
set search_path = public
as $$
declare
  node jsonb;
begin
  if jsonb_typeof(body) = 'array' then
    for node in select * from jsonb_array_elements(body) loop
      if node ->> 'type' = asset_type and node -> 'attrs' ->> 'url' is not null then
        return next node -> 'attrs' ->> 'url';
      end if;
      if node ? 'content' then
        return query select public.body_asset_urls(node -> 'content', asset_type);
      end if;
    end loop;
  end if;
  return;
end;
$$;

create or replace function public.enforce_body_image_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- admin/src/lib/images.ts の MAX_BODY_IMAGES と一致させること。権威はこちら。
  max_images constant int := 5;
  base text;
  image_urls text[];
  file_urls text[];
  u text;
begin
  -- body が変わらない UPDATE は本文検証を一切スキップする(ホストローテーション後の
  -- 救済経路。20260709120000_body_image_rules.sql のオリジナルコメント参照)。
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  select image_base_url into base from settings where id = 1;

  select array_agg(u) into image_urls from public.body_asset_urls(new.body, 'image') as u;
  select array_agg(u) into file_urls from public.body_asset_urls(new.body, 'file') as u;

  if image_urls is not null and array_length(image_urls, 1) > max_images then
    raise exception 'IMAGE_LIMIT_EXCEEDED';
  end if;

  if image_urls is not null then
    foreach u in array image_urls loop
      if base = '' or left(u, length(base) + 1) <> base || '/' then
        raise exception 'IMAGE_HOST_NOT_ALLOWED';
      end if;
    end loop;
  end if;

  if file_urls is not null then
    foreach u in array file_urls loop
      if base = '' or left(u, length(base) + 1) <> base || '/' then
        raise exception 'FILE_HOST_NOT_ALLOWED';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- media_library.sql の block_media_in_use は旧 body_image_urls(text) を
-- 呼んでいたため、jsonb版に合わせて再定義する(トリガー自体は既存のまま)。
create or replace function public.block_media_in_use()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return old;
  end if;

  if exists (
    select 1 from articles a
     where a.cover_image_url = old.url
        or exists (select 1 from public.body_asset_urls(a.body, 'image') bu where bu = old.url)
        or exists (select 1 from public.body_asset_urls(a.body, 'file') bu where bu = old.url)
  ) then
    raise exception 'MEDIA_IN_USE';
  end if;
  return old;
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: PASS(全9件)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712090100_body_image_rules_jsonb.sql supabase/tests/database/07_body_image_rules.test.sql
git commit -m "feat(db): store article body as a block JSON array and enforce image/file host+count rules on it"
```

---

### Task 3: 埋め込みブロックのドメイン許可リストをDBで強制する

**Files:**
- Create: `supabase/migrations/20260712090200_body_embed_rules.sql`
- Create: `supabase/tests/database/09_body_blocks_rules.test.sql`

**Interfaces:**
- Consumes: `public.body_asset_urls(body jsonb, asset_type text)`(Task 2)
- Produces: 例外 `EMBED_HOST_NOT_ALLOWED`(Task 21の`translateSaveError`、Task 9の`detectEmbedProvider`と同じホストリストを維持)

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/database/09_body_blocks_rules.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

update settings set image_base_url = 'https://img.test' where id = 1;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b2', 'body-blocks-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000b2', 'writer', 'body-blocks-writer', 'BB');

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'yt', 'youtube-embed',
      '[{"type":"embed","attrs":{"url":"https://www.youtube.com/watch?v=abc","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'youtube embed is allowed'
);

select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'evil', 'evil-embed',
      '[{"type":"embed","attrs":{"url":"https://evil.example/embed/1","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'P0001', 'EMBED_HOST_NOT_ALLOWED', 'disallowed embed host is rejected'
);

-- youtube.com(wwwなし)はDBトリガーとdetectEmbedProviderの両方で意図的に非許可
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'bare', 'bare-youtube',
      '[{"type":"embed","attrs":{"url":"https://youtube.com/watch?v=abc","provider":"youtube"}}]'::jsonb,
      'draft')$$,
  'P0001', 'EMBED_HOST_NOT_ALLOWED', 'bare youtube.com without www is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — トリガーが無いためすべて `lives_ok`/`throws_ok` の期待と異なる結果になる(埋め込みホストチェックが未実装)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260712090200_body_embed_rules.sql
-- 埋め込みブロックのurlを許可プロバイダドメインに限定する。
-- admin/src/lib/embed-dialog.ts の detectEmbedProvider と同じ6ホストを維持すること。

create or replace function public.enforce_body_embed_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  allowed_embed_hosts constant text[] := array[
    'www.youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'player.vimeo.com', 'vimeo.com'
  ];
  embed_urls text[];
  u text;
  host text;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  select array_agg(u) into embed_urls from public.body_asset_urls(new.body, 'embed') as u;
  if embed_urls is null then
    return new;
  end if;

  foreach u in array embed_urls loop
    host := lower((regexp_match(u, '^[a-zA-Z]+://([^/]+)'))[1]);
    if host is null or not (host = any(allowed_embed_hosts)) then
      raise exception 'EMBED_HOST_NOT_ALLOWED';
    end if;
  end loop;

  return new;
end;
$$;

create trigger aa_enforce_body_embed_rules
  before insert or update on public.articles
  for each row execute function public.enforce_body_embed_rules();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712090200_body_embed_rules.sql supabase/tests/database/09_body_blocks_rules.test.sql
git commit -m "feat(db): enforce the embed provider allowlist on articles.body"
```

---

### Task 4: 公開時に本文へのテキスト存在を要求する

**Files:**
- Create: `supabase/migrations/20260712090300_publish_requires_body.sql`
- Modify: `supabase/tests/database/09_body_blocks_rules.test.sql`

**Interfaces:**
- Consumes: `public.enforce_publish_rules()`(既存、`20260706043424_harden_publish_and_commission_rules.sql` で定義された最新版を完全に再現した上で追記する)
- Produces: 例外 `BODY_EMPTY_ON_PUBLISH`(Task 21の`translateSaveError`が参照)

- [ ] **Step 1: Write the failing test**

`supabase/tests/database/09_body_blocks_rules.test.sql` の `select plan(4);` を `select plan(6);` に変更し、`select * from finish();` の直前に追加:

```sql
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'empty', 'empty-body-publish', '[]'::jsonb, 'published')$$,
  'P0001', 'BODY_EMPTY_ON_PUBLISH', 'publishing with an empty body array is rejected'
);

select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000b2', 'nonempty', 'nonempty-body-publish',
      '[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]'::jsonb, 'published')$$,
  'publishing with a text-bearing body is allowed'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — 空のbodyでも公開できてしまう(`empty-body-publish`のケースが`throws_ok`を満たさない)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260712090300_publish_requires_body.sql
-- 公開するにはbody(ブロック配列)にテキストを持つノードが1つ以上必要とする。
-- これは画像/ファイル/埋め込みのホスト制限(enforce_body_image_rules/
-- enforce_body_embed_rules)と同じく、body の内容整合性そのものの不変条件
-- であり admin にもサービスロールにも常に適用する(POST_INTERVAL_NOT_ELAPSED
-- のような「ワークフローポリシー」ではない)。

create or replace function public.body_has_text(body jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  node jsonb;
begin
  if jsonb_typeof(body) = 'array' then
    for node in select * from jsonb_array_elements(body) loop
      if node ->> 'type' = 'text' and coalesce(node ->> 'text', '') <> '' then
        return true;
      end if;
      if node ? 'content' and public.body_has_text(node -> 'content') then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- 20260706043424_harden_publish_and_commission_rules.sql の enforce_publish_rules
-- を完全に再現した上で、公開遷移の先頭にBODY_EMPTY_ON_PUBLISHチェックを追加する。
create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  interval_days int;
  last_pub timestamptz;
  trusted boolean;
begin
  trusted := (auth.uid() is null or public.is_admin());

  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if not public.body_has_text(new.body) then
      raise exception 'BODY_EMPTY_ON_PUBLISH';
    end if;

    if trusted then
      if new.published_at is null then
        new.published_at := now();
      end if;
    else
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

  if tg_op = 'UPDATE'
     and old.status = 'published' and new.status = 'published' then

    if not trusted then
      new.published_at := old.published_at;
    end if;

    if old.commissioned_by is not null
       and new.commissioned_by is null
       and not trusted then
      raise exception
        'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: unpublish the article before removing the commission link';
    end if;
  end if;

  return new;
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: PASS(全6件)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712090300_publish_requires_body.sql supabase/tests/database/09_body_blocks_rules.test.sql
git commit -m "feat(db): require body text content before an article can be published"
```

---

### Task 5: シードスクリプトをブロックJSONに更新する

**Files:**
- Modify: `scripts/seed.mjs`

**Interfaces:**
- Consumes: Task 2の `articles.body jsonb` スキーマ
- Produces: なし(ローカル開発用シードデータの更新のみ)

- [ ] **Step 1: 既存のmarkdown文字列をブロックJSON配列に置き換える**

`scripts/seed.mjs` 内の5箇所の `body: '...'` リテラルを、それぞれ同じ見出し・本文をブロックJSONで表現した配列に置き換える。XSSサニタイズ確認用の記事(現在 `<script>alert("xss")</script>` を含むもの)は、実際のscriptノードではなく通常のテキストノードとしてその文字列を持たせ、レンダラのエスケープを検証する:

```js
// scripts/seed.mjs — 該当5箇所を置き換え(既存の他フィールドはそのまま)
{
  // ...
  body: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '川辺にて' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '朝の川辺を歩いた。' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'カワセミ' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'サギ' }] }] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("xss")</script>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '静かな時間だった。', marks: [{ type: 'bold' }] }] },
  ],
},
{
  // ...
  body: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '苔の森' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '雨上がりの森は苔が輝く。' }] },
  ],
},
{
  // ...
  body: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '街の鳥たち' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '公園のカラスを観察した。' }] },
  ],
},
{
  // ...
  body: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '企業の森' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'フォレスト再生機構の活動を取材した。' }] },
  ],
},
{
  // ...
  body: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '海岸にて' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '清掃活動に参加した。' }] },
  ],
},
```

`body: 'まだ書きかけ。'`(下書き記事)も同様に置き換える:

```js
body: [{ type: 'paragraph', content: [{ type: 'text', text: 'まだ書きかけ。' }] }],
```

- [ ] **Step 2: 動作確認**

Run: `supabase start && supabase db reset && npm run seed`
Expected: エラーなく完了する

- [ ] **Step 3: Commit**

```bash
git add scripts/seed.mjs
git commit -m "chore: seed article bodies as block JSON instead of markdown strings"
```

---

### Task 6: `packages/blocks-renderer/` の本体 — 共有スキーマとHTMLレンダラ

**Files:**
- Create: `packages/blocks-renderer/src/extensions.ts`
- Modify: `packages/blocks-renderer/src/render.ts`(新規)
- Modify: `packages/blocks-renderer/src/index.ts`
- Test: `packages/blocks-renderer/tests/render.test.ts`

**Interfaces:**
- Consumes: `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-text-align`, `sanitize-html`(Task 7で依存追加)
- Produces: `export const blockExtensions: AnyExtension[]`(`admin/src/lib/block-editor.ts`・Task 10が`@wild-media/blocks-renderer/extensions`からimport)、`export function renderBlocksToHtml(doc: JSONContent, imageBaseUrl: string): string`(Task 16・Task 22が`@wild-media/blocks-renderer`からimport)

- [ ] **Step 1: Write the failing test**

```ts
// packages/blocks-renderer/tests/render.test.ts
import { describe, it, expect } from 'vitest';
import { renderBlocksToHtml } from '../src/render';
import type { JSONContent } from '@tiptap/core';

const BASE = 'https://img.test';

describe('renderBlocksToHtml', () => {
  it('renders blocks and strips scripts', () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '強調', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ] };
    const html = renderBlocksToHtml(doc, BASE);
    expect(html).toContain('<h2 id="見出し">');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: null } },
    ] };
    expect(renderBlocksToHtml(doc, BASE)).toContain(`src="${BASE}/x.webp"`);
  });

  it('許可ホスト以外の画像は落とす', () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: 'https://evil.example/x.webp', alt: '', caption: null } },
    ] };
    expect(renderBlocksToHtml(doc, BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: null } },
    ] };
    expect(renderBlocksToHtml(doc, '')).not.toContain('<img');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/blocks-renderer && npx vitest run tests/render.test.ts`
Expected: FAIL with `Cannot find module '../src/render'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/blocks-renderer/src/extensions.ts
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Node } from '@tiptap/core';

const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      caption: { default: null },
      alt: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-block="image"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', { 'data-block': 'image', src: HTMLAttributes.url, alt: HTMLAttributes.alt }];
  },
});

const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      provider: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-block="embed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-block': 'embed', 'data-provider': HTMLAttributes.provider },
      ['iframe', {
        src: HTMLAttributes.url, sandbox: 'allow-scripts allow-same-origin allow-presentation',
        referrerpolicy: 'no-referrer', loading: 'lazy',
      }]];
  },
});

const FileBlock = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      filename: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-block="file"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', { 'data-block': 'file', href: HTMLAttributes.url, download: HTMLAttributes.filename },
      HTMLAttributes.filename ?? ''];
  },
});

const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-block="toc"]' }];
  },
  renderHTML() {
    // 目次はクライアント側(admin/src/lib/toc-panel.ts)/ビルド時に別途生成する
    // プレースホルダ。公開HTML自体には何も出力しない(空のdivのみ)。
    return ['div', { 'data-block': 'toc' }];
  },
});

// 要件通りH1は無効化(見出しはH2/H3のみ、記事タイトルがH1を兼ねる)。
// コードフェンスの自動変換とH1変換は StarterKit の既定を上書きしない
// (StarterKit標準のCodeBlockはそのまま使う。H1のみ levels で除外)。
export const blockExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
  }),
  Link.configure({ openOnClick: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  Embed,
  FileBlock,
  Toc,
];
```

```ts
// packages/blocks-renderer/src/render.ts
import { generateHTML } from '@tiptap/core';
import sanitizeHtml from 'sanitize-html';
import type { JSONContent } from '@tiptap/core';
import { blockExtensions } from './extensions';

function isAllowedAssetUrl(url: string | null | undefined, imageBaseUrl: string): boolean {
  if (!url || !imageBaseUrl) return false;
  return url.startsWith(`${imageBaseUrl}/`);
}

// image/file ノードのurlがimageBaseUrl配下でなければ、そのノードごと
// ドキュメントから取り除く(HTML生成前にJSONレベルでフィルタする方が、
// 生成後のHTML文字列を正規表現でいじるより確実)。
function dropDisallowedAssets(node: JSONContent, imageBaseUrl: string): JSONContent | null {
  if ((node.type === 'image' || node.type === 'file') && !isAllowedAssetUrl(node.attrs?.url, imageBaseUrl)) {
    return null;
  }
  if (node.content) {
    return { ...node, content: node.content.map((c) => dropDisallowedAssets(c, imageBaseUrl)).filter((c): c is JSONContent => c !== null) };
  }
  return node;
}

// generateHTMLは見出しにidを付与しないため、見出しテキストをそのままid属性
// にする後処理を行う(admin側プレビューと公開サイトの目次リンク遷移が
// 同じidを指せるようにするため。見出しはこのschemaでは常にプレーンテキスト
// のみを子に持つ想定)。
function addHeadingIds(html: string): string {
  return html.replace(/<h([23])>([^<]*)<\/h\1>/g, (match, level, text) => `<h${level} id="${text}">${text}</h${level}>`);
}

export function renderBlocksToHtml(doc: JSONContent, imageBaseUrl: string): string {
  const filtered: JSONContent = {
    type: 'doc',
    content: (doc.content ?? []).map((n) => dropDisallowedAssets(n, imageBaseUrl)).filter((n): n is JSONContent => n !== null),
  };
  const raw = generateHTML(filtered, blockExtensions);
  const withIds = addHeadingIds(raw);
  return sanitizeHtml(withIds, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'iframe']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      h2: ['id'], h3: ['id'],
      img: ['src', 'alt'],
      a: ['href', 'download'],
      iframe: ['src', 'sandbox', 'referrerpolicy', 'loading'],
    },
  });
}
```

```ts
// packages/blocks-renderer/src/index.ts
export const BLOCKS_RENDERER_READY = true;
export { renderBlocksToHtml } from './render';
export { blockExtensions } from './extensions';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/blocks-renderer && npx vitest run tests/render.test.ts`
Expected: PASS(依存追加後。次のTask 7でインストールしてから実行すること)

- [ ] **Step 5: Commit**

```bash
git add packages/blocks-renderer/src packages/blocks-renderer/tests
git commit -m "feat(blocks-renderer): shared Tiptap schema and blocks-to-html renderer"
```

---

### Task 7: Tiptap依存関係の追加(admin・blocks-renderer両方)

**Files:**
- Modify: `admin/package.json`
- Modify: `packages/blocks-renderer/package.json`

**Interfaces:**
- Consumes: なし
- Produces: Task 6以降が使うTiptapパッケージ一式のインストール

- [ ] **Step 1: `admin/package.json` に依存を追加**

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
    "@tiptap/core": "2.27.2",
    "@tiptap/starter-kit": "2.27.2",
    "@tiptap/suggestion": "2.27.2",
    "@tiptap/extension-bubble-menu": "2.27.2",
    "@tiptap/extension-character-count": "2.27.2",
    "@tiptap/extension-link": "2.27.2",
    "@tiptap/extension-text-align": "2.27.2",
    "@wild-media/blocks-renderer": "^0.1.0",
    "astro": "^5.0.0",
    "cropperjs": "^1.6.2",
    "marked": "^14.0.0",
    "sanitize-html": "^2.13.0"
  },
  "devDependencies": {
    "@types/sanitize-html": "^2.11.0",
    "dotenv": "^16.4.0",
    "jsdom": "^27.0.1",
    "vitest": "^2.1.0"
  }
}
```

(`marked`/`sanitize-html`はまだ`editor-helpers.ts`が使っているため、この時点では残す。撤去はTask 21/23。`@tiptap/starter-kit`は`block-editor.ts`(Task 10)が直接importするため直接依存として必要。)

- [ ] **Step 2: `packages/blocks-renderer/package.json` に依存を追加**

```json
{
  "name": "@wild-media/blocks-renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./extensions": "./src/extensions.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@tiptap/core": "2.27.2",
    "@tiptap/starter-kit": "2.27.2",
    "@tiptap/extension-link": "2.27.2",
    "@tiptap/extension-text-align": "2.27.2",
    "sanitize-html": "^2.13.0"
  },
  "devDependencies": {
    "@types/sanitize-html": "^2.11.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Install and verify Task 6's test now passes**

Run: `npm install`(repo root)
Run: `cd packages/blocks-renderer && npx vitest run tests/render.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add admin/package.json admin/package-lock.json packages/blocks-renderer/package.json package-lock.json
git commit -m "chore: add pinned Tiptap 2.27.2 dependencies to admin and blocks-renderer"
```

---

### Task 8: `r2-upload.ts` — 画像/ファイル共通のR2アップロード原始関数

**Files:**
- Create: `admin/src/lib/r2-upload.ts`
- Modify: `supabase/functions/r2-upload-url/index.ts`
- Test: `admin/tests/r2-upload.test.ts`

**Interfaces:**
- Consumes: 既存の`r2-upload-url` Edge Function呼び出しパターン(`admin/src/lib/body-image.ts`の`supabase.functions.invoke(...)`と同じ形)
- Produces: `export interface UploadTicket { uploadUrl: string; publicUrl: string; headers: Record<string, string> }`, `export function requestUploadUrl(supabase, file, kind): Promise<UploadTicket>`, `export function uploadToR2(supabase, file, kind, fetchFn?): Promise<{url: string}>`(Task 13が消費)

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/r2-upload.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requestUploadUrl, uploadToR2 } from '../src/lib/r2-upload';

function fakeSupabase(ticket: { uploadUrl: string; publicUrl: string; headers: Record<string, string> }) {
  return {
    functions: {
      invoke: vi.fn(async (name: string, _opts: { body: unknown }) => {
        expect(name).toBe('r2-upload-url');
        return { data: ticket, error: null };
      }),
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('requestUploadUrl', () => {
  it('invokes r2-upload-url with contentType/contentLength/kind', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: {} };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const result = await requestUploadUrl(supabase, file, 'image');
    expect(result).toEqual(ticket);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('r2-upload-url', {
      body: { contentType: 'image/webp', contentLength: 1, kind: 'image' },
    });
  });
});

describe('uploadToR2', () => {
  it('uploads the file via PUT and returns the public url', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: { 'Content-Type': 'image/webp' } };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(ticket.uploadUrl);
      expect(init.method).toBe('PUT');
      return new Response(null, { status: 200 });
    });
    const result = await uploadToR2(supabase, file, 'image', fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ url: ticket.publicUrl });
  });

  it('throws UPLOAD_FAILED when the PUT is not ok', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: {} };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      uploadToR2(supabase, file, 'image', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow('UPLOAD_FAILED: 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/r2-upload.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/r2-upload'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/r2-upload.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UploadTicket {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

export async function requestUploadUrl(
  supabase: SupabaseClient, file: File, kind: 'image' | 'file',
): Promise<UploadTicket> {
  const { data, error } = await supabase.functions.invoke('r2-upload-url', {
    body: { contentType: file.type, contentLength: file.size, kind },
  });
  if (error) throw error;
  return data as UploadTicket;
}

// 画像・ファイルの両方で使う低レベルのアップロード原始関数。
// 上限バイト数のUX的なチェック(images.ts の MAX_UPLOAD_BYTES)や、
// ノード種別ごとの挿入処理は呼び出し元(block-uploads.ts)の責務。
export async function uploadToR2(
  supabase: SupabaseClient, file: File, kind: 'image' | 'file', fetchFn: typeof fetch = fetch,
): Promise<{ url: string }> {
  const ticket = await requestUploadUrl(supabase, file, kind);
  const res = await fetchFn(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`UPLOAD_FAILED: ${res.status}`);
  return { url: ticket.publicUrl };
}
```

Update the Edge Function to accept `kind` and widen allowed MIME types for files:

```ts
// supabase/functions/r2-upload-url/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';
import { corsHeaders } from '../_shared/cors.ts';

const MAX_BYTES = 512_000;

// kinds: どの kind パラメータでこの MIME タイプを許可するか。
// 'image' は既存の画像アップロード(本文画像・カバー画像)専用のまま、
// 'file' はファイルブロック用に PDF を追加で許可する。
const ALLOWED_TYPES: Record<string, { ext: string; kinds: Array<'image' | 'file'> }> = {
  'image/webp': { ext: 'webp', kinds: ['image', 'file'] },
  'image/jpeg': { ext: 'jpg', kinds: ['image', 'file'] },
  'image/png': { ext: 'png', kinds: ['image', 'file'] },
  'application/pdf': { ext: 'pdf', kinds: ['file'] },
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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData } = await admin.auth.getUser(jwt);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { contentType?: string; contentLength?: number; kind?: 'image' | 'file' };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { contentType, contentLength } = payload;
  const kind = payload.kind ?? 'image';

  const allowed = ALLOWED_TYPES[contentType ?? ''];
  if (!allowed || !allowed.kinds.includes(kind)) {
    const validForKind = Object.entries(ALLOWED_TYPES)
      .filter(([, v]) => v.kinds.includes(kind))
      .map(([k]) => k);
    return json(
      { error: `contentType must be one of: ${validForKind.join(', ')}` },
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

  const key = `${userData.user.id}/${crypto.randomUUID()}.${allowed.ext}`;
  const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '');
  const objectUrl = new URL(`${endpoint}/${Deno.env.get('R2_BUCKET')}/${key}`);
  objectUrl.searchParams.set('X-Amz-Expires', '300');

  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  });

  const signed = await r2.sign(
    new Request(objectUrl.toString(), {
      method: 'PUT',
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': contentType!,
      },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  );

  return json({
    uploadUrl: signed.url,
    publicUrl: `${Deno.env.get('R2_PUBLIC_BASE_URL')}/${key}`,
    headers: { 'Content-Type': contentType },
  });
});
```

The diff from the original: `MAX_BYTES`/`corsHeaders` unchanged; `ALLOWED_TYPES` changed from `Record<string, string>` (mime → ext) to `Record<string, { ext, kinds }>`; `payload` gains `kind?: 'image' | 'file'` (defaulting to `'image'` — existing callers in `body-image.ts`/`cover-widget.ts` that never send `kind` keep working unchanged); the MIME-type check now also verifies `allowed.kinds.includes(kind)`; `key` now uses `allowed.ext` instead of the old flat `ALLOWED_TYPES[contentType]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/r2-upload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/r2-upload.ts admin/tests/r2-upload.test.ts supabase/functions/r2-upload-url/index.ts
git commit -m "feat(admin): shared R2 upload primitive with file-kind support in the edge function"
```

---

### Task 9: `embed-dialog.ts` groundwork — `detectEmbedProvider`

**Files:**
- Create: `admin/src/lib/embed-dialog.ts`
- Test: `admin/tests/embed-dialog.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数)
- Produces: `export function detectEmbedProvider(url: string): 'youtube' | 'twitter' | 'vimeo' | null`(Task 14が`insertEmbedBlock`を組み立てる土台)

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/embed-dialog.test.ts
import { describe, it, expect } from 'vitest';
import { detectEmbedProvider } from '../src/lib/embed-dialog';

describe('detectEmbedProvider', () => {
  it('detects youtube.com and youtu.be', () => {
    expect(detectEmbedProvider('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectEmbedProvider('https://youtu.be/abc')).toBe('youtube');
  });
  it('detects twitter.com and x.com', () => {
    expect(detectEmbedProvider('https://twitter.com/user/status/1')).toBe('twitter');
    expect(detectEmbedProvider('https://x.com/user/status/1')).toBe('twitter');
  });
  it('detects vimeo.com and player.vimeo.com', () => {
    expect(detectEmbedProvider('https://vimeo.com/12345')).toBe('vimeo');
    expect(detectEmbedProvider('https://player.vimeo.com/video/12345')).toBe('vimeo');
  });
  it('returns null for a bare host without www (matches the DB allowlist exactly)', () => {
    expect(detectEmbedProvider('https://youtube.com/watch?v=abc')).toBeNull();
  });
  it('returns null for a disallowed host', () => {
    expect(detectEmbedProvider('https://evil.example/embed/1')).toBeNull();
  });
  it('returns null for an invalid url', () => {
    expect(detectEmbedProvider('not a url')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/embed-dialog.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/embed-dialog'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/embed-dialog.ts
// 許可ホストは DB トリガーと同期させること(権威は DB 側)。
// supabase/migrations/20260712090200_body_embed_rules.sql の
// allowed_embed_hosts と同じ6つのホスト名。
const PROVIDER_HOSTS: Record<'youtube' | 'twitter' | 'vimeo', string[]> = {
  youtube: ['www.youtube.com', 'youtu.be'],
  twitter: ['twitter.com', 'x.com'],
  vimeo: ['player.vimeo.com', 'vimeo.com'],
};

export function detectEmbedProvider(url: string): 'youtube' | 'twitter' | 'vimeo' | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
    if (hosts.includes(host)) return provider as 'youtube' | 'twitter' | 'vimeo';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/embed-dialog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/embed-dialog.ts admin/tests/embed-dialog.test.ts
git commit -m "feat(admin): detect the embed provider from a url against the DB allowlist"
```

---

### Task 10: `block-editor.ts` — Tiptap `Editor` を共有スキーマで組み立てる

**Files:**
- Create: `admin/src/lib/block-editor.ts`
- Test: `admin/tests/block-editor.test.ts`

**Interfaces:**
- Consumes: `blockExtensions` from `@wild-media/blocks-renderer/extensions`(Task 6)
- Produces: `export interface CreateBlockEditorOptions { element: HTMLElement; content: JSONContent[]; extraExtensions: Extension[] }`, `export function createBlockEditor(opts: CreateBlockEditorOptions): Editor`, `export function getBodyBlocks(editor: Editor): JSONContent[]`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/block-editor.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBlockEditor, getBodyBlocks } from '../src/lib/block-editor';

describe('createBlockEditor / getBodyBlocks', () => {
  it('round-trips heading and paragraph content', () => {
    const el = document.createElement('div');
    const content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    ];
    const editor = createBlockEditor({ element: el, content, extraExtensions: [] });
    expect(getBodyBlocks(editor)).toEqual(content);
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/block-editor.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/block-editor'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/block-editor.ts
import { Editor, type Extension, type JSONContent } from '@tiptap/core';
import { blockExtensions } from '@wild-media/blocks-renderer/extensions';

export interface CreateBlockEditorOptions {
  element: HTMLElement;
  content: JSONContent[];
  extraExtensions: Extension[];
}

export function createBlockEditor(opts: CreateBlockEditorOptions): Editor {
  return new Editor({
    element: opts.element,
    extensions: [...blockExtensions, ...opts.extraExtensions],
    content: { type: 'doc', content: opts.content },
  });
}

export function getBodyBlocks(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/block-editor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/block-editor.ts admin/tests/block-editor.test.ts
git commit -m "feat(admin): create the Tiptap block editor against the shared schema"
```

---

### Task 11: `insert-menu.ts` — 「＋」/スラッシュ挿入メニュー

**Files:**
- Create: `admin/src/lib/insert-menu.ts`
- Test: `admin/tests/insert-menu.test.ts`

**Interfaces:**
- Consumes: `Editor`, `Extension` from `@tiptap/core`; `Suggestion` from `@tiptap/suggestion`
- Produces: `export interface BlockCommand { id: string; label: string; run: (editor: Editor) => void }`, `export function createSlashCommandsExtension(commands: BlockCommand[]): Extension`, `export function initInsertButton(editor: Editor, wrapperEl: HTMLElement): void`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/insert-menu.test.ts
import { describe, it, expect } from 'vitest';
import { filterCommands, type BlockCommand } from '../src/lib/insert-menu';

const commands: BlockCommand[] = [
  { id: 'heading', label: '見出し', run: () => {} },
  { id: 'image', label: '画像を挿入', run: () => {} },
  { id: 'quote', label: '引用', run: () => {} },
];

describe('filterCommands', () => {
  it('returns all commands for an empty query', () => {
    expect(filterCommands(commands, '')).toHaveLength(3);
  });
  it('filters by label substring', () => {
    expect(filterCommands(commands, '画像').map((c) => c.id)).toEqual(['image']);
  });
  it('filters by id substring (english query)', () => {
    expect(filterCommands(commands, 'quo').map((c) => c.id)).toEqual(['quote']);
  });
  it('returns empty array when nothing matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/insert-menu.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/insert-menu'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/insert-menu.ts
import { Extension, type Editor } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

export interface BlockCommand {
  id: string;
  label: string;
  run: (editor: Editor) => void;
}

export function filterCommands(commands: BlockCommand[], query: string): BlockCommand[] {
  const q = query.toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
}

export function createSlashCommandsExtension(commands: BlockCommand[]): Extension {
  return Extension.create({
    name: 'slashCommands',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          items: ({ query }: { query: string }) => filterCommands(commands, query),
          command: ({
            editor, range, props,
          }: { editor: Editor; range: { from: number; to: number }; props: BlockCommand }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
    },
  });
}

// 本文の空行左に表示する「＋」ボタン。空のテキストブロックにキャレットが
// あるときだけ表示し、クリックで "/" を挿入してスラッシュメニューを開く
// (既存のコマンド一覧を流用する)。
export function initInsertButton(editor: Editor, wrapperEl: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'insert-block-button';
  button.textContent = '+';
  button.hidden = true;
  wrapperEl.append(button);

  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    editor.chain().focus().insertContent('/').run();
  });

  const updateVisibility = () => {
    const { $from } = editor.state.selection;
    const isEmptyTextBlock = $from.parent.isTextblock && $from.parent.content.size === 0;
    button.hidden = !isEmptyTextBlock;
  };

  editor.on('selectionUpdate', updateVisibility);
  editor.on('transaction', updateVisibility);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/insert-menu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/insert-menu.ts admin/tests/insert-menu.test.ts
git commit -m "feat(admin): slash-command insert menu and the empty-line insert button"
```

---

### Task 12: `bubble-toolbar.ts` — 選択時ツールバー

**Files:**
- Create: `admin/src/lib/bubble-toolbar.ts`
- Test: `admin/tests/bubble-toolbar.test.ts`

**Interfaces:**
- Consumes: `BubbleMenu` from `@tiptap/extension-bubble-menu`
- Produces: `export function createBubbleMenuExtension(toolbarEl: HTMLElement): Extension`, `export function initBubbleToolbar(editor: Editor, toolbarEl: HTMLElement): void`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/bubble-toolbar.test.ts
import { describe, it, expect } from 'vitest';
import { deriveActiveButtons, type ActiveEditor } from '../src/lib/bubble-toolbar';

function fakeEditor(active: Set<string>): ActiveEditor {
  return {
    isActive: (name: string, attrs?: Record<string, unknown>) => {
      if (!attrs) return active.has(name);
      return active.has(`${name}:${JSON.stringify(attrs)}`);
    },
  };
}

describe('deriveActiveButtons', () => {
  it('reports bold/strike active when the editor says so', () => {
    const state = deriveActiveButtons(fakeEditor(new Set(['bold', 'strike'])));
    expect(state.bold).toBe(true);
    expect(state.strike).toBe(true);
    expect(state.bulletList).toBe(false);
  });

  it('reports heading level via attrs-keyed isActive calls', () => {
    const state = deriveActiveButtons(fakeEditor(new Set(['heading:{"level":2}'])));
    expect(state.headingH2).toBe(true);
    expect(state.headingH3).toBe(false);
  });

  it('reports text align via object-form isActive calls', () => {
    const state = deriveActiveButtons(fakeEditor(new Set(['undefined:{"textAlign":"center"}'])));
    expect(state.alignCenter).toBe(true);
    expect(state.alignLeft).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/bubble-toolbar.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/bubble-toolbar'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/bubble-toolbar.ts
import type { Editor, Extension } from '@tiptap/core';
import BubbleMenu from '@tiptap/extension-bubble-menu';

export function createBubbleMenuExtension(toolbarEl: HTMLElement): Extension {
  return BubbleMenu.configure({
    element: toolbarEl,
    tippyOptions: { duration: 100 },
  }) as unknown as Extension;
}

export interface ToolbarButtonState {
  bold: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
  headingH2: boolean;
  headingH3: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
}

export interface ActiveEditor {
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean;
}

export function deriveActiveButtons(editor: ActiveEditor): ToolbarButtonState {
  return {
    bold: editor.isActive('bold'),
    strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    blockquote: editor.isActive('blockquote'),
    codeBlock: editor.isActive('codeBlock'),
    link: editor.isActive('link'),
    headingH2: editor.isActive('heading', { level: 2 }),
    headingH3: editor.isActive('heading', { level: 3 }),
    alignLeft: editor.isActive({ textAlign: 'left' } as unknown as string),
    alignCenter: editor.isActive({ textAlign: 'center' } as unknown as string),
    alignRight: editor.isActive({ textAlign: 'right' } as unknown as string),
  };
}

export function initBubbleToolbar(editor: Editor, toolbarEl: HTMLElement): void {
  const q = (action: string) => toolbarEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const buttons = {
    bold: q('bold'), strike: q('strike'), bulletList: q('bulletList'), orderedList: q('orderedList'),
    blockquote: q('blockquote'), codeBlock: q('codeBlock'), link: q('link'), unlink: q('unlink'),
    headingH2: q('headingH2'), headingH3: q('headingH3'), paragraph: q('paragraph'),
    alignLeft: q('alignLeft'), alignCenter: q('alignCenter'), alignRight: q('alignRight'),
    delete: q('delete'),
  };

  buttons.bold?.addEventListener('click', () => editor.chain().focus().toggleBold().run());
  buttons.strike?.addEventListener('click', () => editor.chain().focus().toggleStrike().run());
  buttons.bulletList?.addEventListener('click', () => editor.chain().focus().toggleBulletList().run());
  buttons.orderedList?.addEventListener('click', () => editor.chain().focus().toggleOrderedList().run());
  buttons.blockquote?.addEventListener('click', () => editor.chain().focus().toggleBlockquote().run());
  buttons.codeBlock?.addEventListener('click', () => editor.chain().focus().toggleCodeBlock().run());
  buttons.headingH2?.addEventListener('click', () => editor.chain().focus().toggleHeading({ level: 2 }).run());
  buttons.headingH3?.addEventListener('click', () => editor.chain().focus().toggleHeading({ level: 3 }).run());
  buttons.paragraph?.addEventListener('click', () => editor.chain().focus().setParagraph().run());
  buttons.alignLeft?.addEventListener('click', () => editor.chain().focus().setTextAlign('left').run());
  buttons.alignCenter?.addEventListener('click', () => editor.chain().focus().setTextAlign('center').run());
  buttons.alignRight?.addEventListener('click', () => editor.chain().focus().setTextAlign('right').run());
  buttons.link?.addEventListener('click', () => {
    const url = window.prompt('リンク先のURL');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  });
  buttons.unlink?.addEventListener('click', () => editor.chain().focus().unsetLink().run());
  buttons.delete?.addEventListener('click', () => editor.chain().focus().deleteSelection().run());

  const syncActiveState = () => {
    const state = deriveActiveButtons(editor);
    buttons.bold?.setAttribute('aria-pressed', String(state.bold));
    buttons.strike?.setAttribute('aria-pressed', String(state.strike));
    buttons.bulletList?.setAttribute('aria-pressed', String(state.bulletList));
    buttons.orderedList?.setAttribute('aria-pressed', String(state.orderedList));
    buttons.blockquote?.setAttribute('aria-pressed', String(state.blockquote));
    buttons.codeBlock?.setAttribute('aria-pressed', String(state.codeBlock));
    buttons.link?.setAttribute('aria-pressed', String(state.link));
    buttons.headingH2?.setAttribute('aria-pressed', String(state.headingH2));
    buttons.headingH3?.setAttribute('aria-pressed', String(state.headingH3));
    buttons.alignLeft?.setAttribute('aria-pressed', String(state.alignLeft));
    buttons.alignCenter?.setAttribute('aria-pressed', String(state.alignCenter));
    buttons.alignRight?.setAttribute('aria-pressed', String(state.alignRight));
  };

  editor.on('selectionUpdate', syncActiveState);
  editor.on('transaction', syncActiveState);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/bubble-toolbar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/bubble-toolbar.ts admin/tests/bubble-toolbar.test.ts
git commit -m "feat(admin): bubble selection toolbar wired to editor commands"
```

---

### Task 13: `block-uploads.ts` — 画像/ファイルブロックの挿入

**Files:**
- Create: `admin/src/lib/block-uploads.ts`
- Test: `admin/tests/block-uploads.test.ts`

**Interfaces:**
- Consumes: `uploadToR2` from `./r2-upload`(Task 8)
- Produces: `export async function insertImageBlock(supabase, editor, file): Promise<void>`, `export async function insertFileBlock(supabase, editor, file): Promise<void>`, `export function insertImageUrlBlock(editor, url): void`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/block-uploads.test.ts
import { describe, it, expect, vi } from 'vitest';
import { insertImageBlock, insertFileBlock, insertImageUrlBlock } from '../src/lib/block-uploads';

vi.mock('../src/lib/r2-upload', () => ({
  uploadToR2: vi.fn(async (_supabase: unknown, file: File, kind: 'image' | 'file') => ({
    url: `https://img.test/${kind}-${file.name}`,
  })),
}));

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  const chain = vi.fn(() => ({ focus }));
  return { chain, insertContent, run } as unknown as import('@tiptap/core').Editor & {
    insertContent: typeof insertContent; run: typeof run;
  };
}

describe('insertImageBlock', () => {
  it('uploads then inserts an image node with the uploaded url', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'photo.webp', { type: 'image/webp' });
    await insertImageBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/image-photo.webp', caption: null, alt: '' },
    });
    expect(editor.run).toHaveBeenCalled();
  });
});

describe('insertFileBlock', () => {
  it('uploads then inserts a file node with the uploaded url and filename', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    await insertFileBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'file', attrs: { url: 'https://img.test/file-doc.pdf', filename: 'doc.pdf' },
    });
  });
});

describe('insertImageUrlBlock', () => {
  it('inserts an image node directly without uploading', () => {
    const editor = fakeEditor();
    insertImageUrlBlock(editor, 'https://img.test/reused.webp');
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/reused.webp', caption: null, alt: '' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/block-uploads.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/block-uploads'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/block-uploads.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Editor } from '@tiptap/core';
import { uploadToR2 } from './r2-upload';

// アップロードに失敗した場合の例外は握りつぶさずそのまま伝播させる。
// 呼び出し元(edit.astro/new.astro)が images.ts の translateUploadError で
// 日本語に翻訳する。
export async function insertImageBlock(
  supabase: SupabaseClient, editor: Editor, file: File,
): Promise<void> {
  const { url } = await uploadToR2(supabase, file, 'image');
  editor.chain().focus().insertContent({
    type: 'image',
    attrs: { url, caption: null, alt: '' },
  }).run();
}

export async function insertFileBlock(
  supabase: SupabaseClient, editor: Editor, file: File,
): Promise<void> {
  const { url } = await uploadToR2(supabase, file, 'file');
  editor.chain().focus().insertContent({
    type: 'file',
    attrs: { url, filename: file.name },
  }).run();
}

// メディアライブラリからの再利用フロー: アップロードせず既知のURLだけを挿入する。
export function insertImageUrlBlock(editor: Editor, url: string): void {
  editor.chain().focus().insertContent({
    type: 'image',
    attrs: { url, caption: null, alt: '' },
  }).run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/block-uploads.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/block-uploads.ts admin/tests/block-uploads.test.ts
git commit -m "feat(admin): insert image/file blocks after upload, and reuse-from-library insertion"
```

---

### Task 14: `embed-dialog.ts` — `insertEmbedBlock`

**Files:**
- Modify: `admin/src/lib/embed-dialog.ts`
- Test: `admin/tests/embed-dialog.test.ts`

**Interfaces:**
- Consumes: `detectEmbedProvider`(Task 9、同一ファイル)
- Produces: `export function insertEmbedBlock(editor: Editor, url: string): { ok: true } | { ok: false; message: string }`

- [ ] **Step 1: Write the failing test**

Append to `admin/tests/embed-dialog.test.ts`:

```ts
import { insertEmbedBlock } from '../src/lib/embed-dialog';
import { vi } from 'vitest';

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  const chain = vi.fn(() => ({ focus }));
  return { chain, insertContent, run } as unknown as import('@tiptap/core').Editor & {
    insertContent: typeof insertContent;
  };
}

describe('insertEmbedBlock', () => {
  it('inserts an embed node for an allowed provider url', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://www.youtube.com/watch?v=abc');
    expect(result).toEqual({ ok: true });
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'embed', attrs: { url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube' },
    });
  });

  it('rejects a disallowed host without touching the editor', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://evil.example/embed/1');
    expect(result).toEqual({
      ok: false,
      message: '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。',
    });
    expect(editor.insertContent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/embed-dialog.test.ts`
Expected: FAIL with `insertEmbedBlock is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `admin/src/lib/embed-dialog.ts`:

```ts
import type { Editor } from '@tiptap/core';

export function insertEmbedBlock(
  editor: Editor, url: string,
): { ok: true } | { ok: false; message: string } {
  const provider = detectEmbedProvider(url);
  if (!provider) {
    return { ok: false, message: '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。' };
  }
  editor.chain().focus().insertContent({
    type: 'embed',
    attrs: { url, provider },
  }).run();
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/embed-dialog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/embed-dialog.ts admin/tests/embed-dialog.test.ts
git commit -m "feat(admin): insert embed blocks for allowed providers with a UX-facing rejection message"
```

---

### Task 15: `toc-panel.ts` — 目次パネル

**Files:**
- Create: `admin/src/lib/toc-panel.ts`
- Test: `admin/tests/toc-panel.test.ts`

**Interfaces:**
- Consumes: `Editor`, `JSONContent` from `@tiptap/core`
- Produces: `export function extractHeadings(doc: JSONContent): { level: number; text: string; pos: number }[]`, `export function renderTocPanel(editor: Editor, panelEl: HTMLElement): void`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/toc-panel.test.ts
import { describe, it, expect } from 'vitest';
import { extractHeadings } from '../src/lib/toc-panel';
import type { JSONContent } from '@tiptap/core';

describe('extractHeadings', () => {
  it('returns an empty array when there are no headings', () => {
    expect(extractHeadings({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
    })).toEqual([]);
  });

  it('extracts level/text/pos for each top-level heading in order', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '第一節' }] },
      ],
    };
    const headings = extractHeadings(doc);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toEqual({ level: 2, text: '第一章', pos: 0 });
    // heading1 nodeSize = 3 chars + 2 = 5; paragraph nodeSize = 2 chars + 2 = 4
    expect(headings[1]).toEqual({ level: 3, text: '第一節', pos: 9 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/toc-panel.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/toc-panel'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/toc-panel.ts
import type { Editor, JSONContent } from '@tiptap/core';

export interface HeadingInfo {
  level: number;
  text: string;
  pos: number;
}

const ATOM_TYPES = new Set(['image', 'file', 'embed', 'horizontalRule', 'toc', 'hardBreak']);

function nodeText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

// JSONContent(プレーンな JSON)には ProseMirror の position 情報が無いため、
// nodeSize の計算規則(テキストは文字数、atom ノードは1、コンテナノードは
// 子の合計+2)を模倣して見出しの実位置を求める。トップレベルの見出しのみを
// 対象とする(この schema では見出しは常にトップレベル)。
function nodeSize(node: JSONContent): number {
  if (node.type === 'text') return (node.text ?? '').length;
  if (ATOM_TYPES.has(node.type ?? '')) return 1;
  const childrenSize = (node.content ?? []).reduce((sum, c) => sum + nodeSize(c), 0);
  return childrenSize + 2;
}

export function extractHeadings(doc: JSONContent): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  let pos = 0;
  for (const node of doc.content ?? []) {
    if (node.type === 'heading') {
      headings.push({
        level: (node.attrs?.level as number | undefined) ?? 2,
        text: nodeText(node),
        pos,
      });
    }
    pos += nodeSize(node);
  }
  return headings;
}

export function renderTocPanel(editor: Editor, panelEl: HTMLElement): void {
  const render = () => {
    const headings = extractHeadings(editor.getJSON());
    panelEl.replaceChildren();
    if (headings.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = '見出しを設定すると表示されます';
      panelEl.append(empty);
      return;
    }
    const list = document.createElement('ul');
    for (const h of headings) {
      const item = document.createElement('li');
      item.dataset.level = String(h.level);
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = h.text;
      link.addEventListener('click', () => {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      item.append(link);
      list.append(item);
    }
    panelEl.append(list);
  };

  render();
  editor.on('update', render);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/toc-panel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/toc-panel.ts admin/tests/toc-panel.test.ts
git commit -m "feat(admin): table-of-contents panel generated from the current heading nodes"
```

---

### Task 16: `editor-preview.ts`

**Files:**
- Create: `admin/src/lib/editor-preview.ts`
- Test: `admin/tests/editor-preview.test.ts`

**Interfaces:**
- Consumes: `renderBlocksToHtml` from `@wild-media/blocks-renderer`(Task 6)、`createBlockEditor` from `./block-editor`(Task 10)
- Produces: `export function renderPreviewHtml(editor: Editor, imageBaseUrl: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/editor-preview.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBlockEditor } from '../src/lib/block-editor';
import { renderPreviewHtml } from '../src/lib/editor-preview';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

describe('renderPreviewHtml', () => {
  it('matches renderBlocksToHtml for the same content', () => {
    const el = document.createElement('div');
    const content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    ];
    const editor = createBlockEditor({ element: el, content, extraExtensions: [] });
    const expected = renderBlocksToHtml({ type: 'doc', content }, 'https://img.test');
    expect(renderPreviewHtml(editor, 'https://img.test')).toBe(expected);
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/editor-preview.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/editor-preview'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/editor-preview.ts
import type { Editor } from '@tiptap/core';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

export function renderPreviewHtml(editor: Editor, imageBaseUrl: string): string {
  return renderBlocksToHtml(
    { type: 'doc', content: editor.getJSON().content ?? [] },
    imageBaseUrl,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/editor-preview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/editor-preview.ts admin/tests/editor-preview.test.ts
git commit -m "feat(admin): render editor content to preview HTML via the shared blocks-renderer"
```

---

### Task 17: `char-count.ts`

**Files:**
- Create: `admin/src/lib/char-count.ts`
- Test: `admin/tests/char-count.test.ts`

**Interfaces:**
- Consumes: `editor.storage.characterCount.characters()`, `editor.state.doc.textBetween(from, to)`
- Produces: `export function formatCharCount(total: number, selected: number): string`, `export function initCharCount(editor: Editor, totalEl: HTMLElement, selectionEl: HTMLElement): void`

- [ ] **Step 1: Write the failing test**

```ts
// admin/tests/char-count.test.ts
import { describe, it, expect } from 'vitest';
import { formatCharCount } from '../src/lib/char-count';

describe('formatCharCount', () => {
  it('returns empty string when nothing is selected', () => {
    expect(formatCharCount(120, 0)).toBe('');
  });
  it('returns the selected/total format when there is a selection', () => {
    expect(formatCharCount(120, 15)).toBe('選択中 15 / 全体 120 文字');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/char-count.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/char-count'`

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/char-count.ts
import type { Editor } from '@tiptap/core';

export function formatCharCount(total: number, selected: number): string {
  return selected > 0 ? `選択中 ${selected} / 全体 ${total} 文字` : '';
}

export function initCharCount(
  editor: Editor, totalEl: HTMLElement, selectionEl: HTMLElement,
): void {
  const update = () => {
    const total = (editor.storage.characterCount as { characters: () => number }).characters();
    const { from, to } = editor.state.selection;
    const selected = from === to ? 0 : editor.state.doc.textBetween(from, to).length;
    totalEl.textContent = `全体 ${total} 文字`;
    selectionEl.textContent = formatCharCount(total, selected);
  };

  update();
  editor.on('update', update);
  editor.on('selectionUpdate', update);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/char-count.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/char-count.ts admin/tests/char-count.test.ts
git commit -m "feat(admin): total/selection character count display"
```

---

### Task 18: `articles.ts` jsonb body + 楽観的排他制御、`autosave.ts`

**Files:**
- Modify: `admin/src/lib/articles.ts`
- Modify: `admin/tests/articles.test.ts`
- Create: `admin/src/lib/autosave.ts`
- Create: `admin/tests/autosave.test.ts`

**Interfaces:**
- Consumes: `JSONContent` from `@tiptap/core`、既存の`articles`テーブル`updated_at`列
- Produces: `ArticleInput`, `EditableArticle`, `SaveResult`, `buildArticlePayload`, `createDraft`, `fetchArticleForEdit`, `saveArticle`, `deleteArticle`, `checkSlugAvailable`, `validateCommissionCode`(すべて`admin/src/lib/articles.ts`)、`AutosaveSnapshot`, `AutosaveOptions`, `AutosaveController`, `createAutosave`, `saveDraftBackup`, `loadDraftBackup`, `clearDraftBackup`(すべて`admin/src/lib/autosave.ts`)— Task 19が全て消費

- [ ] **Step 1: Write the failing tests**

`admin/tests/articles.test.ts` 内の既存の `body: '...'`(markdown文字列)リテラルを、すべて `JSONContent[]` の配列に置き換える(例: `body: '# 見出し\n\n本文'` → `body: [{ type: 'paragraph', content: [{ type: 'text', text: '見出しと本文' }] }]`)。そのうえで以下を追記する:

```ts
describe('optimistic concurrency (Task 18)', () => {
  it('fetchArticleForEdit exposes updatedAt as an ISO timestamp', async () => {
    const id = await createDraft(supabase, {
      title: '更新日時テスト', slug: '',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
      coverUrl: '', commissionCode: '',
    });
    created.push(id);
    const article = await fetchArticleForEdit(supabase, id);
    expect(article).not.toBeNull();
    expect(typeof article!.updatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(article!.updatedAt))).toBe(false);
  });

  it('saveArticle succeeds when expectedUpdatedAt matches the current row', async () => {
    const id = await createDraft(supabase, {
      title: '一致テスト', slug: '', body: [], coverUrl: '', commissionCode: '',
    });
    created.push(id);
    const before = await fetchArticleForEdit(supabase, id);
    const result = await saveArticle(supabase, id, {
      title: '一致テスト2', slug: '', body: [], coverUrl: '', commissionCode: '',
    }, false, before!.updatedAt);
    expect(typeof result.updatedAt).toBe('string');
  });

  it('saveArticle throws CONFLICT when expectedUpdatedAt is stale', async () => {
    const id = await createDraft(supabase, {
      title: '競合テスト', slug: '', body: [], coverUrl: '', commissionCode: '',
    });
    created.push(id);
    const staleTimestamp = new Date(0).toISOString();
    await expect(
      saveArticle(supabase, id, {
        title: '競合テスト2', slug: '', body: [], coverUrl: '', commissionCode: '',
      }, false, staleTimestamp),
    ).rejects.toThrow('CONFLICT');
  });

  it('saveArticle throws NOT_FOUND when the article id does not exist and no expectedUpdatedAt is given', async () => {
    await expect(
      saveArticle(supabase, '00000000-0000-0000-0000-000000000000', {
        title: '存在しない', slug: '', body: [], coverUrl: '', commissionCode: '',
      }, false),
    ).rejects.toThrow('NOT_FOUND');
  });
});
```

```ts
// admin/tests/autosave.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAutosave, saveDraftBackup, loadDraftBackup, clearDraftBackup,
} from '../src/lib/autosave';

beforeEach(() => localStorage.clear());

describe('draft backup (localStorage)', () => {
  it('round-trips body through save/load, keyed by article id', () => {
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: '下書き' }] }];
    saveDraftBackup('article-1', body);
    const loaded = loadDraftBackup('article-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.body).toEqual(body);
    expect(typeof loaded!.savedAt).toBe('string');
  });

  it('returns null when there is no backup for the id', () => {
    expect(loadDraftBackup('missing')).toBeNull();
  });

  it('clearDraftBackup removes the stored backup', () => {
    saveDraftBackup('article-2', []);
    clearDraftBackup('article-2');
    expect(loadDraftBackup('article-2')).toBeNull();
  });
});

describe('createAutosave', () => {
  it('skips saving when the snapshot body has not changed since the last save', async () => {
    const save = vi.fn(async () => ({ updatedAt: 'x' }));
    const body = [{ type: 'paragraph', content: [] }];
    const autosave = createAutosave({
      intervalMs: 1000,
      getSnapshot: () => ({ body, updatedAt: 't0' }),
      save, onSaved: () => {}, onConflict: () => {}, onError: () => {},
    });
    await autosave.triggerNow();
    await autosave.triggerNow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('calls onConflict when save rejects with CONFLICT', async () => {
    const onConflict = vi.fn();
    const autosave = createAutosave({
      intervalMs: 1000,
      getSnapshot: () => ({ body: [{ type: 'paragraph' }], updatedAt: 't0' }),
      save: async () => { throw new Error('CONFLICT'); },
      onSaved: () => {}, onConflict, onError: () => {},
    });
    await autosave.triggerNow();
    expect(onConflict).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx vitest run tests/articles.test.ts tests/autosave.test.ts`
Expected: FAIL — `admin/tests/autosave.test.ts` fails with `Cannot find module '../src/lib/autosave'`; `admin/tests/articles.test.ts`'s new "fetchArticleForEdit exposes updatedAt" test fails with `expected 'undefined' to be 'string'`(現在の`fetchArticleForEdit`は`updated_at`を select/返却していない)、CONFLICT/NOT_FOUNDのテストは`promise resolved instead of rejecting`で失敗する(現在の`saveArticle`に4番目の引数が無く、行の存在確認もしていない)

- [ ] **Step 3: Write minimal implementation**

```ts
// admin/src/lib/articles.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JSONContent } from '@tiptap/core';
import { safeUrl } from './url';

export interface ArticleInput {
  title: string;
  slug: string;
  body: JSONContent[];
  coverUrl: string;
  commissionCode: string;
}

export interface ArticlePayload {
  title: string;
  slug: string | null;
  body: JSONContent[];
  cover_image_url: string | null;
  commission_code_input: string | null;
}

export interface EditableArticle {
  id: string;
  title: string;
  slug: string | null;
  body: JSONContent[];
  coverImageUrl: string | null;
  commissionCodeInput: string | null;
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
    .select('id, title, slug, body, cover_image_url, commission_code_input, status, updated_at')
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
    commissionCodeInput: data.commission_code_input,
    status: data.status,
    updatedAt: data.updated_at,
  };
}

export async function saveArticle(
  supabase: SupabaseClient, id: string, input: ArticleInput, publish: boolean,
  expectedUpdatedAt?: string,
): Promise<SaveResult> {
  const payload = buildArticlePayload(input);
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

export async function validateCommissionCode(
  supabase: SupabaseClient, code: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('validate_commission_code', { code });
  if (error) throw error;
  return (data as string | null) ?? null;
}
```

```ts
// admin/src/lib/autosave.ts
import type { JSONContent } from '@tiptap/core';

export interface AutosaveSnapshot {
  body: JSONContent[];
  updatedAt: string;
}

export interface AutosaveOptions {
  intervalMs: number;
  getSnapshot: () => AutosaveSnapshot;
  save: (body: JSONContent[], expectedUpdatedAt: string) => Promise<{ updatedAt: string }>;
  onSaved: (updatedAt: string) => void;
  onConflict: () => void;
  onError: (err: unknown) => void;
}

export interface AutosaveController {
  start(): void;
  stop(): void;
  triggerNow(): Promise<void>;
}

export function createAutosave(opts: AutosaveOptions): AutosaveController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastSavedBody: string | null = null;

  const run = async () => {
    if (inFlight) return;
    const snapshot = opts.getSnapshot();
    const serialized = JSON.stringify(snapshot.body);
    if (serialized === lastSavedBody) return;
    inFlight = true;
    try {
      const result = await opts.save(snapshot.body, snapshot.updatedAt);
      lastSavedBody = serialized;
      opts.onSaved(result.updatedAt);
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        opts.onConflict();
      } else {
        opts.onError(err);
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(run, opts.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    triggerNow: run,
  };
}

const backupKey = (articleId: string) => `wild-media:draft-backup:${articleId}`;

export function saveDraftBackup(articleId: string, body: JSONContent[]): void {
  localStorage.setItem(
    backupKey(articleId),
    JSON.stringify({ body, savedAt: new Date().toISOString() }),
  );
}

export function loadDraftBackup(
  articleId: string,
): { body: JSONContent[]; savedAt: string } | null {
  const raw = localStorage.getItem(backupKey(articleId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { body: JSONContent[]; savedAt: string };
  } catch {
    return null;
  }
}

export function clearDraftBackup(articleId: string): void {
  localStorage.removeItem(backupKey(articleId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/articles.test.ts tests/autosave.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/articles.ts admin/tests/articles.test.ts admin/src/lib/autosave.ts admin/tests/autosave.test.ts
git commit -m "feat(admin): jsonb article body, optimistic concurrency, and autosave"
```

---

### Task 19: `edit.astro` を新しいブロックエディタに全面切り替え

**Files:**
- Modify: `admin/src/pages/articles/edit.astro`(テンプレートと`<script>`ブロック全体)

**Interfaces:**
- Consumes: `createBlockEditor`/`getBodyBlocks`(Task 10)、`createSlashCommandsExtension`/`initInsertButton`/`BlockCommand`(Task 11)、`createBubbleMenuExtension`/`initBubbleToolbar`(Task 12)、`insertImageBlock`/`insertFileBlock`/`insertImageUrlBlock`(Task 13)、`insertEmbedBlock`(Task 14)、`renderTocPanel`(Task 15)、`renderPreviewHtml`(Task 16)、`initCharCount`(Task 17)、`saveArticle`/`fetchArticleForEdit`/`EditableArticle`(Task 18)、`createAutosave`/`saveDraftBackup`/`loadDraftBackup`/`clearDraftBackup`(Task 18)、`fetchImageBaseUrl`/`translateUploadError`(`admin/src/lib/images.ts`)、`initMediaPicker`(`admin/src/lib/media-picker.ts`)、`initCoverWidget`(`admin/src/lib/cover-widget.ts`、変更なし)、`translateSaveError`/`isValidArticleSlug`(`admin/src/lib/editor-helpers.ts`)
- Produces: なし(末端ページ)

- [ ] **Step 1: テンプレートのマークアップを置き換える**

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
      <p id="autosave-label" role="status"></p>
      <form id="article-form">
        <p><label>タイトル <input type="text" id="title" required /></label></p>
        <p><label>スラッグ(公開時は必須) <input type="text" id="slug" /></label>
           <span id="slug-status"></span></p>
        <fieldset>
          <legend>カバー画像(任意)</legend>
          <input type="hidden" id="cover" />
          <p id="cover-current"></p>
          <p>
            <input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp" />
            <button type="button" id="cover-clear">画像を外す</button>
          </p>
          <div id="cover-crop" style="max-width:480px;"></div>
          <p>
            <button type="button" id="cover-apply" hidden>切り抜いてアップロード</button>
            <span id="cover-status"></span>
          </p>
        </fieldset>
        <p><label>依頼者コード(任意) <input type="text" id="commission" /></label>
           <span id="commission-status"></span></p>
        <div style="display:flex; gap:1rem;">
          <aside style="width:180px;">
            <p>目次</p>
            <div id="toc-panel"></div>
          </aside>
          <div style="flex:1;">
            <div id="bubble-toolbar" hidden></div>
            <div id="editor-body-wrap" style="position:relative;">
              <div id="editor-body"></div>
            </div>
            <p>
              <span id="char-total"></span>
              <span id="char-selection"></span>
            </p>
            <input type="file" id="body-image-file" accept="image/*" hidden />
            <input type="file" id="body-file-file" accept="application/pdf,text/plain" hidden />
            <span id="body-image-status" role="status"></span>

            <div id="media-modal" role="dialog" aria-label="メディアライブラリ" hidden>
              <button type="button" id="media-close">閉じる</button>
              <p id="media-status" role="status"></p>
              <div id="media-grid"></div>
            </div>
          </div>
        </div>
        <p>
          <button type="button" id="save-draft">下書き保存</button>
          <button type="button" id="publish">公開する</button>
          <button type="button" id="unpublish">下書きに戻す</button>
          <button type="button" id="preview-toggle">プレビュー</button>
          <button type="button" id="delete">削除</button>
        </p>
      </form>
      <div id="preview-modal" role="dialog" aria-label="プレビュー" hidden>
        <button type="button" id="preview-close">閉じる</button>
        <div id="preview-body"></div>
      </div>
      <p id="message" role="alert"></p>
    </main>
  </body>
</html>
```

- [ ] **Step 2: `<script>` ブロックを置き換える**

```astro
    <script>
      import { supabaseBrowser } from '../../lib/supabase-browser';
      import { redirectTo } from '../../lib/auth';
      import { fetchArticleForEdit, saveArticle, deleteArticle, validateCommissionCode, checkSlugAvailable } from '../../lib/articles';
      import { translateSaveError, isValidArticleSlug } from '../../lib/editor-helpers';
      import { initCoverWidget } from '../../lib/cover-widget';
      import { fetchImageBaseUrl, translateUploadError } from '../../lib/images';
      import { initMediaPicker } from '../../lib/media-picker';
      import { createBlockEditor, getBodyBlocks } from '../../lib/block-editor';
      import { createSlashCommandsExtension, initInsertButton, type BlockCommand } from '../../lib/insert-menu';
      import { createBubbleMenuExtension, initBubbleToolbar } from '../../lib/bubble-toolbar';
      import { insertImageBlock, insertFileBlock, insertImageUrlBlock } from '../../lib/block-uploads';
      import { insertEmbedBlock } from '../../lib/embed-dialog';
      import { renderTocPanel } from '../../lib/toc-panel';
      import { renderPreviewHtml } from '../../lib/editor-preview';
      import { initCharCount } from '../../lib/char-count';
      import { createAutosave, saveDraftBackup, loadDraftBackup, clearDraftBackup } from '../../lib/autosave';
      import CharacterCount from '@tiptap/extension-character-count';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else {
        const id = new URLSearchParams(window.location.search).get('id') ?? '';
        const $ = (elId: string) => document.getElementById(elId) as HTMLInputElement & HTMLTextAreaElement;
        const messageEl = document.getElementById('message')!;
        const statusLabel = document.getElementById('status-label')!;
        const autosaveLabel = document.getElementById('autosave-label')!;
        const slugStatus = document.getElementById('slug-status')!;
        const commissionStatus = document.getElementById('commission-status')!;
        const imageBaseUrl = await fetchImageBaseUrl(supabaseBrowser);

        const article = await fetchArticleForEdit(supabaseBrowser, id);
        if (!article) {
          messageEl.textContent = '記事が見つかりません(自分の記事のみ編集できます)。';
          (document.getElementById('article-form') as HTMLElement).hidden = true;
        } else {
          $('title').value = article.title;
          $('slug').value = article.slug ?? '';
          const cover = initCoverWidget(supabaseBrowser);
          cover.setUrl(article.coverImageUrl);
          $('commission').value = article.commissionCodeInput ?? '';
          statusLabel.textContent = `状態: ${article.status === 'draft' ? '下書き' : '公開中'}`;

          let currentUpdatedAt = article.updatedAt;
          let initialBody = article.body;
          const backup = loadDraftBackup(id);
          if (backup && window.confirm(`未送信の変更(${backup.savedAt})が見つかりました。復元しますか?`)) {
            initialBody = backup.body;
          }

          const fileInput = document.getElementById('body-image-file') as HTMLInputElement;
          const fileFileInput = document.getElementById('body-file-file') as HTMLInputElement;
          const uploadStatus = document.getElementById('body-image-status')!;
          const bubbleToolbarEl = document.getElementById('bubble-toolbar') as HTMLElement;

          const commands: BlockCommand[] = [
            { id: 'heading2', label: '見出し(H2)', run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run() },
            { id: 'heading3', label: '見出し(H3)', run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run() },
            { id: 'bulletList', label: '箇条書き', run: (ed) => ed.chain().focus().toggleBulletList().run() },
            { id: 'orderedList', label: '番号付きリスト', run: (ed) => ed.chain().focus().toggleOrderedList().run() },
            { id: 'quote', label: '引用', run: (ed) => ed.chain().focus().toggleBlockquote().run() },
            { id: 'hr', label: '区切り線', run: (ed) => ed.chain().focus().setHorizontalRule().run() },
            { id: 'codeBlock', label: 'コード', run: (ed) => ed.chain().focus().toggleCodeBlock().run() },
            { id: 'toc', label: '目次', run: (ed) => ed.chain().focus().insertContent({ type: 'toc' }).run() },
            { id: 'image', label: '画像を挿入', run: () => fileInput.click() },
            { id: 'media', label: 'メディアから選ぶ', run: () => picker.open() },
            { id: 'file', label: 'ファイルを添付', run: () => fileFileInput.click() },
            {
              id: 'embed', label: '埋め込み(YouTube/X/Vimeo)',
              run: (ed) => {
                const url = window.prompt('埋め込みURL(YouTube / X / Vimeo)');
                if (!url) return;
                const result = insertEmbedBlock(ed, url);
                if (!result.ok) uploadStatus.textContent = result.message;
              },
            },
          ];

          const editorEl = document.getElementById('editor-body')!;
          const editor = createBlockEditor({
            element: editorEl,
            content: initialBody,
            extraExtensions: [
              createSlashCommandsExtension(commands),
              createBubbleMenuExtension(bubbleToolbarEl),
              CharacterCount.configure({ limit: null }),
            ],
          });

          bubbleToolbarEl.hidden = false;
          initBubbleToolbar(editor, bubbleToolbarEl);
          initInsertButton(editor, document.getElementById('editor-body-wrap')!);
          renderTocPanel(editor, document.getElementById('toc-panel')!);
          initCharCount(editor, document.getElementById('char-total')!, document.getElementById('char-selection')!);

          const picker = initMediaPicker(supabaseBrowser, {
            modalEl: document.getElementById('media-modal') as HTMLElement,
            gridEl: document.getElementById('media-grid') as HTMLElement,
            statusEl: document.getElementById('media-status') as HTMLElement,
            closeBtn: document.getElementById('media-close') as HTMLButtonElement,
            onPick: (url) => insertImageUrlBlock(editor, url),
          });

          fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;
            uploadStatus.textContent = 'アップロード中…';
            try {
              await insertImageBlock(supabaseBrowser, editor, file);
              uploadStatus.textContent = '画像を挿入しました。';
            } catch (err) {
              uploadStatus.textContent = translateUploadError(err);
              console.error(err);
            }
          });

          fileFileInput.addEventListener('change', async () => {
            const file = fileFileInput.files?.[0];
            fileFileInput.value = '';
            if (!file) return;
            uploadStatus.textContent = 'アップロード中…';
            try {
              await insertFileBlock(supabaseBrowser, editor, file);
              uploadStatus.textContent = 'ファイルを挿入しました。';
            } catch (err) {
              uploadStatus.textContent = translateUploadError(err);
              console.error(err);
            }
          });

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
            title: $('title').value, slug: $('slug').value, body: getBodyBlocks(editor),
            coverUrl: cover.getUrl(), commissionCode: $('commission').value,
          });

          const save = async (publish: boolean) => {
            messageEl.textContent = '';
            const input = collect();
            if (!input.title.trim()) { messageEl.textContent = 'タイトルを入力してください'; return; }
            if (publish && !isValidArticleSlug(input.slug.trim())) {
              messageEl.textContent = '公開にはスラッグが必要です(小文字英数字とハイフン)'; return;
            }
            try {
              const result = await saveArticle(supabaseBrowser, id, input, publish, currentUpdatedAt);
              currentUpdatedAt = result.updatedAt;
              clearDraftBackup(id);
              messageEl.textContent = publish ? '公開しました。' : '保存しました。';
              const fresh = await fetchArticleForEdit(supabaseBrowser, id);
              if (fresh) statusLabel.textContent = `状態: ${fresh.status === 'draft' ? '下書き' : '公開中'}`;
            } catch (err) {
              if (err instanceof Error && err.message === 'CONFLICT') {
                messageEl.textContent = '他の場所でこの記事が更新されています。ページを再読み込みしてください。';
              } else {
                messageEl.textContent = translateSaveError(err);
              }
              saveDraftBackup(id, input.body);
              console.error(err);
            }
          };

          document.getElementById('save-draft')!.addEventListener('click', () => save(false));
          document.getElementById('publish')!.addEventListener('click', () => save(true));

          document.getElementById('unpublish')!.addEventListener('click', async () => {
            messageEl.textContent = '';
            const input = collect();
            try {
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

          const previewModal = document.getElementById('preview-modal') as HTMLElement;
          const previewBody = document.getElementById('preview-body')!;
          document.getElementById('preview-toggle')!.addEventListener('click', () => {
            previewBody.innerHTML = renderPreviewHtml(editor, imageBaseUrl);
            previewModal.hidden = false;
          });
          document.getElementById('preview-close')!.addEventListener('click', () => {
            previewModal.hidden = true;
          });

          const deleteBtn = document.getElementById('delete')!;
          let deleteArmed = false;
          deleteBtn.addEventListener('click', async () => {
            messageEl.textContent = '';
            if (!deleteArmed) {
              deleteArmed = true;
              deleteBtn.textContent = '本当に削除?(もう一度押す)';
              return;
            }
            try {
              await deleteArticle(supabaseBrowser, id);
              redirectTo('/dashboard');
            } catch (err) {
              messageEl.textContent = translateSaveError(err);
              console.error(err);
            }
          });

          const autosave = createAutosave({
            intervalMs: 20000,
            getSnapshot: () => ({ body: getBodyBlocks(editor), updatedAt: currentUpdatedAt }),
            save: async (body, expectedUpdatedAt) => {
              const input = { ...collect(), body };
              const result = await saveArticle(supabaseBrowser, id, input, false, expectedUpdatedAt);
              return result;
            },
            onSaved: (updatedAt) => {
              currentUpdatedAt = updatedAt;
              clearDraftBackup(id);
              autosaveLabel.textContent = `自動保存しました(${new Date().toLocaleTimeString('ja-JP')})`;
            },
            onConflict: () => {
              autosaveLabel.textContent = '他の場所で更新されています。自動保存を停止しました。ページを再読み込みしてください。';
              autosave.stop();
            },
            onError: (err) => {
              saveDraftBackup(id, getBodyBlocks(editor));
              autosaveLabel.textContent = '自動保存に失敗しました(端末に一時保存しました)。';
              console.error(err);
            },
          });
          autosave.start();
        }
      }
    </script>
```

- [ ] **Step 3: 手動確認**

Run: `cd admin && npm run dev`(`supabase start`済みの状態で)、`http://localhost:4322/articles/edit?id=<seeded-draft-id>` を開く
Expected: ブロックエディタにシード内容が表示され、「＋」/スラッシュメニューでのブロック挿入、選択時ツールバーでの装飾切替、画像/ファイル/埋め込みの挿入、目次パネルへの見出し反映、プレビューでのサニタイズ済みHTML表示、下書き保存/公開/下書きに戻す/削除が従来通り動作し、編集から約20秒後に自動保存ラベルが更新される

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/articles/edit.astro
git commit -m "feat(admin): cut edit.astro over to the Tiptap block editor"
```

---

### Task 20: `new.astro` を新しいブロックエディタに全面切り替え

**Files:**
- Modify: `admin/src/pages/articles/new.astro`(テンプレートと`<script>`ブロック全体)

**Interfaces:**
- Consumes: Task 19と同じ(`fetchArticleForEdit`と自動保存の競合検知まわりを除く。新規下書きにはまだ`updated_at`が無いため)。加えて`createDraft`(`admin/src/lib/articles.ts`、Task 18でシグネチャ変更済み)
- Produces: なし(末端ページ)

- [ ] **Step 1: テンプレートのマークアップを置き換える**

Task 19の新マークアップ(Step 1)から `#status-label`・`#autosave-label`・`#unpublish`・`#delete` を除いたものを流用し、代わりに `#create-draft` ボタンと「公開は、下書き作成後の編集ページから行います。」という説明文を配置する。

- [ ] **Step 2: `<script>` ブロックを置き換える**

```astro
    <script>
      import { supabaseBrowser } from '../../lib/supabase-browser';
      import { redirectTo } from '../../lib/auth';
      import { createDraft, validateCommissionCode, checkSlugAvailable } from '../../lib/articles';
      import { translateSaveError, isValidArticleSlug } from '../../lib/editor-helpers';
      import { initCoverWidget } from '../../lib/cover-widget';
      import { fetchImageBaseUrl, translateUploadError } from '../../lib/images';
      import { initMediaPicker } from '../../lib/media-picker';
      import { createBlockEditor, getBodyBlocks } from '../../lib/block-editor';
      import { createSlashCommandsExtension, initInsertButton, type BlockCommand } from '../../lib/insert-menu';
      import { createBubbleMenuExtension, initBubbleToolbar } from '../../lib/bubble-toolbar';
      import { insertImageBlock, insertFileBlock, insertImageUrlBlock } from '../../lib/block-uploads';
      import { insertEmbedBlock } from '../../lib/embed-dialog';
      import { renderTocPanel } from '../../lib/toc-panel';
      import { renderPreviewHtml } from '../../lib/editor-preview';
      import { initCharCount } from '../../lib/char-count';
      import CharacterCount from '@tiptap/extension-character-count';

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        redirectTo('/login');
      } else {
        const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement;
        const messageEl = document.getElementById('message')!;
        const slugStatus = document.getElementById('slug-status')!;
        const commissionStatus = document.getElementById('commission-status')!;
        const cover = initCoverWidget(supabaseBrowser);
        const imageBaseUrl = await fetchImageBaseUrl(supabaseBrowser);

        const fileInput = document.getElementById('body-image-file') as HTMLInputElement;
        const fileFileInput = document.getElementById('body-file-file') as HTMLInputElement;
        const uploadStatus = document.getElementById('body-image-status')!;
        const bubbleToolbarEl = document.getElementById('bubble-toolbar') as HTMLElement;

        const commands: BlockCommand[] = [
          { id: 'heading2', label: '見出し(H2)', run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run() },
          { id: 'heading3', label: '見出し(H3)', run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run() },
          { id: 'bulletList', label: '箇条書き', run: (ed) => ed.chain().focus().toggleBulletList().run() },
          { id: 'orderedList', label: '番号付きリスト', run: (ed) => ed.chain().focus().toggleOrderedList().run() },
          { id: 'quote', label: '引用', run: (ed) => ed.chain().focus().toggleBlockquote().run() },
          { id: 'hr', label: '区切り線', run: (ed) => ed.chain().focus().setHorizontalRule().run() },
          { id: 'codeBlock', label: 'コード', run: (ed) => ed.chain().focus().toggleCodeBlock().run() },
          { id: 'toc', label: '目次', run: (ed) => ed.chain().focus().insertContent({ type: 'toc' }).run() },
          { id: 'image', label: '画像を挿入', run: () => fileInput.click() },
          { id: 'media', label: 'メディアから選ぶ', run: () => picker.open() },
          { id: 'file', label: 'ファイルを添付', run: () => fileFileInput.click() },
          {
            id: 'embed', label: '埋め込み(YouTube/X/Vimeo)',
            run: (ed) => {
              const url = window.prompt('埋め込みURL(YouTube / X / Vimeo)');
              if (!url) return;
              const result = insertEmbedBlock(ed, url);
              if (!result.ok) uploadStatus.textContent = result.message;
            },
          },
        ];

        const editor = createBlockEditor({
          element: document.getElementById('editor-body')!,
          content: [],
          extraExtensions: [
            createSlashCommandsExtension(commands),
            createBubbleMenuExtension(bubbleToolbarEl),
            CharacterCount.configure({ limit: null }),
          ],
        });

        bubbleToolbarEl.hidden = false;
        initBubbleToolbar(editor, bubbleToolbarEl);
        initInsertButton(editor, document.getElementById('editor-body-wrap')!);
        renderTocPanel(editor, document.getElementById('toc-panel')!);
        initCharCount(editor, document.getElementById('char-total')!, document.getElementById('char-selection')!);

        const picker = initMediaPicker(supabaseBrowser, {
          modalEl: document.getElementById('media-modal') as HTMLElement,
          gridEl: document.getElementById('media-grid') as HTMLElement,
          statusEl: document.getElementById('media-status') as HTMLElement,
          closeBtn: document.getElementById('media-close') as HTMLButtonElement,
          onPick: (url) => insertImageUrlBlock(editor, url),
        });

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file) return;
          uploadStatus.textContent = 'アップロード中…';
          try {
            await insertImageBlock(supabaseBrowser, editor, file);
            uploadStatus.textContent = '画像を挿入しました。';
          } catch (err) {
            uploadStatus.textContent = translateUploadError(err);
            console.error(err);
          }
        });

        fileFileInput.addEventListener('change', async () => {
          const file = fileFileInput.files?.[0];
          fileFileInput.value = '';
          if (!file) return;
          uploadStatus.textContent = 'アップロード中…';
          try {
            await insertFileBlock(supabaseBrowser, editor, file);
            uploadStatus.textContent = 'ファイルを挿入しました。';
          } catch (err) {
            uploadStatus.textContent = translateUploadError(err);
            console.error(err);
          }
        });

        $('slug').addEventListener('blur', async () => {
          const slug = $('slug').value.trim();
          if (!slug) { slugStatus.textContent = ''; return; }
          if (!isValidArticleSlug(slug)) { slugStatus.textContent = '形式が不正です'; return; }
          slugStatus.textContent = (await checkSlugAvailable(supabaseBrowser, slug)) ? '利用可能' : '使用済み';
        });

        $('commission').addEventListener('blur', async () => {
          const code = $('commission').value.trim();
          if (!code) { commissionStatus.textContent = ''; return; }
          const name = await validateCommissionCode(supabaseBrowser, code);
          commissionStatus.textContent = name ? `依頼者: ${name}` : 'コードが見つかりません';
        });

        const collect = () => ({
          title: $('title').value, slug: $('slug').value, body: getBodyBlocks(editor),
          coverUrl: cover.getUrl(), commissionCode: $('commission').value,
        });

        const previewModal = document.getElementById('preview-modal') as HTMLElement;
        const previewBody = document.getElementById('preview-body')!;
        document.getElementById('preview-toggle')!.addEventListener('click', () => {
          previewBody.innerHTML = renderPreviewHtml(editor, imageBaseUrl);
          previewModal.hidden = false;
        });
        document.getElementById('preview-close')!.addEventListener('click', () => {
          previewModal.hidden = true;
        });

        const draftBtn = document.getElementById('create-draft') as HTMLButtonElement;
        let draftInFlight = false;

        const create = async () => {
          if (draftInFlight) return;
          messageEl.textContent = '';
          const input = collect();
          if (!input.title.trim()) { messageEl.textContent = 'タイトルを入力してください'; return; }
          draftInFlight = true;
          draftBtn.disabled = true;
          try {
            const id = await createDraft(supabaseBrowser, input);
            redirectTo(`/articles/edit?id=${id}`);
          } catch (err) {
            messageEl.textContent = translateSaveError(err);
            console.error(err);
          } finally {
            draftInFlight = false;
            draftBtn.disabled = false;
          }
        };

        draftBtn.addEventListener('click', () => create());
      }
    </script>
```

- [ ] **Step 3: 手動確認**

Run: `cd admin && npm run dev`、`http://localhost:4322/articles/new` を開く
Expected: 空のエディタが表示され、挿入メニュー/ツールバー/アップロード/埋め込み/目次/プレビューがすべて動作し、「下書きを作成して編集へ」で下書きが作られ`edit.astro`にリダイレクトされ、入力したブロックが保持されている

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/articles/new.astro
git commit -m "feat(admin): cut new.astro over to the Tiptap block editor"
```

---

### Task 21: `slash-menu.ts` の削除と `editor-helpers.ts` の整理

**Files:**
- Delete: `admin/src/lib/slash-menu.ts`
- Delete: `admin/tests/slash-menu.test.ts`
- Modify: `admin/src/lib/editor-helpers.ts`(`renderMarkdownPreview`と`marked`/`sanitize-html`のimportを撤去)
- Modify: `admin/tests/editor-helpers.test.ts`(`renderMarkdownPreview`のdescribeブロックを撤去)

**Interfaces:**
- Consumes: なし
- Produces: `editor-helpers.ts`は`isValidArticleSlug`と`translateSaveError`のみをエクスポートする

- [ ] **Step 1: 削除対象を他が参照していないことを確認**

Run: `grep -rn "slash-menu\|renderMarkdownPreview" admin/src admin/tests`
Expected: このタスクで削除/編集するファイル以外に一致なし(Task 19/20で既に`slash-menu.ts`/`renderMarkdownPreview`のimportは無くなっている)

- [ ] **Step 2: 旧ファイルを削除**

```bash
rm admin/src/lib/slash-menu.ts admin/tests/slash-menu.test.ts
```

- [ ] **Step 3: `editor-helpers.ts` を整理**

```ts
// admin/src/lib/editor-helpers.ts
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
  if (msg.includes('IMAGE_LIMIT_EXCEEDED')) {
    return '本文に入れられる画像は5枚までです。';
  }
  if (msg.includes('IMAGE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所の画像は使えません。「/」から画像を挿入してください。';
  }
  if (msg.includes('FILE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所のファイルは使えません。「/」からファイルを添付してください。';
  }
  if (msg.includes('EMBED_HOST_NOT_ALLOWED')) {
    return '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。';
  }
  if (msg.includes('BODY_EMPTY_ON_PUBLISH')) {
    return '公開するには本文にテキストを入力してください。';
  }
  return '保存に失敗しました。入力内容を確認して再度お試しください。';
}
```

`admin/tests/editor-helpers.test.ts` から `describe('renderMarkdownPreview', ...)` ブロックを削除し、3つの新しいエラー翻訳のテストを追加する:

```ts
// admin/tests/editor-helpers.test.ts 内、describe('translateSaveError') に追記
it('FILE_HOST_NOT_ALLOWED を訳す', () => {
  expect(translateSaveError(new Error('FILE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
});
it('EMBED_HOST_NOT_ALLOWED を訳す', () => {
  expect(translateSaveError(new Error('EMBED_HOST_NOT_ALLOWED'))).toContain('YouTube');
});
it('BODY_EMPTY_ON_PUBLISH を訳す', () => {
  expect(translateSaveError(new Error('BODY_EMPTY_ON_PUBLISH'))).toContain('本文');
});
```

`admin/src/lib/images.ts` から未使用となった `countBodyImages`/`insertAtCursor` エクスポート(旧textarea経路専用だった)と、`admin/tests/images.test.ts` の対応するテストケースも削除する。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx vitest run tests/editor-helpers.test.ts tests/images.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A admin/src/lib/editor-helpers.ts admin/tests/editor-helpers.test.ts admin/src/lib/images.ts admin/tests/images.test.ts
git rm admin/src/lib/slash-menu.ts admin/tests/slash-menu.test.ts
git commit -m "chore(admin): remove the retired textarea slash-menu and markdown preview code"
```

---

### Task 22: 公開サイト — `content.ts` を `renderBlocksToHtml` に切り替え

**Files:**
- Modify: `src/lib/content.ts`(`renderMarkdown` → `renderBlocksToHtml`、`fetchArticleBySlug`)
- Modify: `tests/content.test.ts`

**Interfaces:**
- Consumes: `renderBlocksToHtml` from `@wild-media/blocks-renderer`(Task 6)
- Produces: `ArticleDetail.bodyHtml`は`renderBlocksToHtml`由来になる。`renderMarkdown`と`marked`/`sanitize-html`のimportは`content.ts`から撤去

- [ ] **Step 1: Write the failing test**

```ts
// tests/content.test.ts — describe('renderMarkdown', ...) ブロックを置き換え
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

describe('article rendering via renderBlocksToHtml', () => {
  const BASE = 'https://img.test';

  it('renders blocks and strips scripts', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '強調', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ] };
    const html = renderBlocksToHtml(doc, BASE);
    expect(html).toContain('<h2 id="見出し">');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: '' } }] };
    expect(renderBlocksToHtml(doc, BASE)).toContain(`src="${BASE}/x.webp"`);
  });

  it('許可ホスト以外の画像は落とす', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: 'https://evil.example/x.webp', alt: '', caption: '' } }] };
    expect(renderBlocksToHtml(doc, BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: '' } }] };
    expect(renderBlocksToHtml(doc, '')).not.toContain('<img');
  });
});
```

`content data layer` describeブロックの `fetchArticleBySlug` アサーションも更新する:

```ts
it('returns article detail with sanitized rendered body', async () => {
  const article = await fetchArticleBySlug(db, 'kawabe-kansatsu');
  expect(article).not.toBeNull();
  expect(article!.authorName).toBe('田中 花');
  expect(article!.authorSlug).toBe('tanaka-hana');
  expect(article!.bodyHtml).toContain('<h2 id="川辺にて">');
  expect(article!.bodyHtml).not.toContain('<script');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content.test.ts`
Expected: FAIL — `renderBlocksToHtml`のimport自体は解決するが、`src/lib/content.ts`の`fetchArticleBySlug`がまだ旧`renderMarkdown(data.body, imageBaseUrl)`をmarkdown文字列相手に呼んでいるため`article!.bodyHtml`に`<h2 id="...">`が含まれない

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content.ts — ファイル冒頭
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';
```

(`import { marked } from 'marked';` と `import sanitizeHtml from 'sanitize-html';` を削除し、`export function renderMarkdown(...)` 関数を丸ごと削除する — `renderBlocksToHtml`が`packages/blocks-renderer`にある)

```ts
// src/lib/content.ts — fetchArticleBySlug、最後の2行を置き換え
  const imageBaseUrl = await fetchImageBaseUrl(db);
  return {
    ...toSummary(data),
    bodyHtml: renderBlocksToHtml({ type: 'doc', content: (data as any).body }, imageBaseUrl),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/content.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/content.ts tests/content.test.ts
git commit -m "feat(site): render article bodies via the shared blocks renderer"
```

---

### Task 23: 未使用になった `marked`/`sanitize-html` の直接依存を撤去

**Files:**
- Modify: `package.json`(root)
- Modify: `admin/package.json`

**Interfaces:**
- Consumes: なし
- Produces: なし(依存関係の整理のみ)

- [ ] **Step 1: 残存importが無いことを確認**

Run: `grep -rln "from 'marked'\|from \"marked\"\|from 'sanitize-html'\|from \"sanitize-html\"" src admin/src`
Expected: 一致なし(`packages/blocks-renderer/src/render.ts`だけが引き続き`sanitize-html`をimportするが、それは自分の`package.json`で完結する)

- [ ] **Step 2: 依存を削除**

```json
// package.json (root) — dependencies block
"dependencies": {
  "@supabase/supabase-js": "^2.45.0",
  "@wild-media/blocks-renderer": "^0.1.0",
  "astro": "^5.0.0"
},
"devDependencies": {
  "dotenv": "^16.4.0",
  "vitest": "^2.1.0"
}
```

```json
// admin/package.json — dependencies block(marked/sanitize-html/@types/sanitize-htmlを撤去)
"dependencies": {
  "@supabase/supabase-js": "^2.45.0",
  "@tiptap/core": "2.27.2",
  "@tiptap/starter-kit": "2.27.2",
  "@tiptap/suggestion": "2.27.2",
  "@tiptap/extension-bubble-menu": "2.27.2",
  "@tiptap/extension-character-count": "2.27.2",
  "@tiptap/extension-link": "2.27.2",
  "@tiptap/extension-text-align": "2.27.2",
  "@wild-media/blocks-renderer": "^0.1.0",
  "cropperjs": "^1.6.2"
}
```

Run: `npm install`(repo root)

- [ ] **Step 3: 全レイヤーのテストを流して壊れていないことを確認**

Run: `npm test && cd admin && npm test && cd .. && supabase test db`
Expected: PASS(3レイヤーすべて)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json admin/package.json admin/package-lock.json
git commit -m "chore: drop marked/sanitize-html now that blocks-renderer owns HTML generation"
```

---

### Task 24: `ARCHITECTURE.md` をドキュメント保守ルールに従って更新

**Files:**
- Modify: `ARCHITECTURE.md`(`articles.body`をMarkdownと説明している「主要ルール」の記述)

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: 古い記述を更新**

以下の記述:
```
- 記事本文は Markdown のまま `articles.body` に保存。HTML 化はビルド時(公開サイト)とプレビュー時(CMS)のみ
```
を、以下に置き換える:
```
- 記事本文は Tiptap(ProseMirror)のブロック JSON 配列として `articles.body`(jsonb)に保存。
  HTML 化は `packages/blocks-renderer/` の `renderBlocksToHtml()` に一本化されており、
  公開サイトのビルド時と CMS のプレビュー時の両方がこれを呼ぶ(生成 HTML が食い違わない)
```

画像ルールの記述:
```
- 本文の画像は 5 枚まで、かつ `settings.image_base_url` 配下のものだけ
  (`articles` のトリガー `a_enforce_body_image_rules`。違反時の例外は
  `IMAGE_LIMIT_EXCEEDED`(枚数超過)・`IMAGE_HOST_NOT_ALLOWED`(許可外ホスト)・
  `HTML_IMG_NOT_ALLOWED`(生の `<img>` タグ)・`IMAGE_SYNTAX_NOT_ALLOWED`
  (reference 記法 `![x][1]` や shortcut 記法 `![x]` など、インライン以外の
  markdown 画像構文)の4種)。本文に生の `<img>` タグは書けない(markdown の
  `![](url)` のみ)。
```
を、以下に置き換える:
```
- 本文の画像・ファイルブロックは `settings.image_base_url` 配下の URL のみ許可し、
  画像は 5 枚まで(`articles` のトリガー `a_enforce_body_image_rules`。違反時の例外は
  `IMAGE_LIMIT_EXCEEDED`・`IMAGE_HOST_NOT_ALLOWED`・`FILE_HOST_NOT_ALLOWED`)。
  埋め込みブロックの URL は許可プロバイダドメイン(YouTube/X/Vimeo)のみ許可
  (`EMBED_HOST_NOT_ALLOWED`)。body は構造化 JSON のため、生の `<img>` タグや
  reference/shortcut 記法での抜け道はそもそも存在しない。
- 公開するには本文ブロックにテキストを持つノードが1つ以上必要
  (`b_enforce_publish_rules`。違反時は `BODY_EMPTY_ON_PUBLISH`)。
```

- [ ] **Step 2: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md for the jsonb block body and its DB rules"
```

## Critical Files for Implementation

- `packages/blocks-renderer/src/extensions.ts` — admin・公開サイトが共有するブロックスキーマの単一の情報源
- `packages/blocks-renderer/src/render.ts` — `renderBlocksToHtml`、`admin/`と`src/`両方が依存する関数
- `supabase/migrations/20260712090100_body_image_rules_jsonb.sql`(および`090200`/`090300`)— 他すべてが満たすべきDB強制ルール
- `admin/src/lib/block-editor.ts` — 他のadminエディタモジュールが土台とするvanilla JS Tiptap組み込みパターン
- `admin/src/pages/articles/edit.astro` — 挿入メニュー・ツールバー・アップロード・埋め込み・目次・プレビュー・自動保存のすべてが組み上がる合流点
