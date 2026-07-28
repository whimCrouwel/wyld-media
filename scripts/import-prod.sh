#!/bin/bash
# 本番(wyld-media)へのWP記事インポート用ラッパー。
# パスワードだけ環境変数 WP_IMPORT_WRITER_PASSWORD で渡す:
#   WP_IMPORT_WRITER_PASSWORD='...' bash scripts/import-prod.sh          # DRY RUN(確認のみ)
#   DRY_RUN=0 WP_IMPORT_WRITER_PASSWORD='...' bash scripts/import-prod.sh # 本番投入
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${WP_IMPORT_WRITER_PASSWORD:-}" ]; then
  echo "WP_IMPORT_WRITER_PASSWORD を指定してください" >&2
  exit 1
fi

export DRY_RUN="${DRY_RUN:-1}"
export WP_IMPORT_WRITER_EMAIL="whimonvim@gmail.com"
export WP_IMPORT_WRITER_PASSWORD
export PUBLIC_SUPABASE_URL="https://cikudhtkeybzknhwkhlo.supabase.co"
export PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpa3VkaHRrZXliemtuaHdraGxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODA3NjksImV4cCI6MjEwMDQ1Njc2OX0.QPFqo5fX_E6Zmp2jJVx8bg0Nk6xfNSSxJhgkgIlOaCY"

node scripts/import-wp-articles.mjs
