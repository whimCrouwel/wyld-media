# Wild Media v2.0

環境系ライターの記事プラットフォーム。

- 全体像・信頼境界・主要ルール → [ARCHITECTURE.md](ARCHITECTURE.md)
- 本番の仕組み(Vercel + Supabase + R2 がどう繋がってるか)→ [docs/PRODUCTION.md](docs/PRODUCTION.md)
- 本番ドメインを変えるとき → [docs/DOMAIN-CHANGE.md](docs/DOMAIN-CHANGE.md)(Vercel だけでは足りない — Supabase Auth / R2 CORS / CMS_URL secret も要更新)
- バックアップと復旧(「バックアップを実行して」と言われたら `./scripts/backup.sh`)→ [docs/RECOVERY.md](docs/RECOVERY.md)

## 絶対に守ること

- **並列開発中かもしれない。** 別のターミナルのエージェントが同時にこのリポジトリで作業していることがある。作業開始前に必ず [docs/PARALLEL-DEV.md](docs/PARALLEL-DEV.md) を読み、`AGENTS-ACTIVE.local.md`(宣言板)を確認して自分の作業ブロックを宣言すること。特に git 操作(`add -A`・ブランチ切替・`stash`・`reset --hard` の禁止)と `supabase db reset` の禁止は厳守。
- **権限・ビジネスルールは DB 層(RLS・トリガー)で強制する。** CMS はブラウザから anon key で Supabase に直結しており、クライアント側のチェックはUX目的でしかない。新ルールはまずマイグレーション+pgTAP テストで書く。
- **service role key を `admin/` に入れない。** 公開サイトのビルド時(`src/lib/supabase-server.ts`)専用。
- ホスティングは **Vercel**(Cloudflare Pages ではない)。画像ストレージは Cloudflare R2。
- **本番の機密値(DB パスワード・API キー等)は `PRODUCTION-SECRETS.local.md` に置く。** リポルートの gitignore 済みファイル(`*.local.md` パターン)。理想は 1Password 等のパスワードマネージャで、そのファイルは deploy 作業中の一時参照用。

## コマンド

初回セットアップ:

```bash
supabase start && supabase db reset   # ローカルDB
supabase test db                      # DB層テスト(pgTAP)
npm test                              # データ層テスト(Vitest)
cd admin && npm test                  # CMS ロジックの単体テスト
```

開発を始めるたびに(Supabase は起動しっぱなしにしておくもの。停止するなら `supabase stop`):

```bash
supabase start                        # 既に起動していれば状態表示のみ
npm run dev:all                       # 公開サイト(:4321)+ CMS(:4322)+ Edge Functions を1コマンドで
```

`dev:all` は公開サイト・CMS・`functions serve`(招待・画像URL発行・検索)を `concurrently` でまとめて起動する(`site`/`admin`/`fn` と色分け表示、`Ctrl+C` で全部停止)。Edge Function は `config.toml` で `[edge_runtime] enabled = false`(ローカル起動安定化のため意図的)なので `supabase start` では配信されない。**画像アップロード等が失敗するときは、まず `fn` が動いているか(=`dev:all` を使っているか)を疑う。**

個別に起動したいとき:

```bash
npm run dev                           # 公開サイトのみ(:4321、ライブリロード)
npm run dev -w admin                  # CMS のみ(:4322)
npm run dev:fn                        # Edge Functions のみ(= supabase functions serve --env-file supabase/functions/.env)
```

その他:

```bash
npm run build && npm run preview      # 公開サイトの静的ビルドをそのまま確認(:4321)
```

## 環境変数(Edge Functions)

`supabase/functions/.env`(ローカル)・本番のFunction Secretsに `OPENAI_API_KEY` が必要
(ハイブリッド検索のembedding生成用)。

シードログイン(`npm run seed` 実行後、全アカウント共通パスワード `seed-pass-1234`):
admin は `admin@seed.local`、ライターは `hana@seed.local` / `kenta@seed.local`、サービスプロバイダーは `forest@seed.local`。

`npm run seed` は記事投入後に Edge Function `chunk-article` を呼んで検索インデックス(`post_chunks`)を構築する(CMS が記事保存時に呼ぶのと同じコードパス)。そのため **`npm run seed` の前に Edge Functions(`npm run dev:fn` または `npm run dev:all`)を起動しておくこと**。起動していない・`OPENAI_API_KEY` 未設定の場合はその旨のエラーで失敗する(サイレントに検索が壊れたままにはならない)。

## 作業中の課題管理

本題と関係ない、または今すぐ対応しなくていいバグ・改善点に気づいても都度直さず、[docs/TODO.md](docs/TODO.md) に追記して本題を続けること。一段落したらまとめて対応し、解消したらチェックを付ける。追記する際は該当ファイルパス(可能なら行番号も)を明記する。

## ドキュメントの保守

コード変更でここに書かれた内容が変わるときは、同じ変更の中でドキュメントも更新すること:

- アーキテクチャ・信頼境界・主要ルールの変更 → [ARCHITECTURE.md](ARCHITECTURE.md)
- セットアップ手順・コマンドの変更 → [README.md](README.md) とこのファイル
- デプロイ手順の変更 → [docs/superpowers/DEPLOYMENT-CHECKLIST.md](docs/superpowers/DEPLOYMENT-CHECKLIST.md)
- テーブル追加・カラム変更・外部キー変更などスキーマの変更 → [docs/DATABASE.md](docs/DATABASE.md)(ER図)

`docs/superpowers/specs/`・`docs/superpowers/plans/` は過去の意思決定・作業の記録なので書き換えない(現状と食い違っていても歴史として残す)。
