# 記事ハイブリッド検索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事本文をチャンク分割してembeddingを生成し、pgvector類似検索とpgroonga全文検索をRRFでマージしたハイブリッド検索を、記事保存/削除時のインデックス更新と公開サイトの検索UIまで含めて実装する。

**Architecture:** DBに `post_chunks` テーブル(pgvector埋め込み列 + pgroongaインデックス列)を追加し、2つのEdge Function(`chunk-article`: 保存時にチャンク化+embedding生成、`search-articles`: クエリembedding化+RPC呼び出し)と1つのDB関数(`search_articles_hybrid`: RRFマージ+published限定+ハイライト生成)で構成する。フロントは軽量なvanilla TSコンポーネント。

**Tech Stack:** Supabase(Postgres 17 + pgvector 0.8.2 + pgroonga 3.2.5 + Edge Functions/Deno)、OpenAI `text-embedding-3-small`、Astro(公開サイト)、既存admin(Astro CMS)。

## Global Constraints

- **前提ブランチ**: `feature/article-editor` のワークツリー(`.worktrees/article-editor`)上で作業する。`articles.body` は `jsonb`(Tiptapブロック配列)。
- **権限・ビジネスルールはDB層で強制する**(CLAUDE.md)。published限定フィルタはRPC内で強制し、Edge Function/フロントの入力を信用しない。
- **service role keyはadmin/に入れない**。Edge Function内(Deno)でのみ使う。
- `post_chunks` はEdge Function(service role)以外からは一切アクセス不可(RLS + GRANTの両方でデフォルト拒否)。
- embeddingモデル: OpenAI `text-embedding-3-small`(1536次元)。
- RRFパラメータ: k=60、各手法の候補プール上位50件、最終返却は記事単位で重複排除した上位10件。
- チャンク化トリガー: admin保存/公開ボタンの手動保存時のみ(20秒毎のautosaveでは呼ばない)。
- 記事削除時のチャンク削除は `post_chunks.article_id` の `on delete cascade` で保証する(Edge Function呼び出し不要)。
- フロント検索UIはデバウンス300ms、`AbortController`で前回リクエストをキャンセルする。まずは `src/pages/index.astro` にのみ設置。
- テストは既存3層規約に従う: DB(pgTAP, `supabase test db`)/公開サイト(Vitest, `npm test`)/CMS(Vitest, `cd admin && npm test`)。Edge Function本体(Deno)は既存の`invite-user`/`r2-upload-url`と同様に自動テスト対象外とし、手動smokeで検証する。

---

### Task 1: `post_chunks` テーブル(拡張機能・RLS・インデックス)

**Files:**
- Create: `supabase/migrations/20260713100000_post_chunks.sql`
- Create: `supabase/tests/database/10_post_chunks.test.sql`

**Interfaces:**
- Consumes: なし
- Produces: テーブル `public.post_chunks(id, article_id, chunk_index, heading_path, content, token_count, embedding, created_at, updated_at)`。以降のタスクはこのカラム名・型をそのまま使う。

- [ ] **Step 1: マイグレーションを書く**

```sql
-- supabase/migrations/20260713100000_post_chunks.sql
create extension if not exists vector with schema extensions;
create extension if not exists pgroonga with schema extensions;

create table public.post_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  heading_path text not null default '',
  content text not null,
  token_count int not null check (token_count >= 0),
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, chunk_index)
);

create trigger post_chunks_set_updated_at
  before update on public.post_chunks
  for each row execute function extensions.moddatetime(updated_at);

-- post_chunks はEdge Function(service role)専用。anon/authenticatedには
-- テーブル権限を一切付与しない(RLSと二重の防御)。
grant select, insert, update, delete on public.post_chunks to service_role;

alter table public.post_chunks enable row level security;
-- ポリシーなし = service role以外からは常に拒否。

create index post_chunks_embedding_idx
  on public.post_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index post_chunks_content_pgroonga_idx
  on public.post_chunks using pgroonga (content);
```

- [ ] **Step 2: ローカルDBに適用**

Run: `supabase db reset`
Expected: マイグレーションがエラーなく適用される(出力の最後に `Finished supabase db reset`)

- [ ] **Step 3: pgTAPテストを書く**

