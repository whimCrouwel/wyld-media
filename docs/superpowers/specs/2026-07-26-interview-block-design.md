# 設計書: インタビュー(会話)ブロック

日付: 2026-07-26
ステータス: 提案(設計)

## 概要

記事本文に「対話形式」を組み込めるブロックを追加する。話者(聞き手・話し手)の名前・肩書・サムネイルを **記事ごとに一度だけ登録** し、以降のターン(発言)ではどちらの話者かを切り替えるだけで会話を積み重ねられる。公開サイトでは左右交互のインタビュー風レイアウトで表示する。参考: [zine.wyld-crd.org のインタビュー記事](https://zine.wyld-crd.org/ja/posts/%E7%9F%B3%E5%B7%9D%E3%81%AE%E6%B5%B7%E3%82%92%E5%AE%88%E3%82%8B%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B5%E3%83%AA%E3%83%BC%E4%BD%9C%E5%AE%B6%E3%83%BB%E5%B7%9D%E5%B4%8E%E3%81%95%E3%82%93%E3%81%AE%E6%8C%91)。

**スコープ**:
- Tiptap カスタムノード `interview`(および子ノード `turn`)の追加
- 編集画面: 話者登録モーダル・スラッシュメニュー挿入・ターン追加(＋ボタン)・話者切替・並べ替え・削除
- 公開サイト: 左右交互レイアウトのレンダラー
- DB検証トリガー(ノード構造・アバターURLホスト制限)
- 検索インデックス(`post_chunks`)へのターン本文の反映

**スコープ外(今回はやらない — YAGNI)**:
- 5人以上の対談・座談会(2〜4人までを今回スコープ)
- 発言内のブロック(画像・埋め込み)。インライン装飾(太字・リンク等)は許可
- 既存 `profiles` テーブルとの自動リンク(話者が登録済み provider/writer の場合の紐付け)
- 話者ごとの色テーマカスタマイズ
- 発言単位のパーマリンク / 引用リンク

## 前提となるデフォルト判断(合意事項)

ブレスト時のオープン質問への決定。実装フェーズで参照する。

- **話者数**: 1記事につき **2〜4人**(key: `A`, `B`, `C`, `D` の連番)。基本は 2人(1対1インタビュー)、必要なら最大 4人まで拡張して座談会形式に。5人以上は将来課題。
- **アバター**: **新規アップロード** を基本にしつつ、話者が現在のログインユーザー本人の場合は「自分のプロフィール画像を使う」ワンクリック挿入をオプション提供。それ以外の話者(取材相手)は毎回アップロード(取材相手が Wild Media アカウントを持つとは限らないため)。
- **公開サイトのレイアウト**: **話者 A**(先頭に登録された話者=聞き手)は常に **左**。**B / C / D**(話し手側)は常に **右**。3〜4人の座談会は「聞き手1人・話し手複数」の構図で表示され、B/C/D はアバターと名前で識別する(左右位置ではなく)。モバイル(<640px)は全ターン左寄せ。
- **1発言の中身**: テキスト + インラインマーク(bold / italic / strike / link)のみ。ブロックレベル要素(画像・埋め込み等)は入れない。

## アーキテクチャ

| 層 | 変更内容 |
|---|---|
| Tiptap ノード定義 (`packages/blocks-renderer/src/extensions.ts`) | `InterviewNode`(block, 話者attrs保持) と `TurnNode`(interview内でのみ許容, speaker attr保持) を追加し `blockExtensions` に登録 |
| 公開サイト レンダラー (`packages/blocks-renderer/src/render.ts`) | `interview` ノード用の HTML 生成分岐を追加(interview は `renderHTML` を上書きしないので、`generateHTML` の `nodeViews` ではなく、事後 DOM 加工 or Tiptap 側の `renderHTML` にレイアウトを持たせる) |
| 編集画面 UI | スラッシュコマンド追加(`admin/src/pages/articles/edit.astro` / `new.astro`)、話者登録モーダル(新規 `admin/src/lib/interview-dialog.ts`)、Tiptap NodeView(新規 `admin/src/lib/interview-nodeview.ts`)でブロック内 UI(話者カード・ターン行・＋ボタン)を描画 |
| DB検証 | 既存 `body_asset_urls()` を `interview.attrs.speakers[].avatarUrl` も走査するよう拡張。`enforce_body_image_rules` はこれに追随。加えて `enforce_interview_structure` トリガーで構造整合性を検証 |
| メディア連携 | アバター画像は既存 `r2-upload-url` Edge Function + `media` テーブルをそのまま利用(新しい経路は追加しない) |
| 検索インデックス | `chunk-article` Edge Function がターン本文を通常の段落と同様に抽出できるよう、テキスト平坦化ロジックに `interview` → `turn` の辿りを追加 |

## データモデル

### Tiptap ノード スキーマ

2人インタビューの例:

```json
{
  "type": "interview",
  "attrs": {
    "speakers": [
      { "key": "A", "name": "米田 貴明", "role": "聞き手 / Writer", "avatarUrl": "https://…/yoneda.webp" },
      { "key": "B", "name": "川崎 明子", "role": "Kaeru Design 代表", "avatarUrl": "https://…/kawasaki.webp" }
    ]
  },
  "content": [
    { "type": "turn", "attrs": { "speaker": "A" }, "content": [ { "type": "text", "text": "…" } ] },
    { "type": "turn", "attrs": { "speaker": "B" }, "content": [ { "type": "text", "text": "…" } ] }
  ]
}
```

4人座談会の場合は `speakers` を A〜D の 4件に拡張し、`turn.speaker` にも `"C"` `"D"` が使えるようになる。key は必ず A から連番(A / AB / ABC / ABCD のいずれか)で、飛び番は禁止。

### `InterviewNode` 定義

- `group: 'block'`
- `content: 'turn+'`(最低1ターン。0ターンの空 interview は禁止)
- `defining: true`(削除時に子だけ残らない)
- `attrs.speakers`:
  - 型: `Array<{ key: 'A' | 'B' | 'C' | 'D'; name: string; role: string; avatarUrl: string }>`
  - 検証: 長さ 2〜4、`key` は先頭から `'A'` の連番(A / AB / ABC / ABCD のいずれかの並び。飛び番・重複禁止)、`name` は空文字禁止、`role` は空許可、`avatarUrl` はホワイトリスト(下記トリガー参照)
  - `parseHTML` / `renderHTML`: 詳細は「7. HTML表現」

### `TurnNode` 定義

- `group: 'block'` だが `content: 'inline*'` で子はインラインのみ
- `defining: true`
- `attrs.speaker`: `'A' | 'B' | 'C' | 'D'` のいずれか(デフォルト `'A'`)。ただし親 `interview.attrs.speakers` に登録された key に必ず含まれること — 参照整合は DB トリガー(下記)で強制
- **ドキュメントスキーマ制約**: `TurnNode` は `interview` の内部でのみ有効(トップレベルへの drop・pasteは禁止)。ProseMirror のスキーマの `content` 表現でこれを表現できないため、Tiptap の `addProseMirrorPlugins` で「turn がトップレベルに来たら wrap or reject」する plugin を用意する

### 許容インラインマーク(turn内)

`bold`, `italic`, `strike`, `link` の4つ。既存 `StarterKit` と `Link` extension でカバー済み。段落改行は Enter で新しい `turn` を作らず、`turn` 内で `HardBreak`(Shift+Enter)で行内改行のみ許容する ── これは既存の記事エディタの改行ルールに合わせる。

## DBによる強制ルール(必須・トリガー)

CLAUDE.md 冒頭ルール(権限・ビジネスルールはDB層で強制)に従う。

### 拡張1: `body_asset_urls(body jsonb, node_type text)` の探索対象拡大

現状は `body` トップの `content` 配列を再帰探索して指定 `node_type` の `attrs.url` を集めている。これに **`interview` ノード配下の `attrs.speakers[].avatarUrl`** も対象とするよう変更する。目的は既存の2つの用途を同時に満たすため:

1. `enforce_body_image_rules`(画像URLは `settings.image_base_url` 配下のみ)
2. `block_media_in_use` トリガー(参照中の `media` 行を DELETE できない)

**マイグレーション例** (`supabase/migrations/20260726120000_body_asset_urls_interview.sql`):

```sql
CREATE OR REPLACE FUNCTION body_asset_urls(body jsonb, node_type text)
RETURNS SETOF text LANGUAGE sql STABLE AS $$
  -- 既存の再帰CTE(nodes)で全ノード列挙
  WITH RECURSIVE nodes AS (
    SELECT jsonb_array_elements(coalesce(body, '[]'::jsonb)) AS n
    UNION ALL
    SELECT jsonb_array_elements(n->'content')
    FROM nodes
    WHERE jsonb_typeof(n->'content') = 'array'
  )
  -- 従来: 画像・ファイルブロックの url
  SELECT n->'attrs'->>'url'
  FROM nodes
  WHERE n->>'type' = node_type
    AND n->'attrs'->>'url' IS NOT NULL

  UNION ALL

  -- 追加: interview.attrs.speakers[].avatarUrl(node_type = 'image' のときのみ対象)
  SELECT s->>'avatarUrl'
  FROM nodes,
       LATERAL jsonb_array_elements(coalesce(n->'attrs'->'speakers', '[]'::jsonb)) AS s
  WHERE n->>'type' = 'interview'
    AND node_type = 'image'
    AND s->>'avatarUrl' IS NOT NULL;
$$;
```

理由: アバターも画像アセットの一種として扱い、ホスト制限・削除保護の対象にする。

### 拡張2: `enforce_interview_structure` トリガー(新規)

`articles` の BEFORE INSERT / UPDATE で `body` を走査し、`interview` ノードごとに以下を検証:

- `speakers` は配列で長さ 2〜4
- `speakers[*].key` は `'A'` から始まる連番(登録順に `A`, `AB`, `ABC`, `ABCD` のいずれかの並び)。飛び番・重複禁止
- `speakers[*].name` が空でない
- `content` の各 `turn.attrs.speaker` が **その interview の `speakers[*].key` のいずれかに存在** すること(未登録話者への参照は拒否)
- `content` の長さが最低1

違反時は `RAISE EXCEPTION` で拒否。マイグレーション: `20260726120100_enforce_interview_structure.sql`。

### 画像上限との関係

現状 `enforce_body_image_rules` は `image` ブロックを最大5件までに制限している(`MAX_BODY_IMAGES`)。アバター画像はこの上限には **カウントしない**(あくまでコンテンツ画像用の枠)。上記マイグレーションは URL のホスト制限にのみ関与し、件数カウントは既存の `image` ブロック探索のままにする ── そのため既存関数の実装によっては、件数用と URL 用で別クエリに分けるリファクタが必要。

## 編集画面 UI

### スラッシュメニュー挿入

`admin/src/pages/articles/edit.astro` / `new.astro` の `commands: BlockCommand[]` 配列に追加:

```ts
{
  id: 'interview',
  label: 'インタビュー(会話)',
  run: (editor) => openInterviewDialog(editor)  // 話者登録モーダルを開く
}
```

**アイコンとラベル**: 💬 相当のアイコン + `インタビュー(会話)`。既存の画像・埋め込みと同じ視覚レベル。

### 話者登録モーダル (`admin/src/lib/interview-dialog.ts` 新規)

初回挿入時に開く。フィールド:

- 話者A: サムネイル(アップロード/プロフィール画像から選択/削除)・名前(必須)・肩書(任意)
- 話者B: 同上
- **＋話者を追加** ボタン(3人目 C、4人目 D を追加。最大4人まで)
- 話者 C / D は **✕ 削除** ボタンあり(A / B は必須なので削除不可)

「決定」で `insertContent({ type: 'interview', attrs: { speakers: [...] }, content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [] }] })`。**初期状態は空の A ターン1件** を含めた状態で挿入する(空 interview は DB トリガーで弾かれるため)。話者の順番は登録した順に key を A から採番するため、モーダル上で並べ替え不可(削除も末尾から)。

サムネイルアップロードは既存 `uploadAndRecord()` (`admin/src/lib/body-image.ts`)を再利用 ── R2 → `media` 挿入 → URL返却。

### NodeView (`admin/src/lib/interview-nodeview.ts` 新規)

Tiptap の NodeView として `interview` ノードの見た目を描画する。中身:

- **上部**: 話者カード 2〜4枚(サムネ・名前・肩書表示 + クリックで再編集モーダル)。話者の追加/削除もここから
- **中央**: ターン一覧
  - 各 `turn` 行: 話者ミニアバター・話者名(クリックで **話者選択ポップオーバー** を開き、登録された 2〜4人から選ぶ)・本文編集エリア(Tiptap の子エディタとしてバインド)・ドラッグハンドル・削除
- **下部/間**: `＋ 発言を追加` ボタン(hover で行間に出現、末尾は常時表示)。クリックで **話者選択ポップオーバー**(登録された全話者 2〜4人)を開き、選択後に該当話者のターンを空で挿入

**話者切替**: `updateAttributes({ speaker: 'A' | 'B' | 'C' | 'D' })` で属性のみ更新。UI 上、話者数=2 のときは A/B トグルのシンプル UI、3〜4のときは選択メニュー UI に自動で切り替える(操作数を最小化)。

**話者削除時の整合**: 話者カードから C / D を削除しようとすると、その話者に紐づく既存 turn がある場合は確認ダイアログ(「この話者の発言 N件も削除しますか?」)を挟む。削除確定で該当 turn ノードも同時に消す ── これにより DB トリガーの「未登録話者への参照禁止」に抵触しない。

**並べ替え**: SortableJS のようなライブラリを追加せず、Tiptap の drag handle と ProseMirror の transaction で実装(既存プロジェクトに sortable 系ライブラリが入っていないため、依存を増やさない)。ドラッグ範囲は同一 `interview` 内のみに制約する。

### スラッシュコマンド以外での操作

- **ブロックまるごと削除**: 既存の block delete UI(バブルツールバー or backspace)で `interview` ノード全体を削除できる
- **既存ブロックとの共存**: `interview` の前後には通常の paragraph/heading 等を自由に置ける(既存の `document` スキーマの `content: 'block+'` で自動対応)

## 公開サイト レンダラー

`packages/blocks-renderer/src/render.ts` の `generateHTML(doc, blockExtensions)` を実行後、生成HTMLに対して `interview` ノードのレイアウトを反映する。Tiptap の `renderHTML` は静的HTMLしか吐けないので、ノードの `renderHTML` に以下の構造を持たせる:

```html
<section class="interview-block" data-speakers='...'>
  <div class="turn turn--A">
    <img class="turn__avatar" src="…" alt="米田 貴明" />
    <div class="turn__who">
      <div class="turn__name">米田 貴明</div>
      <div class="turn__role">聞き手 / Writer</div>
    </div>
    <div class="turn__body"><p>…</p></div>
  </div>
  <div class="turn turn--B">…</div>
  <div class="turn turn--C">…</div>
  <div class="turn turn--D">…</div>
</section>
```

**CSS**(公開サイト側スタイルに追加):

- `.turn` は grid で `72px 1fr` レイアウト(アバター|本文)
- `.turn--B`, `.turn--C`, `.turn--D` は `1fr 72px` に反転しテキスト右寄せ(話者 A = 聞き手側=左、それ以外=話し手側=右)
- 話者連続時もアバター・名前を毎回表示(参考ページと同挙動)
- モバイル `<640px` は全ターンを左寄せに揃え、アバター 56px

**サニタイズ**: 既存の `sanitize-html` 設定に `<section class="interview-block">` と各サブクラスの許可を追加。

## 検索インデックス (`post_chunks`)

`chunk-article` Edge Function がテキストを平坦化する際、`interview` の各 `turn` の本文を通常のパラグラフと同じく1チャンクの入力にする。**話者名・肩書は含めない**(検索ノイズを避ける ── 記事執筆者名で filter するのは別のクエリ)。

該当ファイル: `supabase/functions/chunk-article/index.ts` のノードトラバース関数(あれば) or `admin/src/lib/search-index.ts` の該当箇所。

## 変更・追加ファイル一覧

**変更**:
- `packages/blocks-renderer/src/extensions.ts` — `InterviewNode`, `TurnNode` 追加
- `packages/blocks-renderer/src/render.ts` — sanitize 許可タグ追加、`dropDisallowedAssets` の対象拡張
- `admin/src/pages/articles/edit.astro` — スラッシュコマンド追加
- `admin/src/pages/articles/new.astro` — 同上
- `admin/src/lib/bubble-toolbar.ts` — (必要なら)ブロック選択時の追加操作
- `supabase/functions/chunk-article/index.ts` — 本文抽出に `interview → turn` 経路を追加
- 公開サイトの記事本文 CSS(`src/styles/article.css` 相当。実ファイル名は探索して確認)
- `admin/src/lib/body-image.ts` の内部関数はそのまま利用

**新規**:
- `admin/src/lib/interview-dialog.ts` — 話者登録モーダル
- `admin/src/lib/interview-nodeview.ts` — Tiptap NodeView
- `supabase/migrations/20260726120000_body_asset_urls_interview.sql`
- `supabase/migrations/20260726120100_enforce_interview_structure.sql`

## テスト計画

- **pgTAP** (`supabase/tests/`):
  - `enforce_interview_structure`:
    - 話者数が 1 または 5 以上 → 拒否
    - `key` が飛び番(例: A + C)や重複、A から始まらない → 拒否
    - `turn.attrs.speaker` が `speakers[*].key` に存在しない値 → 拒否
    - 空 turn(0件)、空 speakers → 拒否
    - 正常系: 2人・3人・4人それぞれの合法パターンが通る
  - `body_asset_urls('image')`: `interview.speakers[*].avatarUrl` が返ってくる(2〜4人分すべて)
  - `enforce_body_image_rules`: 非許可ホストのアバターURLは拒否
  - `block_media_in_use`: interview で参照中の `media` 行は DELETE 不可
- **Vitest** (`admin/test/` 相当):
  - `interview-dialog`: フォーム入力 → 挿入JSONの構造検証
  - NodeView の A/B トグル → `updateAttributes` 呼び出し
  - `＋` ボタン → ターン追加の transaction
- **レンダラー**: `packages/blocks-renderer/` のスナップショットテストに interview サンプル追加
- **手動確認**(`dev:all` で):
  1. スラッシュメニューから挿入 → モーダル → 話者2人登録 → 空ターンがA話者で1件できる
  2. ＋で B のターン追加、テキスト入力、Enter で改行 → 新ターンにならず HardBreak になる
  3. 話者切替(A/B トグル)、話者カード再編集、ドラッグ並べ替え、行削除
  4. **座談会シナリオ**: 話者を C, D まで追加(合計4人) → ＋ボタンが選択メニュー UI に変わる → C/D の発言も混ぜて追加 → 公開プレビューで A のみ左・B/C/D は右、アバター/名前で判別できる
  5. **話者削除の整合**: C を発言つきで削除しようとすると確認ダイアログ、確定で該当 turn も消える。DB 側 `enforce_interview_structure` が通る
  6. 保存 → リロード → 復元
  7. 公開プレビュー: 話者Aは左・それ以外は右のレイアウト、モバイル(<640px)は左寄せ
  8. 話者アバターの `media` を削除 → ブロック中は削除不可、interview を消してから削除可

## 将来課題(YAGNI — 今回はやらない)

- 5人以上の対談・座談会(`speakers` 長さの緩和 + turn.speaker のキー拡張)
- 発言内の画像・埋め込み(turn を block content 許可に変更)
- `profiles` テーブルとの自動リンク(取材相手が provider/writer として登録済みの場合の紐付け)
- 話者ごとの色テーマカスタマイズ
- 発言単位のパーマリンク / 引用リンク
- ターンの一括インポート(音声書き起こし CSV 等からの流し込み)

## 影響のない前提の再確認

- 既存記事の `body` は空 `[]` または非 `interview` ノードのみで、マイグレーションによる不整合は発生しない
- 既存の画像上限(5件)は `interview.speakers[].avatarUrl` に影響しない(件数カウント対象は `image` ブロックのみ)
- `commission_tokens` 機構やモデレーションフラグには関与しない(記事本文ブロックの追加のみ)
