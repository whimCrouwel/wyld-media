# Wild Media v2.0

ライターと環境のためのプラットフォーム。Astro(完全静的)+ Supabase + Cloudflare R2。

- アーキテクチャ(全体像・信頼境界): `ARCHITECTURE.md`
- 設計スペック(意思決定の経緯): `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md`
- 実装計画: `docs/superpowers/plans/`

## ローカル開発

前提: Docker Desktop(起動しておく)/ Supabase CLI / Node 20+

このプロジェクトはローカル Supabase(Docker コンテナ群)に依存している。**公開サイトも CMS も、Supabase が起動していないと動かない。** 一度 `supabase start` したら、開発中はずっと起動したままにしておくもの(毎回の作業の最初に1回叩くコマンドであって、セットアップの手順ではない)。

### 開発を始めるたびに実行するコマンド

```bash
supabase start                  # ローカル Supabase を起動(既に起動していれば何もせず状態を表示するだけ)
npm run dev:all                 # 公開サイト(:4321)+ CMS(:4322)+ Edge Functions を1コマンドで起動
```

`npm run dev:all` は `concurrently` で3つのプロセスをまとめて起動する:

- `site`(青) 公開サイト  http://localhost:4321(ライブリロード)
- `admin`(紫) CMS         http://localhost:4322
- `fn`(緑) `supabase functions serve --env-file supabase/functions/.env`(**CMSの画像アップロードに必須**)

`Ctrl+C` で3つとも停止する。個別に動かしたいときは `npm run dev`(公開サイト)/ `npm run dev -w admin`(CMS)/ `npm run dev:fn`(Edge Functions)。

`fn`(`supabase functions serve`)は `supabase start` / `supabase stop` では起動・停止されない独立プロセス(`config.toml` の `[edge_runtime] enabled = false` はローカル起動を安定させるための意図的な設定)。CMS で画像をアップロードする(カバー画像・本文画像)なら `dev:all`(または `dev:fn`)を起動しておくこと。招待フロー確認以外は不要、という誤解をしないこと。

記事保存時の検索インデックス更新(`chunk-article`)と検索(`search-articles`)にはOpenAI APIキーが必要。`supabase/functions/.env` に `OPENAI_API_KEY=` を設定すること(`supabase/functions/.env.example` 参照)。

作業を終えるとき(任意。Docker のリソースを解放したい場合のみ):

```bash
supabase stop
```

`supabase status` で現在の起動状態とURL・キーを確認できる。

### 初回セットアップ(最初の1回だけ)

```bash
supabase start
supabase db reset       # マイグレーション適用
supabase test db        # DB層テスト(pgTAP)

cp .env.example .env    # supabase status のキーを転記
                         # PUBLIC_IMAGE_BASE_URL は R2 の公開URLベース。seed が
                         # settings.image_base_url に流し込む(それが画像公開ホストの唯一の権威)
cp supabase/functions/.env.example supabase/functions/.env   # OPENAI_API_KEY を設定
npm install
npm run dev:fn           # 別ターミナルで起動したままにする(seed が chunk-article を叩くため必須)
npm run seed             # サンプルデータ投入(冪等)。検索インデックス(post_chunks)もここで構築される
npm test                # データ層テスト(Vitest)
```

`npm run seed` は記事投入後、CMS が記事保存時に呼ぶのと同じ Edge Function `chunk-article` を叩いて検索インデックス(`post_chunks`)を構築する。そのため **Edge Functions(`npm run dev:fn` または `npm run dev:all`)が起動していないと `npm run seed` は失敗する**(エラーメッセージにその旨が出る)。`supabase/functions/.env` に `OPENAI_API_KEY` が未設定の場合も embedding 生成に失敗するので、先に設定しておくこと。

CMS 側も別途セットアップが必要(下記「CMS」参照)。

### 本番ビルドを手元で確認したいとき

`npm run dev` は開発用サーバー(変更が即反映される)。実際の静的ビルド出力を確認したいときだけ以下を使う(変更のたびに再ビルドが必要なので、通常の開発には使わない):

```bash
npm run build && npm run preview   # http://localhost:4321
```

## CMS(管理画面)

CMS はオリジン分離のため別 Astro アプリ(`admin/`)として動き、本番では `admin.` サブドメインに配置する。ブラウザから Supabase に直結(anon キー + RLS)し、service role キーは持たない。

記事エディタのカバー画像は「ファイル選択 → クロップ(Cropper.js)→ ブラウザ内で長辺1600px・WebP圧縮(512KB以下)→ 署名付きURLで R2 へアップロード」。ローカルでは R2 の代わりに Supabase Storage の S3 互換エンドポイントを使う(`supabase/functions/.env.example` 参照)。

初回セットアップ(最初の1回だけ):

```bash
cd admin
cp .env.example .env    # supabase status の ANON_KEY のみを転記(service role は入れない)
npm install
npm test                # ロジックの単体テスト(Vitest)
```

起動コマンドは上の「開発を始めるたびに実行するコマンド」を参照(`cd admin && npm run dev`)。Supabase が起動していない状態で開くと、ページ読み込み時にAPI呼び出しがすべて失敗する。

ログインはシードユーザー(例 `hana@seed.local` / `seed-pass-1234`)。招待フローの確認には Edge Functions(`supabase functions serve`)が必要。

ログイン後、ダッシュボードの「新しい記事を作成」で下書きを作成し、編集ページで執筆・公開する(マークダウン + ライブプレビュー、依頼者コード・スラッグ設定。公開は編集ページからのみ)。

管理者でログインすると、ダッシュボードに「ユーザー管理」(招待・種別変更・依頼者コードの確認)と「サイト設定」(投稿間隔・Featured 件数)が表示される。シードの管理者は `admin@seed.local` / `seed-pass-1234`。

## 構成

- `admin/` — CMS(別 Astro アプリ、admin. サブドメイン、ブラウザから Supabase 直結)
- `supabase/migrations/` — スキーマ・RLS・トリガー(権限とビジネスルールはすべてDB層で強制)
- `supabase/functions/` — invite-user / r2-upload-url
- `src/lib/content.ts` — ビルド時データ取得(service role)
- `src/pages/` — 公開ページ(トップ / articles / writers)
- `scripts/seed.mjs` — ローカル用シード

## デプロイ

初回は手作業(supabase.com / Vercel / R2 のセットアップ)。手順とコマンドは `docs/superpowers/DEPLOYMENT-CHECKLIST.md`。デプロイ後の運用は自動(記事公開 → Webhook → 再ビルド)。スキーマ変更時のみ `supabase db push` が必要。
