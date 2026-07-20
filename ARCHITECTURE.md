# アーキテクチャ

Wild Media の「いまの姿」の地図。意思決定の経緯は [設計スペック](docs/superpowers/specs/2026-07-06-wild-media-cms-design.md) を参照。

## 全体像

環境系ライターの記事プラットフォーム。プロバイダー(環境事業者)がプラットフォーム外でライターに記事を依頼でき、依頼記事はトップページで Featured 表示される。決済機能はない。

```
                    SUPABASE(バックエンドのすべて)
              Postgres + Auth + RLS + トリガー
              (権限・ビジネスルールはすべてDB層で強制)
                              │
              Edge Functions: invite-user / r2-upload-url ──► Cloudflare R2
                              │                                  (画像)
        service role key      │      anon key + RLS
        (ビルド時のみ)         │      (ブラウザから直結)
              ┌───────────────┴───────────────┐
              ▼                               ▼
   ┌─────────────────────┐        ┌─────────────────────┐
   │ 公開サイト  src/     │        │ CMS  admin/          │
   │ Astro 完全静的       │        │ 別 Astro アプリ       │
   │ Vercel(ルートドメイン)│        │ Vercel(admin.サブ    │
   │ トップ/記事/ライター  │        │  ドメイン、オリジン分離)│
   └──────────▲──────────┘        └─────────────────────┘
              │
   記事の公開/更新/削除 ──► Supabase DB Webhook ──► Vercel Deploy Hook ──► 再ビルド
```

## コンポーネント

| 場所 | 役割 |
|---|---|
| `src/` | 公開サイト(Astro 完全静的)。ビルド時に `src/lib/content.ts` が service role key で全公開データを取得し、`renderBlocksToHtml()` でブロック本文を HTML 化して静的生成 |
| `admin/` | CMS(別 Astro アプリ)。ブラウザから Supabase JS クライアントで直結。anon key のみ保持し、service role key は絶対に持たない。本文編集は Tiptap(ProseMirror)ベースのブロックエディタ |
| `packages/blocks-renderer/` | npm workspace パッケージ(ルート `package.json` の `workspaces: ["admin", "packages/*"]`)。ブロックスキーマ定義(`extensions.ts`)と `renderBlocksToHtml()`(`render.ts`)を admin と公開サイトの両方に提供する単一の情報源 |
| `supabase/migrations/` | スキーマ・RLS・トリガー。権限とビジネスルールの実体はここ |
| `supabase/functions/` | Edge Functionsは5つ: `invite-user`(管理者専用のユーザー招待)/ `r2-upload-url`(R2署名付きURL発行)/ `r2-delete-object`(R2オブジェクト削除、呼び出し元uid配下のキー限定)/ `chunk-article`(記事保存時に本文をチャンク化しembedding生成)/ `search-articles`(ハイブリッド検索) |
| `scripts/seed.mjs` | ローカル用シード(冪等) |

## 信頼境界(最重要)

- **クライアントは信頼しない。** CMS は anon key でブラウザから直接 Supabase を叩くため、devtools から任意のクエリを送れる前提。権限は RLS、ビジネスルール(投稿頻度制限・role 自己昇格防止・publish 条件)は DB トリガーで強制する。**新しいルールを足すときは必ず DB 層に置く。**
- service role key は公開サイトのビルド時のみ使用(`src/lib/supabase-server.ts`)。ブラウザに渡るコードから import しない。
- セルフサインアップは完全無効。ユーザー作成は `invite-user` Edge Function 経由のみ(関数内でも呼び出し元 role を DB 照合)。

## 主要ルール

- 記事本文は Tiptap(ProseMirror)のブロック JSON 配列として `articles.body`(jsonb)に保存。
  HTML 化は `packages/blocks-renderer/` の `renderBlocksToHtml()`(非同期、`Promise<string>` を返す)に
  一本化されており、公開サイトのビルド時と CMS のプレビュー時の両方がこれを呼ぶ(生成 HTML が食い違わない)
- 通常記事の公開は同一著者につき `post_interval_days`(初期値10)日に1回。依頼記事(`commissioned_by` 非null)は対象外
- 依頼者コード: プロバイダー固有のランダム文字列。ライターがエディタで入力し、SECURITY DEFINER RPC で実在チェック(列挙攻撃防止のため完全一致のみ応答)
- Featured 枠 = 最新の依頼記事 `featured_count`(初期値3)件
- 本文の画像・ファイルブロックは `settings.image_base_url` 配下の URL のみ許可し、
  画像は 5 枚まで(`articles` のトリガー `a_enforce_body_image_rules`。違反時の例外は
  `IMAGE_LIMIT_EXCEEDED`・`IMAGE_HOST_NOT_ALLOWED`・`FILE_HOST_NOT_ALLOWED`)。
  埋め込みブロックの URL は許可プロバイダドメイン(YouTube/X/Vimeo)のみ許可
  (トリガー `aa_enforce_body_embed_rules`。違反時は `EMBED_HOST_NOT_ALLOWED`)。
  body は構造化 JSON のため、生の `<img>` タグや reference/shortcut 記法での
  抜け道はそもそも存在しない。
