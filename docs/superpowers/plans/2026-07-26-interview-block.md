# インタビュー(会話)ブロック 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事本文に対話形式ブロックを追加する。話者(2〜4人)を1度登録すれば、＋ボタンで発言を積み重ねられる。公開サイトでは左右交互のインタビュー風レイアウトで表示する。

**Architecture:** 既存の Tiptap カスタムノード (image / embed / file / toc) と同じパターンで、新しい block ノード `interview`(話者を attrs に保持) と、その子 block ノード `turn`(speaker attr で発話者指定、content は inline のみ)を追加する。編集画面では ProseMirror `Decoration` プラグインで話者カード・＋ボタン・話者選択 UI をオーバーレイし、話者登録は `<div hidden>` パターン(既存 `initMediaPicker` と同型)のモーダルで行う。公開サイトは Tiptap `generateHTML` 経由で `<section class="interview-block">` を吐き、既存 `sanitize-html` の allowlist と `.article-body` CSS を拡張する。DB は `body_asset_urls()` を拡張して `speakers[].avatarUrl` も画像アセットとして扱う (既存の `enforce_body_image_rules` と `block_media_in_use` に自動的に組み込まれる)。加えて `enforce_interview_structure` トリガーで話者数(2〜4)・キー連番・`turn.speaker` の参照整合を強制する。

**Tech Stack:** Astro / vanilla Tiptap 2.x (`@tiptap/core`) / TypeScript / Supabase Postgres (plpgsql / sql) / Deno Edge Function (`_shared/chunking.ts`) / Vitest / pgTAP

## Global Constraints

これらは仕様全体にかかる横断的な制約。各タスクの要件に暗黙で含まれる。

- **権限・ビジネスルールは DB 層で強制する** (CLAUDE.md 冒頭)。話者数・キー連番・`turn.speaker` の参照整合・アバターURLのホスト制限はすべて Postgres トリガー + pgTAP テストで書く。クライアント側の検証は UX 目的のみ。
- **`packages/blocks-renderer/`** は admin と公開サイト両方から import される。**ブラウザ / Node 両対応** で書き、`Deno.*` や `npm:` を使わない (既存踏襲)。
- **`supabase/functions/_shared/chunking.ts`** も Deno / Node 両対応 (ファイル冒頭コメントに明記あり、Vitest から import される既存パターン)。
- **話者キー**: `A` から始まる連番の英大文字。話者数 N (2〜4) のとき、`speakers[i].key` は `String.fromCharCode(65 + i)`。飛び番・重複禁止。
- **アバターURLのホスト**: `settings.image_base_url` 配下のみ許可 (既存 `enforce_body_image_rules` が担当)。
- **`turn` の中身**: text + inline marks (bold / italic / strike / link) のみ。ブロックノード禁止。ProseMirror スキーマ `content: 'inline*'` で強制。
- **UI 言語**: 日本語 (既存踏襲)。ラベル・エラーメッセージ・スラッシュメニュー項目名すべて。
- **話者削除ポリシー**: 末尾から削除のみ (中間削除は不可、キー連番を保つため)。「話者を削除」ボタンは常に配列末尾の話者にだけ表示する。
- **1つの `interview` ブロックには初期状態で 1 件の空 `turn`(speaker=A) を含めた形で挿入する** (空 turn の interview は DB トリガーで拒否されるため)。

---

### Task 1: Tiptap ノード定義 (`InterviewNode` + `TurnNode`)

`interview` (block, `content: 'turn+'`) と `turn` (block, `content: 'inline*'`) の 2 ノードを Tiptap に登録する。 admin と公開サイトが共有する `packages/blocks-renderer/src/extensions.ts` に追加し、既存の image/embed/file と同じ形式で定義する。

**Files:**
- Modify: `packages/blocks-renderer/src/extensions.ts` (現在 103 行、`blockExtensions` 配列の末尾に追加)
- Create: `packages/blocks-renderer/test/interview.test.ts`

**Interfaces:**
- Consumes: 既存の `@tiptap/core` の `Node` (imports にすでに存在)
- Produces:
  - `InterviewNode`: `Node.create({ name: 'interview', group: 'block', content: 'turn+', defining: true, attrs.speakers: default null })`
  - `TurnNode`: `Node.create({ name: 'turn', group: 'block', content: 'inline*', defining: true, attrs.speaker: default 'A' })`
  - 両ノードが `blockExtensions` からエクスポートされる (下流の renderer / editor で自動的に有効化)

- [ ] **Step 1: 失敗するテストを書く**

`packages/blocks-renderer/test/interview.test.ts` を新規作成:

```ts
import { describe, expect, it } from 'vitest';
import { generateHTML, generateJSON } from '@tiptap/html';
import { blockExtensions } from '../src/extensions';

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'interview',
      attrs: {
        speakers: [
          { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
          { key: 'B', name: '川崎', role: 'Kaeru 代表', avatarUrl: 'https://img.test/b.webp' },
        ],
      },
      content: [
        { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'こんにちは' }] },
        { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'よろしく' }] },
      ],
    },
  ],
};

describe('interview node', () => {
  it('generates HTML with turn wrappers keyed by speaker', () => {
    const html = generateHTML(sampleDoc, blockExtensions);
    expect(html).toContain('<section');
    expect(html).toContain('class="interview-block"');
    expect(html).toContain('data-speaker="A"');
    expect(html).toContain('data-speaker="B"');
    expect(html).toContain('こんにちは');
    expect(html).toContain('よろしく');
  });

  it('roundtrips speakers attrs through JSON', () => {
    const html = generateHTML(sampleDoc, blockExtensions);
    const roundtripped = generateJSON(html, blockExtensions);
    const interview = roundtripped.content?.[0];
    expect(interview?.type).toBe('interview');
    expect(interview?.attrs?.speakers).toHaveLength(2);
    expect(interview?.attrs?.speakers?.[0]).toEqual({
      key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp',
    });
    const firstTurn = interview?.content?.[0];
    expect(firstTurn?.type).toBe('turn');
    expect(firstTurn?.attrs?.speaker).toBe('A');
  });

  it('rejects a turn placed outside of an interview (schema check)', () => {
    const badDoc = {
      type: 'doc',
      content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'x' }] }],
    };
    // generateHTML wraps in a strict schema; a top-level turn should not render as a turn wrapper.
    const html = generateHTML(badDoc, blockExtensions);
    expect(html).not.toContain('data-speaker="A"');
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
cd packages/blocks-renderer && npx vitest run test/interview.test.ts
```
Expected: FAIL (`interview` ノードが未定義)。

- [ ] **Step 3: `InterviewNode` と `TurnNode` を追加**

`packages/blocks-renderer/src/extensions.ts` を編集。既存の `Toc` の後 (line 87 あたり)、`blockExtensions` 配列の直前に以下を追加:

```ts
const Interview = Node.create({
  name: 'interview',
  group: 'block',
  content: 'turn+',
  defining: true,
  addAttributes() {
    return {
      speakers: { default: null },
    };
  },
  parseHTML() {
    return [{
      tag: 'section[data-block="interview"]',
      getAttrs: (el) => {
        const raw = (el as HTMLElement).getAttribute('data-speakers');
        try {
          return { speakers: raw ? JSON.parse(raw) : null };
        } catch {
          return { speakers: null };
        }
      },
    }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const speakers = node.attrs.speakers ?? [];
    return [
      'section',
      {
        ...HTMLAttributes,
        'data-block': 'interview',
        'data-speakers': JSON.stringify(speakers),
        class: 'interview-block',
      },
      0,
    ];
  },
});

const Turn = Node.create({
  name: 'turn',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      speaker: { default: 'A' },
    };
  },
  parseHTML() {
    return [{
      tag: 'div[data-block="turn"]',
      getAttrs: (el) => ({ speaker: (el as HTMLElement).getAttribute('data-speaker') ?? 'A' }),
    }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const speaker = node.attrs.speaker ?? 'A';
    return [
      'div',
      { ...HTMLAttributes, 'data-block': 'turn', 'data-speaker': speaker, class: `turn turn--${speaker}` },
      0,
    ];
  },
});
```

そして既存の `blockExtensions` 配列の末尾に `Interview` と `Turn` を追加:

```ts
export const blockExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Link.configure({ openOnClick: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  Embed,
  FileBlock,
  Toc,
  Interview,
  Turn,
];
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd packages/blocks-renderer && npx vitest run test/interview.test.ts
```
Expected: PASS (3 tests)。

- [ ] **Step 5: 既存テストを壊していないか確認**

