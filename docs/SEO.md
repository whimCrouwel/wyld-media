# SEO / AEO の仕組み

検索エンジン(Google/Bing)+ AIエンジン(ChatGPT/Perplexity/Google AI Overviews)の両方に見つけてもらうための実装。3 フェーズで入れた。

## 何が入ってるか(超要約)

```
Phase 1: 土台
  ├─ sitemap-index.xml + sitemap-0.xml (下書きは除外)
  ├─ robots.txt (/admin は Disallow)
  ├─ 各ページに canonical / description / OG / Twitter card
  ├─ h1 修正 + 404 ページ (noindex)
  └─ 記事に fallbackDescription (本文から自動生成)

Phase 2: JSON-LD (Schema.org 構造化データ)
  ├─ 全ページ: Organization + WebSite
  ├─ 記事: Article + BreadcrumbList
  ├─ ライター: Person + BreadcrumbList
  ├─ プロバイダー: Organization + BreadcrumbList
  └─ XSS 対策済み (`<` / U+2028 / U+2029 をエスケープ)

Phase 3: AEO (Answer Engine Optimization)
  ├─ パンくずリスト UI (JSON-LD と同じソース)
  ├─ 意味のある alt テキスト
  ├─ 記事末尾に著者カード(bio + SNS `rel="me"`)
  ├─ 関連記事(著者+2点 / 地域+1点 でスコアリング)
  └─ llms.txt (AI クローラー向けサイトマップ)
```

詳細:
- Phase 1 の計画 → [superpowers/plans/2026-07-26-seo-foundations.md](superpowers/plans/2026-07-26-seo-foundations.md)
- Phase 2+3 の計画 → [superpowers/plans/2026-07-26-seo-phase-2-3.md](superpowers/plans/2026-07-26-seo-phase-2-3.md)
- 初回監査レポート → [seo-audit/FULL-AUDIT-REPORT.md](seo-audit/FULL-AUDIT-REPORT.md)

## 触るコードのポイント

- `src/lib/schema.ts` — JSON-LD ビルダー(Article/Person/Organization/WebSite/BreadcrumbList)+ `buildCrumbs` 共通ソース
- `src/components/JsonLd.astro` — `encodeJsonLd()` で XSS セーフに出力
- `src/layouts/Base.astro` — 全ページ共通の Organization + WebSite JSON-LD を注入
- `src/pages/llms.txt.ts` — 公開記事一覧を Markdown で出す prerendered endpoint
- `astro.config.mjs` — `site: '<本番URL>'` が絶対 URL の元。**ドメイン変更時は必ず更新** → [DOMAIN-CHANGE.md](DOMAIN-CHANGE.md)

---

## 本番デプロイ後にやること

コードを本番に上げただけだと Google は認識しない。以下を上から順に。

### ① Google Search Console 登録

1. https://search.google.com/search-console にログイン
2. 「プロパティを追加」→「URL プレフィックス」を選択
3. 本番 URL を入力(例: `https://wildmedia.jp/`)
4. **所有権の確認** — 一番簡単なのは HTML タグ方式:
   - Search Console が発行する `<meta name="google-site-verification" content="...">` タグをコピー
   - `src/layouts/Base.astro` の `<head>` 内(`<slot name="head" />` の直前あたり)に貼る
   - Vercel にデプロイして「確認」ボタンを押す
   - 確認できたら、そのタグは残しておく(再確認に必要)

### ② サイトマップ提出

Search Console の左メニュー「サイトマップ」から:

```
サイトマップ URL:  sitemap-index.xml
```

(フルパスは `https://<本番ドメイン>/sitemap-index.xml`)

提出すると数時間〜数日で「成功しました」+ 検出 URL 数が出る。**下書きは除外されているはず**なので、公開記事数 + 固定ページ数と一致するのが正常。

サイトマップは記事を publish するたびに次回ビルドで自動更新される(Vercel が re-deploy すれば反映)。**手動で再提出は不要** — Google が定期的に取りにくる。

### ③ Rich Results Test で JSON-LD 確認

デプロイ直後に一度やっておく:

- https://search.google.com/test/rich-results
- 記事ページ URL を入れる → 「Article」「BreadcrumbList」が緑チェックで検出されればOK
- ライターページ → 「Person」「BreadcrumbList」
- プロバイダーページ → 「Organization」「BreadcrumbList」

エラーが出たら該当ページの `<script type="application/ld+json">` を見直す。

### ④ Bing Webmaster Tools(任意だがおすすめ)

Bing は ChatGPT の検索バックエンドでもあるので、AEO 的にも意味がある。

1. https://www.bing.com/webmasters にログイン
2. **Google Search Console からインポート**ボタンがあるので押す(所有権確認をショートカットできる)
3. サイトマップ提出: `sitemap-index.xml`(同上)

### ⑤ llms.txt の確認

AI クローラー(ChatGPT / Claude / Perplexity 等)が読みにくる想定の Markdown 一覧:

```
https://<本番ドメイン>/llms.txt
```

ブラウザで開いて `# Wild Media` + `## Articles` の記事リストが出れば OK。**特に提出先はない**(標準化されたレジストリはまだ無い)— 置いておくだけで良い。

### ⑥ 数日〜数週間後にチェック

Search Console の以下を見る:

- **カバレッジ**: 「有効」の URL 数がサイトマップの検出数に近づいてるか
- **拡張 → パンくずリスト / 記事**: 構造化データがエラーなく認識されてるか
- **検索パフォーマンス**: 表示回数がゼロから増えてくれば動き出してる

初回インデックスは 1〜2 週間かかるのが普通。焦らない。

---

## トラブルシューティング

| 症状 | 見るところ |
|---|---|
| サイトマップに下書きが含まれる | `src/lib/content.ts` の `fetchPublishedArticles` に `.eq('status','published').eq('moderation_hold', false)` があるか |
| JSON-LD が Rich Results Test で無効 | 該当ページで view-source → `application/ld+json` の中身を https://validator.schema.org で検証 |
| Organization/WebSite の URL が localhost や wildmedia.vercel.app のまま | `astro.config.mjs` の `site` を本番ドメインに更新して再デプロイ |
| llms.txt が 404 | Vercel のビルドログで `/llms.txt` が生成されてるか確認(`src/pages/llms.txt.ts` は prerender) |

---

## この先にやること(Phase 4 以降 — 未着手)

- **Phase 4: パフォーマンス最適化** — LCP / INP / CLS の改善、画像フォーマット最適化、フォント読み込み戦略
- **Phase 5: コンテンツモデル拡張** — FAQ Schema、HowTo Schema、Video Object 等、記事タイプ別の追加 JSON-LD

やるときは Search Console の Core Web Vitals レポートを見てから優先順位を決める。
