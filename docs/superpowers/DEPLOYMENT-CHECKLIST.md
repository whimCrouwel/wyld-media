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
  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
  # 画像の公開URLベースは DB の settings.image_base_url が唯一の権威
  # (r2-upload-url / r2-delete-object が読む)。R2_PUBLIC_BASE_URL シークレットは廃止。
supabase functions deploy invite-user r2-upload-url
```

残り(signup 無効化・Vercel プロジェクト×2・Webhook 配線)は各ダッシュボードで下記チェックリストの通りに。

## Supabase(ホストプロジェクト)
- [ ] `enable_signup = false` をダッシュボード/config push で適用(`db push` では反映されない。セルフサインアップ無効化の要)
- [ ] `site_url` と `additional_redirect_urls` を本番の admin サブドメイン(例 `https://admin.example.com` と `.../set-password`)に設定
- [ ] サーバー側のパスワード最小長を設定(現状クライアント側 8 文字のみ)
- [ ] マイグレーション適用順の確認(harden migration のタイムスタンプ 043424 が 1228xx より前 — 新規 push は問題なし。部分適用済み環境のみ注意)
- [ ] `20260720160000_article_region_and_page_size.sql` は既存の公開記事を全て取材地「関東」で埋めてから制約を追加する。`db push` 後、CMS で公開済み記事の取材地を実際の取材地に直すこと

## Edge Functions
- [ ] `CMS_URL` シークレットを admin サブドメインに設定(未設定だと招待リンクが localhost:4322 にフォールバックする)
- [ ] `invite-user` / `r2-upload-url` を deploy
- [ ] R2 実バケット作成 + APIトークン → `r2-upload-url` の env 設定(`R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`・`R2_REGION=auto`・`R2_BUCKET`・`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`。旧 `R2_ACCOUNT_ID`・`R2_PUBLIC_BASE_URL` は廃止)
- [ ] R2 バケットに CORS ポリシーを設定(admin サブドメインのオリジンから PUT / Content-Type ヘッダを許可。これが無いとブラウザからのアップロードが CORS で失敗する)
- [ ] R2 がサイズ/タイプ不一致の PUT を 403 で拒否することを実バケットで確認
- [ ] DB の `settings.image_base_url` に R2 の公開URLベース(カスタムドメイン or 公開バケット URL)を設定する
      (`update settings set image_base_url = 'https://...' where id = 1;`)。
      **これが画像公開ホストの唯一の権威**:`r2-upload-url` はこの値で publicUrl を組み立て、
      `r2-delete-object` と保存トリガーはこの値で検証する。だから「アップロードは成功するのに
      保存が `IMAGE_HOST_NOT_ALLOWED` で落ちる」ズレは起きない。未設定(空)だと fail closed で
      画像アップロード自体が 500、本文にも画像を入れられない。公開サイト・CMS の両方からこの
      URL 配下の画像が見えることを確認。
- [ ] Edge Function `r2-delete-object` をデプロイする(`supabase functions deploy r2-delete-object`)
- [ ] 画像ホストを後から変える場合は、この値と既存のURLを同時に書き換える:
      `update articles set cover_image_url = replace(cover_image_url, '<旧>', '<新>'), body = replace(body, '<旧>', '<新>');`
      `update media set url = replace(url, '<旧>', '<新>');`
- [ ] Edge Function `cleanup-orphaned-media` をデプロイする(`supabase functions deploy cleanup-orphaned-media`)。
      env は `r2-delete-object` と共通(R2_* が既に設定済みなら追加不要)
- [ ] 未使用メディア週次掃除の Vault シークレットを設定する(SQL Editor で):
      `select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');`
      `select vault.create_secret('<service_role_key>', 'service_role_key');`
      未設定の間、pg_cron ジョブ(毎週月曜 9:00 JST)は NOTICE を出して静かにスキップする(エラーにはならない)。
      設定後 `select public.invoke_cleanup_orphaned_media();` を1回実行し、Edge Functions のログで
      `cleanup-orphaned-media: deleted N media rows` が出ること・`select * from cron.job;` にジョブが居ることを確認

## フロントエンド(Vercel プロジェクト ×2)
- [ ] 公開サイト: Vercel プロジェクト作成(Root Directory = リポジトリ直下、Framework = Astro)。env に `PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`(ビルド時のみ使用)/ `PUBLIC_SUPABASE_ANON_KEY` を設定し、ルートドメインを割り当て
      (`PUBLIC_SUPABASE_ANON_KEY` は検索モーダルがブラウザから直接 Supabase を叩くために必要。Astro はビルド時に値を埋め込むため、未設定だと本番ビルドの全ページで検索が例外を起こす。service role キーは CMS プロジェクトには絶対に含めない)
- [ ] CMS: 別の Vercel プロジェクト作成(Root Directory = `admin/`)。env は `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` のみ(service role キーは絶対に含めない)。admin サブドメインを割り当て
- [ ] 公開サイト側プロジェクトで Deploy Hook を作成(Settings → Git → Deploy Hooks)
- [ ] Supabase Database Webhook(articles の INSERT/UPDATE/DELETE)→ 上記 Vercel Deploy Hook URL を POST で叩き自動再ビルド。
      ただしダッシュボードの Webhook UI では発火条件を絞れないため、SQL Editor で条件付きトリガー3本として作成する
      (`rebuild_on_article_publish_insert` = `new.status = 'published'` / `_update` = `old.status = 'published' or new.status = 'published'` / `_delete` = `old.status = 'published'`、
      いずれも `supabase_functions.http_request(<Deploy Hook URL>, 'POST', '{"Content-type":"application/json"}', '{}', '5000')` を実行)。
      下書きの保存では再ビルドさせない(公開・公開中記事の変更・非公開化・公開記事の削除のみ発火)。
      なお profiles / settings の変更では再ビルドは走らない — プロフィール等だけ変えた場合は次の記事保存まで反映されない(必要なら Vercel で手動 Redeploy)

## 検証
- [ ] 招待受諾(パスワード設定)フローをホストの SMTP で E2E 確認
