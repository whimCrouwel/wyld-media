# バックアップと復旧

本番のデータを手元に取り、壊れたときに戻すための手順。方針は「シンプルに、週1回、1コマンド」。

## 何をバックアップしているか

| 対象 | 中身 | 方法 |
|---|---|---|
| コード・スキーマ | migrations / RLS / トリガー / アプリ | **git で済んでいる**(何もしない) |
| Supabase DB | 記事・ユーザー(auth 含む)・設定 | `scripts/backup.sh` が SQL ダンプを取る |
| R2 画像 | カバー画像・本文画像 | 同スクリプトが rclone で同期 |

保存先はリポ内の `backups/`(gitignore 済み)。このリポは Dropbox 内にあるので、取った瞬間にオフサイトコピーにもなる。

```
backups/
├── db/2026-07-28/schema.sql, data.sql   ← 日付ごと、最新4世代を自動保持
└── r2/                                   ← R2 バケットの鏡(常に最新に上書き)
```

## バックアップの取り方(週1回、月曜の朝など)

```bash
./scripts/backup.sh
```

前提(初回のみ): `brew install rclone` と、`scripts/backup.env.example` をコピーして `scripts/backup.env` を作る(値は `PRODUCTION-SECRETS.local.md`)。Docker Desktop が起動していること(`supabase db dump` が使う)。

## 戻し方

**大原則: DB と画像は同じ日付のセットで戻す。** DB だけ古い状態に戻すと画像参照がズレる。

### DB が壊れた・消した

1. まず Supabase Dashboard → Database → Backups の自動日次バックアップからの復元を検討(一番簡単)。
2. 手元のダンプから戻す場合(プロジェクトを作り直すレベルの全損時):
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # migrations でスキーマを再現
   # データを流し込む(psql 未インストールでも Docker で可)
   docker run --rm -i postgres:17 psql "<DB_URL>" < backups/db/<日付>/data.sql
   ```
   `<DB_URL>` は `scripts/backup.env` のもの。復元後、Edge Function secrets と Vercel 環境変数の再設定は `docs/superpowers/DEPLOYMENT-CHECKLIST.md` を参照。

### R2 の画像が消えた

バックアップ時と逆方向に同期するだけ:

```bash
source scripts/backup.env
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
       RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" \
       RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
       RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
rclone sync backups/r2/ "r2:$R2_BUCKET"
```

## Claude / 自動で実行するには

- **Claude に頼む(一番簡単)**: Claude Code に「バックアップを実行して」と言えば `./scripts/backup.sh` を走らせてくれる。開発セッションのついでに週1で頼めば十分。
- **完全自動(cron)**: Mac で毎週月曜 9 時に実行するなら `crontab -e` に1行:
  ```
  0 9 * * 1 cd /Users/labomba/Dropbox/ai-workspace/wc/softwares/wild-media-v2.0 && ./scripts/backup.sh >> backups/backup.log 2>&1
  ```
  注意: Mac がスリープ中は動かない。確実にしたければ Claude Code のスケジュール実行(`/schedule`)ではなく cron を使う — クラウドのルーティンはこの Mac のファイルに触れないため、ローカルバックアップには使えない。

## 未使用画像の掃除(自動)

記事の削除・カバー画像の差し替え・本文からの画像削除は R2 のオブジェクトを消さないため、未参照の画像が溜まっていく。この掃除は**クラウド側で全自動**になっている(このMacが寝ていても動く):

- **毎週月曜 9:00 JST** に pg_cron が Edge Function `cleanup-orphaned-media` を起動し、どこからも参照されていない `media` 行と R2 オブジェクトを削除する
- 「参照」= 記事のカバー・本文の画像/ファイル・インタビュー話者アバター・プロフィールのアバター/カバー/サービス画像(判定は DB 関数 `delete_orphaned_media`、pgTAP テスト `19_orphaned_media_cleanup.test.sql`)
- アップロードから **7日未満**の画像は対象外(編集中の下書きを誤検知しない)
- 本番セットアップ(Function デプロイ + Vault シークレット2件)→ [superpowers/DEPLOYMENT-CHECKLIST.md](superpowers/DEPLOYMENT-CHECKLIST.md) の Edge Functions 節

今すぐ手動で走らせたいとき(SQL Editor / `supabase db query` で):

```sql
select public.invoke_cleanup_orphaned_media();
```

結果は Supabase Dashboard → Edge Functions → cleanup-orphaned-media のログで確認(`deleted N media rows`)。誤削除に気づいたら: 掃除で消えた画像も、その時点の `backups/r2/` には残っている(次回 backup.sh 実行で鏡が上書きされるまで)。上の「R2 の画像が消えた」の手順で戻せる。

## 復旧リハーサル(任意、余裕があるとき)

年に1〜2回、`supabase start` したローカル環境に `data.sql` を流してみて、CMS でログイン・記事表示ができることを確認しておくと、本番障害時に手順で詰まらない。