```bash
cd packages/blocks-renderer && npx vitest run
```
Expected: 全 tests PASS。

- [ ] **Step 6: コミット**

```bash
git add packages/blocks-renderer/src/extensions.ts packages/blocks-renderer/test/interview.test.ts
git commit -m "feat(blocks): add interview and turn Tiptap nodes for conversation UI"
```

---

### Task 2: DB スキーマ検証 (`body_asset_urls` 拡張 + `enforce_interview_structure`)

Postgres 側で interview ブロックの構造整合を強制する。既存の `body_asset_urls(body, asset_type)` を拡張して `interview.attrs.speakers[].avatarUrl` も画像アセットとして返すようにし、加えて話者数・キー連番・turn.speaker の参照整合を検証する `enforce_interview_structure` トリガーを追加する。

**Files:**
- Create: `supabase/migrations/20260726120000_body_asset_urls_interview.sql`
- Create: `supabase/migrations/20260726120100_enforce_interview_structure.sql`
- Create: `supabase/tests/database/17_interview_block_rules.test.sql`

**Interfaces:**
- Consumes: Task 1 で決定した JSON 形状 (`interview.attrs.speakers`, `turn.attrs.speaker`)
- Produces:
  - 拡張された `public.body_asset_urls(body jsonb, asset_type text)` — `asset_type='image'` のとき `speakers[].avatarUrl` も返す
  - 新規トリガー `a_enforce_interview_structure` on `public.articles` (BEFORE INSERT OR UPDATE)
  - エラーコード: `INTERVIEW_SPEAKER_COUNT` / `INTERVIEW_KEY_SEQUENCE` / `INTERVIEW_SPEAKER_NAME_EMPTY` / `INTERVIEW_TURN_SPEAKER_UNKNOWN` / `INTERVIEW_EMPTY_TURNS`

- [ ] **Step 1: pgTAP テストを書く (失敗するはず)**

`supabase/tests/database/17_interview_block_rules.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- 前提: image_base_url を固定
update settings set image_base_url = 'https://img.test' where id = 1;

-- テスト用ライター
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'iv-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000c1', 'writer', 'iv-writer', 'IV Writer');

-- 正常系: 2人インタビュー
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ok-2', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"米田","role":"聞き手","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"川崎","role":"代表","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
        {"type":"turn","attrs":{"speaker":"B"},"content":[{"type":"text","text":"y"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  '2人インタビューは通る'
);

-- 正常系: 4人座談会
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ok-4', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
        {"type":"turn","attrs":{"speaker":"D"},"content":[{"type":"text","text":"z"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  '4人座談会は通る'
);

-- 異常系: 話者1人
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-1', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_COUNT', '話者1人は拒否'
);

-- 異常系: 話者5人
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-5', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"},
        {"key":"E","name":"E","role":"","avatarUrl":"https://img.test/e.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_COUNT', '話者5人は拒否'
);

-- 異常系: キー飛び番 (A, C)
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-gap', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_KEY_SEQUENCE', 'キー飛び番は拒否'
);

-- 異常系: 名前空
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-name', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_NAME_EMPTY', '名前空は拒否'
);

-- 異常系: 未登録話者を参照
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-ref', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"C"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_TURN_SPEAKER_UNKNOWN', '未登録話者への参照は拒否'
);

-- 異常系: turn 0件
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-empty', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_EMPTY_TURNS', 'turn 0件は拒否'
);

-- 異常系: アバターURLが image_base_url 外
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-host', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://evil.example/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'アバターURLの非許可ホストは拒否'
);

-- 検証: body_asset_urls('image') が interview 内のアバターも返す
select set_eq(
  $$select public.body_asset_urls((select body from articles where slug = 'iv-ok-2'), 'image')$$,
  $$values ('https://img.test/a.webp'), ('https://img.test/b.webp')$$,
  'body_asset_urls は interview のアバターも列挙する'
);

-- 検証: アバターは image 数上限にはカウントしない (MAX_BODY_IMAGES=5、interview アバターは別枠)
-- 4人インタビュー(=4アバター) + image ノード5件 → 通る
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-images-ok', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]},
      {"type":"image","attrs":{"url":"https://img.test/1.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/2.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/3.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/4.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/5.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'アバター4枚 + image5枚 は通る (別カウント)'
);

-- 検証: block_media_in_use が interview 内アバターも参照中とみなす
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1', 'https://img.test/a.webp', 1000);

select throws_ok(
  $$delete from media where url = 'https://img.test/a.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'interview のアバターは media から削除できない'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
supabase db reset && supabase test db
```

Expected: `17_interview_block_rules.test.sql` が新規に落ちる (トリガー未定義)。

- [ ] **Step 3: `body_asset_urls` 拡張マイグレーションを書く**

`supabase/migrations/20260726120000_body_asset_urls_interview.sql`:

```sql
-- body_asset_urls を SQL 版に置き換え、interview.attrs.speakers[].avatarUrl も列挙対象にする。
-- asset_type='image' のときのみアバターも返す (画像アセットの一種として扱う)。

create or replace function public.body_asset_urls(body jsonb, asset_type text)
returns setof text
language sql
immutable
set search_path = public
as $$
  with recursive nodes as (
    select jsonb_array_elements(coalesce(body, '[]'::jsonb)) as n
    union all
    select jsonb_array_elements(n->'content')
    from nodes
    where jsonb_typeof(n->'content') = 'array'
  )
  -- 既存: type=asset_type のノードの attrs.url
  select n->'attrs'->>'url'
  from nodes
  where n->>'type' = asset_type
    and n->'attrs'->>'url' is not null

  union all

  -- 追加: interview.attrs.speakers[*].avatarUrl (asset_type='image' のときのみ対象)
  select s->>'avatarUrl'
  from nodes,
       lateral jsonb_array_elements(coalesce(n->'attrs'->'speakers', '[]'::jsonb)) as s
  where n->>'type' = 'interview'
    and asset_type = 'image'
    and s->>'avatarUrl' is not null;
$$;

comment on function public.body_asset_urls(jsonb, text) is
  '記事本文 JSON から指定タイプの画像/ファイルURLを列挙する。 asset_type=image のとき interview.attrs.speakers[].avatarUrl も対象。';
```

- [ ] **Step 4: `enforce_interview_structure` マイグレーションを書く**

`supabase/migrations/20260726120100_enforce_interview_structure.sql`:

```sql
-- インタビューブロックの構造整合を強制する。
-- body 内の各 interview ノードについて:
--  * speakers 長さ 2〜4
--  * speakers[i].key が A から始まる連番 (A, AB, ABC, ABCD のいずれか)
--  * speakers[i].name が空でない
--  * content が最低 1 件の turn
--  * 各 turn.attrs.speaker が speakers[*].key に存在
--
-- 参照: docs/superpowers/specs/2026-07-26-interview-block-design.md
--       Global Constraints (docs/superpowers/plans/2026-07-26-interview-block.md)

create or replace function public.enforce_interview_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  interview_node jsonb;
  speakers jsonb;
  turn_node jsonb;
  speaker_key text;
  expected_key text;
  speaker_keys text[];
  i int;
begin
  -- body 未変更 UPDATE はスキップ (enforce_body_image_rules と同じ救済経路)
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if jsonb_typeof(new.body) <> 'array' then
    return new;  -- body が配列でない場合はここでは何もしない (別のガードに任せる)
  end if;

  -- トップレベルの interview ノードを走査 (現状 interview はトップレベルのみを想定)
  for interview_node in
    select value
    from jsonb_array_elements(new.body) as value
    where value->>'type' = 'interview'
  loop
    speakers := interview_node -> 'attrs' -> 'speakers';

    -- 話者数チェック (2〜4)
    if speakers is null
       or jsonb_typeof(speakers) <> 'array'
       or jsonb_array_length(speakers) < 2
       or jsonb_array_length(speakers) > 4 then
      raise exception 'INTERVIEW_SPEAKER_COUNT';
    end if;

    -- キー連番チェック (A から始まる連番)
    speaker_keys := array[]::text[];
    for i in 0 .. jsonb_array_length(speakers) - 1 loop
      expected_key := chr(65 + i);  -- 'A', 'B', 'C', 'D'
      speaker_key := speakers -> i ->> 'key';
      if speaker_key is null or speaker_key <> expected_key then
        raise exception 'INTERVIEW_KEY_SEQUENCE';
      end if;
      -- 名前空チェック
      if coalesce(nullif(speakers -> i ->> 'name', ''), '') = '' then
        raise exception 'INTERVIEW_SPEAKER_NAME_EMPTY';
      end if;
      speaker_keys := speaker_keys || speaker_key;
    end loop;

    -- turn が最低 1 件
    if jsonb_typeof(interview_node -> 'content') <> 'array'
       or jsonb_array_length(interview_node -> 'content') < 1 then
      raise exception 'INTERVIEW_EMPTY_TURNS';
    end if;

    -- 各 turn.speaker が speakers に存在
    for turn_node in
      select value from jsonb_array_elements(interview_node -> 'content') as value
    loop
      if turn_node ->> 'type' <> 'turn' then
        continue;
      end if;
      speaker_key := turn_node -> 'attrs' ->> 'speaker';
      if speaker_key is null or not (speaker_key = any(speaker_keys)) then
        raise exception 'INTERVIEW_TURN_SPEAKER_UNKNOWN';
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

comment on function public.enforce_interview_structure() is
  'interview ノードの話者数(2-4)・キー連番・turn.speaker 参照整合を検証する。';

-- トリガーバインド (既存 enforce_body_image_rules と同じく BEFORE INSERT OR UPDATE)。
-- 名前は 'b_' プレフィックスで実行順を後ろに (先に image URL 検証、次に interview 構造)。
create trigger b_enforce_interview_structure
  before insert or update on public.articles
  for each row execute function public.enforce_interview_structure();
```

