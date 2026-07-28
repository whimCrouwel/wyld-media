# ドメイン変更のやり方

Vercel の `.vercel.app` から独自ドメインへ移すとき、または別のドメインに切り替えるときの手順。

## 触る場所は 4 か所

```
┌─────────────────────────────────────┐
│  ①  Vercel                          │  ← ドメインを紐付ける
│      Domains 追加                   │
├─────────────────────────────────────┤
│  ②  Supabase Auth                   │  ← 招待メール/リダイレクトの許可URL
│      site_url + redirect_urls       │
├─────────────────────────────────────┤
│  ③  Cloudflare R2                   │  ← 画像アップロードの CORS
│      Bucket → CORS Policy           │
├─────────────────────────────────────┤
│  ④  Edge Function secret            │  ← 招待メール本文のリンク
│      CMS_URL                        │
└─────────────────────────────────────┘
```

**画像 URL 自体を変えたい場合は別作業。→ [SCALING.md](SCALING.md)**

## 前提

新しい URL を決める:

```
公開サイト:  https://<NEW_SITE>
CMS:         https://<NEW_CMS>
```

以下 `<NEW_SITE>` / `<NEW_CMS>` を実際の値に置き換えて実行。

## ① Vercel — ドメイン追加

**公開サイト (`wyld-media`)**

- Dashboard → wyld-media → Settings → Domains
- **Add** → `<NEW_SITE>` を入力(ホスト名のみ、`https://` は不要)
- DNS 設定手順が表示される → 表示された CNAME / A レコードをドメインの DNS に追加
- 反映後、Vercel 側で ✅ になる

**CMS (`wyld-media-admin`)**

- Dashboard → wyld-media-admin → Settings → Domains
- 同上で `<NEW_CMS>` を追加

Vercel は旧 `.vercel.app` も残る(削除しなくてよい)。両方でアクセス可能になる。

## ② Supabase Auth — 許可 URL 更新

Dashboard → Authentication → **URL Configuration**

- **Site URL**: `https://<NEW_CMS>` に変更(CMS のログイン後リダイレクト先)
- **Redirect URLs**(改行区切りで両方入れる):
  ```
  https://<NEW_CMS>
  https://<NEW_CMS>/set-password
  ```

**保存** をクリック。

⚠️ 旧 URL を消すのは、切り替わったのを確認してから。書きかけの招待メールに旧 URL が入ってると、リダイレクトが失敗する。

## ③ Cloudflare R2 — CORS 更新

Cloudflare Dashboard → R2 → `wild-media-covers-dev` バケット → Settings → **CORS Policy**

```json
[
  {
    "AllowedOrigins": [
      "https://<NEW_CMS>",
      "https://wyld-media-admin.vercel.app"
    ],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

**Save**。旧 URL は残しておいて OK(両方許可される)。切り替わり後に消す。

## ④ Edge Function secret — CMS_URL

ターミナル(リポジトリ直下):

```bash
supabase secrets set CMS_URL=https://<NEW_CMS>
```

反映確認:

```bash
supabase secrets list
```

これで招待メールに新 URL が入るようになる。既に送った招待は旧 URL のまま(受諾は動く)。

## 完了確認

```
✅ サイト:   https://<NEW_SITE> でアクセスできる
✅ CMS:     https://<NEW_CMS> でログインできる
✅ CMS:     画像アップロードが成功する
✅ 招待:    新しい招待メールのリンクが新 URL
```

## 現状のマップ

```
公開サイト:  zine.wyld-crd.org (旧 wyld-media.vercel.app は 308 でここへリダイレクト)
CMS:         wyld-media-admin.vercel.app
```

新しいドメインに切り替えたら、この 2 行を更新すること。

`PRODUCTION-SECRETS.local.md` の Vercel セクションも同時に書き換える。

### 公開サイトのビルド設定

- `astro.config.mjs` の `SITE` 定数(または `PUBLIC_SITE_URL` 環境変数)を新ドメインに更新
- `public/robots.txt` の `Sitemap:` 行を新ドメインに更新
