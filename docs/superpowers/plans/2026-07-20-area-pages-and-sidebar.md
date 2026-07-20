# 地域別記事ページ・サイドバー・ページネーション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事に取材地を持たせ、地域別の記事一覧ページ・全ページ共通の左サイドバー・トップと地域ページのページネーションを追加する。

**Architecture:** `articles.region`(取材地)を新設し、Astro の `getStaticPaths` + `paginate()` で静的にページを生成する。サイドバーは `Base.astro` に組み込み、データはビルド中1回だけ取得してメモ化する(`getAreaLinks()`)。UIは既存の atoms/molecules/organisms の粒度に合わせて分解する。

**Tech Stack:** Astro 5(静的ビルド)、Supabase(Postgres + RLS + pgTAP)、Tailwind CSS v4、Vitest、TypeScript

設計の根拠: [docs/superpowers/specs/2026-07-20-area-pages-and-sidebar-design.md](../specs/2026-07-20-area-pages-and-sidebar-design.md)

## Global Constraints

- 権限・ビジネスルールは **DB層(RLS・トリガー・check制約)で強制**する。クライアント側のチェックはUX目的のみ
- `service role key` を `admin/` と公開サイトのブラウザ用コードに**絶対に入れない**。公開サイトのビルド時(`src/lib/supabase-server.ts`)専用
- 地域は12区分固定: `北海道 東北 関東 甲信越 北陸 東海 近畿 中国 四国 九州 沖縄 海外`
- 地域slugはローマ字: `hokkaido tohoku kanto koshinetsu hokuriku tokai kinki chugoku shikoku kyushu okinawa overseas`
- **`getStaticPaths` の中でページごとにDBクエリを投げない。** 全記事を1回取得してからメモリ上でグループ化し `paginate()` に渡す
- **サイドバー用データを props で各ページに引き回さない。** `Sidebar.astro` が `getAreaLinks()` を自分で呼ぶ
- 1ページあたりの件数は `settings.page_size`。コードにハードコードしない
- 既存の日本語コメントの density と語り口に合わせる。コメントは「なぜ」を書く
- テストコマンド: `supabase test db`(pgTAP、**`supabase db reset` 直後のクリーンなDBで実行**)、`npm test`(公開サイト、シード済みDBが必要)、`npm test -w admin`(CMS)
- **この作業ツリーは他のセッションと共有している可能性がある。`git add -A` / `git add .` / `git commit -a` を使わず、自分が触ったファイルだけを名指しでコミットする**(`git commit -m "..." -- path1 path2`)

---

### Task 1: DB に取材地とページ件数を追加する

**Files:**
- Create: `supabase/migrations/20260720160000_article_region_and_page_size.sql`
- Modify: `supabase/tests/database/01_schema.test.sql:3`(plan数), `:8`付近(has_column), 末尾付近(制約テスト)
- Modify: `scripts/seed.mjs:113`付近(記事に region を入れる)
- Modify: `docs/DATABASE.md`(ER図)

**Interfaces:**
- Consumes: なし(最初のタスク)
- Produces: `articles.region text`(12区分のcheck制約付き、null許容)、`published_requires_region` 制約、`settings.page_size int not null default 2 check (page_size >= 1)`

- [ ] **Step 1: 失敗する pgTAP テストを書く**

`supabase/tests/database/01_schema.test.sql` の3行目を `select plan(20);` に変更する(15 → 20)。

`select has_column('public', 'profiles', 'region', 'profiles has region');` の直後に追加:

```sql
select has_column('public', 'articles', 'region', 'articles has region');
select has_column('public', 'settings', 'page_size', 'settings has page_size');

select throws_ok(
  $$update settings set page_size = 0 where id = 1$$,
  '23514', null, 'page_size must be at least 1'
);
```

ファイル末尾の `select lives_ok(...'draft without slug is allowed');` の直後に追加:

```sql
select throws_ok(
  $$insert into articles (author_id, slug, title, region)
    values ('00000000-0000-0000-0000-00000000000a', 'bad-region', 't', '中部')$$,
  '23514', null, 'article region must be one of the 12 areas'
);

-- 下書きは取材地なしで保存できる。公開だけが必須。
select throws_ok(
  $$insert into articles (author_id, status, published_at, slug, title, body)
    values ('00000000-0000-0000-0000-00000000000a', 'published', now(), 'no-region', 't',
      '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb)$$,
  '23514', null, 'published article requires region'
);
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `supabase test db`
Expected: FAIL。`01_schema.test.sql` が `column "region" does not exist` 系で落ちる

- [ ] **Step 3: マイグレーションを書く**

`supabase/migrations/20260720160000_article_region_and_page_size.sql`:

```sql
-- 記事の取材地。profiles.region(ライターの活動拠点)とは意味の違う別カラムで、
-- 東京在住のライターが屋久島の記事を書いたら「九州」に並ぶ、という読者の期待に合わせる。
-- 一覧の絞り込みに使う値なので、妥当性は check 制約で DB 層に強制する。
alter table public.articles
  add column region text
    check (region in (
      '北海道', '東北', '関東', '甲信越', '北陸', '東海',
      '近畿', '中国', '四国', '九州', '沖縄', '海外'
    ));

-- 下書きは取材地なしで保存できるが、公開するときだけ必須。
-- 既存の published_requires_slug と同じ形。
alter table public.articles
  add constraint published_requires_region
    check (status = 'draft' or region is not null);

-- 一覧ページ1枚あたりの記事数。公開サイトは静的ビルドなので、変更の反映には再ビルドが要る
-- (featured_count と同じ条件)。
alter table public.settings
  add column page_size int not null default 2 check (page_size >= 1);

comment on column public.articles.region is '取材地(12区分)。公開時は必須。';
comment on column public.settings.page_size is '一覧ページ1枚あたりの記事数。';
```

- [ ] **Step 4: 既存テストの published 挿入に取材地を足す**

新しい制約により、**既存の pgTAP テストで公開記事を insert/update している箇所が全て落ちる**。以下を修正する(`region` を追加、値は何でもよいので `'関東'` で統一する)。

| ファイル | 行 |
|---|---|
| `supabase/tests/database/02_rls.test.sql` | 20 |
| `supabase/tests/database/05_publish_rules.test.sql` | 22, 33, 52, 59, 65, 76, 92 |
| `supabase/tests/database/06_publish_hardening.test.sql` | 25, 44, 88, 124 |
| `supabase/tests/database/09_body_blocks_rules.test.sql` | 39, 46 |
| `supabase/tests/database/11_search_articles_hybrid.test.sql` | 38, 49, 58 |

insert の場合は列リストと values の両方に足す:

```sql
-- 修正前
insert into articles (author_id, slug, title, status, published_at)
  values (..., 'pub-a', 'first post', 'published', now());
-- 修正後
insert into articles (author_id, slug, title, status, published_at, region)
  values (..., 'pub-a', 'first post', 'published', now(), '関東');
