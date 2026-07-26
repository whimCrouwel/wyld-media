# Wild Media — SEO / AEO 改善アクションプラン

**監査:** [FULL-AUDIT-REPORT.md](./FULL-AUDIT-REPORT.md)(スコア 34/100)
**優先順位方針:** インパクト × 工数の逆数。AEO は「JSON-LD + llms.txt + 記事ページ自己完結性」で 90% が決まるので先に片付ける。

---

## Phase 1 — 基盤(即日〜1週間、SEO 60/100 に届く最短ルート)

### 1-1. `astro.config.mjs` に `site` と `@astrojs/sitemap` を追加(30 分)
- `npm i -D @astrojs/sitemap` 追加
- `astro.config.mjs:2` に import + integrations に `sitemap({ filter })` — drafts は既に fetch 段階で除外されるので filter は最小
- `site: 'https://<本番URL>'` を追加(現状 `wyld-media.vercel.app` → カスタムドメイン確定後に切り替え)
- `docs/DOMAIN-CHANGE.md` にドメイン変更時に `astro.config.mjs` も更新する旨を追記

### 1-2. `public/robots.txt` 新規(10 分)
```
User-agent: *
Allow: /
Sitemap: https://<本番URL>/sitemap-index.xml

# AI crawlers を明示的に許可(AEO)
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
```

### 1-3. `Base.astro` に SEO 拡張ポイントを作る(1 時間)
- `src/layouts/Base.astro:47-56` の Props を拡張: `description?`, `ogImage?`, `ogType?`, `canonicalPath?`, `noindex?`
- head 内で canonical / description / OG / Twitter Card を出力
- `<slot name="head">` を追加(per-page JSON-LD 用)

### 1-4. `SEO.astro` コンポーネント新規(既存の重複回避)
- `src/components/SEO.astro` — Base への props ラップと JSON-LD スロット注入を集約
- article / writer / provider / area の各ページで用途別に使う

### 1-5. `articles.description` カラム追加(45 分)
- `supabase/migrations/YYYYMMDD_add_article_description.sql`: `alter table articles add column description text;`
- pgTAP: 空文字と NULL 両方許容、CMS 側の書き込み権限確認
- `src/lib/content.ts:100 周辺`(`fetchArticle*` 系)で select
- **暫定策**: 列追加まで body の先頭 160 文字を抜粋する `fallbackDescription(bodyHtml)` を `src/lib/content.ts` に実装、SEO コンポーネントが `description || fallbackDescription(bodyHtml)` を使う
- `admin/` の記事編集フォームに description 入力欄追加(別 PR で可)

### 1-6. `src/pages/404.astro` 新規(30 分)
- Base レイアウトで `noindex`、Works に戻る導線、検索モーダルを開くボタン

### 1-7. `Hero.astro` の h1 見直し(15 分)
- `src/components/organisms/Hero.astro:6-11` — 日本語 topical h1(例:「環境と生き方を書く、ライターのメディア」)に差し替え、装飾英字は視覚的サブ要素として保持

**Phase 1 完了時: SEO ヘルススコア 34 → 約 60、Google 発見性が段違いに改善。**

---

## Phase 2 — JSON-LD / 構造化データ(1〜2 週目、AEO 最重要)

### 2-1. `src/components/schema/` 配下に per-type コンポーネント(2〜3 時間)
- `ArticleSchema.astro` — headline, datePublished (ISO), dateModified (ISO), author {Person: name, url}, image (カバー R2 URL), mainEntityOfPage, publisher (Organization), inLanguage: "ja"
- `PersonSchema.astro` — writer 用(name, description=bio, image=avatarUrl, url, sameAs=snsLinks[])
- `OrganizationSchema.astro` — provider 用 + サイト全体用の 2 パターン。サイト全体版は Base で常時 emit
- `BreadcrumbListSchema.astro` — path から自動生成(depth 2〜3)
- `WebSiteSchema.astro` — サイト全体、SearchAction は Phase 3 の /search 実装後に有効化

### 2-2. `<time datetime="ISO">` に統一(1 時間)
- `src/lib/content.ts:77-79` の `formatDate()` は human-formatted のみ返すが、`publishedAtISO` / `updatedAtISO` を Article 型に追加
- articles / writers / providers の一覧・詳細で表示用テキストは formatDate、要素は `<time datetime={iso}>`

### 2-3. Base に site-wide Organization + WebSite JSON-LD(20 分)
- `Base.astro` head に常時 emit(SearchAction は空でスキーマだけ)

### 2-4. 各ページで per-type schema を有効化
- articles/[slug].astro → ArticleSchema + BreadcrumbList
- writers/[slug].astro → PersonSchema + BreadcrumbList
- providers/[slug].astro → OrganizationSchema + BreadcrumbList

### 2-5. Google Rich Results Test で検証
- 各テンプレートを本番 preview URL で https://search.google.com/test/rich-results に流す
- エラーゼロを確認、`docs/seo-audit/schema-validation.md` に結果を残す

**Phase 2 完了時: AEO レディネス 40 → 80。AI 回答エンジンでの引用率が明確に上がる。**

---

## Phase 3 — AEO 特化 / 記事ページの自己完結化(2〜3 週目)

### 3-1. `public/llms.txt` 新規(30 分)
- ビルド時に `writeLlmsTxt()` を実行し `dist/llms.txt` を生成する軽い integration(`astro-integrations` or `src/integrations/llms-txt.ts` を Astro プラグインとして)
- 内容: サイト概要 + 主要カテゴリ + 全記事の canonical URL(タイトル・要約付き)
- **`public/llms-full.txt`(オプション)**: 記事本文の plain text 版を連結。R2 の帯域も食わない静的アセット

