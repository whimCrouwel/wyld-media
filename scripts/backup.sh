#!/usr/bin/env bash
# 本番(Supabase DB + R2 画像)のバックアップを backups/ に取る。
# 使い方・戻し方 → docs/RECOVERY.md
# 接続情報は scripts/backup.env(gitignore 済み。雛形は backup.env.example)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f scripts/backup.env ]]; then
  echo "❌ scripts/backup.env がない。scripts/backup.env.example をコピーして値を入れること。" >&2
  exit 1
fi
source scripts/backup.env

STAMP=$(date +%Y-%m-%d)
DB_DIR="backups/db/$STAMP"
mkdir -p "$DB_DIR"

echo "==> [1/3] DB ダンプ → $DB_DIR"
supabase db dump --db-url "$DB_URL" -f "$DB_DIR/schema.sql"
supabase db dump --db-url "$DB_URL" --data-only --use-copy -s auth,public -f "$DB_DIR/data.sql"

echo "==> [2/3] R2 画像を同期 → backups/r2/"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
rclone sync "r2:$R2_BUCKET" backups/r2/

echo "==> [3/3] 古い DB ダンプを削除(最新4世代を残す)"
ls -dt backups/db/*/ | tail -n +5 | while read -r d; do
  echo "    rm $d"
  rm -rf "$d"
done

echo "✅ 完了: $DB_DIR と backups/r2/"