```

`update articles set status = 'published'` の場合は set 句に足す:

```sql
-- 修正前
update articles set status = 'published', slug = 'pub-e' where ...
-- 修正後
update articles set status = 'published', slug = 'pub-e', region = '関東' where ...
```

ただし `09_body_blocks_rules.test.sql:39` の「空の本文で公開できない」テストのように **公開が失敗することを期待している** テストは、region を足しても期待するエラーコードが変わらないことを確認する(どちらも `23514` なので通る)。もし失敗理由が region に化けて意図が薄れるなら、そのテストにも region を足して本来の失敗理由に戻す。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `supabase db reset && supabase test db`
Expected: `All tests successful.` / `Files=11, Tests=111` (106 + 5)

- [ ] **Step 6: シードに取材地を入れる**

`scripts/seed.mjs` の `ARTICLES` 配列の各要素に `region` を足し、insert 時に渡す。5本の公開記事に地域が散るようにする(`関東` 2本、`甲信越` 2本、`九州` 1本など、地域ページとページネーションの両方を手で確認できる配分にする)。下書き1本は region なしのままにして、下書きが取材地なしで保存できることを実地で確認する。

`scripts/seed.mjs:113` 付近の insert オブジェクトに `region: a.region ?? null,` を追加する。

- [ ] **Step 7: シードを流して確認する**

Run: `node scripts/seed.mjs && docker exec supabase_db_wild-media-v2-0 psql -U postgres -c "select region, count(*) from articles where status='published' group by region order by count desc;"`
Expected: 地域が2〜3種類に分かれて合計5件

- [ ] **Step 8: ER図を更新する**

`docs/DATABASE.md` の `articles` に `text region "取材地(12区分、公開時必須)"`、`settings` に `int page_size "一覧1ページあたりの記事数"` を追加する。

- [ ] **Step 9: コミット**

```bash
git add supabase/migrations/20260720160000_article_region_and_page_size.sql \
        supabase/tests/database/ scripts/seed.mjs docs/DATABASE.md
git commit -m "feat(db): 記事の取材地とページ件数の設定を追加"
```

---

### Task 2: 地域slugの対応表

**Files:**
- Modify: `src/lib/regions.ts`
- Test: `tests/regions.test.ts`

**Interfaces:**
- Consumes: `REGIONS`, `Region`, `usedRegions()`(既存)
- Produces:
  - `regionSlug(region: Region): string`
  - `regionFromSlug(slug: string): Region | null`
  - `REGION_SLUGS: Record<Region, string>`

- [ ] **Step 1: 失敗するテストを書く**

`tests/regions.test.ts` の末尾に追加:

```ts
import { regionSlug, regionFromSlug, REGIONS } from '../src/lib/regions';