```sql
-- supabase/tests/database/10_post_chunks.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_table('public', 'post_chunks', 'post_chunks table exists');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'chunk-writer@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000d1', 'writer', 'chunk-writer', 'CW');
insert into articles (id, author_id, title, body) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
   'テスト記事', '[]'::jsonb);

select lives_ok(
  $$insert into post_chunks (article_id, chunk_index, heading_path, content, token_count)
    values ('00000000-0000-0000-0000-0000000000d2', 0, '見出し', '本文テキスト', 10)$$,
  'seeding a chunk succeeds as postgres'
);

select throws_ok(
  $$insert into post_chunks (article_id, chunk_index, heading_path, content, token_count)
    values ('00000000-0000-0000-0000-0000000000d2', 0, '見出し2', '別の本文', 5)$$,
  '23505', null, 'duplicate (article_id, chunk_index) is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select 1 from post_chunks$$,
  '42501', null, 'authenticated cannot read post_chunks directly'
);
reset role;

set local role anon;
select throws_ok(
  $$select 1 from post_chunks$$,
  '42501', null, 'anon cannot read post_chunks directly'
);
reset role;

delete from articles where id = '00000000-0000-0000-0000-0000000000d2';
select is(
  (select count(*)::int from post_chunks
   where article_id = '00000000-0000-0000-0000-0000000000d2'),
  0,
  'deleting the article cascades to post_chunks'
);

select * from finish();
rollback;
```

- [ ] **Step 4: テストを実行**

Run: `supabase db reset && supabase test db`
Expected: `10_post_chunks.test.sql` が `ok` 6件で通り、他の既存テストファイルも全てPASSのまま(`Result: PASS`)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713100000_post_chunks.sql supabase/tests/database/10_post_chunks.test.sql
git commit -m "feat(db): add post_chunks table for hybrid search"
```

---

### Task 2: `chunkBlocks` 純粋関数(見出し単位のチャンク分割)

**Files:**
- Create: `supabase/functions/_shared/chunking.ts`
- Create: `tests/chunking.test.ts`

**Interfaces:**
- Consumes: なし(Deno固有APIもTiptapの型importも使わない、自己完結したファイル)
- Produces: `export interface ChunkNode { type?: string; attrs?: { level?: number; [key: string]: unknown }; content?: ChunkNode[]; text?: string }`、`export interface Chunk { headingPath: string; content: string; tokenCount: number }`、`export function chunkBlocks(blocks: ChunkNode[]): Chunk[]`。Task 4(`chunk-article`)がこの関数をDenoから相対import(`../_shared/chunking.ts`)して使う。`ArticleInput.body`(`JSONContent[]`)はこの`ChunkNode[]`と構造的に互換。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/chunking.test.ts
import { describe, it, expect } from 'vitest';
import { chunkBlocks } from '../supabase/functions/_shared/chunking';

describe('chunkBlocks', () => {
  it('returns an empty array for an empty body', () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  it('produces one chunk for a short heading + paragraph', () => {
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '川辺にて' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '今日は川辺を観察した。' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('川辺にて');
    expect(chunks[0].content).toContain('川辺にて');
    expect(chunks[0].content).toContain('今日は川辺を観察した。');
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('skips image/embed/file/toc blocks (no extractable text)', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
      { type: 'image', attrs: { url: 'https://img.test/a.webp' } },
      { type: 'embed', attrs: { url: 'https://youtube.com/x', provider: 'youtube' } },
      { type: 'file', attrs: { url: 'https://img.test/a.pdf', filename: 'a.pdf' } },
      { type: 'toc' },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('本文');
  });

  it('extracts text from nested bulletList > listItem > paragraph', () => {
    const blocks = [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目1' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目2' }] }] },
        ],
      },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('項目1');
    expect(chunks[0].content).toContain('項目2');
  });

  it('force-flushes mid-section once token count crosses 800, without a heading', () => {
    // 900文字のCJKテキストを持つ単一段落 = 推定トークン数900(> 800)
    const longText = '観'.repeat(900);
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '長い章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: longText }] },
      { type: 'paragraph', content: [{ type: 'text', text: '続きの段落' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].headingPath).toBe('長い章');
    expect(chunks[1].headingPath).toBe('長い章');
    expect(chunks[1].content).toContain('続きの段落');
  });

  it('flushes at a heading boundary once buffered tokens reach 500, and the new chunk keeps the new heading', () => {
    // 各段落520文字のCJK(推定520トークン、500の壁を単独で越える)
    const para1 = '観'.repeat(520);
    const para2 = '察'.repeat(520);
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: para1 }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第二章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: para2 }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toBe('第一章');
    expect(chunks[1].headingPath).toBe('第二章');
  });

  it('tracks a two-level heading path (h2 > h3), resetting h3 on a new h2', () => {
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '装備' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '長靴' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '長靴の話。' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks[chunks.length - 1].headingPath).toBe('装備 > 長靴');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/chunking.test.ts`
Expected: FAIL(`Cannot find module '../supabase/functions/_shared/chunking'`)

- [ ] **Step 3: 実装を書く**

