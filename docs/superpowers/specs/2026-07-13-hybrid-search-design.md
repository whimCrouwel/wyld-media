# 記事ハイブリッド検索 設計スペック

**前提ブランチ**: `feature/article-editor`(`articles.body` が Tiptap ブロックJSON(`jsonb`)である前提)。このブランチが `main` にマージされるまで、本機能もこのブランチ上で継続する。

## 目的

記事本文をチャンク分割して embedding を生成し、pgvectorによるベクトル類似検索とPostgreSQL全文検索(pgroonga)をRRF(Reciprocal Rank Fusion)でマージしたハイブリッド検索を提供する。公開サイトに検索ボックスを設置する。

## アーキテクチャ概要

```
[記事保存/公開] (admin, edit.astro/new.astro)
      │ saveArticle成功後、fire-and-forget
      ▼
Edge Function: chunk-article ──► OpenAI embeddings API
      │ (認証: JWT検証 + article.author_id一致 or admin)
      ▼
DB: post_chunks (upsert, article_id+chunk_index一意)
      articles.body(jsonb, ブロック配列) を見出し単位で分割

[記事削除] (admin, deleteArticle)
      │
      ▼
DB: articles DELETE → post_chunks ON DELETE CASCADE で自動削除
      (Edge Function呼び出し不要、DB層で保証)

[検索] (公開サイト, SearchBox component)
      │ 300msデバウンス、AbortControllerでキャンセル
      ▼
Edge Function: search-articles ──► OpenAI embeddings API(クエリ)
      │ 認証不要(公開検索)
      ▼
DB RPC: search_articles_hybrid(query_embedding, query_text)
      - pgvector類似検索 top50 + pgroonga全文検索 top50 をRRFでマージ
      - articles.status='published' でDB側フィルタ(下書きは絶対に出ない)
      - 記事単位で重複排除、pgroongaのhighlight関数で抜粋HTML生成
      - 上位10件を返す
      ▼
JSON {title, slug, excerptHtml, score}[] ──► フロント描画
```

## DBスキーマ

```sql
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

alter table public.post_chunks enable row level security;
-- ポリシーなし = anon/authenticatedからは一切読めない/書けない。
-- service role(Edge Function内)のみがRLSをバイパスしてアクセスする。

create index post_chunks_embedding_idx
  on public.post_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index post_chunks_content_pgroonga_idx
  on public.post_chunks using pgroonga (content);

create trigger post_chunks_set_updated_at
  before update on public.post_chunks
  for each row execute function extensions.moddatetime(updated_at);
```

- `article_id` に `on delete cascade` → 記事削除時のチャンク削除はDB層で保証(Edge Function呼び出し不要)。
- RLSはポリシーなしのデフォルト拒否。`post_chunks` を直接読めるのは service role だけ(Edge Function内のみ)。CMS/公開サイトのブラウザからは一切触れない。
- pgTAPテストで RLS拒否・カスケード削除・unique制約を検証。

## チャンク化アルゴリズム(`chunk-article` Edge Function)

`articles.body`(Tiptap ブロックJSON配列)をトップレベルのブロック順に走査する。

- テキストを持つブロック: `heading`(h2/h3)/`paragraph`/`bulletList`・`orderedList`(中の`listItem`を再帰)/`blockquote`/`codeBlock`
- テキストを持たないブロック(スキップ、スコープ外): `image`/`embed`/`file`/`toc`
- 見出しに遭遇するたびに `heading_path` を更新(例: `"川辺の観察 > 装備について"`)。h2が来たらh3は破棄。

トークン数は簡易推定(CJK文字=1文字1トークン、それ以外=4文字1トークン程度)。OpenAIの正確なトークナイザは使わず、チャンクサイズ調整用のヒューリスティックとして割り切る(課金計算には使わない)。

```
buffer = [], bufferTokens = 0, headingPath = ''
for block in blocks:
  if block is heading:
    headingPath = updatePath(block)
    if bufferTokens >= 500: flush()   // 見出し境界を優先してカット
  text = extractText(block)
  if text: buffer.push(text); bufferTokens += estimateTokens(text)
  if bufferTokens >= 800: flush()     // 800超えたら見出し境界を無視して強制カット
flush()  // 残り
```

この純粋関数(`chunkBlocks`)はDeno固有API(`Deno.*`)を一切使わずに書き、`supabase/functions/_shared/chunking.ts` に置いて **Vitestからも直接importしてユニットテストする**(block editor実装時に `renderBlocksToHtml` の DOM依存で Deno/Node 両ランタイム対応につまずいた教訓を踏まえ、この関数はランタイム依存を持たせない)。

## Edge Functions

### `chunk-article`