describe('地域slug', () => {
  it('地域名からslugを引ける', () => {
    expect(regionSlug('甲信越')).toBe('koshinetsu');
    expect(regionSlug('海外')).toBe('overseas');
  });

  it('slugから地域名に戻せる', () => {
    expect(regionFromSlug('kanto')).toBe('関東');
    expect(regionFromSlug('okinawa')).toBe('沖縄');
  });

  it('未知のslugは null', () => {
    expect(regionFromSlug('atlantis')).toBeNull();
    expect(regionFromSlug('')).toBeNull();
  });

  it('12区分すべてに重複のないslugがある', () => {
    const slugs = REGIONS.map(regionSlug);
    expect(slugs).toHaveLength(12);
    expect(new Set(slugs).size).toBe(12);
    for (const s of slugs) expect(s).toMatch(/^[a-z]+$/);
  });

  it('往復して元に戻る', () => {
    for (const r of REGIONS) expect(regionFromSlug(regionSlug(r))).toBe(r);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- tests/regions.test.ts`
Expected: FAIL `regionSlug is not a function`

- [ ] **Step 3: 実装する**

`src/lib/regions.ts` に追加:

```ts
// URL用のローマ字slug。日本語のままだと %E9%96%A2%E6%9D%B1 になって共有しづらいため。
export const REGION_SLUGS: Record<Region, string> = {
  北海道: 'hokkaido',
  東北: 'tohoku',
  関東: 'kanto',
  甲信越: 'koshinetsu',
  北陸: 'hokuriku',
  東海: 'tokai',
  近畿: 'kinki',
  中国: 'chugoku',
  四国: 'shikoku',
  九州: 'kyushu',
  沖縄: 'okinawa',
  海外: 'overseas',
};

export function regionSlug(region: Region): string {
  return REGION_SLUGS[region];
}

export function regionFromSlug(slug: string): Region | null {
  return REGIONS.find((r) => REGION_SLUGS[r] === slug) ?? null;
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- tests/regions.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/regions.ts tests/regions.test.ts
git commit -m "feat(site): 地域のローマ字slug対応表"
```

---

### Task 3: データ取得層(記事の取材地 + サイドバー用データ)

**Files:**
- Modify: `src/lib/content.ts`(`ArticleSummary` に region、`ARTICLE_SELECT`、`toSummary`、`fetchPageSize` 追加)
- Create: `src/lib/sidebar.ts`
- Test: `tests/content.test.ts`, `tests/sidebar.test.ts`(新規)

**Interfaces:**
- Consumes: `regionSlug()`, `usedRegions()`(Task 2)
- Produces:
  - `ArticleSummary.region: string | null`
  - `fetchPageSize(db: SupabaseClient): Promise<number>`
  - `src/lib/sidebar.ts`: `interface AreaLink { region: string; slug: string; href: string; count: number }`
  - `src/lib/sidebar.ts`: `getAreaLinks(db: SupabaseClient): Promise<AreaLink[]>`
  - `src/lib/sidebar.ts`: `buildAreaLinks(regions: (string | null)[]): AreaLink[]`(純粋関数、テスト用)

- [ ] **Step 1: 失敗するテストを書く**

`tests/sidebar.test.ts`(新規):

```ts
import { describe, it, expect } from 'vitest';
import { buildAreaLinks } from '../src/lib/sidebar';

describe('buildAreaLinks', () => {
  it('地域ごとに件数を数え、北から南の順で返す', () => {
    const links = buildAreaLinks(['関東', '北海道', '関東', '甲信越']);
    expect(links).toEqual([
      { region: '北海道', slug: 'hokkaido', href: '/areas/hokkaido', count: 1 },
      { region: '関東', slug: 'kanto', href: '/areas/kanto', count: 2 },
      { region: '甲信越', slug: 'koshinetsu', href: '/areas/koshinetsu', count: 1 },
    ]);
  });

  it('記事のない地域は落とす', () => {
    const links = buildAreaLinks(['沖縄']);
    expect(links.map((l) => l.slug)).toEqual(['okinawa']);
  });

  it('region が null の記事は数えない', () => {
    expect(buildAreaLinks([null, null])).toEqual([]);
  });
});
```

`tests/content.test.ts` の既存の writer detail テストの近くに追加:

```ts
it('公開記事は取材地を持つ', async () => {
  const { featured, normal } = await fetchPublishedArticles(db);
  const all = [...featured, ...normal];
  expect(all.length).toBeGreaterThan(0);
  for (const a of all) {
    expect(typeof a.region).toBe('string');
    expect(a.region).not.toBe('');
  }
});

it('fetchPageSize は 1 以上の整数を返す', async () => {
  const size = await fetchPageSize(db);
  expect(Number.isInteger(size)).toBe(true);
  expect(size).toBeGreaterThanOrEqual(1);
});
```

`tests/content.test.ts` の import に `fetchPageSize` を足す。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL。`Cannot find module '../src/lib/sidebar'` と `fetchPageSize is not a function`

- [ ] **Step 3: content.ts に取材地とページ件数を足す**

`src/lib/content.ts`:

1. `ArticleSummary` に `region: string | null;` を追加(`commissionedByName` の下)
2. `ARTICLE_SELECT` の先頭の列並びに `region` を追加:

```ts
const ARTICLE_SELECT =
  'id, slug, title, cover_image_url, published_at, commissioned_by, region, ' +
  'author:profiles!articles_author_id_fkey(name, slug), ' +
  'commissioned:profiles!articles_commissioned_by_fkey(name)';
```

3. `toSummary` の返り値に `region: row.region ?? null,` を追加
4. `fetchImageBaseUrl` の下に追加:

```ts
// 一覧1ページあたりの記事数。運営が CMS から変えられる(反映は再ビルド時)。
export async function fetchPageSize(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('settings')
    .select('page_size')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { page_size: number }).page_size;
}
```

- [ ] **Step 4: sidebar.ts を実装する**

`src/lib/sidebar.ts`(新規):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { usedRegions, regionSlug, type Region } from './regions';

export interface AreaLink {
  region: string;
  slug: string;
  href: string;
  count: number;
}

// 記事の取材地の配列から、記事のある地域だけを北→南の順で組み立てる
export function buildAreaLinks(regions: (string | null)[]): AreaLink[] {
  const counts = new Map<string, number>();
  for (const r of regions) {
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return usedRegions(regions).map((region) => ({
    region,
    slug: regionSlug(region as Region),
    href: `/areas/${regionSlug(region as Region)}`,
    count: counts.get(region) ?? 0,
  }));
}

async function loadAreaLinks(db: SupabaseClient): Promise<AreaLink[]> {
  const { data, error } = await db
    .from('articles')
    .select('region')
    .eq('status', 'published');
  // 地域ナビは全ページの骨格なので、取れないならビルドを落とす。
  // probeAspect と違ってフォールバックしないのは、地域ナビのないページを
  // 黙って何百枚も出力するほうが悪いから。
  if (error) throw error;
  return buildAreaLinks((data ?? []).map((r: { region: string | null }) => r.region));
}

// サイドバーは全ページに出るので、素直に書くと1ページ1クエリ(数百回)になる。
// モジュールは1ビルドにつき1回しか評価されないので、最初の Promise を使い回せば
// 全ページ合わせて1クエリで済む。
let areaLinks: Promise<AreaLink[]> | undefined;

export function getAreaLinks(db: SupabaseClient): Promise<AreaLink[]> {
  return (areaLinks ??= loadAreaLinks(db));
}
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS(全ファイル)

- [ ] **Step 6: コミット**

```bash
git add src/lib/content.ts src/lib/sidebar.ts tests/
git commit -m "feat(site): 記事の取材地とサイドバー用データの取得"
```

---

### Task 4: atoms/Chip と molecules/AreaNav・Pagination

**Files:**
- Create: `src/components/atoms/Chip.astro`
- Create: `src/components/molecules/AreaNav.astro`
- Create: `src/components/molecules/Pagination.astro`
- Modify: `src/pages/writers/index.astro`(インラインCSSを Chip に置き換える)

**Interfaces:**
- Consumes: `AreaLink`(Task 3)
- Produces:
  - `Chip.astro` props: `{ href?: string; active?: boolean; class?: string; [key: string]: unknown }` — `href` があれば `<a>`、なければ `<button type="button">`。残りの属性はそのまま要素に渡す
  - `AreaNav.astro` props: `{ areas: AreaLink[]; activeSlug?: string }`
  - `Pagination.astro` props: `{ page: Page }`(`import type { Page } from 'astro'`)

- [ ] **Step 1: Chip を作る**

`src/components/atoms/Chip.astro`:

```astro
---
interface Props {
  href?: string;
  active?: boolean;
  class?: string;
  [key: string]: unknown;
}
const { href, active = false, class: className = '', ...rest } = Astro.props;
const cls = ['chip', active ? 'is-active' : '', className].filter(Boolean).join(' ');
---
{
  href ? (
    <a href={href} class={cls} {...rest}><slot /></a>
  ) : (
    <button type="button" class={cls} {...rest}><slot /></button>
  )
}

<style>
  /* .meta と同じ小さな欧文メタ組み。選択中だけ本文色 + 下線 */
  .chip {
    font-family: var(--font-accent);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--color-meta);
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.2s ease;
  }

  .chip:hover {
    color: var(--color-ink);
  }

  .chip.is-active {
    color: var(--color-ink);
    text-decoration: underline;
    text-underline-offset: 5px;
  }
</style>
```

- [ ] **Step 2: AreaNav を作る**

`src/components/molecules/AreaNav.astro`:

```astro
---
import Chip from '../atoms/Chip.astro';
import type { AreaLink } from '../../lib/sidebar';

interface Props {
  areas: AreaLink[];
  activeSlug?: string;
}
const { areas, activeSlug } = Astro.props;
---
<nav aria-label="地域から探す" class="area-nav">
  {
    areas.map((a) => (
      <Chip href={a.href} active={a.slug === activeSlug} class="area-item">
        <span>{a.region}</span>
        <span class="tabular-nums">{String(a.count).padStart(2, '0')}</span>
      </Chip>
    ))
  }
</nav>

<style>
  /* デスクトップは縦積み、スマホは横スクロールの1列。JSなしで両立させる */
  .area-nav {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .area-nav::-webkit-scrollbar {
    display: none;
  }

  .area-nav :global(.area-item) {
    display: flex;
    gap: 0.75rem;
  }

  @media (min-width: 1024px) {
    .area-nav {
      flex-direction: column;
      gap: 0.6rem;
      overflow-x: visible;
    }

    /* 縦のときだけ地域名と件数を両端に寄せる */
    .area-nav :global(.area-item) {
      justify-content: space-between;
    }
  }
</style>
```

- [ ] **Step 3: Pagination を作る**

`src/components/molecules/Pagination.astro`:

```astro
---
import type { Page } from 'astro';
import MetaLabel from '../atoms/MetaLabel.astro';

interface Props {
  page: Page;
}
const { page } = Astro.props;
const pad = (n: number) => String(n).padStart(2, '0');
---
{
  page.lastPage > 1 && (
    <nav aria-label="ページ送り" class="flex items-center justify-center gap-8 py-16">
      {page.url.prev ? (
        <a href={page.url.prev} aria-label="前のページ"><MetaLabel>←</MetaLabel></a>
      ) : (
        <span aria-hidden="true" class="opacity-25"><MetaLabel>←</MetaLabel></span>
      )}

      <MetaLabel class="tabular-nums">{pad(page.currentPage)} / {pad(page.lastPage)}</MetaLabel>

      {page.url.next ? (
        <a href={page.url.next} aria-label="次のページ"><MetaLabel>→</MetaLabel></a>
      ) : (
        <span aria-hidden="true" class="opacity-25"><MetaLabel>→</MetaLabel></span>
      )}
    </nav>
  )
}
```

- [ ] **Step 4: ライター一覧のインラインCSSを Chip に置き換える**

`src/pages/writers/index.astro`:

1. `import Chip from '../../components/atoms/Chip.astro';` を追加
2. フィルタのボタンを Chip に置き換える:

```astro
<nav id="region-filter" class="-mt-8 flex flex-wrap gap-x-6 gap-y-2 pb-10">
  <Chip class="region-chip" active data-region="" aria-pressed="true">すべて</Chip>
  {regions.map((r) => (
    <Chip class="region-chip" data-region={r} aria-pressed="false">{r}</Chip>
  ))}
</nav>
```

3. ページ末尾の `<style>` ブロックを**丸ごと削除**する(`.region-chip` の定義は Chip に移った)

`src/scripts/writer-filter.ts` は `button[data-region]` と `.is-active` を触っているだけなので変更不要。Chip は `href` なしのとき `<button type="button">` を出し、`is-active` クラスを使うため、そのまま動く。

- [ ] **Step 5: ビルドしてライター一覧が壊れていないことを確認する**

Run: `npm run build && grep -c 'class="chip' dist/writers/index.html`
Expected: ビルド成功。`chip` クラスのついた要素が3つ以上(すべて + 地域ぶん)

- [ ] **Step 6: ブラウザで絞り込みが動くことを確認する**

Run: `npm run preview` を起動し、`http://localhost:4321/writers` で地域チップをクリックする
Expected: 件数表示が変わり、選択中のチップに下線がつく(Task 4 以前と同じ挙動)

- [ ] **Step 7: コミット**

```bash
git add src/components/atoms/Chip.astro src/components/molecules/AreaNav.astro \
        src/components/molecules/Pagination.astro src/pages/writers/index.astro
git commit -m "feat(site): Chip / AreaNav / Pagination コンポーネント"
```

---

### Task 5: サイドバーをレイアウトに組み込む

**Files:**
- Create: `src/components/organisms/Sidebar.astro`
- Modify: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`(Hero を全幅スロットへ移す)

**Interfaces:**
- Consumes: `getAreaLinks()`(Task 3)、`AreaNav`(Task 4)
- Produces:
  - `Sidebar.astro` props: `{ activeAreaSlug?: string }`
  - `Base.astro` に名前付きスロット `full`(サイドバーの外側・全幅で描画される)

このタスクの時点では検索トリガーはまだ置かない(Task 8 で足す)。

- [ ] **Step 1: Sidebar を作る**

`src/components/organisms/Sidebar.astro`:

```astro
---
import AreaNav from '../molecules/AreaNav.astro';
import MetaLabel from '../atoms/MetaLabel.astro';
import { supabaseServer } from '../../lib/supabase-server';
import { getAreaLinks } from '../../lib/sidebar';

interface Props {
  activeAreaSlug?: string;
}
const { activeAreaSlug } = Astro.props;

// ページ側から props で渡さない。ビルド中1回だけ実行されてメモ化される。
const areas = await getAreaLinks(supabaseServer);
---
<aside class="px-6 pb-10 lg:pb-24">
  <div class="border-card border-t pt-3">
    <MetaLabel class="text-ink">Area</MetaLabel>
  </div>
  <div class="mt-4">
    <AreaNav areas={areas} activeSlug={activeAreaSlug} />
  </div>
</aside>
```

- [ ] **Step 2: Base.astro に全幅スロットと2カラムを足す**

`src/layouts/Base.astro` の `<body>` の中を差し替える:

```astro
  <body>
    <SiteHeader />
    <!-- サイドバーの外側に出したいもの(トップの Hero など)。無いページでは何も出ない -->
    <slot name="full" />
    <div class="lg:grid lg:grid-cols-[16rem_1fr] lg:items-start">
      <Sidebar activeAreaSlug={activeAreaSlug} />
      <main class="min-w-0"><slot /></main>
    </div>
    <footer class="px-6 pb-10">
      <MetaLabel>Wild Media — ライターと環境のためのプラットフォーム</MetaLabel>
    </footer>
  </body>
```

frontmatter を差し替える:

```astro
---
import '../styles/global.css';
import SiteHeader from '../components/organisms/SiteHeader.astro';
import Sidebar from '../components/organisms/Sidebar.astro';
import MetaLabel from '../components/atoms/MetaLabel.astro';

interface Props {
  title: string;
  activeAreaSlug?: string;
}
const { title, activeAreaSlug } = Astro.props;
---
```

`min-w-0` は、マソンリーグリッドがサイドバーぶんの幅を無視して溢れるのを防ぐために必要。

- [ ] **Step 3: トップの Hero を全幅スロットへ移す**

`src/pages/index.astro` の `<Base>` の中身を差し替える:

```astro
<Base title="Wild Media">
  <Fragment slot="full">
    <BgContours />
    <SplashIntro />
    <Hero />
    <FeaturedStrip works={featuredWorks} />
  </Fragment>
  <section>
    <div class="border-card mx-6 flex items-baseline justify-between border-t pt-3 pb-6">
      <MetaLabel class="text-ink">Works</MetaLabel>
      <MetaLabel class="tabular-nums">{String(gridWorks.length).padStart(2, '0')}</MetaLabel>
    </div>
    <MasonryGrid works={gridWorks} />
  </section>
</Base>
```

- [ ] **Step 4: ビルドして全ページが通ることを確認する**

Run: `npm run build`
Expected: ビルド成功、9ページ

- [ ] **Step 5: ブラウザでレイアウトを確認する**

Run: `npm run preview` を起動し、以下を見る
- `http://localhost:4321/` — Hero が全幅、その下が2カラム、左に Area リストと件数
- `http://localhost:4321/writers` — 2カラム、左に Area
- `http://localhost:4321/articles/<seedのslug>` — 2カラム、本文が読める幅を保っている

Expected: どのページでも Area リストが出て、件数の合計が公開記事数と一致する。横スクロールバーが出ていないこと。

- [ ] **Step 6: スマホ幅を確認する**

ブラウザの幅を 390px 相当にして `/` を見る
Expected: サイドバーが本文の上に積まれ、地域が横1列で横スクロールできる

- [ ] **Step 7: コミット**

```bash
git add src/components/organisms/Sidebar.astro src/layouts/Base.astro src/pages/index.astro
git commit -m "feat(site): 全ページ共通の左サイドバー"
```

---

### Task 6: トップのページネーション

**Files:**
- Create: `src/pages/[...page].astro`(`src/pages/index.astro` を改名・改造)
- Delete: `src/pages/index.astro`

**Interfaces:**
- Consumes: `fetchPageSize()`(Task 3)、`Pagination`(Task 4)、`Base` の `full` スロット(Task 5)
- Produces: `/`, `/2`, `/3` …

- [ ] **Step 1: index.astro を [...page].astro に作り替える**

```bash
git mv src/pages/index.astro src/pages/\[...page\].astro
```

frontmatter を差し替える(`toWork` の中身は既存のまま):

```astro
---
import type { GetStaticPaths, Page } from 'astro';
import Base from '../layouts/Base.astro';
import BgContours from '../components/organisms/BgContours.astro';
import SplashIntro from '../components/organisms/SplashIntro.astro';
import Hero from '../components/organisms/Hero.astro';
import FeaturedStrip from '../components/organisms/FeaturedStrip.astro';
import MasonryGrid from '../components/organisms/MasonryGrid.astro';
import Pagination from '../components/molecules/Pagination.astro';
import MetaLabel from '../components/atoms/MetaLabel.astro';
import { supabaseServer } from '../lib/supabase-server';
import { fetchPublishedArticles, fetchPageSize, formatDate } from '../lib/content';
import { probeAspect, placeholderImage } from '../lib/images';
import type { ArticleSummary } from '../lib/content';
import type { GalleryWork } from '../lib/images';

// getStaticPaths はビルド中1回だけ走る。ここで全記事を取り切り、
// ページごとにDBへ問い合わせないようにする。
export const getStaticPaths = (async ({ paginate }) => {
  const { featured, normal } = await fetchPublishedArticles(supabaseServer);
  const pageSize = await fetchPageSize(supabaseServer);
  // Featured は1ページ目のヒーロー帯にだけ出すので、グリッドは normal だけを分割する
  return paginate(normal, { pageSize, props: { featured, total: featured.length + normal.length } });
}) satisfies GetStaticPaths;

interface Props {
  page: Page<ArticleSummary>;
  featured: ArticleSummary[];
  total: number;
}
const { page, featured, total } = Astro.props;
const isFirstPage = page.currentPage === 1;

// カタログ番号は新しいものほど大きい(全作品通し番号)
async function toWork(article: ArticleSummary, indexInAll: number): Promise<GalleryWork> {
  const image = article.coverImageUrl
    ? { url: article.coverImageUrl, ratio: await probeAspect(article.coverImageUrl) }
    : placeholderImage(article.slug, indexInAll); // 仮画像(本番画像が入り次第外す)
  return {
    href: `/articles/${article.slug}`,
    title: article.title,
    date: formatDate(article.publishedAt),
    imageUrl: image.url,
    ratio: image.ratio,
    number: total - indexInAll,
    authorName: article.authorName,
    authorHref: `/writers/${article.authorSlug}`,
  };
}

const featuredWorks = isFirstPage
  ? await Promise.all(featured.map((a, i) => toWork(a, i)))
  : [];
// 通し番号が全ページで連続するよう、このページの先頭が全体の何番目かを足す
const offset = featured.length + (page.currentPage - 1) * page.size;
const gridWorks = await Promise.all(page.data.map((a, i) => toWork(a, offset + i)));
---
```

body を差し替える:

```astro
<Base title={isFirstPage ? 'Wild Media' : `Wild Media — ${page.currentPage}ページ目`}>
  {
    isFirstPage && (
      <Fragment slot="full">
        <BgContours />
        <SplashIntro />
        <Hero />
        <FeaturedStrip works={featuredWorks} />
      </Fragment>
    )
  }
  <section>
    <div class="border-card mx-6 flex items-baseline justify-between border-t pt-3 pb-6">
      <MetaLabel class="text-ink">Works</MetaLabel>
      <MetaLabel class="tabular-nums">{String(page.total).padStart(2, '0')}</MetaLabel>
    </div>
    <MasonryGrid works={gridWorks} />
    <Pagination page={page} />
  </section>
</Base>
```

- [ ] **Step 2: ビルドしてページが分かれることを確認する**

Run: `npm run build && ls dist && ls dist/2`
Expected: `dist/index.html` と `dist/2/index.html` が存在する(シード5件・page_size=2 なら normal 記事数ぶんのページができる)

- [ ] **Step 3: 既存ページが巻き添えになっていないことを確認する**

Run: `ls dist/writers/index.html dist/articles`
Expected: どちらも存在する。ルート直下の `[...page]` は Astro のルート優先順位で最後に評価されるため、`/writers` などは従来通り解決される

- [ ] **Step 4: ブラウザでページ送りを確認する**

`npm run preview` で `/` を開く
Expected: 1ページ目に Hero と Featured があり、下に `01 / 0N` のページ送り。`→` を押すと `/2` に移動し、Hero が消えてグリッドだけになる。`←` で戻れる

- [ ] **Step 5: コミット**

この作業ツリーは他のセッションと共有している可能性がある。**`git add -A` や `git commit -a` を使わず、必ず触ったファイルだけを名指しでコミットする。**

```bash
git add 'src/pages/[...page].astro' src/pages/index.astro
git commit -m "feat(site): トップのページネーション" -- 'src/pages/[...page].astro' src/pages/index.astro
```

---

### Task 7: 地域別記事ページ

**Files:**
- Create: `src/pages/areas/[area]/[...page].astro`

**Interfaces:**
- Consumes: `regionFromSlug()`, `regionSlug()`(Task 2)、`fetchPageSize()`(Task 3)、`Pagination`(Task 4)、`Base` の `activeAreaSlug`(Task 5)
- Produces: `/areas/<slug>`, `/areas/<slug>/2` …

- [ ] **Step 1: 地域ページを作る**

`src/pages/areas/[area]/[...page].astro`:

```astro
---
import type { GetStaticPaths, Page } from 'astro';
import Base from '../../../layouts/Base.astro';
import MasonryGrid from '../../../components/organisms/MasonryGrid.astro';
import Pagination from '../../../components/molecules/Pagination.astro';
import MetaLabel from '../../../components/atoms/MetaLabel.astro';
import { supabaseServer } from '../../../lib/supabase-server';
import { fetchPublishedArticles, fetchPageSize, formatDate } from '../../../lib/content';
import { probeAspect, placeholderImage } from '../../../lib/images';
import { regionSlug, type Region } from '../../../lib/regions';
import type { ArticleSummary } from '../../../lib/content';
import type { GalleryWork } from '../../../lib/images';

// 全記事を1回だけ取り、メモリ上で地域ごとに分けてから paginate に渡す。
// 地域ごとにクエリを投げると地域数 × ページ数のクエリになる。
export const getStaticPaths = (async ({ paginate }) => {
  const { featured, normal } = await fetchPublishedArticles(supabaseServer);
  const pageSize = await fetchPageSize(supabaseServer);
  const all = [...featured, ...normal];

  const byRegion = new Map<string, ArticleSummary[]>();
  for (const article of all) {
    if (!article.region) continue;
    const list = byRegion.get(article.region) ?? [];
    list.push(article);
    byRegion.set(article.region, list);
  }

  return [...byRegion.entries()].flatMap(([region, articles]) =>
    paginate(articles, {
      pageSize,
      params: { area: regionSlug(region as Region) },
      props: { region },
    }),
  );
}) satisfies GetStaticPaths;

interface Props {
  page: Page<ArticleSummary>;
  region: string;
}
const { page, region } = Astro.props;
const area = Astro.params.area as string;

async function toWork(article: ArticleSummary, i: number): Promise<GalleryWork> {
  const image = article.coverImageUrl
    ? { url: article.coverImageUrl, ratio: await probeAspect(article.coverImageUrl) }
    : placeholderImage(article.slug, i);
  return {
    href: `/articles/${article.slug}`,
    title: article.title,
    date: formatDate(article.publishedAt),
    imageUrl: image.url,
    ratio: image.ratio,
    number: page.total - ((page.currentPage - 1) * page.size + i),
    authorName: article.authorName,
    authorHref: `/writers/${article.authorSlug}`,
  };
}

const works = await Promise.all(page.data.map((a, i) => toWork(a, i)));
---
<Base title={`${region}の記事 | Wild Media`} activeAreaSlug={area}>
  <section class="pt-32">
    <div class="border-card mx-6 flex items-baseline justify-between border-t pt-3 pb-6">
      <MetaLabel class="text-ink">{region}</MetaLabel>
      <MetaLabel class="tabular-nums">{String(page.total).padStart(2, '0')}</MetaLabel>
    </div>
    <MasonryGrid works={works} />
    <Pagination page={page} />
  </section>
</Base>
```

`pt-32` はヘッダーぶんの余白。既存の `src/pages/writers/index.astro` が `pt-32` を使っているのに合わせる。

- [ ] **Step 2: ビルドして地域ページができることを確認する**

Run: `npm run build && ls dist/areas`
Expected: シードで使った地域のディレクトリだけができている(記事のない地域は生成されない)

- [ ] **Step 3: ページ分割を確認する**

Run: `ls dist/areas/kanto`(シードで関東に3本以上入れた場合)
Expected: `index.html` と `2/index.html`

- [ ] **Step 4: ブラウザで確認する**

`npm run preview` で `/` を開き、サイドバーの地域をクリックする
Expected: その地域の記事だけが並ぶ。サイドバーで今いる地域に下線がつく。ページ送りが動く

- [ ] **Step 5: コミット**

```bash
git add src/pages/areas
git commit -m "feat(site): 地域別記事ページ"
```

---

### Task 8: 検索モーダル

**Files:**
- Create: `src/lib/supabase-browser.ts`(削除されていたものを復活)
- Create: `src/components/molecules/SearchTrigger.astro`
- Create: `src/components/organisms/SearchModal.astro`
- Create: `src/scripts/search-modal.ts`
- Modify: `src/components/organisms/Sidebar.astro`(トリガーを載せる)
- Modify: `src/layouts/Base.astro`(モーダル本体を置く)
- Modify: `.env.example`(不足していれば)

**Interfaces:**
- Consumes: なし
- Produces: `supabaseBrowser`(anon key のみのブラウザ用クライアント)

- [ ] **Step 1: 環境変数を確認する**

Run: `grep -c PUBLIC_SUPABASE_ANON_KEY .env .env.example`
Expected: 両方 1 以上。**0 の場合は先に進まず**、`.env.example` に以下を追記したうえでユーザーに `.env` への設定を依頼する:

```
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=<supabase status で表示される anon key>
```

- [ ] **Step 2: ブラウザ用クライアントを復活させる**

`src/lib/supabase-browser.ts`(削除前と同じ内容):

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

// ブラウザ専用クライアント(検索モーダル用)。anon keyのみ。
// service role keyはここに絶対に入れないこと(それは supabase-server.ts の役目)。
export const supabaseBrowser = createClient(url, anonKey, {
  auth: { persistSession: false },
});
```

- [ ] **Step 3: トリガーを作る**

`src/components/molecules/SearchTrigger.astro`:

```astro
---
import MetaLabel from '../atoms/MetaLabel.astro';
---
<button type="button" id="search-open" class="search-trigger">
  <MetaLabel>記事を検索</MetaLabel>
</button>

<style>
  .search-trigger {
    width: 100%;
    border: 1px solid var(--color-card);
    border-radius: 999px;
    padding: 0.6rem 1rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s ease;
  }

  .search-trigger:hover {
    border-color: var(--color-meta);
  }
</style>
```

- [ ] **Step 4: モーダルを作る**

`src/components/organisms/SearchModal.astro`:

```astro
---
import MetaLabel from '../atoms/MetaLabel.astro';
---
<dialog id="search-modal" class="search-modal" aria-label="記事を検索">
  <form method="dialog" class="mb-6 flex justify-end">
    <button type="submit" aria-label="閉じる"><MetaLabel>Close ×</MetaLabel></button>
  </form>
  <input
    type="search"
    id="search-input"
    placeholder="記事を検索"
    aria-label="記事を検索"
    class="search-input"
  />
  <p id="search-status" role="status" class="mt-4"><MetaLabel /></p>
  <ul id="search-results" class="mt-6" hidden></ul>
</dialog>

<script>
  import '../../scripts/search-modal';
</script>

<style>
  .search-modal {
    width: min(40rem, calc(100vw - 3rem));
    margin: auto;
    padding: 1.5rem;
    border: none;
    border-radius: 20px;
    background-color: var(--color-bg);
    color: var(--color-ink);
  }

  .search-modal::backdrop {
    background-color: rgba(53, 48, 31, 0.4);
  }

  .search-input {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--color-card);
    background: transparent;
    padding: 0.5rem 0;
    font-family: var(--font-heading);
    font-size: 22px;
    outline: none;
  }

  .search-modal :global(li) {
    border-top: 1px solid var(--color-card);
    padding: 1rem 0;
  }
</style>
```

- [ ] **Step 5: モーダルのロジックを書く**

`src/scripts/search-modal.ts`:

```ts
// 検索モーダル。開閉と、ハイブリッド検索 Edge Function の呼び出し。
import { supabaseBrowser } from '../lib/supabase-browser';

const modal = document.getElementById('search-modal') as HTMLDialogElement | null;
const openBtn = document.getElementById('search-open');
const input = document.getElementById('search-input') as HTMLInputElement | null;
const resultsEl = document.getElementById('search-results') as HTMLUListElement | null;
const statusEl = document.getElementById('search-status');

interface SearchResult {
  slug: string;
  title: string;
  excerptHtml: string;
  score: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

if (modal && openBtn && input && resultsEl && statusEl) {
  openBtn.addEventListener('click', () => {
    modal.showModal();
    input.focus();
  });

  // バックドロップのクリックで閉じる(dialog 自身の領域外を押したとき)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  function render(results: SearchResult[]) {
    if (results.length === 0) {
      resultsEl!.hidden = true;
      statusEl!.textContent = '見つかりませんでした。';
      return;
    }
    resultsEl!.innerHTML = results
      .map(
        (r) => `
      <li>
        <a href="/articles/${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>
        <p>${r.excerptHtml}</p>
      </li>`,
      )
      .join('');
    resultsEl!.hidden = false;
    statusEl!.textContent = '';
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    abortController?.abort();

    if (!q) {
      resultsEl.hidden = true;
      statusEl.textContent = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      abortController = new AbortController();
      statusEl.textContent = '検索中…';
      try {
        const { data, error } = await supabaseBrowser.functions.invoke('search-articles', {
          body: { query: q },
          signal: abortController.signal,
        });
        if (error) throw error;
        render((data?.results ?? []) as SearchResult[]);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        statusEl.textContent = '検索に失敗しました。';
        console.error(err);
      }
    }, 250);
  });
}
```

**注意:** Edge Function のリクエスト/レスポンス形式は `supabase/functions/search-articles/index.ts` を読んで合わせること。上のコードは削除前の `SearchBox.astro`(`git show HEAD~N:src/components/SearchBox.astro` で読める)を踏襲しているが、実際の関数の入出力が違うなら関数側に合わせる。

- [ ] **Step 6: サイドバーとレイアウトに載せる**

`src/components/organisms/Sidebar.astro` の `<aside>` の先頭(Area 見出しの前)に追加:

```astro
import SearchTrigger from '../molecules/SearchTrigger.astro';
```
```astro
  <div class="pb-10">
    <SearchTrigger />
  </div>
```

`src/layouts/Base.astro` の `</div>`(2カラム)の直後、`<footer>` の前に追加:

```astro
    <SearchModal />
```

frontmatter に `import SearchModal from '../components/organisms/SearchModal.astro';` を追加。

- [ ] **Step 7: Edge Functions を起動してビルドする**

Run: `npm run dev:all` を別ターミナルで起動しておく(Edge Function は `supabase start` では配信されない)。別途 `npm run build`
Expected: ビルド成功

- [ ] **Step 8: ブラウザで検索を確認する**

`npm run dev` で `/` を開き、「記事を検索」を押す
Expected: モーダルが開いて入力にフォーカスが当たる。シード記事のタイトルの一部を打つと結果が出る。Esc・× ボタン・背景クリックで閉じる

- [ ] **Step 9: コミット**

```bash
git add src/lib/supabase-browser.ts src/components/molecules/SearchTrigger.astro \
        src/components/organisms/SearchModal.astro src/scripts/search-modal.ts \
        src/components/organisms/Sidebar.astro src/layouts/Base.astro .env.example
git commit -m "feat(site): 検索モーダル"
```

---

### Task 9: CMS で記事の取材地を編集できるようにする

**Files:**
- Modify: `admin/src/lib/articles.ts`(`ArticleInput`/`ArticlePayload`/`EditableArticle`/`buildArticlePayload`/`fetchArticleForEdit`)
- Modify: `admin/src/lib/editor-helpers.ts`(エラーメッセージ)
- Modify: `admin/src/pages/articles/new.astro`(初期値)
- Modify: `admin/src/pages/articles/edit.astro`(select)
- Test: `admin/tests/articles.test.ts`, `admin/tests/editor-helpers.test.ts`

**Interfaces:**
- Consumes: `isRegion()`, `REGIONS`(既存 `admin/src/lib/regions.ts`)
- Produces: `ArticleInput.region: string`、`ArticlePayload.region: string | null`、`EditableArticle.region: string | null`

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/articles.test.ts` の `buildArticlePayload` の describe に追加:

```ts
it('取材地を payload に入れる', () => {
  const p = buildArticlePayload({
    title: 't', slug: 's', body: [], coverUrl: '', commissionCode: '', region: '甲信越',
  });
  expect(p.region).toBe('甲信越');
});

it('リスト外の取材地は null にする(最終判断はDBのcheck制約)', () => {
  const p = buildArticlePayload({
    title: 't', slug: 's', body: [], coverUrl: '', commissionCode: '', region: '中部',
  });
  expect(p.region).toBeNull();
});

it('未選択は null', () => {
  const p = buildArticlePayload({
    title: 't', slug: 's', body: [], coverUrl: '', commissionCode: '', region: '',
  });
  expect(p.region).toBeNull();
});
```

既存の `buildArticlePayload` 呼び出しが型エラーになるので、全て `region: '関東'` などを足す。

`admin/tests/editor-helpers.test.ts` に追加:

```ts
it('取材地なしの公開を日本語で説明する', () => {
  expect(translateSaveError({ code: '23514', message: 'published_requires_region' }))
    .toBe('公開するには取材地を選んでください。');
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -w admin`
Expected: FAIL(`region` プロパティが型に無い / メッセージが違う)

- [ ] **Step 3: articles.ts に region を通す**

`admin/src/lib/articles.ts`:

1. 先頭に `import { isRegion } from './regions';`
2. `ArticleInput` に `region: string;`
3. `ArticlePayload` に `region: string | null;`
4. `EditableArticle` に `region: string | null;`
5. `buildArticlePayload` に追加:

```ts
    // 想定外の値は送らず null にする(最終的な拒否は DB の check 制約)
    region: isRegion(input.region.trim()) ? input.region.trim() : null,
```
6. `fetchArticleForEdit` の select に `region` を足し、返り値に `region: data.region,` を足す

- [ ] **Step 4: エラーメッセージを足す**

`admin/src/lib/editor-helpers.ts` の `translateSaveError` に、`23505` の分岐より前に追加:

```ts
  if (msg.includes('published_requires_region')) {
    return '公開するには取材地を選んでください。';
  }
```

- [ ] **Step 5: 記事編集画面に select を足す**

`admin/src/pages/articles/edit.astro`:

1. frontmatter に `import { REGIONS } from '../../lib/regions';`
2. `<Field id="slug" ... />` の下に追加:

```astro
        <Field id="region" label="取材地(公開時は必須)" as="select">
          <option value="">未選択</option>
          {REGIONS.map((r) => <option value={r}>{r}</option>)}
        </Field>
```
3. `const $ = (elId: string) => ... as HTMLInputElement & HTMLTextAreaElement;` を
   `as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;` に変更
4. `$('slug').value = article.slug ?? '';` の下に `$('region').value = article.region ?? '';`
5. `collect()` に `region: $('region').value,` を追加
6. `save()` の公開時チェック(スラッグの検証の直後)に追加:

```ts
            if (publish && !input.region) {
              messageEl.textContent = '公開には取材地が必要です'; return;
            }
```

- [ ] **Step 6: 新規作成時の初期値を執筆者の拠点にする**

`admin/src/pages/articles/new.astro:247` の `const id = await createDraft(supabaseBrowser, input);` より前で、自分のプロフィールの `region` を取り、`createDraft` に渡す input に入れる。取得はフォーム送信のたびに走らせず、スクリプト冒頭の認証チェック直後に1回だけ行う:

```ts
        // 取材地の初期値は執筆者の活動拠点。あくまで初期値で、記事ごとに変更できる。
        const { data: me } = await supabaseBrowser
          .from('profiles')
          .select('region')
          .eq('id', session.user.id)
          .single();
        const defaultRegion = me?.region ?? '';
```

`createDraft` に渡す input に `region: defaultRegion` を含める。新規作成フォームに取材地の入力欄がない場合は、下書き作成後に編集画面へ遷移してそこで選ばせる方針でよい(下書きは取材地なしで保存できる)。

- [ ] **Step 7: テストを実行して通ることを確認する**

Run: `npm test -w admin`
Expected: PASS(全ファイル)

- [ ] **Step 8: CMS を起動して手で確認する**

`npm run dev:all` を起動し、`http://localhost:4322` に `hana@seed.local` / `seed-pass-1234` でログイン
Expected:
- 既存記事の編集画面で取材地が現在の値で選択されている
- 取材地を未選択にして「公開」を押すと「公開には取材地が必要です」が出る
- 取材地を選んで公開すると成功する
- 新規作成した下書きの取材地が、プロフィールの活動拠点になっている

- [ ] **Step 9: コミット**

```bash
git add admin/src/lib/articles.ts admin/src/lib/editor-helpers.ts \
        admin/src/pages/articles/ admin/tests/
git commit -m "feat(admin): 記事の取材地を編集できるようにする"
```

---

### Task 10: CMS でページ件数を設定できるようにする

**Files:**
- Modify: `admin/src/lib/admin.ts`(`SiteSettings`, `fetchSettings`, `updateSettings`)
- Modify: `admin/src/pages/settings.astro`
- Test: `admin/tests/admin.test.ts`

**Interfaces:**
- Consumes: `settings.page_size`(Task 1)
- Produces: `SiteSettings.pageSize: number`

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/admin.test.ts` の設定まわりの describe に追加:

```ts
it('pageSize が 1 未満なら INVALID_SETTINGS', async () => {
  await expect(
    updateSettings(fakeSupabase, { postIntervalDays: 10, featuredCount: 3, pageSize: 0 }),
  ).rejects.toThrow('INVALID_SETTINGS');
});

it('pageSize が整数でなければ INVALID_SETTINGS', async () => {
  await expect(
    updateSettings(fakeSupabase, { postIntervalDays: 10, featuredCount: 3, pageSize: 1.5 }),
  ).rejects.toThrow('INVALID_SETTINGS');
});
```

`fakeSupabase` は既存テストで使っているモックに合わせる。既存の `updateSettings` 呼び出しには `pageSize: 2` を足す。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -w admin -- admin.test.ts`
Expected: FAIL(型エラー、または期待した例外が投げられない)

- [ ] **Step 3: admin.ts を直す**

`admin/src/lib/admin.ts`:

1. `SiteSettings` に `pageSize: number;`
2. `fetchSettings` の select を `'post_interval_days, featured_count, page_size'` にし、返り値に `pageSize: data.page_size,`
3. `updateSettings` に検証と更新列を追加:

```ts
  if (!Number.isInteger(s.pageSize) || s.pageSize < 1) throw new Error('INVALID_SETTINGS');
```
```ts
    .update({
      post_interval_days: s.postIntervalDays,
      featured_count: s.featuredCount,
      page_size: s.pageSize,
    })
```

- [ ] **Step 4: 設定画面に入力欄を足す**

`admin/src/pages/settings.astro`:

1. `featured` の Field の下に:

```astro
      <Field id="page-size" label="一覧1ページあたりの記事数" type="number" min="1" step="1" required />
```
2. `const featuredEl = ...` の下に `const pageSizeEl = document.getElementById('page-size') as HTMLInputElement;`
3. 読み込み時に `pageSizeEl.value = String(s.pageSize);`
4. 空欄チェックに `|| pageSizeEl.value.trim() === ''` を足す
5. `updateSettings` の引数に `pageSize: Number(pageSizeEl.value),`

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test -w admin`
Expected: PASS

- [ ] **Step 6: 手で確認する**

CMS に admin ユーザーでログインし、設定画面で件数を 3 に変えて保存。公開サイトを再ビルドする。

Run: `npm run build && ls dist/2`
Expected: 保存できる。再ビルド後、1ページあたり3件になりページ数が減る

確認後、件数を 2 に戻しておく。

- [ ] **Step 7: コミット**

```bash
git add admin/src/lib/admin.ts admin/src/pages/settings.astro admin/tests/admin.test.ts
git commit -m "feat(admin): 一覧1ページあたりの記事数を設定できるようにする"
```

---

### Task 11: ドキュメント更新と通し確認

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `CLAUDE.md`(必要なら)

**Interfaces:**
- Consumes: Task 1〜10 の全て
- Produces: なし

- [ ] **Step 1: ARCHITECTURE.md を更新する**

以下を追記する:
- `articles.region`(取材地)と `profiles.region`(活動拠点)が別物であること
- 地域ページのルーティング(`/areas/<slug>`、2ページ目以降は `/areas/<slug>/2`)
- サイドバーのデータは `getAreaLinks()` がビルド中1回だけ取得してメモ化すること、各ページから props で渡さないこと
- `getStaticPaths` の中でページごとにクエリを投げないこと

- [ ] **Step 2: クリーンな状態で全テストを流す**

```bash
supabase db reset && supabase test db
node scripts/seed.mjs && npm test
npm test -w admin
```

Expected:
- pgTAP: `All tests successful.`(111 tests)
- 公開サイト Vitest: 全て PASS
- CMS Vitest: 全て PASS

- [ ] **Step 3: 両方ビルドする**

```bash
npm run build && npm run build -w admin
```

Expected: どちらも成功

- [ ] **Step 4: ブラウザで通し確認する**

`npm run dev:all` を起動し、以下を順に確認する:

| 確認 | 期待 |
|---|---|
| `/` | Hero が全幅、下に2カラム、左に検索と Area |
| `/` のページ送り `→` | `/2` に移動、Hero が消える |
| サイドバーの地域リンク | その地域の記事だけ、地域名に下線 |
| 地域ページのページ送り | `/areas/<slug>/2` に移動 |
| 検索モーダル | 開く・打つと結果・Esc で閉じる |
| `/writers` | 2カラム、既存の地域フィルタが動く |
| `/articles/<slug>` | 2カラム、本文が読める |
| 幅 390px | サイドバーが上に積まれ、地域が横スクロール |

- [ ] **Step 5: コミット**

```bash
git add ARCHITECTURE.md CLAUDE.md
git commit -m "docs: 地域ページ・サイドバーの設計をアーキテクチャ文書に反映"
```

---

## 実装順序の理由

Task 1(DB)が全ての土台。Task 2〜3(データ層)を先に固めてから Task 4〜5(見た目)、Task 6〜7(ページ生成)と積む。Task 8(検索)は独立しているので後回しでよい。Task 9〜10(CMS)は公開サイトが動いてからでも順序を入れ替えられるが、Task 1 の制約により**Task 9 を入れるまで CMS から記事を公開できなくなる**点に注意する(既存の公開記事は影響を受けない)。
