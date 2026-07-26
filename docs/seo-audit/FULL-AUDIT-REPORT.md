# Wild Media v2.0 — SEO / AEO 監査レポート

**監査日:** 2026-07-26
**対象:** 公開サイト (`src/pages/**`, `src/layouts/**`, `src/components/**`)。CMS(`admin/`)は対象外。
**手法:** ソースコード静的解析(ライブサイトのクロールはしていない)。
**リポジトリ:** `wild-media-v2.0` (Astro 5, static output)

改善計画は [ACTION-PLAN.md](./ACTION-PLAN.md) 参照。

---

## 総評

**SEO ヘルススコア(推定): 32 / 100**

Astro SSG のおかげで「HTML に本文が入っている」という土台は良い(AEO 上有利)。しかし SEO/AEO の基本要素がほぼ何も実装されていない:

- robots.txt / sitemap.xml / canonical / meta description / OG / Twitter Card がすべて **無し**
- JSON-LD(構造化データ)が **ゼロ** — AEO 上の最大の空白
- `astro.config.mjs` に `site` フィールド未設定 — 絶対 URL 生成やサイトマップ統合が動かない
- 画像は raw `<img>`(`astro:assets` 未使用)で responsive/webp 変換なし
- 404 ページ無し
- llms.txt 無し

一方、良い土台もある: 完全 SSG で本文が初期 HTML に入る、下書き/保留記事はビルド対象から確実に除外、SNS スクリプトや外部フォントは不要、記事本文内で h2/h3 の ID 自動付与 → passage-level 引用に有利。

---

## 発見事項 カテゴリ別

### 1. Crawlability & Indexability(スコア: 20/100)

**動いているもの**
- `<html lang="ja">` 設定済み(`src/layouts/Base.astro:48`)
- 下書き/保留記事はビルド対象外(`src/lib/content.ts:148-150` — `.eq('status','published').eq('moderation_hold', false)`)。将来 sitemap を追加してもドラフトが漏れない。

**欠けているもの**
- **robots.txt が無い。** `public/` 配下にもファイル無し、`src/pages/robots.txt.ts` も無し。
- **sitemap.xml が無い。** `@astrojs/sitemap` は `package.json:19-34` に無し。手動生成も無し。
- **canonical URL が無い。** `Base.astro:49-53` は `<meta charset>`, `<meta viewport>`, `<title>` のみ出力。
- **`<meta name="robots">` が無い。** 実質 index,follow なので即座に害は無いが、`/{page}` のページネーションが薄いページとして蓄積するリスク。
- **404 ページが無い。** `find src -iname "404*"` → 0 件。Vercel デフォルトの 404 が返る。
- **`astro.config.mjs` の `site` が未設定** — sitemap や absolute URL 生成が動かない。

**編集対象**
- `astro.config.mjs`(site 追加、@astrojs/sitemap 統合)
- `public/robots.txt`(新規)
- `src/pages/404.astro`(新規)
- `src/layouts/Base.astro`(canonical 出力)

---

### 2. Meta & On-Page(スコア: 35/100)

**動いているもの**
- 全ルートで `Base title=` によりページタイトル設定済み。パターンは `{Page} | Wild Media` で統一。
  - home: `src/pages/[...page].astro:50`
  - article: `src/pages/articles/[slug].astro:23`
  - writer detail: `src/pages/writers/[slug].astro:27`
  - provider detail: `src/pages/providers/[slug].astro:27`
  - writer index: `src/pages/writers/index.astro:16`
  - provider index: `src/pages/providers/index.astro:17`
  - area: `src/pages/areas/[area]/[...page].astro:75`