### 3-2. 記事ページに著者 bio セクション(1 時間)
- `src/pages/articles/[slug].astro:25-31` の直下に AuthorCard(avatar / name / bio / SNS リンク with `rel="me"` / 「著者の他の記事を見る」リンク)
- データは既に `fetchArticleBySlug()` 経由で取得できる — profile を join

### 3-3. 「関連記事」ブロック(2 時間)
- 同じ region + 同じ author を優先、次点で最新
- `src/lib/content.ts` に `fetchRelatedArticles(articleId, { limit: 6 })` 追加
- 記事ページ末尾に RelatedArticles.astro カード 3〜6 件

### 3-4. カバー画像 `alt` を title 由来に(15 分)
- `articles/[slug].astro:42`, `writers/[slug].astro:36`, `providers/[slug].astro:34` — 空文字を title / name ベースに
- 装飾扱いを続けたい場合は `role="presentation"` 明示

### 3-5. splash オーバーレイのクローラ対応(1 時間)
- `SplashIntro.astro:9-12` — 初期 HTML では splash を **描画しない**(空)、DOMContentLoaded で JS が挿入する方針に変更
- または `#splash { display: none } @media (script) { display: block }` 的な CSS で JS-only にする(実装は `@supports` が使えないので JS フラグクラスで toggle)
- スクリーンショット系 AI クローラで真っ白ページ扱いされるリスクを消す

### 3-6. パンくず UI(45 分)
- `src/components/organisms/Breadcrumbs.astro` — 記事: Home → Works → 記事タイトル、writer: Home → Writers → 著者名、area: Home → Works → 地域名
- Phase 2 の BreadcrumbList JSON-LD と対応

**Phase 3 完了時: AEO レディネス 80 → 92、記事 1 ページで著者性・関連・コンテキストが完結。**

---

## Phase 4 — Performance(3〜4 週目)

### 4-1. `astro:assets` 導入(半日)
- `astro.config.mjs` の `image.domains` または `image.remotePatterns` に R2 pub ドメイン許可
- `CardImage.astro`, `articles/[slug].astro`, `writers/[slug].astro`, `providers/[slug].astro` の `<img>` を `<Image>` に置換
- カバー(LCP 対象)には `loading="eager"` `fetchpriority="high"`、それ以外は `loading="lazy"`
- 期待効果: モバイル LCP が半減、Google Core Web Vitals field data のスコア底上げ

### 4-2. Display font preload(15 分)
- `Base.astro` head に `<link rel="preload" href="/fonts/yeseva-one-latin-400.woff2" as="font" type="font/woff2" crossorigin>`
- font-display: swap が既定(@fontsource 標準)を確認

### 4-3. Three.js splash の見直し(要判断)
- **選択肢 A(推奨):** 初回訪問クッキーで gating し、リピート訪問では splash / Three.js を丸ごとスキップ
- **選択肢 B:** Three.js の代わりに軽量な CSS/SVG アニメに置き換え
- **選択肢 C:** そもそも splash 廃止
- 判断は「ブランド体験としてどれくらい必要か」次第 — [docs/TODO.md](../TODO.md) にオープンで残す

### 4-4. Cloudflare Images or R2 resize worker
- R2 原寸配信をやめる。CMS 側で multi-size を事前生成する方向で [docs/SCALING.md](../SCALING.md) と統合検討

**Phase 4 完了時: モバイル LCP < 2.5s、Performance スコア 45 → 75。**

---

## Phase 5 — コンテンツモデル拡張(2 ヶ月目以降、ロードマップ)

- **タグ/カテゴリー分類**: region に加えてトピックタグを導入。既存の記事に後付けするコストが大きいので CMS 側の UX を先に固める
- **`profiles.credentials` / `profiles.expertise`**: 著者 E-E-A-T 強化。任意入力
- **`/search?q=...` の SSG or SSR ルート**: 現状 modal-only なので、静的な検索結果ページを追加できると WebSite + SearchAction スキーマが有効化できる
- **エバーグリーン vs フレッシュのホーム分離**: featured band の運用ルールを CMS 側に組み込む(admin フラグ or 手動並び替え)
- **エリアページの intro copy**: `regions` テーブル(要検討)or ハードコード辞書に導入

---

## 継続タスク(Phase 4 以降ずっと)

- **月次 Google Search Console 確認** — Coverage / Performance / Enhancements(schema) / Core Web Vitals
- **Rich Results Test の CI 化** — schema.astro を変更した PR で自動チェック
- **`llms.txt` の再生成をビルドに組み込む** — 記事追加のたびに手動更新にならないよう
- **ドメイン切り替え時のチェックリスト**(`docs/DOMAIN-CHANGE.md`)に `astro.config.mjs` の `site` と `robots.txt` の Sitemap URL を追記

---

## 見積総工数

| Phase | 工数 | インパクト |
|---|---|---|
| Phase 1(基盤) | 3〜4 時間 | ★★★★★ |
| Phase 2(JSON-LD) | 4〜5 時間 | ★★★★★ AEO |
| Phase 3(AEO 特化) | 5〜6 時間 | ★★★★ AEO |
| Phase 4(Performance) | 半日 + 判断 | ★★★ |
| Phase 5(モデル拡張) | 別途企画 | ★★ ロードマップ |

**Phase 1〜3 で丸 2 日(実装のみ)、SEO スコア 34 → 85、AEO スコア 40 → 92。まず Phase 1 から着手する価値が明確。**

---

## 次アクション

1. このプランで方向性 OK なら Phase 1 の 1-1 〜 1-7 から着手
2. どこかで壁に当たったら [docs/TODO.md](../TODO.md) に切り出して継続
3. 各 Phase 完了時にこのファイルの該当項目にチェックを入れる運用
