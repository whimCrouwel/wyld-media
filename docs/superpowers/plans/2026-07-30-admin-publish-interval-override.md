# admin による投稿間隔ルール無視 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin(管理者ロール)が、通常記事(依頼記事以外)の投稿間隔ルール(`settings.post_interval_days`、既定10日)を無視して、他ライターの下書き記事を即座に公開できるようにする。

**Architecture:** `articles` テーブルの `before insert or update` トリガー関数 `enforce_publish_rules()` が投稿間隔チェックを行っている。この関数は既に `trusted`(`auth.uid() is null or public.is_admin()`)という信頼フラグを計算済みで、`published_at` の書き換え制御に使っている。今回はこの `trusted` フラグを投稿間隔チェックの分岐条件にも追加するだけ。RLS(`update own articles or admin all`)は既に admin による全記事UPDATEを許可しており、CMS(`admin/src/pages/articles/edit.astro` の「公開する」ボタン)も著者チェックをしていないため、DBトリガーの変更のみで完結する。

**Tech Stack:** PostgreSQL(Supabase)、pgTAP(DBテスト)、plpgsql トリガー関数。

## Global Constraints

- 権限・ビジネスルールはDB層(RLS・トリガー)で強制する。クライアント側の変更は不要かつ行わない。
- `trusted` の定義(`auth.uid() is null or public.is_admin()`)自体は変更しない。
- 監査記録(誰が・いつ間隔を無視して公開したか)は実装しない(スコープ外)。
- 依頼記事(`commissioned_by` が非null)の扱いに影響を与えない(既存の間隔無視の対象外という挙動を維持)。

---

### Task 1: `enforce_publish_rules` トリガーで admin(trusted)を投稿間隔チェックから除外する

**Files:**
- Test: `supabase/tests/database/06_publish_hardening.test.sql`(既存ファイルに追記)
- Create: `supabase/migrations/20260730100000_admin_publish_interval_override.sql`

**Interfaces:**
- Consumes: 既存の `public.enforce_publish_rules()` トリガー関数(`supabase/migrations/20260706043424_harden_publish_and_commission_rules.sql`)、`public.is_admin()` 関数、`settings.post_interval_days`。
- Produces: `public.enforce_publish_rules()` の新バージョン(投稿間隔チェックが `trusted` なら丸ごとスキップされる)。以降のタスクは無いため、他タスクへの新しい公開インターフェースはない。

- [ ] **Step 1: 失敗するテストを追記する**

`supabase/tests/database/06_publish_hardening.test.sql` の3行目を書き換える:

```sql
select plan(16);
```

(元は `select plan(12);`)

同ファイルの150行目 `select * from finish();` の直前(148行目の `'republishing as a normal (uncommissioned) post goes through the rate limit again');` の直後)に、以下のブロックを追記する:

```sql
-- 7) admin (trusted) can force-publish another author's draft even when that
--    author's normal-post interval has not elapsed. The author themself
--    remains rate-limited afterwards (the override does not create a chain
--    of exemptions).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'hard-admin@test.local');
insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-00000000000e', 'admin', 'hard-admin', 'Admin');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status, body, region)
    values ('40000000-0000-0000-0000-000000000005',
            '00000000-0000-0000-0000-00000000000c',
            'hard-d', 'fourth post (draft)', 'draft',
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'writer can always save a new draft regardless of the interval');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update articles set status = 'published'
    where id = '40000000-0000-0000-0000-000000000005'$$,
  'admin can publish another author''s draft even though the interval has not elapsed');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into articles (id, author_id, slug, title, status, body, region)
    values ('40000000-0000-0000-0000-000000000006',
            '00000000-0000-0000-0000-00000000000c',
            'hard-e', 'fifth post (draft)', 'draft',
            '[{"type":"paragraph","content":[{"type":"text","text":"body"}]}]'::jsonb, '関東')$$,
  'writer can save another new draft');

select throws_like(
  $$update articles set status = 'published'
    where id = '40000000-0000-0000-0000-000000000006'$$,
  '%POST_INTERVAL_NOT_ELAPSED%',
  'the author themself is still rate-limited even though admin just force-published for them');
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `supabase test db`

Expected: `06_publish_hardening.test.sql` 内で `'admin can publish another author''s draft even though the interval has not elapsed'` のアサーションが FAIL する(現行の `enforce_publish_rules` は admin でも投稿間隔チェックを適用するため、`update ... set status = 'published'` が `POST_INTERVAL_NOT_ELAPSED` 例外を投げて `lives_ok` が失敗する)。他の15件は通ることを確認する。

- [ ] **Step 3: マイグレーションを作成し、間隔チェックを `trusted` なら除外する**

新規ファイル `supabase/migrations/20260730100000_admin_publish_interval_override.sql`:

```sql
-- admin(trusted)は通常記事の投稿間隔ルールを無視して公開できるようにする。
-- 経緯: docs/superpowers/specs/2026-07-30-admin-publish-interval-override-design.md
--
-- enforce_publish_rules は既に `trusted`(auth.uid() is null or is_admin())を
-- published_at の書き換え制御に使っている。同じ trusted フラグを投稿間隔
-- チェックにも適用し、admin(および pgTAP フィクスチャ・サービス側の
-- トラステッド呼び出し)はインターバルを無視して公開できるようにする。
-- RLS は既に admin による全記事UPDATE(著者不問)を許可しているため、
-- この変更のみで admin から他ライターの下書きを即時公開できるようになる。
create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  interval_days int;
  last_pub timestamptz;
  trusted boolean;