```typescript
// supabase/functions/_shared/chunking.ts
// Deno固有API(Deno.*)やnpm importを一切使わない自己完結モジュール。
// Denoの chunk-article Edge Function と、Node上のVitestテストの両方から
// そのままimportできることを保証するため。

export interface ChunkNode {
  type?: string;
  attrs?: { level?: number; [key: string]: unknown };
  content?: ChunkNode[];
  text?: string;
}

export interface Chunk {
  headingPath: string;
  content: string;
  tokenCount: number;
}

const TEXT_LEAF_TYPES = new Set(['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem']);
const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);
const FLUSH_FLOOR_TOKENS = 500;
const FLUSH_CEILING_TOKENS = 800;

function estimateTokens(text: string): number {
  // CJK(ひらがな・カタカナ・漢字・全角記号)は1文字1トークン、それ以外は4文字1トークン
  // で見積もる簡易ヒューリスティック。OpenAIの正確なトークナイザは使わない
  // (課金計算ではなく、チャンクサイズを500〜800語相当に抑えるための目安)。
  const cjkMatches = text.match(/[　-ヿ㐀-鿿＀-￯]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const restCount = text.length - cjkCount;
  return cjkCount + Math.ceil(restCount / 4);
}

function extractText(node: ChunkNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).filter((t) => t.length > 0).join(' ');
}

function collectTextBlocks(node: ChunkNode, out: ChunkNode[]): void {
  if (!node.type) return;
  if (TEXT_LEAF_TYPES.has(node.type)) {
    out.push(node);
    return;
  }
  if (LIST_CONTAINER_TYPES.has(node.type)) {
    for (const child of node.content ?? []) collectTextBlocks(child, out);
    return;
  }
  // image/embed/file/toc など、テキストを持たないブロックはスキップする。
}

export function chunkBlocks(blocks: ChunkNode[]): Chunk[] {
  const textBlocks: ChunkNode[] = [];
  for (const block of blocks) collectTextBlocks(block, textBlocks);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  let headingPath: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({
      headingPath: headingPath.join(' > '),
      content: buffer.join('\n\n'),
      tokenCount: bufferTokens,
    });
    buffer = [];
    bufferTokens = 0;
  };

  for (const block of textBlocks) {
    if (block.type === 'heading') {
      // 見出し境界を優先してカットする: 直前のセクションを「古い」headingPathの
      // ままflushしてから、新しいheadingPathに更新する(逆順にすると直前の
      // セクションが新しい見出しのラベルを引き継いでしまう)。
      if (bufferTokens >= FLUSH_FLOOR_TOKENS) flush();
      const level = block.attrs?.level ?? 2;
      const text = extractText(block);
      if (level <= 2) {
        headingPath = text ? [text] : [];
      } else {
        headingPath = [...headingPath.slice(0, 1), text].filter((t) => t.length > 0);
      }
    }

    const text = extractText(block);
    if (text) {
      buffer.push(text);
      bufferTokens += estimateTokens(text);
    }
    if (bufferTokens >= FLUSH_CEILING_TOKENS) flush();
  }
  flush();

  return chunks;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npx vitest run tests/chunking.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: ルート全体のテストも壊れていないことを確認**

Run: `npm test`
Expected: 既存の`tests/content.test.ts`も含め全てPASS

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/chunking.ts tests/chunking.test.ts
git commit -m "feat: add chunkBlocks pure function for heading-based chunking"
```

---

### Task 3: RPC `search_articles_hybrid`(RRFマージ)

**Files:**
- Create: `supabase/migrations/20260713100100_search_articles_hybrid.sql`
- Create: `supabase/tests/database/11_search_articles_hybrid.test.sql`

**Interfaces:**
- Consumes: Task 1の `public.post_chunks` テーブル。
- Produces: `public.search_articles_hybrid(query_embedding extensions.vector(1536), query_text text, match_count int default 10) returns table(article_id uuid, slug text, title text, excerpt_html text, score double precision)`。Task 5(`search-articles` Edge Function)がこの関数名・シグネチャをそのまま `supabase.rpc('search_articles_hybrid', {...})` で呼ぶ。

- [ ] **Step 1: マイグレーションを書く**

```sql
-- supabase/migrations/20260713100100_search_articles_hybrid.sql
create or replace function public.search_articles_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  match_count int default 10
)
returns table (
  article_id uuid,
  slug text,
  title text,
  excerpt_html text,
  score double precision
)
language sql
stable
as $$
  with vector_ranked as (
    select
      pc.id as chunk_id,
      pc.article_id,
      row_number() over (order by pc.embedding <=> query_embedding) as rnk
    from public.post_chunks pc
    join public.articles a on a.id = pc.article_id
    where a.status = 'published' and pc.embedding is not null
    order by pc.embedding <=> query_embedding
    limit 50
  ),
  fulltext_ranked as (
    select
      pc.id as chunk_id,
      pc.article_id,
      row_number() over (
        order by extensions.pgroonga_score(pc.tableoid, pc.ctid) desc
      ) as rnk
    from public.post_chunks pc
    join public.articles a on a.id = pc.article_id
    where a.status = 'published' and pc.content &@~ query_text
    limit 50
  ),
  fused as (
    select
      coalesce(v.chunk_id, f.chunk_id) as chunk_id,
      coalesce(v.article_id, f.article_id) as article_id,
      coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0) as rrf_score
    from vector_ranked v
    full outer join fulltext_ranked f on f.chunk_id = v.chunk_id
  ),
  best_chunk as (
    select distinct on (article_id)
      article_id, chunk_id, rrf_score
    from fused
    order by article_id, rrf_score desc
  )
  select
    a.id as article_id,
    a.slug,
    a.title,
    extensions.pgroonga_highlight_html(
      pc.content,
      extensions.pgroonga_query_extract_keywords(query_text)
    ) as excerpt_html,
    bc.rrf_score as score
  from best_chunk bc
  join public.post_chunks pc on pc.id = bc.chunk_id
  join public.articles a on a.id = bc.article_id
  order by bc.rrf_score desc
  limit match_count;
$$;

revoke execute on function public.search_articles_hybrid(extensions.vector, text, int)
  from public, anon, authenticated;
grant execute on function public.search_articles_hybrid(extensions.vector, text, int)
  to service_role;
```

