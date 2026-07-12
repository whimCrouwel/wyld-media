# 設計書: 記事エディタのブロック化(note.com相当のWYSIWYGエディタ)

日付: 2026-07-12
ステータス: 承認済み(設計)

## 概要

現行の記事エディタ(素の `textarea` + Markdown + スラッシュメニュー)を、note.com相当の「執筆に集中できるブロック型WYSIWYGエディタ」に刷新する。

調査元は `cms-editor-requirements.md`(note.comエディタ実機調査、2026-07-12)。このドキュメントが定義する要件のうち、以下をスコープとする。

- **Phase 1**: ブロック基盤(段落・見出しH2/H3・箇条書き・番号付き・引用・区切り線)、Enter/Shift+Enterの2種改行、Markdown入力ルール、選択時ツールバー、自動保存
- **Phase 2**: 画像・埋め込み・コード・ファイルブロック、目次パネル、プレビュー

**スコープ外(今回はやらない)**:
- Phase 3 相当のすべて: 公開設定の別画面化、タグ、カテゴリ・シリーズ、変更履歴(バージョン管理)
- 有料エリア、予約投稿、限定公開、コメント機能、AIアシスタント、自動翻訳、複数人同時編集、表ブロック、文字色/フォントサイズ変更(元要件書のスコープ外を踏襲)
- oEmbed等によるカード化(タイトル・サムネイル取得)された埋め込み — 今回は許可プロバイダのURLパターン判定によるクライアント側iframe埋め込みのみ

## アーキテクチャ

| 層 | 技術 | 役割 |
|---|---|---|
| エディタエンジン | Tiptap(ProseMirror)、`@tiptap/core` をvanilla JSで組み込み | ブロックモデル・キー入力・IME・Markdown入力ルールを提供 |
| ブロック→HTML変換 | 新規共有パッケージ `packages/blocks-renderer/`(Tiptapの `generateHTML` + サニタイズ) | admin側プレビューと公開サイトビルドの両方から利用 |
| DB・強制ルール | Supabase Postgres(トリガー) | ブロックJSONの構造・ホスト制限・件数制限を強制 |
| 画像・ファイルアップロード | 既存 `r2-upload-url` Edge Function(許可MIMEタイプを拡張) | R2への署名付きアップロード |
| 埋め込み | クライアント側iframe(許可ドメインのみ)+ DBトリガーで同じ許可リストを強制 | 新規Edge Functionは作らない |

- admin画面は既存通りReact等のUIフレームワークを導入しない。Tiptapはフレームワーク非依存のvanilla JS APIで既存の `<script>` 構成に組み込む。
- root(公開サイト)とadminは別パッケージなので、`packages/blocks-renderer/` を共有するために npm workspace を導入する。

## データモデル

```
articles
├ id
├ author_id
├ slug
├ title
├ body              … jsonb(ProseMirrorドキュメントJSON。{type:"doc", content:[...]}）★変更点(旧: markdown text)
├ cover_image_url
├ status
├ published_at
├ commission_code_input
├ commissioned_by
├ created_at
└ updated_at
```

- `body` は `text` → `jsonb` へ型変更。**本番データが存在しない(初回デプロイ未実施)ため、既存データの変換は不要。** マイグレーションは列の作り直し(`DROP COLUMN` → `ADD COLUMN body jsonb NOT NULL DEFAULT '[]'::jsonb`)でよい。
- 独自のブロックシリアライズ形式は定義しない。Tiptap(ProseMirror)が出力するドキュメントJSONをそのまま保存する。各ノードは `type` / `attrs` / `content`(子ノード配列、ソフト改行を含みうる) / `marks`(インライン装飾)を持ち、要件定義書のデータ要件と一致する。
- タイトル・アイキャッチは従来通り `articles.title` / `articles.cover_image_url` に別保持。本文ブロックにH1は含めない。

### ブロック型(Phase 1 + 2)

| ブロック型 | Tiptap実装 |
|---|---|
| 段落 | StarterKit標準(ソフト改行 = HardBreak) |
| 見出し(H2/H3) | StarterKit標準(H1は無効化) |
| 箇条書き/番号付きリスト | StarterKit標準(ネスト対応) |
| 引用 | StarterKit標準(Blockquote) |
| 区切り線 | StarterKit標準(HorizontalRule) |
| 画像 | カスタムノード(url, caption, alt) |
| 埋め込み | カスタムノード(url, provider) |
| コード | StarterKit標準(CodeBlock) |
| ファイル | カスタムノード(url, filename) |
| 目次 | カスタムノード(保持データなし、見出しから都度生成して表示) |

