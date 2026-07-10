# Wild Media v2.0

ライターと環境のためのプラットフォーム。Astro(完全静的)+ Supabase + Cloudflare R2。

- 設計スペック: `docs/superpowers/specs/2026-07-06-wild-media-cms-design.md`
- 実装計画: `docs/superpowers/plans/`

## ローカル開発

前提: Docker Desktop / Supabase CLI / Node 20+

```bash
supabase start          # ローカル Supabase(初回は数分)
supabase db reset       # マイグレーション適用
supabase test db        # DB層テスト(pgTAP)

cp .env.example .env    # supabase status のキーを転記
                         # PUBLIC_IMAGE_BASE_URL は R2 の公開URL(Edge Function の R2_PUBLIC_BASE_URL と同じ値にする)
npm install
npm run seed            # サンプルデータ投入(冪等)
npm test                # データ層テスト(Vitest)
npm run build           # 静的ビルド
npm run preview         # http://localhost:4321
```

Edge Functions(招待・画像アップロードURL発行)の起動:

```bash
supabase functions serve --env-file supabase/functions/.env
```

## CMS(管理画面)

CMS はオリジン分離のため別 Astro アプリ(`admin/`)として動き、本番では `admin.` サブドメインに配置する。ブラウザから Supabase に直結(anon キー + RLS)し、service role キーは持たない。

記事エディタのカバー画像は「ファイル選択 → クロップ(Cropper.js)→ ブラウザ内で長辺1600px・WebP圧縮(512KB以下)→ 署名付きURLで R2 へアップロード」。ローカルでは R2 の代わりに Supabase Storage の S3 互換エンドポイントを使う(`supabase/functions/.env.example` 参照)。

```bash
cd admin
cp .env.example .env    # supabase status の ANON_KEY のみを転記(service role は入れない)
npm install
npm test                # ロジックの単体テスト(Vitest)
npm run dev             # http://localhost:4322
```

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