- [ ] **Step 2: ローカルDBに適用**

Run: `supabase db reset`
Expected: マイグレーションがエラーなく適用される

- [ ] **Step 3: pgTAPテストを書く**

```sql
-- supabase/tests/database/11_search_articles_hybrid.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_function('public', 'search_articles_hybrid', 'search_articles_hybrid function exists');

-- 1536次元ベクトルを2つの次元の重みだけで組み立てるテスト専用ヘルパ
-- (トランザクション終了で自動的に破棄される)。完全に同一の距離を持つ
-- ベクトル同士(row_numberのタイブレークが処理系依存になる)を避けるため、
-- クエリ・A・C・Bの4本を「一致度が段階的に下がる」よう明確に距離を離して作る:
--   query/A = blend(1,1, 2,0)      距離0(完全一致)
--   C       = blend(1,0.5, 2,0.5) 距離が中間(Aより明確に遠く、Bより明確に近い)
--   B       = blend(1,0, 2,1)     距離1(直交、最も遠い)
create function pg_temp.blend(dim_a int, weight_a numeric, dim_b int, weight_b numeric)
returns extensions.vector as $$
  select ('[' || string_agg(
    (case when g = dim_a then weight_a when g = dim_b then weight_b else 0 end)::text, ','
  ) || ']')::extensions.vector(1536)
  from generate_series(1, 1536) g;
$$ language sql;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'search-writer@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'writer', 'search-writer', 'SW');

-- A: ベクトルもキーワードも一致(両方で強くヒット)。2チャンク(dedup検証も兼ねる)
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ記事A', 'kawauso-a', '[{"type":"paragraph"}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a1', 0, '', 'カワウソの生態について解説する記事です', 20,
   pg_temp.blend(1, 1, 2, 0)),
  ('00000000-0000-0000-0000-0000000000a1', 1, '', 'カワウソの別の話題です', 15,
   pg_temp.blend(1, 1, 2, 0));

-- B: キーワードのみ一致、ベクトルは最も無関係(直交)
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ記事B', 'kawauso-b', '[{"type":"paragraph"}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a2', 0, '', 'カワウソに関する重要な情報です', 15,
   pg_temp.blend(1, 0, 2, 1));

-- C: ベクトルのみ中程度に一致、キーワードは無関係
insert into articles (id, author_id, title, slug, body, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1',
   '無関係記事C', 'unrelated-c', '[{"type":"paragraph"}]'::jsonb, 'published', now());
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a3', 0, '', '全く関係ない話題の記事です', 15,
   pg_temp.blend(1, 0.5, 2, 0.5));

-- D: 下書き。ベクトルもキーワードも強一致だが published ではないので絶対に出ない
insert into articles (id, author_id, title, slug, body, status) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1',
   'カワウソ下書きD', null, '[{"type":"paragraph"}]'::jsonb, 'draft');
insert into post_chunks (article_id, chunk_index, heading_path, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a4', 0, '', 'カワウソの下書き記事です', 15,
   pg_temp.blend(1, 1, 2, 0));

select is(
  (select array_agg(slug order by score desc)
   from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)),
  array['kawauso-a', 'kawauso-b', 'unrelated-c'],
  'A(両方一致)が最上位、B(キーワードのみ)・C(ベクトルのみ中程度)が続く'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
   where slug = 'kawauso-a'),
  1,
  'Aは2チャンクマッチしても記事単位で1行にdedupされる'
);

select ok(
  not exists (
    select 1 from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)
    where article_id = '00000000-0000-0000-0000-0000000000a4'
  ),
  '下書き記事D(ベクトル・キーワードとも強一致)はpublishedでないため結果に含まれない'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 10)),
  3,
  '下書きDを除いた3記事だけが返る'
);

select is(
  (select count(*)::int from public.search_articles_hybrid(pg_temp.blend(1, 1, 2, 0), 'カワウソ', 1)),
  1,
  'match_countで件数を絞れる'
);

select * from finish();
rollback;
```