- 公開するには本文ブロックにテキストを持つノードが1つ以上必要
  (トリガー `b_enforce_publish_rules`、`enforce_publish_rules` 内の `BODY_EMPTY_ON_PUBLISH` チェック)。
- アップロード済み画像は `media` テーブルに記録される。記事から参照されている
  画像は削除できない(`a_block_media_in_use`)。R2 のオブジェクト削除は
  Edge Function `r2-delete-object` が行い、呼び出し元の uid 配下のキーに限る。
- 記事検索はハイブリッド検索(pgvector類似検索 + pgroonga全文検索をRRFでマージ)。
  記事の手動保存/公開時に `chunk-article` Edge Functionが本文を見出し単位で
  チャンク分割し、OpenAI `text-embedding-3-small` でembeddingを生成して
  `post_chunks` テーブルに保存する(20秒毎のautosaveでは呼ばない)。
  `post_chunks` はservice role専用(RLS+GRANTの両方でanon/authenticatedを拒否)。
  検索は `search-articles` Edge Function → DB関数 `search_articles_hybrid` が
  `articles.status = 'published'` をDB層で強制し、下書きは結果に混ざらない。
  記事削除時は `post_chunks.article_id` の `on delete cascade` で自動的に
  チャンクも削除される。
- `articles.region`(取材地)と `profiles.region`(ライターの活動拠点)は別物。
  どちらも同じ12区分(北海道〜沖縄・海外)の check 制約だが、意味が違う記事とライターの
  属性なので混同しないこと。`articles.region` は公開時のみ必須(下書きは null 可、
  `published_requires_region` 制約)。CMS の記事編集画面では、新規記事の取材地の初期値に
  執筆者の `profiles.region` を入れているだけで、値そのものは連動しない(後から
  ライターの拠点を変えても既存記事の取材地は変わらない)。
- 地域ページは `/areas/<slug>`(1ページ目)・`/areas/<slug>/2` 以降(2ページ目以降)。
  `<slug>` は `src/lib/regions.ts` の `regionSlug()` / `regionFromSlug()` が持つ
  日本語⇔ローマ字の対応表による(`関東` → `kanto` など)。日本語のまま URL に出すと
  `%E9%96%A2%E6%9D%B1` のようになり共有しづらいための変換。
- サイドバーの地域リンク(`Area` ナビ)は `src/lib/sidebar.ts` の `getAreaLinks(db)` が
  ビルド中に1回だけ取得し、モジュールスコープの Promise でメモ化したものを全ページが
  参照する。サイドバーは `Base.astro` 経由で**全ページ**に出るコンポーネントなので、
  素直に書くと1ページ1クエリ(記事数百枚なら数百クエリ)になる。ページ側(`props`)から
  データを渡すのではなく、`Sidebar.astro` が自分で `getAreaLinks()` を呼ぶ構成にして、
  どのページを増やしてもクエリ数が増えないようにしている。**新しいページを追加すると
  きも、地域リンクは props で引き回さずこの関数を呼ぶこと。**
- `buildAreaLinks()` は**記事0件の地域も件数0で返す**。`Area` ナビはモザイクの日本地図
  (`AreaNav.astro`)で、1地域でも欠けると地図の形として成立しないため。0件を落とす
  最適化をしないこと。押せてはいけないので、描画側が0件のタイルを淡色・リンクなしに
  している。なお `海外` は陸地ではないので地図には描かず、「すべて」と並べて地図の下に
  置く(値としては `articles.region` の check 制約に含まれ、CMS から選択できる)。
- `getStaticPaths` の中でページ(地域・ページ番号)ごとに DB クエリを投げない。
  `src/pages/[...page].astro` と `src/pages/areas/[area]/[...page].astro` はどちらも
  `getStaticPaths` の先頭で `fetchPublishedArticles()` を1回呼んで全公開記事を取り切り、
  そのあとメモリ上で地域ごとにグループ化してから `paginate()` に渡している。地域ごとに
  クエリを分けると「地域数 × ページ数」のクエリになり、記事や地域が増えるほどビルドが
  重くなる。**`getStaticPaths` 内で `.eq('region', ...)` のような絞り込みクエリを地域
  ごとに投げる書き方はしないこと。**

## テスト3層

| 層 | 実行 | 対象 |
|---|---|---|
| DB(pgTAP) | `supabase test db` | RLS・トリガー・publish ルール |
| データ層(Vitest) | `npm test` | `src/lib/` のビルド時取得ロジック |
| CMS(Vitest) | `cd admin && npm test` | `admin/src/lib/` のロジック |

## デプロイ

Vercel プロジェクト×2(公開サイト = リポジトリ直下 / CMS = `admin/`)+ ホスト版 Supabase + R2。手順は [DEPLOYMENT-CHECKLIST](docs/superpowers/DEPLOYMENT-CHECKLIST.md)。