**欠けているもの**
- **`<meta name="description">` がサイト全体でゼロ。** `grep -rn "meta name=" src` は viewport のみヒット。
- **`articles` テーブルに `excerpt`/`description` カラムが無い。** `supabase/migrations/20260706030845_create_schema.sql:21-38` を確認。description のデータソースが無いので、body から抽出するか列を追加する必要あり。
- **OG タグ無し** — `og:title` / `og:description` / `og:image` / `og:url` / `og:type` / `og:site_name` すべて無し。SNS 共有時のプレビューが真っ白。
- **Twitter Card 無し** — `twitter:card` / `twitter:image` 無し。
- **`article:published_time` / `article:author` 無し** — データは `article.publishedAt` / `article.authorName`(`articles/[slug].astro:29,27`)に存在するが出力してない。
- **Head 拡張ポイントが無い** — `Base.astro` に `<slot name="head">` や props 経由の meta 拡張が無いので、per-page でメタタグを差し込めない構造。

**編集対象**
- `src/layouts/Base.astro`(head slot / description props)
- `src/components/SEO.astro`(新規)
- `supabase/migrations/*`(articles.description 列追加)
- `src/lib/content.ts`(新列を select)
- 各 page.astro(description / og image を渡す)

---

### 3. Structured Data / JSON-LD(スコア: 0/100)—— AEO 最大の空白

**動いているもの**
- 無し。`grep -rn "application/ld" src` → 0 件。

**欠けているもの**
- **JSON-LD が一切無い。** AEO(LLM 答え検索)は Article / Person / Organization / BreadcrumbList を強く評価する。この空白は他のどの改善よりも AEO インパクトが大きい。
- **`<time datetime="ISO">` 未使用。** `formatDate()`(`src/lib/content.ts:77-79`)が `2026/7/26` 形式を返すのみで、機械可読の日付が HTML に無い。
- **Person スキーマの素材は揃っている**(name, bio, sameAs=snsLinks, url=homepageUrl, image=avatarUrl → `writers/[slug].astro`)が emit してない。
- **Organization スキーマの素材も揃っている**(providers: name / description / address / sameAs / url → `providers/[slug].astro`)。
- **`WebSite` + `SearchAction` が無い**(現状 search は modal-only なので URL 化が前提)。
- **`BreadcrumbList` 用の視覚パンくずが無い** — スキーマもパンくず UI も両方無い。
- **サイト全体の `Organization` (Wild Media 自身)が未定義** — ロゴ、`sameAs` を `https://www.instagram.com/wild_card_jp`(`SiteHeader.astro:31` にリンク済み)に紐付けられていない。

**編集対象**
- `src/components/schema/*.astro`(新規、type ごと)
- `src/layouts/Base.astro`(head slot 経由で埋め込み)

---

### 4. AEO / GEO(スコア: 40/100)

**動いているもの**
- **SSG 完全レンダリング** → 記事本文は初期 HTML に入る(`packages/blocks-renderer/src/render.ts` の jsdom シム + `renderBlocksToHtml`、`articles/[slug].astro:47` で `set:html={article.bodyHtml}`)。JS を実行しない AI クローラでも本文取得可能。
- **h2/h3 に ID 自動付与**(`render.ts:65-71`)→ passage-level アンカー可能で AI 引用に有利。
- **セマンティック HTML**: 本文は `<article>` ラップ(`articles/[slug].astro:24`)、main は `<main>`(`Base.astro:78`)、nav は `<nav>`(`SiteHeader.astro:20`)。
- **サニタイズ許可リスト**(`render.ts:82-89`)で script 汚染無し。