begin
  trusted := (auth.uid() is null or public.is_admin());

  -- run only when the row is becoming published
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if trusted then
      if new.published_at is null then
        new.published_at := now();
      end if;
    else
      -- ignore any client-supplied published_at on the publish transition
      new.published_at := now();
    end if;

    if new.commissioned_by is null and not trusted then
      select post_interval_days into interval_days
        from settings where id = 1;

      select max(published_at) into last_pub
        from articles
       where author_id = new.author_id
         and status = 'published'
         and commissioned_by is null
         and id <> new.id;

      if last_pub is not null
         and last_pub > now() - make_interval(days => interval_days) then
        raise exception
          'POST_INTERVAL_NOT_ELAPSED: next normal post allowed after %',
          last_pub + make_interval(days => interval_days);
      end if;
    end if;
  end if;

  -- row stays published across the update: published_at is immutable for
  -- untrusted callers, and unlinking a commission requires unpublishing first
  if tg_op = 'UPDATE'
     and old.status = 'published' and new.status = 'published' then

    if not trusted then
      new.published_at := old.published_at;
    end if;

    if old.commissioned_by is not null
       and new.commissioned_by is null
       and not trusted then
      raise exception
        'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: unpublish the article before removing the commission link';
    end if;
  end if;

  return new;
end;
$$;
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `supabase db reset && supabase test db`

(新しいマイグレーションをローカルDBに適用するため、`test db` 単体ではなく `db reset` を挟む。)

Expected: `06_publish_hardening.test.sql` の16件すべて PASS。他の pgTAP テストファイル(`05_publish_rules.test.sql` 含む)もすべて PASS のままであること。

- [ ] **Step 5: 手動確認(CMS)**

ローカルで `npm run dev:all` を起動し、`admin@seed.local` / `seed-pass-1234` で CMS(:4322) にログイン。ダッシュボードの「全記事」監査一覧から `hana@seed.local` または `kenta@seed.local` が直近公開した記事の著者の、別の下書き記事を開き、「公開する」ボタンを押して即座に公開できることを確認する(投稿間隔が経過していない状態でも成功すること)。

- [ ] **Step 6: コミット**

```bash
git add supabase/migrations/20260730100000_admin_publish_interval_override.sql supabase/tests/database/06_publish_hardening.test.sql
git commit -m "$(cat <<'EOF'
feat(db): adminは投稿間隔ルールを無視して公開できるようにする

enforce_publish_rulesトリガーが既に持つtrustedフラグ
(auth.uid() is null or is_admin())を投稿間隔チェックにも適用し、
adminが他ライターの下書きを即時公開できるようにする。RLS・CMS側は
既に対応済みのため変更不要。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage**: spec の「DBマイグレーション」「テスト計画」「実装順」の全項目に対応するステップがある。「CMS」「監査記録」はいずれも「変更なし」が spec 通りであり、対応するタスクは不要(Global Constraintsに明記)。
- **Placeholder scan**: TBD・「適切なエラーハンドリングを追加」等のプレースホルダーなし。全ステップに実際のSQL/コマンドを記載。
- **Type consistency**: トリガー関数のシグネチャ(`returns trigger`, 引数なし)は変更前後で同一。テストで参照する `article_status`(draft/published)・列名(`status`, `published_at`, `commissioned_by`, `author_id`)は既存スキーマと一致。
