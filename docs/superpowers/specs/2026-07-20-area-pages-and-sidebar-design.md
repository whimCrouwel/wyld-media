# 地域別記事ページ・サイドバー・ページネーション 設計

2026-07-20

## 目的

読者が「その土地の記事」から入れるようにする。あわせて全ページに左サイドバーを置き、
一覧の件数を運営側から調整できるようにする。

## 決定事項

### 地域は記事自身が持つ

`articles.region`(取材地)を新設する。既存の `profiles.region`(ライターの活動拠点)とは
**意味の違う別カラム**として併存させる。東京在住のライターが屋久島の記事を書いたら
「九州」に並ぶ、という読者の期待に合わせるため。

CMS の記事編集画面では、新規作成時のみ執筆者の `profiles.region` を初期値に入れる。
あくまで初期値で、保存後は独立した値として扱う。

区分は `profiles.region` と同じ12区分(北海道/東北/関東/甲信越/北陸/東海/近畿/中国/
四国/九州/沖縄/海外)。

### 公開記事は取材地が必須

下書きは region なしで保存できる。公開しようとしたときだけ必須。
既存の `published_requires_slug` と同じ形の check 制約で DB 層に強制する。

### ページネーションはトップと地域ページのみ

記事が無制限に増える器はこの2つだけ。ライター詳細は個人の執筆本数で頭打ちするので
分割しない。ライター一覧も分割せず、既存のクライアント側地域フィルタをそのまま残す
(ページ分割するとフィルタが「そのページ内の数人」しか対象にできず矛盾するため)。

1ページあたりの件数は `settings.page_size`(初期値2)。トップも地域ページも同じ値を使う。

## データモデル

マイグレーション3本。

```sql
-- 1. 記事の取材地
alter table public.articles
  add column region text
    check (region in ('北海道','東北','関東','甲信越','北陸','東海',
                      '近畿','中国','四国','九州','沖縄','海外'));

-- 2. 公開時のみ必須
alter table public.articles
  add constraint published_requires_region
    check (status = 'draft' or region is not null);

-- 3. 1ページあたりの件数
alter table public.settings
  add column page_size int not null default 2 check (page_size >= 1);
```

既存の公開記事5件には、シードで地域を入れる。

## ルーティング

Astro の `getStaticPaths` + `paginate()` を使う。1ページ目は末尾なしのURL。

| ファイル | 生成URL |
|---|---|
| `src/pages/[...page].astro` | `/`, `/2`, `/3` |
| `src/pages/areas/[area]/[...page].astro` | `/areas/kanto`, `/areas/kanto/2` |
| `src/pages/writers/index.astro` | `/writers`(分割なし・既存のまま) |
| `src/pages/writers/[slug].astro` | `/writers/tanaka-hana`(分割なし・既存のまま) |
| `src/pages/articles/[slug].astro` | 既存のまま |

地域の slug はローマ字。

| slug | 地域 | slug | 地域 |
|---|---|---|---|
| hokkaido | 北海道 | kinki | 近畿 |
| tohoku | 東北 | chugoku | 中国 |
| kanto | 関東 | shikoku | 四国 |
| koshinetsu | 甲信越 | kyushu | 九州 |
| hokuriku | 北陸 | okinawa | 沖縄 |
| tokai | 東海 | overseas | 海外 |

トップは `page.currentPage === 1` のときだけ Hero と FeaturedStrip を出す。
2ページ目以降はグリッドのみ。グリッド自体は1つのコードパスのまま。

記事が1本もない地域のページは生成しない(サイドバーにも出さない)。

### ビルドコストの約束事

`getStaticPaths` は各ファイルにつきビルド中1回しか走らない。そこで**全公開記事を1回
取得し、メモリ上で地域ごとにグループ化してから** `paginate()` に渡す。ページごとに
クエリを投げてはいけない。

記事500本時の見込みはトップ約250 + 地域合計約250 = 約500ページ。Astro の静的生成は
1ページ数ms〜十数msなので十数秒の増加。DBクエリはページ数に比例せず十数回で済む。

画像のアスペクト比プローブ(`src/lib/images.ts` の `probeAspect`)はURL単位でメモ化
済みなので、ページ数が増えても記事数に比例するだけ。

## コンポーネント構成

既存の atoms / molecules / organisms の粒度に合わせる。

### atoms

