# スケールアップ時にやること

サイトが伸びてきた時のアップグレード手順。

## 画像 URL をブランドドメインに切り替え

### 状況

```
    今:  https://pub-xxxxx.r2.dev/covers/img.jpg
              ↓
    後: https://media.wyld-crd.org/covers/img.jpg
```

### いつやる?

```
✅ こういう時にやりたくなる
────────────────────
・URL がダサいと感じ始めた
・アクセスが増えて r2.dev のレート制限が気になる
・SEO 的にブランドドメイン下に画像を置きたい
```

### 手順(5 分)

```
   ①              ②                 ③               ④
 CF R2 で   →  Supabase の    →   DB の既存 URL  →  Vercel
 custom       image_base_url     一括置換          rebuild
 domain 設定   更新
```

**① Cloudflare R2 で custom domain 設定**

- R2 ダッシュボード → 対象バケット → Settings
- **Custom Domains** → **Connect Domain**
- `media.wyld-crd.org` を入力(DNS が Cloudflare 管理下にある必要あり)

⚠️ **DNS 移管が必要な場合はこの前段階で:**
```
    wyld-crd.org の DNS を
    現状のプロバイダから Cloudflare に移管
              ↓
    Cloudflare にドメイン追加
              ↓
    ネームサーバ変更(現プロバイダの管理画面で)
              ↓
    48h 以内に浸透
```

**② Supabase で `image_base_url` 更新**

```sql
update settings
   set image_base_url = 'https://media.wyld-crd.org'
 where id = 1;
```

**③ 既存記事の URL を一括置換**

```sql
update articles
   set cover_image_url = replace(
         cover_image_url,
         'pub-xxxxx.r2.dev',
         'media.wyld-crd.org'
       ),
       body = replace(
         body,
         'pub-xxxxx.r2.dev',
         'media.wyld-crd.org'
       );

update media
   set url = replace(
         url,
         'pub-xxxxx.r2.dev',
         'media.wyld-crd.org'
       );
```

**④ Vercel で公開サイトを rebuild**

- Vercel Dashboard → Deployments → 最新 → Redeploy
- 数分で新 URL が反映される

### 気をつけること

```
🔴 順番を守る
────────────
① → ② → ③ → ④

② と ③ の間で画像が一時的に古い URL のまま
→ 一瞬 broken image になる可能性
→ 深夜等、アクセス少ない時間帯に実行推奨
```

```
🔴 古い URL への外部リンク
────────────────
他サイトが pub-xxxxx.r2.dev への直リンク貼ってると
そこは切れる(自サイト内は上の SQL で全部直る)
→ R2 側で 301 redirect 設定するのがベスト
   (R2 の Custom Domain 設定内で可能)
```

## その他、伸びてきたら検討すること

```
┌────────────────────────────────────────────┐
│ Vercel Pro プラン ($20/mo)                 │
│  ・帯域 1TB → 無制限                        │
│  ・ビルド並列数 UP                          │
│  → 月間 PV 数十万を超えるあたり             │
├────────────────────────────────────────────┤
│ Supabase Pro プラン ($25/mo)               │
│  ・DB 500MB → 8GB                          │
│  ・帯域 5GB → 250GB                        │
│  → コンテンツ増えた + ユーザー増えた時      │
├────────────────────────────────────────────┤
│ R2 の Custom Domain(上記手順)             │
│  ・r2.dev のレート制限が気になり始めた時     │
├────────────────────────────────────────────┤
│ 検索の Elasticsearch/Meilisearch 移行       │
│  ・現状は pgvector + tsvector で軽量        │
│  ・記事数万件を超えたら検討                  │
└────────────────────────────────────────────┘
```