**欠けているもの**
- **`llms.txt` / `llms-full.txt` が無い。** OpenAI / Anthropic / Perplexity のクローラが明示的に消費するファイル。低コスト・高リターン。
- **splash オーバーレイ問題**(`src/components/organisms/SplashIntro.astro:9-12` — `position: fixed; z-index: 60; background: var(--color-bg)` で全画面)。JS を実行しないクローラは DOM 上は背後の記事グリッドを読めるが、スクリーンショットベースの AI ツール(Perplexity プレビュー等)は真っ白ページとして認識する可能性。`#splash` を消すのは JS と `noscript` と `prefers-reduced-motion` のみ。
- **記事ページの著者 E-E-A-T シグナルが薄い。** 記事ページ(`articles/[slug].astro:25-31`)は著者名のリンクだけ。bio / credentials / SNS リンクは `/writers/{slug}` に 1 クリック先。LLM が記事ページを要約するとき著者情報を拾えない。
- **カバー画像の `alt=""`**(`articles/[slug].astro:42`)— 装飾扱いなのでスクリーンリーダーも AI も画像の内容を得られない。writers/providers のカバーも同様(`writers/[slug].astro:36`, `providers/[slug].astro:34`)。
- **記事ページに関連記事が無い** — Session depth が浅い + 内部 PageRank 配分が弱い。
- **FAQ / HowTo / 定義パッセージのテンプレートフックが無い** — 本文は TipTap 完全お任せ。
- **homepage h1 が「Writings for your well beings」(`Hero.astro:6-11`)** — 装飾的で「Wild Media は何のサイトか」という AI クローラの問いに答えない。日本語の topical h1 に変えるべき。
- **`rel="author"` / `rel="me"` が無い**(writer の SNS リンクに)— 著者性シグナルが弱い。

**編集対象**
- `public/llms.txt`(新規)
- `src/pages/articles/[slug].astro`(著者 bio セクション + 関連記事 + ISO time + カバー alt)
- `src/components/organisms/SplashIntro.astro`(クローラで隠す方針変更)
- `src/components/organisms/Hero.astro`(h1 の見直し)

---

### 5. Performance(コードベースからの推定、スコア: 45/100)

**動いているもの**
- カード画像に `loading="lazy" decoding="async"`(`CardImage.astro:14-15`)
- `aspect-ratio` を build 時に `probe-image-size` で取得しカードに設定(`src/lib/images.ts:42-51`, `CardImage.astro:10`)— カード領域は CLS-safe
- サードパーティ analytics/tracker 未使用(`grep -rn "gtag\|GA_\|GTM\|plausible" src` → 0)— ブロッキングやプライバシーオーバーヘッド無し
- フォントは `@fontsource` セルフホスト(`package.json:20-24`)

**欠けているもの**
- **`astro:assets` の `<Image>` を全く使ってない。** すべて raw `<img>`(`CardImage.astro:12`, `articles/[slug].astro:42`, `writers/[slug].astro:33,56`, `providers/[slug].astro:33,56,146`)。結果:
  - WebP / AVIF 自動変換なし
  - responsive `srcset` / `sizes` なし → モバイルにもデスクトップにもフルサイズを配信
  - remote R2 画像の width/height 属性が HTML に出ない
- **記事ページのカバー画像に width/height / aspect-ratio 無し**(`articles/[slug].astro:42`)— R2 画像ロード時 CLS リスク
- **フォント読み込み**: `src/styles/global.css:2-6` に `@import` が 5 個。preload / preconnect 無し(セルフホスト前提)。表示フォント Yeseva One の preload を Base.astro head に入れると LCP 改善余地あり
- **Three.js を splash で全 homepage に読み込む**(`package.json:33` — `three: ^0.185.1`、`src/scripts/splash.ts` 経由で `SplashIntro.astro:48-50` から)— 初回訪問の LCP/INP を重くする
- **Lenis smooth scroll** も全ページ実行(`src/scripts/lenis-instance.ts`)— 追加 JS ワーク
- **R2 カバー画像は原寸ダイレクト配信**(`src/lib/content.ts:100` で `row.cover_image_url` そのまま)— R2 は自動変換無し。Cloudflare Images / resize worker を挟むか、CMS 側で複数サイズを事前生成する必要
- **LCP 対策の `<link rel="preload" as="image" fetchpriority="high">` 無し**(hero/cover)

**編集対象**
- `src/components/atoms/CardImage.astro`
- `src/pages/articles/[slug].astro`(LCP に効く)
- `astro.config.mjs`(`image.domains` or `image.remotePatterns` で R2 許可し `astro:assets` 使用)
- `src/styles/global.css` + `Base.astro`(display font preload)
- `SplashIntro.astro`(Three.js を初回訪問クッキーで gating か、削除検討)

---

### 6. Internal linking & site structure(スコア: 50/100)