- `Chip.astro` — 小さなメタ文字のリンク/ボタン。`.meta` と同じ 11px 欧文メタ組み。
  選択中は本文色＋下線。AREAの各項目・スマホの横並びチップ・ライター一覧のフィルタが
  共通で使う。前回インラインで書いた `.region-chip` CSS はこれに吸収して消す

### molecules

- `AreaNav.astro` — 地域＋件数のリスト。`Chip` を並べるだけ。デスクトップ縦・スマホ
  横スクロールはCSSのみで両立させる(JS不要)
- `Pagination.astro` — `← 01 / 04 →`。Astro の `page` オブジェクトを受け取る。
  前/次がない端では矢印を出さない
- `SearchTrigger.astro` — 検索モーダルを開くボタン

### organisms

- `Sidebar.astro` — `SearchTrigger` + `AreaNav` を積むだけ。自分でデータを取りに行く
  (下記参照)
- `SearchModal.astro` — `<dialog>` ベースのポップアップ。ロジックは
  `src/scripts/search-modal.ts`(既存の `gallery.ts` と同じ流儀)

### layouts

`Base.astro` に全幅スロットを1つ足すだけ。レイアウトは増やさない。

```
<SiteHeader />
<slot name="full" />              ← トップはここに Hero / FeaturedStrip を入れる
<div class="grid lg:grid-cols-[16rem_1fr]">
  <Sidebar />
  <main><slot /></main>
</div>
<SearchModal />
<footer />
```

スマホ幅ではグリッドが1カラムになり、サイドバーが本文の上に積まれる。AREAはそのとき
横スクロールのチップ列になる。

### サイドバーのデータの配り方

件数付きAREAは全ページに出る。素直に書くと全ページが同じクエリを叩く(500ページ =
500クエリ)。これを避けるため `src/lib/sidebar.ts` に**ビルド中1回だけ実行してメモ化
する** `getSidebarData()` を置き、`Sidebar.astro` が自分で呼ぶ。既存の `probeAspect`
と同じ手口。

各ページがサイドバー用データを props で引き回す必要がなくなる。これが今回いちばん
スパゲッティになりやすい所なので、明示的に禁じておく。

## 検索モーダル

現ブランチで `src/components/SearchBox.astro` と `src/lib/supabase-browser.ts` が削除
されている。Edge Function(`supabase/functions/search-articles`)は残っているので、
ブラウザ用クライアントを復活させ、新デザインでモーダルとして作り直す。

- 前提: 公開サイトの `.env` に `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` が
  あること(CMS側と同じ変数名)。実装の最初に確認する。なければ `.env.example` に追記し
  ユーザーに設定を依頼する
- `service role key` は絶対に入れない(それは `supabase-server.ts` の役目)
- 入力のデバウンスと `AbortController` は削除前の実装を踏襲する
- Esc とバックドロップクリックで閉じる。開いたときに入力へフォーカス

## CMS

- 記事編集画面(`admin/src/pages/articles/edit.astro`)に「取材地」select を追加。
  新規作成時のみ執筆者の `profiles.region` を初期値に入れる
- 設定画面(`admin/src/pages/settings.astro`)に `page_size` を追加
- 公開操作時に取材地が空ならメッセージを出す。ただしこれは UX 目的で、防壁は DB の
  `published_requires_region`

## テスト

### pgTAP

- `articles.region` が12区分以外を弾く
- 下書きは region なしで保存できる
- 公開は region 必須
- `settings.page_size` が 0 以下を弾く

### Vitest(公開サイト)

- 地域slug ↔ 地域名の相互変換
- `getSidebarData()` の件数集計(記事0件の地域が落ちること)
- 地域別記事の取得

### Vitest(CMS)

- 記事ペイロードに region が入る / 不正値が落ちる
- 新規作成時の初期値がプロフィール由来になる

### ブラウザ確認

ページ送り、地域リンク、検索モーダルの開閉、スマホ幅でのチップ横スクロール。

## やらないこと

- ライター詳細・ライター一覧のページネーション
- サイドバーの最新記事リスト(一度検討したが不要と判断)
- 地域の細分化(都道府県単位)。12区分で運用してみて足りなければ考える

## 影響を受けるドキュメント

- `docs/DATABASE.md` — ER図に `articles.region` と `settings.page_size` を追加
- `ARCHITECTURE.md` — 地域ページのルーティングとサイドバーのデータ取得方針
