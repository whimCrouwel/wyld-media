# デプロイチェックリスト(ホスト版 Supabase + Vercel + R2)

計画1〜3で判明した、ローカルからホスト環境へ移す際に必ず行うこと。デプロイタスクで消化する。

**初回デプロイは一度きりの手作業。** 完了後の日常運用は自動(記事公開 → DB Webhook → 再ビルド / git push → Vercel 再デプロイ)。以降の手作業はスキーマ変更時の `supabase db push` のみ。

## 手順の骨格(コマンド)

前提: supabase.com でプロジェクト作成、Cloudflare で R2 バケット+APIトークン作成、Vercel アカウント(ブラウザ作業)。

```bash
supabase login                                   # 初回のみ(ブラウザ認証)
supabase link --project-ref <project-id>
supabase db push                                 # migrations/ を全適用
supabase secrets set CMS_URL=https://admin.example.com \
  R2_ENDPOINT=... R2_REGION=auto R2_BUCKET=... \
  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_PUBLIC_BASE_URL=...
supabase functions deploy invite-user r2-upload-url
```

残り(signup 無効化・Vercel プロジェクト×2・Webhook 配線)は各ダッシュボードで下記チェックリストの通りに。

## Supabase(ホストプロジェクト)
- [ ] `enable_signup = false` をダッシュボード/config push で適用(`db push` では反映されない。セルフサインアップ無効化の要)
- [ ] `site_url` と `additional_redirect_urls` を本番の admin サブドメイン(例 `https://admin.example.com` と `.../set-password`)に設定
- [ ] サーバー側のパスワード最小長を設定(現状クライアント側 8 文字のみ)
- [ ] マイグレーション適用順の確認(harden migration のタイムスタンプ 043424 が 1228xx より前 — 新規 push は問題なし。部分適用済み環境のみ注意)

## Edge Functions
- [ ] `CMS_URL` シークレットを admin サブドメインに設定(未設定だと招待リンクが localhost:4322 にフォールバックする)
- [ ] `invite-user` / `r2-upload-url` を deploy
- [ ] R2 実バケット作成 + APIトークン → `r2-upload-url` の env 設定(`R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`・`R2_REGION=auto`・`R2_BUCKET`・`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`・`R2_PUBLIC_BASE_URL`。旧 `R2_ACCOUNT_ID` は廃止)
- [ ] R2 バケットに CORS ポリシーを設定(admin サブドメインのオリジンから PUT / Content-Type ヘッダを許可。これが無いとブラウザからのアップロードが CORS で失敗する)
- [ ] `R2_PUBLIC_BASE_URL` は R2 のカスタムドメイン or 公開バケット URL(公開サイト・CMS の両方から画像が見えること)
- [ ] R2 がサイズ/タイプ不一致の PUT を 403 で拒否することを実バケットで確認
- [ ] DB の `settings.image_base_url` を `R2_PUBLIC_BASE_URL` と同じ値に設定する
      (`update settings set image_base_url = 'https://...' where id = 1;`)。
      未設定だと本文に画像を入れられず、値がずれると記事の保存が
      `IMAGE_HOST_NOT_ALLOWED` で落ちる。
- [ ] Edge Function `r2-delete-object` をデプロイする(`supabase functions deploy r2-delete-object`)
- [ ] 画像ホストを後から変える場合は、この値と既存のURLを同時に書き換える:
      `update articles set cover_image_url = replace(cover_image_url, '<旧>', '<新>'), body = replace(body, '<旧>', '<新>');`
      `update media set url = replace(url, '<旧>', '<新>');`

## フロントエンド(Vercel プロジェクト ×2)
- [ ] 公開サイト: Vercel プロジェクト作成(Root Directory = リポジトリ直下、Framework = Astro)。env に `PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`(ビルド時のみ使用)を設定し、ルートドメインを割り当て
- [ ] CMS: 別の Vercel プロジェクト作成(Root Directory = `admin/`)。env は `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` のみ(service role キーは絶対に含めない)。admin サブドメインを割り当て
- [ ] 公開サイト側プロジェクトで Deploy Hook を作成(Settings → Git → Deploy Hooks)
- [ ] Supabase Database Webhook(articles の INSERT/UPDATE/DELETE)→ 上記 Vercel Deploy Hook URL を POST で叩き自動再ビルド

## 検証
- [ ] 招待受諾(パスワード設定)フローをホストの SMTP で E2E 確認
