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

```bash
cd admin
cp .env.example .env    # supabase status の ANON_KEY のみを転記(service role は入れない)
npm install
npm test                # ロジックの単体テスト(Vitest)
npm run dev             # http://localhost:4322
```

ログインはシードユーザー(例 `hana@seed.local` / `seed-pass-1234`)。招待フローの確認には Edge Functions(`supabase functions serve`)が必要。

ログイン後、ダッシュボードの「新しい記事を作成」から記事を執筆できる(マークダウン + ライブプレビュー、下書き保存 / 公開、依頼者コード・スラッグ設定)。

## 構成

- `admin/` — CMS(別 Astro アプリ、admin. サブドメイン、ブラウザから Supabase 直結)
- `supabase/migrations/` — スキーマ・RLS・トリガー(権限とビジネスルールはすべてDB層で強制)
- `supabase/functions/` — invite-user / r2-upload-url
- `src/lib/content.ts` — ビルド時データ取得(service role)
- `src/pages/` — 公開ページ(トップ / articles / writers)
- `scripts/seed.mjs` — ローカル用シード
