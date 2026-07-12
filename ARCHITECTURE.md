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
| `supabase/functions/` | Edge Functions は2つだけ: `invite-user`(管理者専用のユーザー招待)/ `r2-upload-url`(R2 署名付きURL発行) |
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
  (`enforce_publish_rules` の `BODY_EMPTY_ON_PUBLISH` チェック)。
- アップロード済み画像は `media` テーブルに記録される。記事から参照されている
  画像は削除できない(`a_block_media_in_use`)。R2 のオブジェクト削除は
  Edge Function `r2-delete-object` が行い、呼び出し元の uid 配下のキーに限る。

## テスト3層

| 層 | 実行 | 対象 |
|---|---|---|
| DB(pgTAP) | `supabase test db` | RLS・トリガー・publish ルール |
| データ層(Vitest) | `npm test` | `src/lib/` のビルド時取得ロジック |
| CMS(Vitest) | `cd admin && npm test` | `admin/src/lib/` のロジック |

## デプロイ

Vercel プロジェクト×2(公開サイト = リポジトリ直下 / CMS = `admin/`)+ ホスト版 Supabase + R2。手順は [DEPLOYMENT-CHECKLIST](docs/superpowers/DEPLOYMENT-CHECKLIST.md)。
