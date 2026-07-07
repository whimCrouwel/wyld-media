# デプロイチェックリスト(ホスト版 Supabase + Cloudflare)

計画1〜3で判明した、ローカルからホスト環境へ移す際に必ず行うこと。デプロイタスクで消化する。

## Supabase(ホストプロジェクト)
- [ ] `enable_signup = false` をダッシュボード/config push で適用(`db push` では反映されない。セルフサインアップ無効化の要)
- [ ] `site_url` と `additional_redirect_urls` を本番の admin サブドメイン(例 `https://admin.example.com` と `.../set-password`)に設定
- [ ] サーバー側のパスワード最小長を設定(現状クライアント側 8 文字のみ)
- [ ] マイグレーション適用順の確認(harden migration のタイムスタンプ 043424 が 1228xx より前 — 新規 push は問題なし。部分適用済み環境のみ注意)

## Edge Functions
- [ ] `CMS_URL` シークレットを admin サブドメインに設定(未設定だと招待リンクが localhost:4322 にフォールバックする)
- [ ] `invite-user` / `r2-upload-url` を deploy
- [ ] R2 実バケット作成 + APIトークン → `r2-upload-url` の env 設定
- [ ] R2 がサイズ/タイプ不一致の PUT を 403 で拒否することを実バケットで確認

## フロントエンド(Cloudflare Pages ×2)
- [ ] 公開サイト(リポジトリ直下)を本番 `PUBLIC_*` env でビルドしてデプロイ(ルートドメイン)
- [ ] CMS(`admin/`)を本番 `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` でビルドしてデプロイ(admin サブドメイン)。service role キーは絶対に含めない
- [ ] Supabase Database Webhook(記事の公開/更新/削除)→ 公開サイトの Cloudflare Pages Deploy Hook で自動再ビルド

## 検証
- [ ] 招待受諾(パスワード設定)フローをホストの SMTP で E2E 確認
