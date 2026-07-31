# ユーザー削除機能 設計 (2026-07-31)

## 目的

CMS のユーザー管理ページ(`admin/src/pages/users.astro`)から、管理者がユーザー(テストユーザー等)を削除できるようにする。削除前に既存の `ConfirmDialog` による確認ステップを挟む。

## 決定事項

- **記事を持つユーザーは削除をブロックする**(連鎖削除しない)。エラーメッセージで案内する。
- **自分自身(ログイン中の管理者)は削除不可**。他の管理者アカウントは削除可。
- 確認ポップアップは既存の共通コンポーネント `ConfirmDialog.astro` + `confirm-dialog.ts` を再利用する(新規コンポーネントは作らない)。

## アーキテクチャ

### 1. DB 層(マイグレーション + pgTAP)

`articles.author_id references profiles(id)` の外部キーを `on delete cascade` から `on delete restrict` に変更する。

- 記事を持つユーザーの `profiles` 行の削除は FK 違反で失敗する。
- `auth.users` の削除は `profiles` へ cascade するため、その途中で restrict に当たると **トランザクション全体が原子的に失敗**する。つまり `auth.admin.deleteUser` 自体がエラーになり、中途半端な状態は残らない。
- トリガー不要。宣言的制約のみで「記事があれば削除不可」を DB 層で強制する(CLAUDE.md の原則どおり)。

pgTAP テスト(`supabase/tests/database/`):

- 記事を持つユーザーの `auth.users` 行削除が失敗すること。
- 記事を持たないユーザーの削除が成功し、`profiles` 行も消えること。

既存挙動の変更点: これまで「ユーザー削除で記事も消える」だったものを意図的に廃止する。`invite-user` のロールバック(`auth.admin.deleteUser`)は招待直後で記事ゼロのため影響なし。

### 2. Edge Function `delete-user`(新規)

`supabase/functions/invite-user/index.ts` と同じパターン:

1. 呼び出し元の JWT を検証し、`profiles.role = 'admin'` であることを確認(非 admin は 403)。
2. `targetUserId === caller.id` なら拒否(自己削除防止、400)。
3. service role クライアントで `auth.admin.deleteUser(targetUserId)` を実行。
4. FK restrict による失敗(記事あり)は判別可能なエラーコードで返し、CMS が日本語メッセージに変換できるようにする。

### 3. CMS(既存パターンの適用)

- `admin/src/lib/admin.ts` に `deleteUser(userId)` ヘルパーを追加(`supabase.functions.invoke('delete-user', ...)`)。エラー変換関数(`translateInviteError` 相当)も追加。
- `admin/src/pages/users.astro` のユーザー一覧テーブル各行に「削除」ボタンを追加。ただし**自分自身の行にはボタンを表示しない**(UX 目的。強制は Edge Function 側)。
- クリック時の流れ: `confirmDialog.confirm({ title, body, confirmLabel: '削除する' })` → OK なら `deleteUser()` → 成功で行を DOM から削除、失敗でページ内のエラー表示領域にメッセージ表示(記事ありの場合は「このユーザーは記事を持っているため削除できません。先に記事を削除してください。」)。
- dashboard.astro の記事削除フロー(dialog init → confirm → 削除 → 行除去)と同じ構成。

## テスト

- pgTAP: 上記 2 ケース(記事あり=ブロック / 記事なし=成功)。
- `admin` の Vitest: `deleteUser` ヘルパーとエラー変換関数の単体テスト(既存の `admin.ts` テストのパターンに追従)。

## ドキュメント更新

- `docs/DATABASE.md`: `articles.author_id` の FK が restrict になる変更を ER 図/説明に反映。