- **入力**: `{ articleId: string }`(POST, JWT必須)
- **認可**: JWT検証 → 呼び出しユーザーが記事の著者 or admin role でなければ403(`invite-user`と同じ「関数内でDB照合」パターン)
- **手順**:
  1. service role clientで対象記事を再取得(クライアントが送ってきた本文は信用しない、DBの現在値を使う)
  2. `chunkBlocks(article.body)` でチャンク配列を生成
  3. OpenAI `POST /v1/embeddings`(`text-embedding-3-small`)に全チャンクのテキストを一括投入(1回のAPI呼び出し)
  4. `post_chunks` に `(article_id, chunk_index)` でupsert
  5. 新しいチャンク数より `chunk_index` が大きい既存行を削除(本文が短くなった場合の後始末)
  6. `{ ok: true, chunkCount }` を返す

### `search-articles`

- **入力**: `{ query: string }`(POST, 認証不要・公開検索)
- **バリデーション**: 空文字/前後空白トリム後0文字 → 400。200文字超は切り詰め。
- **手順**:
  1. OpenAI(`text-embedding-3-small`)でクエリをembedding化
  2. DB RPC `search_articles_hybrid(query_embedding, query_text, match_count => 10)` を呼ぶ
  3. RPCの結果(`slug, title, excerpt_html, score`)をそのままJSON化して返す

### RPC `search_articles_hybrid`(plpgsql、DB層に実装)

- ベクトル類似検索 top50(`embedding <=> query_embedding` 昇順)と pgroonga全文検索 top50(`content &@~ query_text`)をそれぞれ `row_number()` でランク付け
- RRFスコア: `1/(60+rank_vector) + 1/(60+rank_fulltext)`(どちらかに出現しない場合はそちら側0点、k=60)
- `articles.status = 'published'` を**RPC内でjoin条件として強制**(呼び出し元が何を送ろうと下書きは絶対に混じらない)
- 記事単位でチャンクをdedup(スコア最大のチャンクを代表として採用)、スコア降順で上位10件
- 抜粋HTMLは `pgroonga_highlight_html(content, pgroonga_query_extract_keywords(query_text))` で生成(マッチ箇所を`<span class="keyword">`で自動ハイライト、エスケープ込み)

このRPCはpgTAPでテスト可能(既知のembedding/テキストをシードして、順位・dedup・published限定・ハイライトを検証)。

## フロント(公開サイト)

- `src/components/SearchBox.astro`: 検索ボックス+結果一覧。まずはトップページ(`src/pages/index.astro`)にのみ設置(場所は後で変更しやすいよう独立コンポーネントとして作る)。
- クライアントJS(`<script>`内、フレームワーク不使用、既存admin側の素のTS流儀に合わせる):
  - 入力→300msデバウンス→`AbortController`で前回リクエストをキャンセルしつつ `supabase.functions.invoke('search-articles', {body:{query}})`
  - 結果: タイトル(リンク`/articles/[slug]`)+ `excerptHtml`(Edge Function側で安全に組み立てたHTMLのみ、`<span class="keyword">`程度に限定)
  - 空クエリ時は結果非表示、0件時は「見つかりませんでした」、エラー時は「検索に失敗しました。時間をおいて再度お試しください。」

## admin側の変更

- `edit.astro` / `new.astro` の保存・公開ボタンハンドラ内、`saveArticle`成功後に `supabase.functions.invoke('chunk-article', {body:{articleId}})` を呼ぶ(fire-and-forget、失敗してもコンソール警告のみで保存自体は成功扱い)
- **20秒ごとのautosaveでは呼ばない**(埋め込みAPIコストの無駄撃ち防止)。手動保存・公開時のみ。
- 削除は既存の `deleteArticle` のまま変更不要(FK cascadeで自動処理)

## スコープ外(今回やらないこと)

- 検索のレート制限(小規模プラットフォームのため一旦YAGNI、悪用が問題になったら追加)
- 画像/embed/fileブロックのalt/caption/filenameをチャンク本文に含めること(テキストブロックのみ対象)
- タグ・カテゴリでの絞り込み(検索は全文横断のみ)

## テスト計画

| 層 | 内容 |
|---|---|
| pgTAP | RLS拒否・カスケード削除・unique制約・`search_articles_hybrid`の順位/dedup/published限定/ハイライト |
| Vitest(root) | `chunkBlocks`純粋関数のユニットテスト(見出し境界・800超え強制カット・空ブロックスキップ) |
| 手動smoke | `supabase functions serve --env-file supabase/functions/.env` + curlで chunk-article / search-articles を実際にOpenAI呼び出しまで通す(既存Edge Functionと同じ検証レベル) |

## デプロイ前提

- `OPENAI_API_KEY` を `supabase/functions/.env`(ローカル)と本番のFunction Secretsに追加(README/CLAUDE.mdのセットアップ手順に追記)
- pgroongaが本番Supabaseプロジェクトで有効化可能か(ローカルでは確認済み)は実際のプロジェクトでの検証が必要。万一使えない場合は `content` に `tsvector` 列 + GINインデックスへフォールバックする設計にしておく(RPCのインターフェースは変えずに内部実装だけ差し替え可能)。