- [ ] **Step 5: マイグレーションを適用してテストが通ることを確認**

```bash
supabase db reset && supabase test db
```

Expected: `17_interview_block_rules.test.sql` の 12 assertion 全 PASS。既存の 07 (body_image_rules)・08 (media_library)・その他も全て PASS。

- [ ] **Step 6: コミット**

```bash
git add supabase/migrations/20260726120000_body_asset_urls_interview.sql \
        supabase/migrations/20260726120100_enforce_interview_structure.sql \
        supabase/tests/database/17_interview_block_rules.test.sql
git commit -m "feat(db): validate interview block structure and include avatars in body_asset_urls"
```

---

### Task 3: 検索インデックス (`chunk-article`) 対応

`supabase/functions/_shared/chunking.ts` が interview ブロックのターン本文を認識できるようにする。話者名・肩書は含めず、`turn` 内テキストのみを抽出する。

**Files:**
- Modify: `supabase/functions/_shared/chunking.ts`
- Create: `supabase/functions/_shared/chunking.test.ts` (存在確認: `admin/tests/search-index.test.ts` はあるが chunking.ts 直下のテストは無し。新規作成)

**Interfaces:**
- Consumes: Task 1 の JSON 形状 (`interview.content[].type === 'turn'`, `turn.content[].text`)
- Produces: `chunkBlocks([{type: 'interview', content: [{type: 'turn', content: [{type: 'text', text: '…'}]}]}])` が turn ごとに1つの text チャンクを返す (段落と同等の扱い)

- [ ] **Step 1: 失敗するテストを書く**

`supabase/functions/_shared/chunking.test.ts` を新規作成:

```ts
import { describe, expect, it } from 'vitest';
import { chunkBlocks } from './chunking';

describe('chunkBlocks — interview', () => {
  it('extracts turn text as separate chunks', () => {
    const blocks = [
      {
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: '川崎', role: '代表', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: '最初の質問です' }] },
          { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: '答えはこうです' }] },
        ],
      },
    ];
    const chunks = chunkBlocks(blocks);
    const joined = chunks.map((c) => c.content).join(' | ');
    expect(joined).toContain('最初の質問です');
    expect(joined).toContain('答えはこうです');
  });

  it('does NOT include speaker names or roles in chunk text', () => {
    const blocks = [
      {
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: 'ヨネダタカアキ', role: 'ライター', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: 'カワサキアケミコ', role: 'カエルデザイン代表', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: '本文A' }] },
        ],
      },
    ];
    const joined = chunkBlocks(blocks).map((c) => c.content).join(' ');
    expect(joined).not.toContain('ヨネダタカアキ');
    expect(joined).not.toContain('ライター');
    expect(joined).not.toContain('カワサキアケミコ');
    expect(joined).not.toContain('カエルデザイン代表');
    expect(joined).toContain('本文A');
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npx vitest run supabase/functions/_shared/chunking.test.ts
```

Expected: FAIL (chunk text に interview 内容が含まれない)。

- [ ] **Step 3: `chunking.ts` に interview / turn の扱いを追加**

`supabase/functions/_shared/chunking.ts` 上部の型・定数を修正:

```ts
// 変更前
const TEXT_LEAF_TYPES = new Set(['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem']);
const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);

// 変更後
const TEXT_LEAF_TYPES = new Set(['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem', 'turn']);
const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);
const NESTED_CONTAINER_TYPES = new Set(['interview']);  // 子ブロックを持つコンテナ
```

`collectTextBlocks` を修正:

```ts
function collectTextBlocks(node: ChunkNode, out: ChunkNode[]): void {
  if (!node.type) return;
  if (TEXT_LEAF_TYPES.has(node.type)) {
    out.push(node);
    return;
  }
  if (LIST_CONTAINER_TYPES.has(node.type) || NESTED_CONTAINER_TYPES.has(node.type)) {
    for (const child of node.content ?? []) collectTextBlocks(child, out);
    return;
  }
  // image/embed/file/toc など、テキストを持たないブロックはスキップする。
}
```

`extractText` は既存のまま (turn.content には text ノードが入るのでそのまま動く)。**話者名・肩書は `attrs` にあるだけで content には無いので、自動的にチャンクに含まれない** — 追加ロジック不要。

- [ ] **Step 4: テストが通ることを確認**

```bash
npx vitest run supabase/functions/_shared/chunking.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 5: 既存の post_chunks 系テストを壊していないか確認**

```bash
npx vitest run
supabase db reset && supabase test db
```

Expected: 全 PASS (特に `10_post_chunks.test.sql`)。

- [ ] **Step 6: コミット**

```bash
git add supabase/functions/_shared/chunking.ts supabase/functions/_shared/chunking.test.ts
git commit -m "feat(search): chunk interview turn text into post_chunks index"
```

---

### Task 4: 公開サイトのレンダラー拡張 (sanitize allowlist + CSS)

`packages/blocks-renderer/src/render.ts` の `sanitize-html` allowlist に `<section>` と data 属性を許可し、公開サイト `src/styles/global.css` の `.article-body` セレクタに interview 用のスタイルを追加する。

**Files:**
- Modify: `packages/blocks-renderer/src/render.ts` (line 81-90 の `sanitizeHtml` 設定)
- Modify: `src/styles/global.css` (line 147 以降の `.article-body` ブロックスタイル群)
- Modify: `packages/blocks-renderer/test/interview.test.ts` (Task 1 で作ったファイルに sanitize 通過テストを追加)

**Interfaces:**
- Consumes: Task 1 で `renderHTML` が吐く `<section class="interview-block" data-block="interview" data-speakers="…">` と子 `<div data-block="turn" data-speaker="A" class="turn turn--A">`
- Produces: `renderBlocksToHtml(doc, imageBaseUrl)` が interview を含む doc を正しくサニタイズ・整形して HTML 文字列で返す。公開サイトの `<div class="article-body" set:html={article.bodyHtml}>` にそのまま流し込める。

- [ ] **Step 1: sanitize 通過テストを追加**

`packages/blocks-renderer/test/interview.test.ts` に append:

```ts
import { renderBlocksToHtml } from '../src/render';

describe('renderBlocksToHtml — interview', () => {
  it('preserves section/turn wrappers and data attributes after sanitize', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toContain('<section');
    expect(html).toContain('class="interview-block"');
    expect(html).toContain('data-block="interview"');
    expect(html).toContain('data-block="turn"');
    expect(html).toContain('data-speaker="A"');
    expect(html).toContain('data-speaker="B"');
    expect(html).toContain('こんにちは');
  });

  it('preserves avatar URLs inside data-speakers JSON attribute', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toMatch(/data-speakers=['"]?\[.*avatarUrl.*\]/);
  });
});
```

(`sampleDoc` は Task 1 テストと同一のもの — 同ファイル内なのでそのまま参照可能)

- [ ] **Step 2: テストが落ちることを確認**

```bash
cd packages/blocks-renderer && npx vitest run test/interview.test.ts
```

Expected: FAIL (`<section>` や data 属性が sanitize でストリップされる)。

- [ ] **Step 3: `render.ts` の sanitize allowlist を拡張**

`packages/blocks-renderer/src/render.ts` の line 81-90 を修正:

```ts
return sanitizeHtml(withIds, {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'iframe', 'section']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    h2: ['id'], h3: ['id'],
    img: ['src', 'alt'],
    a: ['href', 'download', 'target', 'rel'],
    iframe: ['src', 'sandbox', 'referrerpolicy', 'loading'],
    section: ['class', 'data-block', 'data-speakers'],
    div: ['class', 'data-block', 'data-speaker'],  // turn 用
  },
});
```

**注意**: 既存の `div` allowlist が無い場合、`div` は `sanitize-html.defaults.allowedTags` に含まれるが `allowedAttributes` は空。追加する属性 (`class` / `data-block` / `data-speaker`) は turn 描画に必要。他の block では div を使っていないので副作用なし。

- [ ] **Step 4: `.article-body` 用の interview CSS を追加**

`src/styles/global.css` の line 204 直後 (article-body ブロック群の末尾) に追加:

```css
/* ===== インタビュー(会話)ブロック =====
   packages/blocks-renderer が吐く <section class="interview-block"> と <div class="turn turn--X"> を
   左右交互レイアウトで表示する。A(先頭話者=聞き手)は左、B/C/D は右。 */

