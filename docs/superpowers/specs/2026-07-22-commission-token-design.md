# 設計書: 依頼トークン制(プロバイダー → ライター)

日付: 2026-07-22
ステータス: 承認済み(設計)

## 概要

現行の「依頼者コード」(`commission_code`)はプロバイダー1人につき1つの静的なコードで、誰に渡しても・何度でも・無期限に使える。そのため管理者は「どのプロバイダーがどのライターに依頼したか」を**記事が公開されたあと**にしか知りようがなく、依頼の意図(誰に何を頼んだか)を事前に追跡できない。

これを、**プロバイダーが特定のライター宛てに発行する使い切りトークン**に置き換える。

- プロバイダーがライターを選んで「依頼する」→ その(プロバイダー, ライター)専用のトークンが発行される
- 両者はプラットフォーム外(既に公開されているライターの `contact_url` / `sns_links` 経由)で条件を交渉する ※この部分は変更なし
- 話がまとまったら、プロバイダーがそのトークンをライターに渡す(渡し方は当事者間で自由)
- ライターは記事公開時にそのトークンを入力する
- システムはトークンがそのライター宛てであることを確認し、`commissioned_by` を紐付ける
- 管理者はどのトークンが誰向けに発行され、使用済み/未使用/取消済みかを一覧で確認できる

「ライターが事前に依頼を承諾する」ステップは設けない。トークンを実際の記事に貼るという行為自体がライターの同意表明であり、承諾画面を別に用意しても実質的な抑止力にならない一方、通知の仕組み(未実装)を新たに必要とするため。

## 現状(変更前)

- `profiles.commission_code`: プロバイダーの `role` 昇格時にトリガー `set_commission_code()` が `WM-XXXXXXXX` 形式で自動生成。以後不変・使い回し自由。
- `public.validate_commission_code(code)`: `SECURITY DEFINER` の完全一致RPC。ライターが記事エディタで入力したコードからプロバイダー名を引く。
- `articles.commission_code_input` → トリガー `resolve_commission_code()` が `articles.commissioned_by` を解決。
- 依頼記事(`commissioned_by` 非null)は `post_interval_days` の投稿間隔制限の対象外、かつ Featured枠(最新 `featured_count` 件)の対象。
- ライターの `contact_url` / `sns_links` / `price_info` はもともと公開サイトの本人ページで誰でも閲覧可能(`src/lib/content.ts`)。今回これは変更しない。

## 新しい設計

### データモデル

```
commission_tokens (新規)
├ id            uuid pk
├ provider_id   → profiles.id   … トークン発行者。auth.uid() からサーバー側で強制設定(クライアント指定不可)
├ writer_id     → profiles.id   … 宛先ライター。role='writer' のみ許可
├ token         text unique     … "WM-XXXXXXXX" 形式(既存の commission_code と同じ生成方式)
├ created_at    timestamptz
├ revoked_at    timestamptz null
└ revoked_by    → profiles.id null

articles(変更)
├ commission_token_input   … commission_code_input のリネーム。ライターが入力する生のトークン文字列
├ commissioned_by          … 変更なし。解決されたプロバイダーid(Featured/間隔除外ロジックはそのまま使える)
└ commission_token_id      → commission_tokens.id(新規)… どのトークンで解決されたか

削除:
- profiles.commission_code
- トリガー set_commission_code()
- RPC validate_commission_code()
```

### トリガー・関数

- **`a_set_commission_token`**(`commission_tokens` への `BEFORE INSERT`, `SECURITY DEFINER`)
  `new.provider_id := auth.uid()` を強制。呼び出し元が `role='provider'` であること、`writer_id` の行が `role='writer'` であることを検証(満たさなければ `NOT_A_PROVIDER` / `INVALID_WRITER`)。トークン文字列を生成。

- **`a_guard_commission_token_revoke`**(`commission_tokens` への `BEFORE UPDATE`)
  `revoked_at` を null → 現在時刻にする更新のみ許可。対象トークンが既にいずれかの記事の `commission_token_id` として使われていれば `TOKEN_IN_USE_CANNOT_REVOKE` で拒否。`token` / `provider_id` / `writer_id` / `created_at` の変更は一切禁止。

- **`a_resolve_commission_token`**(`articles` への `BEFORE INSERT OR UPDATE`。既存 `resolve_commission_code()` の置き換え)
  `commission_token_input` が変更された場合:
  - null → `commissioned_by` / `commission_token_id` をクリア
  - 該当トークンなし → `INVALID_COMMISSION_TOKEN`
  - 取消済み → `COMMISSION_TOKEN_REVOKED`
  - `writer_id <> new.author_id` → `COMMISSION_TOKEN_WRONG_WRITER`
  - 既に他の記事の `commission_token_id` として使用済み → `COMMISSION_TOKEN_ALREADY_USED`
  - それ以外 → `commissioned_by := token.provider_id`, `commission_token_id := token.id`

- 既存の公開時ルール(`enforce_publish_rules()` の間隔除外・Featured対象判定、および `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` = 公開中は先に非公開にしないと依頼解除不可)は `commissioned_by` を見ているためロジック変更不要。ただし `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` のガードは `commission_token_id` の変更も同時に見るよう拡張する。