- [ ] **Step 4: テストを実行**

Run: `supabase db reset && supabase test db`
Expected: `11_search_articles_hybrid.test.sql` が `ok` 6件で通り、既存テストも全てPASSのまま

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713100100_search_articles_hybrid.sql supabase/tests/database/11_search_articles_hybrid.test.sql
git commit -m "feat(db): add search_articles_hybrid RPC (RRF merge, published-only, dedup)"
```

---

### Task 4: `chunk-article` Edge Function

**Files:**
- Create: `supabase/functions/chunk-article/index.ts`
- Modify: `supabase/functions/.env.example`(既存キーの一覧に `OPENAI_API_KEY` を追記)

**Interfaces:**
- Consumes: Task 1の`post_chunks`テーブル、Task 2の`chunkBlocks`(`../_shared/chunking.ts`から相対import)。
- Produces: POST `/functions/v1/chunk-article`、入力 `{ articleId: string }`(要`Authorization: Bearer <jwt>`)、成功時 `{ ok: true, chunkCount: number }`。Task 6がこのエンドポイントを`supabase.functions.invoke('chunk-article', { body: { articleId } })`で呼ぶ。

- [ ] **Step 1: `.env.example` に追記**

`supabase/functions/.env.example` の既存キー一覧に以下を追記する(既存ファイルの書式に倣い、キー名と説明コメントのみ。値は空):

```
OPENAI_API_KEY=
```

- [ ] **Step 2: Edge Functionを実装**

```typescript
// supabase/functions/chunk-article/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { chunkBlocks, type ChunkNode } from '../_shared/chunking.ts';

const EMBEDDING_MODEL = 'text-embedding-3-small';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')!;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.data as { embedding: number[] }[]).map((d) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: callerData } = await admin.auth.getUser(jwt);
  if (!callerData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { articleId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const articleId = payload.articleId;
  if (!articleId) return json({ error: 'articleId is required' }, 400);

  const { data: article, error: articleError } = await admin
    .from('articles')
    .select('id, author_id, body')
    .eq('id', articleId)
    .maybeSingle();
  if (articleError) return json({ error: articleError.message }, 500);
  if (!article) return json({ error: 'not found' }, 404);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();
  const isOwner = article.author_id === callerData.user.id;
  const isAdmin = callerProfile?.role === 'admin';
  if (!isOwner && !isAdmin) return json({ error: 'forbidden' }, 403);

  const chunks = chunkBlocks((article.body as ChunkNode[]) ?? []);

  if (chunks.length === 0) {
    const { error: deleteError } = await admin
      .from('post_chunks').delete().eq('article_id', articleId);
    if (deleteError) return json({ error: deleteError.message }, 500);
    return json({ ok: true, chunkCount: 0 });
  }

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks.map((c) => c.content));
  } catch (err) {
    console.error(err);
    return json({ error: 'embedding failed' }, 502);
  }

  const rows = chunks.map((chunk, index) => ({
    article_id: articleId,
    chunk_index: index,
    heading_path: chunk.headingPath,
    content: chunk.content,
    token_count: chunk.tokenCount,
    embedding: embeddings[index],
  }));

  const { error: upsertError } = await admin
    .from('post_chunks')
    .upsert(rows, { onConflict: 'article_id,chunk_index' });
  if (upsertError) return json({ error: upsertError.message }, 500);

  const { error: pruneError } = await admin
    .from('post_chunks')
    .delete()
    .eq('article_id', articleId)
    .gte('chunk_index', chunks.length);
  if (pruneError) return json({ error: pruneError.message }, 500);

  return json({ ok: true, chunkCount: chunks.length });
});
```

- [ ] **Step 3: ローカルの `.env` に実キーを設定**

`supabase/functions/.env` を開き、`OPENAI_API_KEY=` の行に実際のOpenAI APIキーを設定する(このファイルは既存の`.gitignore`対象で、コミットしない)。

- [ ] **Step 4: 手動smokeテスト**

Run: `supabase functions serve --env-file supabase/functions/.env`(別ターミナル)

続けて、シードユーザーでログインしJWTを取得し、既存の下書き記事IDに対して呼び出す:

```bash
curl -s -X POST http://127.0.0.1:54321/auth/v1/token?grant_type=password \
  -H "apikey: <ローカルのANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"hana@seed.local","password":"seed-pass-1234"}' | jq -r .access_token
# 上記トークンとseed済み記事IDで:
curl -s -X POST http://127.0.0.1:54321/functions/v1/chunk-article \
  -H "Authorization: Bearer <取得したトークン>" -H "Content-Type: application/json" \
  -d '{"articleId":"<記事のUUID>"}'
