#!/usr/bin/env bash
# ローカル PostgreSQL のデータベースを作り直し、Supabase の土台の再現とマイグレーションを適用する。
#   LOCAL_DB=reserveflow ./scripts/dev/reset-local-db.sh
set -euo pipefail
DB="${LOCAL_DB:-reserveflow}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
HOST="${PGHOST:-localhost}"
USER_NAME="${PGUSER:-postgres}"
psql -h "$HOST" -U "$USER_NAME" -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"
DATABASE_URL="postgres://${USER_NAME}:${PGPASSWORD}@${HOST}:5432/${DB}" DATABASE_URL_UNPOOLED="" npx tsx scripts/db/migrate.ts --local
echo "migrated: ${DB}"
