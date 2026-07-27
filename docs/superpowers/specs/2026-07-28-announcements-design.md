# お知らせ機能(announcements)設計

## 背景・目的

アドミンが運営からのお知らせを配信できるようにする。対象は2系統:

- **CMS(ライター・認定事業者向け)**: ログイン中のユーザー向けにシンプルな告知を表示。
- **公開サイト(エンドユーザー向け)**: サイドバー(NavDrawer)にバナーを表示し、クリックでポップアップに本文を表示。

権限・可視範囲は DB 層(RLS)で強制する(このプロジェクトの絶対ルール)。

## データモデル

新テーブル `announcements`:

| カラム | 型 | 説明 |
|---|---|---|
| id | uuid PK, default gen_random_uuid() | |
| title | text not null | バナー・一覧の見出し |
| body | text not null | ポップアップ本文(プレーンテキスト、改行のみ) |
| audiences | text[] not null | `writer` / `provider` / `end_user` の組み合わせ。CHECK制約で許可値のみに制限し、空配列は不可 |
| published | boolean not null default false | 公開トグル |
| created_by | uuid references auth.users | 作成者(アドミン) |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

- 公開期間(開始日・終了日)は今回は設けない。公開トグルの手動運用のみ(YAGNI)。将来必要になればカラム追加で対応。
- 既読管理は行わない。CMS・公開サイトともに「消したら以後表示しない」仕組みはバナーの × のみ(後述)。

### RLS ポリシー

- **書き込み(INSERT/UPDATE/DELETE)**: アドミンロールのみ。
- **SELECT(anon = 公開サイト)**: `published = true AND 'end_user' = ANY(audiences)` の行のみ。
- **SELECT(ライター/事業者)**: `published = true AND (自分のロールに対応する audience) = ANY(audiences)` の行のみ。
- **SELECT(アドミン)**: 全件(published問わず、管理画面で下書き含め見えるように)。

pgTAP でロールごとの可視範囲(公開/非公開、対象違い)と書き込み拒否を検証する。

## CMS: アドミン管理画面

- サイドバー(`AdminShell.astro` の `admin-nav` ブロック)に「お知らせ管理」リンクを追加。
- 新規ページ `admin/src/pages/announcements.astro`:
  - 一覧(タイトル・対象・公開状態・更新日)
  - 作成/編集フォーム: タイトル・本文・対象チェックボックス(ライター/事業者/エンドユーザーを複数選択可)・公開トグル
  - 削除

## CMS: ライター/事業者への表示

- `AdminShell.astro` のサイドバー、ナビとログアウトボタンの間に「お知らせ」セクションを追加。
- ログイン中ユーザーのロール(writer/provider)向けに `published=true` かつ該当 audience を含むお知らせを新しい順に数件表示。
- タイトルをクリックするとモーダルで本文を表示。
- 既読管理なし。常時表示。

## 公開サイト: エンドユーザー向けバナー

- `NavDrawer.astro` 内にバナー枠を追加。
- ページ表示時にスクリプトが Supabase REST エンドポイントに anon key で直接 fetch し(SDK追加なし)、`published=true` かつ `end_user` を含む最新のお知らせを1件取得して表示。
- バナークリックでポップアップ(モーダル)に本文表示。
- バナーに × ボタンを付け、閉じたら該当お知らせの `id` を localStorage に記録して以後非表示にする。新しいお知らせ(別ID)が出れば再度表示される。
- 静的ビルドを経由しないため、アドミンの公開/停止操作が即座に反映される。

## 実装順

1. マイグレーション + pgTAP テスト(`announcements` テーブル、RLS)
2. CMS 管理画面(一覧・作成・編集・削除)
3. CMS 表示(ライター/事業者向けサイドバー欄 + モーダル)
4. 公開サイトバナー(NavDrawer + fetch + モーダル + 既読(localStorage)ロジック)

## スコープ外(YAGNI)

- 公開期間(開始日・終了日)による自動出し分け
- 既読管理のサーバー側永続化
- 通知の優先度・ピン留め・複数同時表示