```

Expected: `{"ok":true,"chunkCount":N}`(N>=1)。続けて `select * from post_chunks where article_id = '<記事のUUID>';` をローカルDBに対して実行し、`embedding`が1536次元のベクトルとして入っていることを確認する。

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/chunk-article/index.ts supabase/functions/.env.example
git commit -m "feat: add chunk-article Edge Function"
```

---

### Task 5: `search-articles` Edge Function

**Files:**
- Create: `supabase/functions/search-articles/index.ts`

**Interfaces:**
- Consumes: Task 3の`search_articles_hybrid` RPC。
- Produces: POST `/functions/v1/search-articles`、入力 `{ query: string }`(認証不要)、成功時 `{ results: { slug: string; title: string; excerptHtml: string; score: number }[] }`。Task 7のフロントがこのエンドポイントを呼ぶ。

- [ ] **Step 1: Edge Functionを実装**

```typescript
// supabase/functions/search-articles/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_QUERY_LENGTH = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function embedQuery(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')!;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let payload: { query?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const query = (payload.query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return json({ error: 'query is required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let embedding: number[];
  try {
    embedding = await embedQuery(query);
  } catch (err) {
    console.error(err);
    return json({ error: 'embedding failed' }, 502);
  }

  const { data, error } = await admin.rpc('search_articles_hybrid', {
    query_embedding: embedding,
    query_text: query,
    match_count: 10,
  });
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as
    { slug: string; title: string; excerpt_html: string; score: number }[];
  return json({
    results: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      excerptHtml: row.excerpt_html,
      score: row.score,
    })),
  });
});
```

- [ ] **Step 2: 手動smokeテスト**

Run: `supabase functions serve --env-file supabase/functions/.env`(既に起動していなければ)

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/search-articles \
  -H "Content-Type: application/json" \
  -d '{"query":"<Task4でチャンク化した記事に含まれるキーワード>"}'
```

Expected: `{"results":[{"slug":"...","title":"...","excerptHtml":"...","score":...}, ...]}`。空文字クエリ `{"query":""}` では400が返ることも確認する。

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/search-articles/index.ts
git commit -m "feat: add search-articles Edge Function"
```

---

### Task 6: admin — 保存/公開時にチャンク化をトリガー

**Files:**
- Create: `admin/src/lib/search-index.ts`
- Create: `admin/tests/search-index.test.ts`
- Modify: `admin/src/pages/articles/edit.astro`(`save`関数内)
- Modify: `admin/src/pages/articles/new.astro`(`create`関数内)

**Interfaces:**
- Consumes: Task 4の`chunk-article` Edge Function(名前のみ、`supabase.functions.invoke`経由)。
- Produces: `export async function triggerChunking(supabase: SupabaseClient, articleId: string): Promise<void>`(内部で例外を握りつぶし、常に解決する)。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// admin/tests/search-index.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { triggerChunking } from '../src/lib/search-index';

function fakeClient(invoke: ReturnType<typeof vi.fn>): SupabaseClient {
  return { functions: { invoke } } as unknown as SupabaseClient;
}