.article-body .interview-block {
  margin: 2.5em 0;
  display: flex;
  flex-direction: column;
  gap: 1.2em;
}

.article-body .interview-block .turn {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 12px;
  align-items: start;
}

.article-body .interview-block .turn--B,
.article-body .interview-block .turn--C,
.article-body .interview-block .turn--D {
  grid-template-columns: 1fr 64px;
  text-align: right;
}

/* アバター (擬似要素で data-speakers JSON から埋め込む方式ではなく、
   下記の JS-less な代替として速攻で読める avatar + name を後段で拡張)
   MVP としては、 turn 内のテキストのみ表示。アバターは Task 4 の Step 5 で追加する */

.article-body .interview-block .turn p {
  margin: 0;
  padding: 8px 12px;
  background-color: var(--color-card);
  border-radius: 12px;
  line-height: 1.75;
}

.article-body .interview-block .turn--B p,
.article-body .interview-block .turn--C p,
.article-body .interview-block .turn--D p {
  grid-column: 1;
}

@media (max-width: 640px) {
  .article-body .interview-block .turn,
  .article-body .interview-block .turn--B,
  .article-body .interview-block .turn--C,
  .article-body .interview-block .turn--D {
    grid-template-columns: 48px 1fr;
    text-align: left;
  }
  .article-body .interview-block .turn--B p,
  .article-body .interview-block .turn--C p,
  .article-body .interview-block .turn--D p {
    grid-column: 2;
  }
}
```

**アバター表示は現段階では data 属性のみ (CSS では表示しない)** — 実際のアバター描画は `renderBlocksToHtml` 後の post-processing、または `renderHTML` の拡張で対応。次の Step 5 で対応する。

- [ ] **Step 5: `renderHTML` でアバターを埋め込む (子要素追加)**

`packages/blocks-renderer/src/extensions.ts` の `Turn` ノードの `renderHTML` を拡張して、アバター/名前のスパンも emit する。ただし ProseMirror の renderHTML は content hole `0` を1箇所しか持てないため、Tiptap の `renderHTML` を工夫する。

代替案として、`render.ts` の HTML 生成後に post-process する形で速攻対応する。`renderBlocksToHtml` 内で最終 HTML に対して interview セクションを走査し、`data-speakers` 属性から話者情報を読み取ってアバター/名前を各 turn 内に注入する。

**選択: post-process 方式** — Tiptap `renderHTML` の制約を回避しやすく、テストしやすい。

`packages/blocks-renderer/src/render.ts` の `renderBlocksToHtml` の中、`sanitizeHtml` 呼び出しの前に post-process を差し込む:

```ts
// sanitize 前に interview セクションをレイアウト完成させる
const withInterview = injectInterviewSpeakers(withIds);
return sanitizeHtml(withInterview, { /* 上記 allowlist */ });
```

そして同ファイルに:

```ts
function injectInterviewSpeakers(html: string): string {
  // <section data-block="interview" data-speakers='[...json...]'>...</section> を検出し、
  // 内部の <div data-block="turn" data-speaker="X"> にアバター+名前 span を先頭に挿入する。
  return html.replace(
    /<section([^>]*data-block="interview"[^>]*)>([\s\S]*?)<\/section>/g,
    (_, sectionAttrs: string, inner: string) => {
      const match = sectionAttrs.match(/data-speakers=(?:"([^"]*)"|'([^']*)')/);
      if (!match) return `<section${sectionAttrs}>${inner}</section>`;
      const raw = match[1] ?? match[2] ?? '[]';
      let speakers: Array<{ key: string; name: string; role: string; avatarUrl: string }> = [];
      try {
        speakers = JSON.parse(raw.replace(/&quot;/g, '"'));
      } catch {
        return `<section${sectionAttrs}>${inner}</section>`;
      }
      const byKey = new Map(speakers.map((s) => [s.key, s]));
      const rewritten = inner.replace(
        /<div([^>]*data-block="turn"[^>]*data-speaker="([^"]+)"[^>]*)>/g,
        (_full, divAttrs: string, key: string) => {
          const s = byKey.get(key);
          if (!s) return `<div${divAttrs}>`;
          const roleHtml = s.role ? `<span class="turn__role">${escapeHtml(s.role)}</span>` : '';
          return (
            `<div${divAttrs}>` +
            `<img class="turn__avatar" src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" />` +
            `<div class="turn__who"><span class="turn__name">${escapeHtml(s.name)}</span>${roleHtml}</div>`
          );
        },
      );
      return `<section${sectionAttrs}>${rewritten}</section>`;
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
```

**sanitize allowlist を追加**: `span: ['class']`, `img: ['src', 'alt', 'class']` の class を許可:

```ts
allowedAttributes: {
  ...sanitizeHtml.defaults.allowedAttributes,
  // ... 既存
  img: ['src', 'alt', 'class'],  // class 追加
  span: ['class'],
  div: ['class', 'data-block', 'data-speaker'],
  section: ['class', 'data-block', 'data-speakers'],
},
```

`src/styles/global.css` に avatar + name のスタイルを追加:

```css
.article-body .interview-block .turn__avatar {
  width: 64px; height: 64px;
  border-radius: 50%;
  object-fit: cover;
  grid-row: 1 / span 2;
  border: 1px solid var(--color-card);
  background-color: var(--color-card);
  margin: 0;  /* .article-body img のデフォルト margin/border-radius を上書き */
}
.article-body .interview-block .turn__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
}
.article-body .interview-block .turn__name {
  font-weight: 600;
  font-size: 14px;
}
.article-body .interview-block .turn__role {
  font-size: 12px;
  color: var(--color-meta);
}
.article-body .interview-block .turn--B .turn__avatar,
.article-body .interview-block .turn--C .turn__avatar,
.article-body .interview-block .turn--D .turn__avatar {
  grid-column: 2;
}
.article-body .interview-block .turn--B .turn__who,
.article-body .interview-block .turn--C .turn__who,
.article-body .interview-block .turn--D .turn__who {
  grid-column: 1;
  align-items: flex-end;
}
@media (max-width: 640px) {
  .article-body .interview-block .turn--B .turn__avatar,
  .article-body .interview-block .turn--C .turn__avatar,
  .article-body .interview-block .turn--D .turn__avatar {
    grid-column: 1;
  }
  .article-body .interview-block .turn--B .turn__who,
  .article-body .interview-block .turn--C .turn__who,
  .article-body .interview-block .turn--D .turn__who {
    grid-column: 2;
    align-items: flex-start;
  }
}
```

- [ ] **Step 6: テストを追加 (アバター注入)**

`packages/blocks-renderer/test/interview.test.ts` に追加:

```ts
it('injects avatar img and name/role spans inside each turn', async () => {
  const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
  expect(html).toContain('class="turn__avatar"');
  expect(html).toContain('src="https://img.test/a.webp"');
  expect(html).toContain('alt="米田"');
  expect(html).toContain('class="turn__name"');
  expect(html).toContain('米田');
  expect(html).toContain('川崎');
  expect(html).toContain('聞き手');
  expect(html).toContain('Kaeru 代表');
});
```

- [ ] **Step 7: 全テストが通ることを確認**

```bash
cd packages/blocks-renderer && npx vitest run
cd ../.. && npm run build  # 公開サイトビルドが CSS 変更で落ちていないか
```

Expected: 全 PASS + build success。

- [ ] **Step 8: 目視確認 (公開サイトで見る)**

```bash
supabase start && npm run dev:all
```

Supabase Studio (`http://localhost:54323`) で `articles` テーブルに手で1件 interview 入り記事を作成する (SQL editor):

```sql
insert into articles (author_id, title, slug, body, status, published_at)
select id, 'iv-preview', 'iv-preview',
  '[{"type":"interview","attrs":{"speakers":[
    {"key":"A","name":"米田","role":"聞き手","avatarUrl":"http://127.0.0.1:54321/storage/v1/object/public/media/dummy/a.webp"},
    {"key":"B","name":"川崎","role":"Kaeru","avatarUrl":"http://127.0.0.1:54321/storage/v1/object/public/media/dummy/b.webp"}
  ]},"content":[
    {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"最初の質問"}]},
    {"type":"turn","attrs":{"speaker":"B"},"content":[{"type":"text","text":"答え"}]}
  ]}]'::jsonb,
  'published', now()
from profiles where role = 'writer' limit 1;
```

(image_base_url は seed で `http://127.0.0.1:54321/storage/v1/object/public/media` の想定。実際の値は `select image_base_url from settings where id=1;` で確認)

公開サイト `http://localhost:4321/posts/iv-preview` を開き、A が左・B が右で表示されること、モバイル幅 (<640px) で左寄せ縦並びになることを目視確認。

- [ ] **Step 9: コミット**

```bash
git add packages/blocks-renderer/src/render.ts \
        packages/blocks-renderer/test/interview.test.ts \
        src/styles/global.css
git commit -m "feat(render): render interview block as left/right conversation layout on public site"
```

---

### Task 5: 話者登録モーダル (`interview-dialog.ts`)

`initMediaPicker` と同型 (`<div hidden>` トグル型) のモーダル。挿入時と再編集時に開く。話者 A/B 必須、C/D 追加可 (最大4)。各話者に対してサムネイル (アップロード / 「自分のプロフィール画像を使う」ワンクリック / 削除)、名前、肩書を編集する。

**Files:**
- Create: `admin/src/lib/interview-dialog.ts`
- Create: `admin/tests/interview-dialog.test.ts`
- Modify: `admin/src/pages/articles/edit.astro` (モーダル DOM シェルを追加、モーダル init 呼び出しは Task 7 で追加)
- Modify: `admin/src/pages/articles/new.astro` (同上)

**Interfaces:**
- Consumes: `SupabaseClient` (アバターアップロード用)、`uploadAndRecord(supabase, file)` from `admin/src/lib/body-image.ts`、現在ログイン中プロフィールの avatar_url (プロフィール画像ワンクリック用)
- Produces:
  - Export: `initInterviewDialog(supabase, opts): InterviewDialogController`
  - Type: `Speaker = { key: 'A'|'B'|'C'|'D'; name: string; role: string; avatarUrl: string }`
  - Type: `InterviewDialogController = { open(initial?: Speaker[]): Promise<Speaker[] | null> }` (キャンセル時 null)
  - `opts: { modalEl: HTMLElement; formEl: HTMLElement; addBtn: HTMLButtonElement; saveBtn: HTMLButtonElement; cancelBtn: HTMLButtonElement; myProfile: { name: string; avatarUrl: string | null } | null }`

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/interview-dialog.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';  // (see Step 3 for setup)
import { initInterviewDialog } from '../src/lib/interview-dialog';

function buildDom() {
  const dom = new JSDOM(`
    <div id="modal" hidden>
      <form id="form"></form>
      <button id="add" type="button">＋話者を追加</button>
      <button id="save" type="button">決定</button>
      <button id="cancel" type="button">キャンセル</button>
    </div>
  `);
  return dom.window.document;
}

const fakeSupabase = {} as any;

describe('initInterviewDialog', () => {
  it('opens with 2 empty speakers (A, B) when no initial provided', async () => {
    const doc = buildDom();
    const modal = doc.getElementById('modal') as HTMLElement;
    const form = doc.getElementById('form') as HTMLElement;
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl: modal, formEl: form,
      addBtn: doc.getElementById('add') as HTMLButtonElement,
      saveBtn: doc.getElementById('save') as HTMLButtonElement,
      cancelBtn: doc.getElementById('cancel') as HTMLButtonElement,
      myProfile: null,
    });
    const pending = dialog.open();
    expect(modal.hidden).toBe(false);
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(2);
    (doc.getElementById('cancel') as HTMLButtonElement).click();
    const result = await pending;
    expect(result).toBeNull();
  });

  it('populates from initial and resolves with edited speakers on save', async () => {
    const doc = buildDom();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl: doc.getElementById('modal') as HTMLElement,
      formEl: doc.getElementById('form') as HTMLElement,
      addBtn: doc.getElementById('add') as HTMLButtonElement,
      saveBtn: doc.getElementById('save') as HTMLButtonElement,
      cancelBtn: doc.getElementById('cancel') as HTMLButtonElement,
      myProfile: null,
    });
    const initial = [
      { key: 'A' as const, name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
      { key: 'B' as const, name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
    ];
    const pending = dialog.open(initial);
    // A の name を書き換える
    const nameA = doc.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameA.value).toBe('米田');
    nameA.value = '米田 貴明';
    (doc.getElementById('save') as HTMLButtonElement).click();
    const result = await pending;
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('米田 貴明');
    expect(result![1].name).toBe('川崎');
  });

  it('adds and removes speakers up to 4, always tail-only', () => {
    const doc = buildDom();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl: doc.getElementById('modal') as HTMLElement,
      formEl: doc.getElementById('form') as HTMLElement,
      addBtn: doc.getElementById('add') as HTMLButtonElement,
      saveBtn: doc.getElementById('save') as HTMLButtonElement,
      cancelBtn: doc.getElementById('cancel') as HTMLButtonElement,
      myProfile: null,
    });
    dialog.open();
    const form = doc.getElementById('form') as HTMLElement;
    const add = doc.getElementById('add') as HTMLButtonElement;
    // 開始は 2
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(2);
    add.click(); // → 3
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(3);
    add.click(); // → 4
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(4);
    add.click(); // → 4 (upper cap)
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(4);
    // 削除ボタンは末尾 (D) のみ表示
    const removeButtons = form.querySelectorAll('[data-remove-speaker]');
    expect(removeButtons.length).toBe(1);
    expect(removeButtons[0].getAttribute('data-remove-speaker')).toBe('D');
    (removeButtons[0] as HTMLButtonElement).click(); // → 3, C が末尾
    expect(form.querySelectorAll('[data-speaker-card]').length).toBe(3);
    expect(form.querySelector('[data-remove-speaker]')?.getAttribute('data-remove-speaker')).toBe('C');
  });

  it('rejects save with empty name and marks the field', () => {
    const doc = buildDom();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl: doc.getElementById('modal') as HTMLElement,
      formEl: doc.getElementById('form') as HTMLElement,
      addBtn: doc.getElementById('add') as HTMLButtonElement,
      saveBtn: doc.getElementById('save') as HTMLButtonElement,
      cancelBtn: doc.getElementById('cancel') as HTMLButtonElement,
      myProfile: null,
    });
    dialog.open();
    // 名前を空のまま save → 保留、エラー表示
    (doc.getElementById('save') as HTMLButtonElement).click();
    const modal = doc.getElementById('modal') as HTMLElement;
    expect(modal.hidden).toBe(false);  // 閉じない
    const nameA = doc.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameA.getAttribute('aria-invalid')).toBe('true');
  });
});
```

- [ ] **Step 2: jsdom を admin テストに追加**

`admin/vitest.setup.ts` の environment を再設定するか、テストファイル冒頭に `@vitest-environment jsdom` を追加。**推奨: このテストファイル冒頭に**:

```ts
// @vitest-environment jsdom
```

および `admin/package.json` の devDependencies に `jsdom` を追加:

```bash
cd admin && npm install --save-dev jsdom
```

- [ ] **Step 3: テストが落ちることを確認**

```bash
cd admin && npx vitest run tests/interview-dialog.test.ts
```

Expected: FAIL (`initInterviewDialog` 未定義)。

- [ ] **Step 4: `interview-dialog.ts` を実装**

`admin/src/lib/interview-dialog.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadAndRecord } from './body-image';