### RLS(`commission_tokens`)

| 操作 | provider | writer | admin |
|---|---|---|---|
| SELECT | 自分が `provider_id` の行のみ | 自分が `writer_id` の行のみ | 全件 |
| INSERT | 自分を `provider_id` として作成可(トリガーが検証・強制) | ❌ | ❌ |
| UPDATE(取消) | 自分が発行した行のみ、`a_guard_commission_token_revoke` の制約内 | ❌ | 全件、同ガード内 |

writerにもSELECTを許可するのは、将来「自分宛ての依頼一覧」を見せるUI(TODO送りにした説明ポップアップ等)を安価に追加できるようにするため。今回のスコープでは表示UIは作らない。

### CMS UI

- **`admin/src/pages/commission.astro`(新規、providerのみ)**: ライター一覧(名前・地域・自己紹介抜粋)+ 各行に「依頼する」ボタン → `commission_tokens` へINSERT → 発行直後のトークンをコピー可能な形で表示。下部に自分が発行したトークンの履歴(状態: 未使用/使用済み/取消済み、未使用のみ「取消す」ボタン)。
- **`admin/src/pages/commissions.astro`(新規、adminのみ)**: 全プロバイダー分のトークン一覧(プロバイダー名・ライター名・トークン・発行日・状態・紐づく記事へのリンク・取消ボタン)。管理者が「誰が誰に依頼したか」を追跡する主画面。
- **`admin/src/pages/dashboard.astro`**: 既存の `admin-nav`(role=adminのみ表示)と同じパターンで `provider-nav` ブロックを追加し、`role='provider'` のときだけ `/commission` へのリンクを表示。
- **記事エディタ**(`admin/src/pages/articles/new.astro` / `edit.astro`): 既存の「依頼者コード(任意)」テキスト欄をそのまま「依頼トークン(任意)」にラベル変更。blur時にバリデーションして提供元プロバイダー名 or エラーメッセージを表示、という既存の対話パターンは変更しない。
- 画面のビジュアル(配色・余白・状態ピルの見せ方)は事前に作成したモックアップをほぼそのまま踏襲する。既存の `admin/` の shadcn 系トークン(`bg-card` / `text-muted-foreground` / `bg-primary` / `rounded-md` 等)に合わせて実装する。

### エラーハンドリング

`admin/src/lib/editor-helpers.ts` のDBエラー→日本語メッセージ表(既存の `INVALID_COMMISSION_CODE` / `COMMISSION_UNLINK_REQUIRES_UNPUBLISH` を置き換え・拡張):

| コード | 発生箇所 | メッセージ |
|---|---|---|
| `INVALID_COMMISSION_TOKEN` | 記事エディタ | トークンが見つかりません |
| `COMMISSION_TOKEN_WRONG_WRITER` | 記事エディタ | このトークンは別のライター宛てです |
| `COMMISSION_TOKEN_REVOKED` | 記事エディタ | このトークンは取り消されています |
| `COMMISSION_TOKEN_ALREADY_USED` | 記事エディタ | このトークンは使用済みです |
| `TOKEN_IN_USE_CANNOT_REVOKE` | プロバイダー/管理画面の取消操作 | 使用済みのトークンは取り消せません |
| `COMMISSION_UNLINK_REQUIRES_UNPUBLISH`(拡張) | 記事エディタ | 依頼を解除するには先に非公開にしてください |
| `NOT_A_PROVIDER` / `INVALID_WRITER` | 依頼作成(通常UIからは到達しない防御的チェック) | 依頼を作成できませんでした |

### テスト方針

- **pgTAP**(`supabase/tests/database/04_commission.test.sql` を置き換え): トークン作成時の権限強制(`provider_id` の強制上書き・role検証)、`a_resolve_commission_token` の全エラーパス+成功パス、取消トリガー(使用済みトークンの取消拒否・他プロバイダーのトークンをRLSで取消不可)、`COMMISSION_UNLINK_REQUIRES_UNPUBLISH` 拡張の確認。
- **Vitest**: 新規 `admin/src/lib/commissions.ts` のロジック、`editor-helpers.ts` の新エラーマッピング。
- **`scripts/seed.mjs`**: `forest@seed.local` → `hana@seed.local` / `kenta@seed.local` へのトークン発行・使用を新フローで再現するよう更新。

## 移行・影響範囲

本番相当データで `commission_code` の使用実績はseed以外に存在しないため、後方互換は不要。旧カラム・トリガー・RPCはマイグレーションで削除する。実装時に `ARCHITECTURE.md`(依頼者コードの記述箇所)・`docs/DATABASE.md`(ER図)を同じ変更の中で更新する(CLAUDE.mdのドキュメント保守ルールに従う)。

## スコープ外

- 依頼の流れ(トークン発行→交渉→入力)を両者に説明するポップアップUI — `docs/TODO.md` に記録済み。将来、上記の writer 向けSELECT RLSを土台に追加できる。