インライン装飾は太字・取り消し線・リンクのみ(要件定義書通り、文字色/フォントサイズ/下線/表は非対応)。

## DBによる強制(必須・トリガー)

CLAUDE.mdの絶対ルール(権限・ビジネスルールはDB層で強制)に従い、以下をすべてDBトリガーで強制する。クライアント側の検証はUX目的に留める。

- 既存 `enforce_body_image_rules`(Markdown文字列をパースする実装)を、`body` のJSON木を走査するトリガーに書き換える
  - `image` ブロックのurlは `settings.image_base_url` 配下のみ許可(既存踏襲)
  - `image` ブロック数は上限5件を維持(`MAX_BODY_IMAGES` と同じ値。変更の要望があれば別途)
  - `file` ブロックのurlも同様のホスト制限を適用
  - `embed` ブロックのurlは許可プロバイダドメイン(YouTube / X(Twitter) / Vimeo等)のリストでチェック
- 公開バリデーション(既存 `05_publish_rules` / `06_publish_hardening`)を「`body` が空文字でない」から「blocksに実質的なコンテンツ(テキストを持つノードが1つ以上)があるか」に更新
- pgTAPテスト: `07_body_image_rules.test.sql` を新形式に書き換え、埋め込み/ファイル/公開バリデーションのケースを `09_body_blocks_rules.test.sql` に追加

## エディタUI(admin側)

- 「＋」挿入メニュー: 本文の空行左に表示、Tiptapの `Suggestion` ユーティリティで実装。既存 `slash-menu.ts` と同様に "/" 入力でも呼び出せる
- 選択時ツールバー: Tiptapの `BubbleMenu` 拡張。見出し変換・太字・取り消し線・リスト変換・文字揃え・リンク・引用/コード変換・削除
- Markdown入力ルール・Enter/Shift+Enterの2種改行: Tiptap標準機能(H1変換とコードフェンスは要件通り無効化)
- 画像・ファイルアップロード: 既存 `r2-upload-url` Edge Functionを再利用(ファイルブロック用にMIMEタイプ許可を拡張)
- 目次パネル: 左サイドバーに表示。本文の見出しノードを都度抽出し、クリックで該当ブロックへスクロール
- プレビュー: `packages/blocks-renderer/` を使い、別画面(またはモーダル)で公開後相当のHTMLを表示
- 文字数カウント: 全体・選択範囲の両方に対応

## 自動保存・競合検知

- 自動保存: 一定間隔+操作の区切りで発火、既存の下書き保存APIを流用。保存状態をヘッダーに表示
- 競合検知: 保存前に `articles.updated_at` を比較し、他所での更新を検知していたら警告(リアルタイム共同編集は非対応のまま)
- 復元: 送信失敗時は `localStorage` に本文JSONを退避し、次回開いた時に復元を提案

## 貼り付け・アクセシビリティ・レスポンシブ

- 貼り付け正規化: Tiptapの `Paste Rules` / `transformPastedHTML` を使い、スキーマに定義されたノード/マーク以外は構造的に除去する
- アクセシビリティ: 全ブロック操作をキーボードのみで完結できるようにする(Tiptap標準キーマップ)。ショートカット一覧はサイドバーの「エディタガイド」に表示
- レスポンシブ: モバイル幅ではツールバーを下部固定に切り替え(CSSのみ)

## 画面構成について

要件定義書にある「公開設定の別画面化」はPhase 3(タグ・カテゴリ・変更履歴)とセットの内容のため、今回は作らない。既存の1画面構成(下書き保存/公開ボタン)を維持し、公開前バリデーション(タイトル・本文必須)はDBトリガーの延長で対応する。

## 変更が必要な既存ファイル(概要)

- `admin/src/pages/articles/edit.astro` / `new.astro` — textareaをTiptapエディタに置き換え
- `admin/src/lib/slash-menu.ts` / `media-picker.ts` / `body-image.ts` — Tiptap拡張への置き換え・統合
- `admin/src/lib/editor-helpers.ts` — Markdownプレビュー関数を撤去し、`packages/blocks-renderer/` を使うよう変更
- `src/lib/content.ts` — `renderMarkdown` を撤去し、`packages/blocks-renderer/` を使うよう変更
- `supabase/migrations/` — `body` 列の型変更マイグレーション、`enforce_body_image_rules` の書き換え、公開バリデーションの更新を追加
- `supabase/tests/database/07_body_image_rules.test.sql` — 書き換え、`09_body_blocks_rules.test.sql` — 新規
- ルート `package.json` — npm workspaces設定を追加(`packages/*`)