export type Speaker = {
  key: 'A' | 'B' | 'C' | 'D';
  name: string;
  role: string;
  avatarUrl: string;
};

export interface InterviewDialogController {
  open(initial?: Speaker[]): Promise<Speaker[] | null>;
}

export interface InterviewDialogOptions {
  modalEl: HTMLElement;
  formEl: HTMLElement;
  addBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  myProfile: { name: string; avatarUrl: string | null } | null;
}

const KEYS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

export function initInterviewDialog(
  supabase: SupabaseClient,
  opts: InterviewDialogOptions,
): InterviewDialogController {
  const { modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile } = opts;
  let currentResolve: ((v: Speaker[] | null) => void) | null = null;
  let workingSpeakers: Speaker[] = [];

  function render(): void {
    formEl.replaceChildren();
    workingSpeakers.forEach((s, idx) => {
      const isTail = idx === workingSpeakers.length - 1;
      const isRemovable = idx >= 2 && isTail;
      const card = document.createElement('div');
      card.setAttribute('data-speaker-card', s.key);
      card.className = 'speaker-card';
      card.innerHTML = `
        <div class="speaker-card__header">
          <span class="speaker-card__key">話者 ${s.key}</span>
          ${isRemovable
            ? `<button type="button" data-remove-speaker="${s.key}" class="speaker-card__remove">✕</button>`
            : (idx < 2 ? '<span class="speaker-card__required">必須</span>' : '')}
        </div>
        <div class="speaker-card__avatar-row">
          ${s.avatarUrl
            ? `<img src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" class="speaker-card__avatar" />`
            : '<div class="speaker-card__avatar speaker-card__avatar--placeholder">画像</div>'}
          <div class="speaker-card__avatar-actions">
            <label class="btn-secondary">
              画像をアップロード
              <input type="file" accept="image/*" data-upload-avatar="${s.key}" hidden />
            </label>
            ${myProfile?.avatarUrl
              ? `<button type="button" data-use-profile="${s.key}">自分のプロフィール画像を使う</button>`
              : ''}
            ${s.avatarUrl ? `<button type="button" data-clear-avatar="${s.key}">画像を削除</button>` : ''}
          </div>
        </div>
        <label class="speaker-card__field">
          <span>名前 <em>*</em></span>
          <input type="text" name="name" value="${escapeAttr(s.name)}" required />
        </label>
        <label class="speaker-card__field">
          <span>肩書</span>
          <input type="text" name="role" value="${escapeAttr(s.role)}" placeholder="Kaeru Design 代表" />
        </label>
      `;
      formEl.appendChild(card);
    });
    // add ボタンの有効化
    addBtn.disabled = workingSpeakers.length >= 4;
  }

  function readFromDom(): void {
    workingSpeakers = workingSpeakers.map((s) => {
      const card = formEl.querySelector(`[data-speaker-card="${s.key}"]`) as HTMLElement | null;
      if (!card) return s;
      const name = (card.querySelector('[name="name"]') as HTMLInputElement).value.trim();
      const role = (card.querySelector('[name="role"]') as HTMLInputElement).value.trim();
      return { ...s, name, role };
    });
  }

  function validate(): boolean {
    let ok = true;
    for (const s of workingSpeakers) {
      const card = formEl.querySelector(`[data-speaker-card="${s.key}"]`) as HTMLElement | null;
      if (!card) continue;
      const nameInput = card.querySelector('[name="name"]') as HTMLInputElement;
      if (!s.name) {
        nameInput.setAttribute('aria-invalid', 'true');
        ok = false;
      } else {
        nameInput.removeAttribute('aria-invalid');
      }
    }
    return ok;
  }

  formEl.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute('name')) {
      target.removeAttribute('aria-invalid');
    }
  });

  formEl.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    const uploadKey = target.getAttribute('data-upload-avatar');
    if (uploadKey && target.files?.[0]) {
      readFromDom();
      try {
        const url = await uploadAndRecord(supabase, target.files[0]);
        const idx = workingSpeakers.findIndex((s) => s.key === uploadKey);
        if (idx >= 0) workingSpeakers[idx].avatarUrl = url;
        render();
      } catch (err) {
        window.alert(`アップロード失敗: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  formEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const removeKey = target.getAttribute('data-remove-speaker');
    const useProfileKey = target.getAttribute('data-use-profile');
    const clearKey = target.getAttribute('data-clear-avatar');
    if (removeKey) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === removeKey);
      if (idx >= 2) {
        workingSpeakers.splice(idx, 1);
        render();
      }
    } else if (useProfileKey && myProfile?.avatarUrl) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === useProfileKey);
      if (idx >= 0) {
        workingSpeakers[idx].avatarUrl = myProfile.avatarUrl;
        if (!workingSpeakers[idx].name) workingSpeakers[idx].name = myProfile.name;
        render();
      }
    } else if (clearKey) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === clearKey);
      if (idx >= 0) {
        workingSpeakers[idx].avatarUrl = '';
        render();
      }
    }
  });

  addBtn.addEventListener('click', () => {
    if (workingSpeakers.length >= 4) return;
    readFromDom();
    const newKey = KEYS[workingSpeakers.length];
    workingSpeakers.push({ key: newKey, name: '', role: '', avatarUrl: '' });
    render();
  });

  cancelBtn.addEventListener('click', () => {
    modalEl.hidden = true;
    if (currentResolve) { currentResolve(null); currentResolve = null; }
  });

  saveBtn.addEventListener('click', () => {
    readFromDom();
    if (!validate()) return;
    modalEl.hidden = true;
    if (currentResolve) { currentResolve(structuredClone(workingSpeakers)); currentResolve = null; }
  });

  return {
    open(initial?: Speaker[]) {
      workingSpeakers = initial
        ? structuredClone(initial)
        : [
            { key: 'A', name: '', role: '', avatarUrl: '' },
            { key: 'B', name: '', role: '', avatarUrl: '' },
          ];
      render();
      modalEl.hidden = false;
      return new Promise<Speaker[] | null>((resolve) => { currentResolve = resolve; });
    },
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 5: モーダル DOM シェルを edit.astro に追加**

`admin/src/pages/articles/edit.astro` の `<div id="media-modal">` (line 94 あたり) の直後に:

```html
<div
  id="interview-modal"
  role="dialog"
  aria-labelledby="interview-modal-title"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
  hidden
>
  <div class="max-w-xl w-full max-h-[90vh] overflow-auto bg-white rounded-lg p-6 shadow-xl">
    <h2 id="interview-modal-title" class="text-lg font-semibold mb-4">話者を登録</h2>
    <form id="interview-form" class="grid gap-4"></form>
    <div class="flex items-center justify-between mt-6">
      <button type="button" id="interview-add" class="text-blue-600">＋話者を追加</button>
      <div class="flex gap-2">
        <button type="button" id="interview-cancel" class="btn-secondary">キャンセル</button>
        <button type="button" id="interview-save" class="btn-primary">決定</button>
      </div>
    </div>
  </div>
</div>
```

同じシェルを `new.astro` にもコピーする。

**注意**: 上の Tailwind ユーティリティクラス (`fixed inset-0` 等) と `.btn-primary` / `.btn-secondary` は仮の想定。実装時に `admin/src/pages/articles/edit.astro` の line 94 付近にある既存モーダル `#media-modal` の要素構造とクラス指定を **コピペ元** として、同じ流儀に揃えること (フレームワークが Tailwind でも独自 CSS でも、既存モーダルと視覚的一貫性を保つのが優先)。

- [ ] **Step 6: テストが通ることを確認**

```bash
cd admin && npx vitest run tests/interview-dialog.test.ts
```

Expected: 4 tests PASS。

- [ ] **Step 7: 既存 admin テストを壊していないか確認**

```bash
cd admin && npm test
```

Expected: 全 PASS。

- [ ] **Step 8: コミット**

```bash
git add admin/src/lib/interview-dialog.ts \
        admin/tests/interview-dialog.test.ts \
        admin/src/pages/articles/edit.astro \
        admin/src/pages/articles/new.astro \
        admin/package.json admin/package-lock.json
git commit -m "feat(admin): add interview speaker registration dialog (2-4 speakers, avatar upload)"
```

---

### Task 6: 編集画面の NodeView / Decoration (`interview-nodeview.ts`)

エディタ内で interview ブロックの上に、話者カード（サムネ・名前・肩書）、＋発言追加ボタン、話者切替ポップオーバーを ProseMirror `Decoration` として重ねる。編集はネイティブに (turn.content が inline なのでそのまま Tiptap で編集可能)。

**Files:**
- Create: `admin/src/lib/interview-nodeview.ts`
- Create: `admin/tests/interview-nodeview.test.ts`

**Interfaces:**
- Consumes: Task 1 の JSON 形状、Task 5 の `InterviewDialogController` (話者カードクリック → 再編集モーダル)
- Produces:
  - Export: `createInterviewPlugin(dialog: InterviewDialogController): Plugin`
  - Plugin は `Decoration.widget` で話者カード・＋ボタン・切替ポップオーバーを挿入する
  - Commands: `insertInterviewBlock(editor, speakers)` — 話者リストから初期 interview を挿入

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/interview-nodeview.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { blockExtensions } from '@wild-media/blocks-renderer';
import { createInterviewPlugin, insertInterviewBlock } from '../src/lib/interview-nodeview';

const fakeDialog = { open: async () => null } as const;

describe('interview-nodeview', () => {
  it('insertInterviewBlock inserts an interview with one empty A turn', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: '<p></p>',
    });
    insertInterviewBlock(editor, [
      { key: 'A', name: '米田', role: '', avatarUrl: 'https://img.test/a.webp' },
      { key: 'B', name: '川崎', role: '', avatarUrl: 'https://img.test/b.webp' },
    ]);
    const json = editor.getJSON();
    const interview = json.content?.find((n) => n.type === 'interview');
    expect(interview).toBeDefined();
    expect(interview?.attrs?.speakers).toHaveLength(2);
    expect(interview?.content).toHaveLength(1);
    expect(interview?.content?.[0].type).toBe('turn');
    expect(interview?.content?.[0].attrs?.speaker).toBe('A');
    editor.destroy();
  });

  it('renders speaker cards and add-turn buttons as decorations over interview blocks', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [
            { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'hi' }] },
          ],
        }],
      },
    });
    const dom = el.querySelector('.interview-block');
    expect(dom).not.toBeNull();
    expect(dom!.querySelectorAll('[data-speaker-card]')).toHaveLength(2);
    expect(dom!.querySelectorAll('[data-add-turn]').length).toBeGreaterThanOrEqual(1);
    editor.destroy();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