describe('triggerChunking', () => {
  it('invokes chunk-article with the articleId', async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true, chunkCount: 3 }, error: null }));
    await triggerChunking(fakeClient(invoke), 'article-1');
    expect(invoke).toHaveBeenCalledWith('chunk-article', { body: { articleId: 'article-1' } });
  });

  it('does not throw when the function returns an error', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error('boom') }));
    await expect(triggerChunking(fakeClient(invoke), 'article-1')).resolves.toBeUndefined();
  });

  it('does not throw when invoke itself rejects', async () => {
    const invoke = vi.fn(async () => { throw new Error('network down'); });
    await expect(triggerChunking(fakeClient(invoke), 'article-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/search-index.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/search-index'`)

- [ ] **Step 3: 実装を書く**

```typescript
// admin/src/lib/search-index.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function triggerChunking(
  supabase: SupabaseClient, articleId: string,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('chunk-article', {
      body: { articleId },
    });
    if (error) console.warn('chunk-article failed:', error);
  } catch (err) {
    console.warn('chunk-article failed:', err);
  }
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `cd admin && npx vitest run tests/search-index.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: `edit.astro` の保存ハンドラに組み込む**

`admin/src/pages/articles/edit.astro` の import 行に追記:

```typescript
import { triggerChunking } from '../../lib/search-index';
```

`save`関数内(`document.getElementById('save-draft')`/`'publish'`の両方のボタンから呼ばれる共通ハンドラ)、`currentUpdatedAt = result.updatedAt;` の直後に1行追加する。変更前後は以下の通り(`clearDraftBackup(id);` 以降は変更なし):

```typescript
            try {
              const result = await saveArticle(supabaseBrowser, id, input, publish, currentUpdatedAt);
              currentUpdatedAt = result.updatedAt;
              await triggerChunking(supabaseBrowser, id);
              clearDraftBackup(id);
```

(20秒毎の`autosave`の`save`コールバック(`createAutosave({...})`内)には**追加しない** — Global Constraints通り、手動保存/公開時のみ)

- [ ] **Step 6: `new.astro` の作成ハンドラに組み込む**

`admin/src/pages/articles/new.astro` の import 行に追記:

```typescript
import { triggerChunking } from '../../lib/search-index';
```

`create`関数内、`const id = await createDraft(supabaseBrowser, input);` の直後に追加する:

```typescript
          try {
            const id = await createDraft(supabaseBrowser, input);
            await triggerChunking(supabaseBrowser, id);
            redirectTo(`/articles/edit?id=${id}`);
```

- [ ] **Step 7: CMS全体のテストとビルドを確認**

Run: `cd admin && npm test && npx astro build`
Expected: 全テストPASS、ビルドエラーなし

- [ ] **Step 8: Commit**

```bash
git add admin/src/lib/search-index.ts admin/tests/search-index.test.ts \
  admin/src/pages/articles/edit.astro admin/src/pages/articles/new.astro
git commit -m "feat(admin): trigger chunk-article on manual save/publish"
```

---

### Task 7: 公開サイト — `SearchBox` コンポーネント

**Files:**
- Create: `src/components/SearchBox.astro`
- Modify: `src/pages/index.astro`(コンポーネントを設置)

**Interfaces:**
- Consumes: Task 5の`search-articles` Edge Function(`supabase.functions.invoke('search-articles', {body:{query}})`)。
- Produces: なし(末端のUIコンポーネント)。

- [ ] **Step 1: `PUBLIC_SUPABASE_ANON_KEY` がローカル環境に設定済みか確認**

公開サイトのSupabaseクライアント(`src/lib/supabase-server.ts`)はservice role専用でビルド時専用のため、ブラウザから呼ぶ検索には別途anon keyのブラウザ用クライアントが必要。`src/env.d.ts`には既に `PUBLIC_SUPABASE_ANON_KEY` の型宣言があるので、ローカルの `.env` に値が入っているか確認する:

Run: `grep -q '^PUBLIC_SUPABASE_ANON_KEY=' .env && echo present || echo missing`

`missing` の場合、ローカルSupabaseの `ANON_KEY`(`supabase status` の出力に含まれる)を追記する:

```bash
printf 'PUBLIC_SUPABASE_ANON_KEY=%s\n' "<supabase status の ANON_KEY>" >> .env
```

- [ ] **Step 2: ブラウザ用anonクライアントを作成**

`src/lib/supabase-browser.ts` が存在しない場合(`test -f src/lib/supabase-browser.ts` で確認)、admin側の実装(`admin/src/lib/supabase-browser.ts`)と同じ構成で作成する:

```typescript
// src/lib/supabase-browser.ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

// ブラウザ専用クライアント(検索ボックス用)。anon keyのみ。
// service role keyはここに絶対に入れないこと(それは supabase-server.ts の役目)。
export const supabaseBrowser = createClient(url, anonKey, {
  auth: { persistSession: false },
});
```

(既に存在する場合はこのステップをスキップし、既存のexport名を後続ステップで使う)

- [ ] **Step 3: `SearchBox.astro` を実装**

```astro
---
// src/components/SearchBox.astro
---
<div class="search-box">
  <input type="search" id="search-input" placeholder="記事を検索" aria-label="記事を検索" />
  <ul id="search-results" hidden></ul>
  <p id="search-status" role="status"></p>
</div>

<script>
  import { supabaseBrowser } from '../lib/supabase-browser';

  const input = document.getElementById('search-input') as HTMLInputElement;
  const resultsEl = document.getElementById('search-results') as HTMLUListElement;
  const statusEl = document.getElementById('search-status') as HTMLParagraphElement;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  interface SearchResult {
    slug: string;
    title: string;
    excerptHtml: string;
    score: number;
  }

  function renderResults(results: SearchResult[]) {
    if (results.length === 0) {
      resultsEl.hidden = true;
      statusEl.textContent = '見つかりませんでした。';
      return;
    }
    resultsEl.innerHTML = results.map((r) => `
      <li>
        <a href="/articles/${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>
        <p>${r.excerptHtml}</p>
      </li>
    `).join('');
    resultsEl.hidden = false;
    statusEl.textContent = '';
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
    ));
  }

  async function runSearch(query: string) {
    abortController?.abort();
    abortController = new AbortController();
    const { signal } = abortController;

    try {
      const { data, error } = await supabaseBrowser.functions.invoke('search-articles', {
        body: { query },
      });
      if (signal.aborted) return;
      if (error) {
        statusEl.textContent = '検索に失敗しました。時間をおいて再度お試しください。';
        resultsEl.hidden = true;
        return;
      }
      renderResults((data?.results ?? []) as SearchResult[]);
    } catch {
      if (signal.aborted) return;
      statusEl.textContent = '検索に失敗しました。時間をおいて再度お試しください。';
      resultsEl.hidden = true;
    }
  }

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);
    if (!query) {
      abortController?.abort();
      resultsEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    debounceTimer = setTimeout(() => runSearch(query), 300);
  });
</script>

<style>
  .search-box { position: relative; }
  #search-results { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  #search-results li { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
  #search-results :global(.keyword) { font-weight: bold; }
</style>
```

- [ ] **Step 4: トップページに設置**

`src/pages/index.astro` の現在の内容:

```astro
---
import Base from '../layouts/Base.astro';
import { supabaseServer } from '../lib/supabase-server';
import { fetchPublishedArticles, formatDate } from '../lib/content';

const { featured, normal } = await fetchPublishedArticles(supabaseServer);
---
<Base title="Wild Media">
  <h1>Wild Media</h1>

  {featured.length > 0 && (
```

frontmatterのimportに1行追加し、`<h1>Wild Media</h1>` の直後・Featuredセクションの直前に `<SearchBox />` を配置する:

```astro
---
import Base from '../layouts/Base.astro';
import { supabaseServer } from '../lib/supabase-server';
import { fetchPublishedArticles, formatDate } from '../lib/content';
import SearchBox from '../components/SearchBox.astro';

const { featured, normal } = await fetchPublishedArticles(supabaseServer);
---
<Base title="Wild Media">
  <h1>Wild Media</h1>

  <SearchBox />

  {featured.length > 0 && (
```

- [ ] **Step 5: 手動ブラウザ確認**

Run: `npm run dev`(公開サイト、:4321)。

ブラウザで `http://localhost:4321/` を開き、検索ボックスにTask4でチャンク化済みの記事に含まれるキーワードを入力し、300ms後に結果が表示されること・ハイライトが効いていること・空欄に戻すと結果が消えることを確認する。

- [ ] **Step 6: ビルド確認**

Run: `npm run build`
Expected: エラーなくビルドが完了する

- [ ] **Step 7: Commit**

```bash
git add src/components/SearchBox.astro src/pages/index.astro
git add src/lib/supabase-browser.ts 2>/dev/null || true
git commit -m "feat: add SearchBox component to the public site top page"
```

---

### Task 8: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1〜7で確定した全ての名前(テーブル名・関数名・Edge Function名・環境変数名)。
- Produces: なし。

- [ ] **Step 1: `ARCHITECTURE.md` を更新**

「コンポーネント」表の `supabase/functions/` の行を更新:

```
| `supabase/functions/` | Edge Functionsは4つ: `invite-user`(管理者専用のユーザー招待)/ `r2-upload-url`(R2署名付きURL発行)/ `chunk-article`(記事保存時に本文をチャンク化しembedding生成)/ `search-articles`(ハイブリッド検索) |
```

「主要ルール」節の末尾に追記:

```markdown
- 記事検索はハイブリッド検索(pgvector類似検索 + pgroonga全文検索をRRFでマージ)。
  記事の手動保存/公開時に `chunk-article` Edge Functionが本文を見出し単位で
  チャンク分割し、OpenAI `text-embedding-3-small` でembeddingを生成して
  `post_chunks` テーブルに保存する(20秒毎のautosaveでは呼ばない)。
  `post_chunks` はservice role専用(RLS+GRANTの両方でanon/authenticatedを拒否)。
  検索は `search-articles` Edge Function → DB関数 `search_articles_hybrid` が
  `articles.status = 'published'` をDB層で強制し、下書きは結果に混ざらない。
  記事削除時は `post_chunks.article_id` の `on delete cascade` で自動的に
  チャンクも削除される。
```

- [ ] **Step 2: `CLAUDE.md` を更新**

「コマンド」節の「その他」ブロックにあるEdge Function起動コマンドの説明コメントを更新:

```markdown
supabase functions serve --env-file supabase/functions/.env  # 招待・画像URL発行・検索インデックス更新・検索
```

新しい環境変数の説明を追記(「シードログイン」の前あたりに新しい段落):

```markdown
## 環境変数(Edge Functions)

`supabase/functions/.env`(ローカル)・本番のFunction Secretsに `OPENAI_API_KEY` が必要
(ハイブリッド検索のembedding生成用)。
```

- [ ] **Step 3: `README.md` に `OPENAI_API_KEY` の設定手順を追記**

`README.md` の「開発を始めるたびに実行するコマンド」ブロック直後、`supabase functions serve` の説明文(35行目付近、`` `supabase functions serve` は `supabase start` / `supabase stop` では起動・停止されない独立プロセス... ``)の次に1文追加する:

```markdown
記事保存時の検索インデックス更新(`chunk-article`)と検索(`search-articles`)にはOpenAI APIキーが必要。`supabase/functions/.env` に `OPENAI_API_KEY=` を設定すること(`supabase/functions/.env.example` 参照)。
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ARCHITECTURE.md README.md
git commit -m "docs: document hybrid search architecture and OPENAI_API_KEY setup"
```
