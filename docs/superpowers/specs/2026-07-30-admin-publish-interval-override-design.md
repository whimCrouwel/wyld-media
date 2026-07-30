# admin による投稿間隔ルールの無視設計

## 背景・目的

通常記事(依頼記事以外)は `enforce_publish_rules` トリガーにより、同一著者の直近公開から `settings.post_interval_days`(既定10日)経過しないと公開できない。この間隔チェックは呼び出し元が admin であっても無条件に適用されており、admin が他ライターの下書きを緊急に公開したい場合でも拒否される。admin がこの間隔ルールを無視して非公開記事を公開できるようにする。

## 現状の実装(調査結果)

- `enforce_publish_rules`(`supabase/migrations/20260706043424_harden_publish_and_commission_rules.sql`)は `trusted := (auth.uid() is null or public.is_admin())` を計算しているが、この `trusted` は `published_at` の書き換え制御とコミッション解除制約にしか使われておらず、投稿間隔チェック(`commissioned_by is null` の場合の `POST_INTERVAL_NOT_ELAPSED`)は trusted かどうかに関係なく一律適用される。
- RLS(`update own articles or admin all` ポリシー、`supabase/migrations/20260706031309_rls_policies.sql`)は既に admin による全記事の UPDATE(著者不問)を許可している。
- CMS 側の導線も既に存在する: admin はダッシュボードの「全記事」監査一覧(`admin/src/pages/dashboard.astro` の `audit-section`、`fetchAllArticlesForAudit`)から他ライターの記事へのリンクをたどって `admin/src/pages/articles/edit.astro?id=<記事ID>` を開ける。編集画面の「公開する」ボタンは著者本人が押す場合と全く同じ UI・同じ関数(`saveArticle`)で動作し、著者チェックは存在しない。
- つまり唯一のブロッカーは DB トリガーの間隔チェックのみ。RLS・CMS の変更は不要。

## 変更内容

### DB マイグレーション

`enforce_publish_rules()` 関数内、投稿間隔チェックのブロックを `trusted` なら丸ごとスキップするよう変更する。

```sql
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
```

`trusted` の定義(`auth.uid() is null or public.is_admin()`)は変更しない。既存の pgTAP フィクスチャ・シードスクリプト(`auth.uid() is null` 経由)も同様に間隔チェックをスキップすることになるが、これは現状の `published_at` 制御と同じ扱いであり一貫性がある。

### CMS

変更なし。既存の「公開する」ボタン・エラーメッセージ変換(`translateSaveError` の `POST_INTERVAL_NOT_ELAPSED` 分岐)はそのまま残す(writer が自分の記事を公開しようとして間隔違反した場合は従来通り表示される)。

### 監査記録

行わない。誰が・いつ間隔を無視して公開したかは記録しない(`updated_at` 以上の情報は残らない)。

## テスト計画

`supabase/tests/database/06_publish_hardening.test.sql` に以下を追加:

- admin が他ライターの記事を、投稿間隔経過前でも公開できること
- writer 自身による公開は、投稿間隔経過前は従来通り `POST_INTERVAL_NOT_ELAPSED` で拒否されること(回帰確認)
- 依頼記事(`commissioned_by` あり)の扱いに変化がないこと(回帰確認)

## 実装順

1. マイグレーション(`enforce_publish_rules` 関数の `create or replace`)
2. pgTAP テスト追加・`supabase test db` で確認
3. ローカルで admin ログインし、間隔内の他ライター記事を実際に公開して動作確認

## スコープ外(YAGNI)

- 間隔無視操作の監査ログ・通知
- CMS 上での「強制公開」であることを示す専用ボタン・確認ダイアログ(既存の「公開する」ボタンをそのまま使う)
- admin 以外のロールへの拡張