cd admin && npx vitest run tests/interview-nodeview.test.ts
```

Expected: FAIL。

- [ ] **Step 3: `interview-nodeview.ts` を実装**

`admin/src/lib/interview-nodeview.ts`:

```ts
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { InterviewDialogController, Speaker } from './interview-dialog';

const KEY = new PluginKey('interview-decorations');

export interface InterviewPluginBundle {
  extension: Extension;
}

export function createInterviewPlugin(dialog: InterviewDialogController): InterviewPluginBundle {
  const extension = Extension.create({
    name: 'interviewDecorations',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: KEY,
          props: {
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.forEach((node, offset) => {
                if (node.type.name !== 'interview') return;
                const speakers: Speaker[] = (node.attrs.speakers ?? []) as Speaker[];
                // 話者カード (interview の直前)
                decos.push(Decoration.widget(offset + 1, () => buildSpeakersHeader(editor, dialog, offset, speakers), { side: -1 }));
                // ＋発言追加ボタン (interview の末尾)
                decos.push(Decoration.widget(offset + node.nodeSize - 1, () => buildAddTurnButton(editor, offset, speakers), { side: 1 }));
                // 各 turn の話者ラベル + 切替
                let cursor = offset + 1;
                node.forEach((turn, _off, i) => {
                  const at = cursor + 1;
                  decos.push(Decoration.widget(at, () => buildTurnHeader(editor, cursor, turn.attrs.speaker, speakers), { side: -1 }));
                  cursor += turn.nodeSize;
                });
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
  return { extension };
}

function buildSpeakersHeader(
  editor: Editor,
  dialog: InterviewDialogController,
  interviewPos: number,
  speakers: Speaker[],
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'interview-block__speakers';
  el.contentEditable = 'false';
  speakers.forEach((s) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('data-speaker-card', s.key);
    card.className = 'speaker-card-inline';
    card.innerHTML = `
      ${s.avatarUrl
        ? `<img src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" />`
        : '<div class="avatar-placeholder">?</div>'}
      <div>
        <span class="speaker-card-inline__name">${escapeHtml(s.name || '(未設定)')}</span>
        ${s.role ? `<span class="speaker-card-inline__role">${escapeHtml(s.role)}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', async () => {
      const updated = await dialog.open(speakers);
      if (!updated) return;
      // 話者数が減った場合、その key を参照している turn を削除する
      const allowedKeys = new Set(updated.map((s) => s.key));
      const tr = editor.state.tr;
      const node = editor.state.doc.nodeAt(interviewPos);
      if (!node) return;
      // 削除する turn の位置を後ろから前へ集める
      const removals: Array<{ from: number; to: number }> = [];
      let cursor = interviewPos + 1;
      node.forEach((turn) => {
        if (turn.type.name === 'turn' && !allowedKeys.has(turn.attrs.speaker)) {
          removals.push({ from: cursor, to: cursor + turn.nodeSize });
        }
        cursor += turn.nodeSize;
      });
      // 発言が消える場合は確認 (spec の話者削除ポリシー)
      if (removals.length > 0) {
        const ok = window.confirm(
          `削除された話者の発言 ${removals.length} 件も同時に削除します。続行しますか?`,
        );
        if (!ok) return;
      }
      for (const r of removals.reverse()) tr.delete(r.from, r.to);
      // speakers attr を更新
      tr.setNodeMarkup(interviewPos, undefined, { speakers: updated });
      // interview が turn 0 件になったら A の空 turn を追加
      const updatedNode = tr.doc.nodeAt(interviewPos);
      if (updatedNode && updatedNode.childCount === 0) {
        const turnType = editor.schema.nodes.turn;
        tr.insert(interviewPos + 1, turnType.create({ speaker: 'A' }));
      }
      editor.view.dispatch(tr);
    });
    el.appendChild(card);
  });
  return el;
}

function buildAddTurnButton(editor: Editor, interviewPos: number, speakers: Speaker[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'interview-block__add-turn';
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('data-add-turn', '1');
  const label = document.createElement('span');
  label.textContent = '＋ 発言を追加';
  wrapper.appendChild(label);
  speakers.forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = s.name || s.key;
    btn.addEventListener('click', () => {
      const node = editor.state.doc.nodeAt(interviewPos);
      if (!node) return;
      const insertAt = interviewPos + node.nodeSize - 1;
      const turnType = editor.schema.nodes.turn;
      const tr = editor.state.tr.insert(insertAt, turnType.create({ speaker: s.key }));
      editor.view.dispatch(tr);
    });
    wrapper.appendChild(btn);
  });
  return wrapper;
}

function buildTurnHeader(
  editor: Editor,
  turnPos: number,
  currentSpeaker: string,
  speakers: Speaker[],
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'turn__header';
  el.contentEditable = 'false';
  const label = document.createElement('button');
  label.type = 'button';
  const currentName = speakers.find((s) => s.key === currentSpeaker)?.name ?? currentSpeaker;
  label.textContent = currentName;
  label.addEventListener('click', () => {
    // 話者選択ポップオーバー
    const menu = document.createElement('div');
    menu.className = 'turn__speaker-menu';
    speakers.forEach((s) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.textContent = s.name || s.key;
      opt.addEventListener('click', () => {
        const node = editor.state.doc.nodeAt(turnPos);
        if (!node) return;
        const tr = editor.state.tr.setNodeMarkup(turnPos, undefined, { speaker: s.key });
        editor.view.dispatch(tr);
        menu.remove();
      });
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);
    const rect = label.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = `${rect.bottom + window.scrollY}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;
    // クリック外で閉じる
    const closer = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('click', closer);
      }
    };
    setTimeout(() => document.addEventListener('click', closer), 0);
  });
  el.appendChild(label);
  return el;
}

export function insertInterviewBlock(editor: Editor, speakers: Speaker[]): void {
  editor.chain().focus().insertContent({
    type: 'interview',
    attrs: { speakers },
    content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [] }],
  }).run();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: 最低限のスタイルを admin CSS に追加**

**まず配置先を決める** — 以下の優先順で見つかった最初のものに追加:
1. `admin/src/styles/global.css` (存在すれば)
2. 記事エディタ layout (`admin/src/layouts/` 直下、edit.astro が使う layout) の `<style is:global>` ブロック
3. 上記いずれもなければ `admin/src/styles/interview-editor.css` を新規作成し、`admin/src/pages/articles/edit.astro` および `new.astro` の frontmatter で `import '../../styles/interview-editor.css'` する

内容:

```css
.interview-block {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  background: #fafafa;
}
.interview-block__speakers {
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed #ccc;
  margin-bottom: 12px;
}
.speaker-card-inline {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.speaker-card-inline img,
.speaker-card-inline .avatar-placeholder {
  width: 32px; height: 32px; border-radius: 50%;
}
.turn__header {
  font-size: 11px;
  color: #666;
  margin-top: 8px;
}
.turn__header button {
  background: none; border: none; padding: 0; cursor: pointer; color: inherit;
  text-decoration: underline dotted;
}
.turn__speaker-menu {
  background: #fff; border: 1px solid #ccc; padding: 4px; border-radius: 4px; z-index: 100;
}
.turn__speaker-menu button {
  display: block; width: 100%; text-align: left; padding: 4px 8px;
  background: none; border: none; cursor: pointer;
}
.turn__speaker-menu button:hover { background: #f0f0f0; }
.interview-block__add-turn {
  margin-top: 8px; display: flex; gap: 8px; align-items: center;
  font-size: 12px; color: #666;
}
.interview-block__add-turn button {
  border: 1px dashed #999; background: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer;
}
```

- [ ] **Step 5: テストが通ることを確認**

```bash
cd admin && npx vitest run tests/interview-nodeview.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 6: 既存 admin テストを壊していないか確認**

```bash
cd admin && npm test
```

Expected: 全 PASS。

- [ ] **Step 7: コミット**

```bash
git add admin/src/lib/interview-nodeview.ts admin/tests/interview-nodeview.test.ts \
        admin/src/styles/  # or wherever CSS lives
git commit -m "feat(admin): render interview speaker cards and add-turn buttons in the editor"
```

---

### Task 7: スラッシュコマンド接続 & E2E 手動確認

`admin/src/pages/articles/edit.astro` と `new.astro` に interview 用のスラッシュコマンドを追加し、Task 5 のダイアログ・Task 6 のプラグインを配線する。手動確認で全フロー (挿入 → 話者登録 → 発言追加 → 話者切替 → 話者削除 → 保存 → リロード → 公開プレビュー) を検証する。

**Files:**
- Modify: `admin/src/pages/articles/edit.astro`
- Modify: `admin/src/pages/articles/new.astro`

**Interfaces:**
- Consumes: `initInterviewDialog` (Task 5), `createInterviewPlugin` / `insertInterviewBlock` (Task 6), 現在のプロフィール (edit.astro 上部で `getSession()` から取得済みのはず — 要確認)
- Produces: スラッシュメニューに「インタビュー(会話)」項目、選択で話者登録モーダル、決定でエディタに interview 挿入、以降は Task 6 のプラグインが UI を担当

- [ ] **Step 1: `edit.astro` にダイアログ初期化を追加**

`admin/src/pages/articles/edit.astro` の `<script>` セクション、既存の `initMediaPicker` 呼び出し (line 268 あたり) の直後に:

```ts
import { initInterviewDialog } from '@/lib/interview-dialog';
import { createInterviewPlugin, insertInterviewBlock } from '@/lib/interview-nodeview';

// 現在のプロフィール取得: edit.astro 上部の `supabaseBrowser.auth.getSession()` 直後で
// profiles テーブルから id, name, avatar_url を SELECT する。同ファイルで既に profile を
// 引いている箇所があるはずなので (アバター widget 用)、そこから流用する。無ければここで追加:
const { data: { session } } = await supabaseBrowser.auth.getSession();
const { data: myProfileRow } = session
  ? await supabaseBrowser.from('profiles').select('name, avatar_url').eq('id', session.user.id).single()
  : { data: null };

const interviewDialog = initInterviewDialog(supabaseBrowser, {
  modalEl: document.getElementById('interview-modal') as HTMLElement,
  formEl: document.getElementById('interview-form') as HTMLElement,
  addBtn: document.getElementById('interview-add') as HTMLButtonElement,
  saveBtn: document.getElementById('interview-save') as HTMLButtonElement,
  cancelBtn: document.getElementById('interview-cancel') as HTMLButtonElement,
  myProfile: myProfileRow
    ? { name: myProfileRow.name, avatarUrl: myProfileRow.avatar_url ?? null }
    : null,
});

const interviewPlugin = createInterviewPlugin(interviewDialog);
```

- [ ] **Step 2: `createBlockEditor` の extraExtensions に interviewPlugin を追加**

同ファイル、`createBlockEditor({...})` 呼び出しの `extraExtensions` 配列に:

```ts
extraExtensions: [
  createSlashCommandsExtension(commands),
  interviewPlugin.extension,
],
```

- [ ] **Step 3: スラッシュコマンドに interview 項目を追加**

同ファイル、`commands` 配列に追加:

```ts
{
  id: 'interview',
  label: 'インタビュー(会話)',
  run: (ed) => {
    (async () => {
      const speakers = await interviewDialog.open();
      if (speakers) insertInterviewBlock(ed, speakers);
    })();
  },
},
```

- [ ] **Step 4: `new.astro` に同じ変更を反映**

`new.astro` にも上記 Step 1〜3 と同じ import / init / commands 追加を行う。

- [ ] **Step 5: ビルド確認**

```bash
cd admin && npm run build
```

Expected: TypeScript エラーなし・ビルド成功。

- [ ] **Step 6: 開発サーバー起動して手動確認**

```bash
supabase start
npm run dev:all  # ルートで実行
```

以下を順に確認 (すべて `http://localhost:4322` の CMS で):

1. writer でログイン (`hana@seed.local` / `seed-pass-1234`)
2. 記事一覧 → 新規記事作成
3. 本文エディタで `/` → 「インタビュー(会話)」を選択
4. 話者登録モーダル: 話者A の名前 "米田"・肩書 "聞き手"・画像アップロード。話者B の名前 "川崎"・肩書 "Kaeru"・「自分のプロフィール画像を使う」ボタンでプロフィール画像を使用 (writer のプロフィールにアバターがあれば)
5. 「決定」→ エディタに interview ブロック挿入。空の A の turn が 1 件、話者カード 2 枚が上部に表示
6. A の turn にテキスト入力 → `＋発言を追加` → 「川崎」を選ぶ → B の turn 追加 → テキスト入力
7. 「＋話者を追加」で C を追加 (モーダル再オープン) → 話者C を登録 → 決定
8. `＋発言を追加` に C が選択肢として現れる → C の発言追加
9. C の turn の話者ラベルをクリック → メニューから A に切替 → speaker が変わる
10. 話者カードの D 削除 (該当なし)、C 削除 → 「C の発言も削除しますか?」 → 確定 → C の turn も消える
11. 「下書き保存」 → リロード → interview ブロックが復元される
12. 「公開する」 → 公開サイト (`http://localhost:4321/posts/<slug>`) を開く → A が左・B/C が右のレイアウト
13. モバイル幅 (デベロッパーツールで 400px) → 全 turn 左寄せ縦並び
14. `admin/media` → interview で使ったアバター画像が一覧に出て、削除ボタンを押すと「参照中で削除できません」エラー
15. Supabase Studio の SQL editor で `select public.body_asset_urls((select body from articles where slug='<slug>'), 'image');` → interview のアバターURLと本文画像URLが列挙される

- [ ] **Step 7: 手動確認のログを取る**

見つかった不具合を `docs/TODO.md` に列挙する形で書き出す (CLAUDE.md 記載の「本題と関係ない改善点」ルールに従い、致命的でないものは TODO 化)。致命的な不具合は Task 6 or 7 内で修正する。

- [ ] **Step 8: コミット**

```bash
git add admin/src/pages/articles/edit.astro admin/src/pages/articles/new.astro
git commit -m "feat(admin): wire interview slash command, dialog, and editor plugin end-to-end"
```

- [ ] **Step 9: 仕様書・ドキュメント更新**

- `docs/DATABASE.md` (ER図) は articles テーブルには変更なし (body は jsonb のまま) なので更新不要
- `ARCHITECTURE.md` の Tiptap カスタムノード一覧 (もしあれば) に `interview` / `turn` を追記
- `docs/TODO.md` に手動確認で見つかった残タスクを追記

```bash
git add docs/  # 該当ファイルのみ
git commit -m "docs: mention interview block in architecture and note follow-ups"
```

---

## Rollout メモ (実装後)

- **本番デプロイ**: マイグレーション 2 本を `supabase db push` で本番に流す。既存記事に interview ノードは存在しないため後方互換性の考慮は不要。
- **既存記事の再インデックス**: 不要 (interview 記事はまだ 1 件もないため)。
- **`docs/PRODUCTION.md` の Deployment Checklist** に interview 追加時の手順を反映する必要はなし (通常のマイグレーション適用フローに含まれる)。

## 将来課題 (今回はやらない)

仕様書 `docs/superpowers/specs/2026-07-26-interview-block-design.md` 末尾の「将来課題」セクション参照。特に:

- 5人以上の座談会
- 発言内の画像・埋め込み
- `profiles` テーブルとの自動リンク (取材相手が provider/writer の場合)
- 話者ごとの色テーマ
- 発言単位のパーマリンク