**動いているもの**
- 記事 → 著者リンクあり(`articles/[slug].astro:26` — `/writers/${authorSlug}`)
- 著者ページに全記事一覧(`writers/[slug].astro:150-185`)— ハブ構造として良い
- グローバルナビ Works / Writers / Projects が全ページ(`SiteHeader.astro:20-39`)
- NavDrawer が area フィルタを全ページで露出(`NavDrawer.astro`)
- Area ページで region フィルタ済みリスト(`areas/[area]/[...page].astro`)

**欠けているもの**
- **視覚パンくず無し + BreadcrumbList JSON-LD 無し**
- **記事詳細から area への back-link 無し** — `← Works`(`articles/[slug].astro:50`)のみ。関東の記事から `/areas/kanto` に戻れない
- **関連記事 / more by this writer が記事ページに無い**
- **タグ/カテゴリー分類が無い** — 分類軸は region 単一のみ
- **検索結果 URL が存在しない** — 検索は modal-only(`SearchModal.astro`)なので `/search?q=...` にリンクできない
- **ホームがフレッシュ vs エバーグリーンで分離してない** — 単純リバースクロノ + 1 ページ目 featured band(`[...page].astro:21`)。エバーグリーンが埋もれる
- **Area 一覧ページに region 紹介文が無い**(`areas/[area]/[...page].astro:78` は SectionHeader ラベルのみ)— 薄いページ扱いのリスク

**編集対象**
- `src/pages/articles/[slug].astro`(関連記事 + area back-link + author card)
- `src/components/organisms/Breadcrumbs.astro`(新規)
- `src/pages/areas/[area]/[...page].astro`(intro copy 追加 — DB 列が必要かも)

---

### 7. Content model(スコア: 55/100)

**URL 構造**
- Articles: `/articles/{slug}` — clean, 日付/カテゴリー prefix 無し。slug は DB kebab-case 制約(`supabase/migrations/20260706030845_create_schema.sql:24`)
- Writers: `/writers/{slug}`
- Providers: `/providers/{slug}` — `certified=true` のみビルド(`src/lib/content.ts:267`)
- Areas: `/areas/{area-slug}` および `/areas/{area-slug}/{page}`
- Home paging: `/`, `/2`, `/3`, …

**動いているもの**
- Slug 制約で URL 安全性担保
- Draft/hold は fetch 段階で除外(`content.ts:148-150,174-175`)
- Provider は certified のみ — 薄い/スパムページ回避
- `getStaticPaths()` で全パス列挙 — 全ページクロール可能

**欠けているもの**
- **`articles.description` / `excerpt` カラムが無い**(§2 参照)
- **`published_at` は timestamptz だが HTML に ISO 出力してない**(§3 参照)
- **`updated_at` は DB トリガーで自動更新される**(`20260706030845_create_schema.sql:33,40-42`)が HTML に出てない → `dateModified` が現状出せない
- **タグ/カテゴリー分類無し** — region 単一のみ
- **`profiles` に `credentials` / `expertise` / `education` が無い** — E-E-A-T-rich な著者ページ用列が不足

**編集対象**
- `supabase/migrations/*`(articles.description、必要ならタグ、profiles.credentials)
- `src/lib/content.ts`
- `admin/*`(CMS 側の入力欄追加、本監査範囲外)

---

## スコア集計

| カテゴリ | 重み | スコア | 加重 |
|---|---|---|---|
| Technical SEO(crawl/index) | 22% | 20 | 4.4 |
| Content Quality | 23% | 55 | 12.7 |
| On-Page SEO(meta) | 20% | 35 | 7.0 |
| Schema / Structured Data | 10% | 0 | 0.0 |
| Performance(CWV 推定) | 10% | 45 | 4.5 |
| AI Search Readiness(AEO) | 10% | 40 | 4.0 |
| Images | 5% | 30 | 1.5 |
| **合計** | 100% | | **34.1 / 100** |

改善の優先順位と工数見積は [ACTION-PLAN.md](./ACTION-PLAN.md) 参照。
