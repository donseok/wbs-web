#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# DK Bot pgvector 마이그레이션 적용기.
# service_role 키로는 DDL(CREATE EXTENSION/TABLE/FUNCTION)을 실행할 수 없으므로
# Postgres 연결 문자열이 필요합니다.
#
# 연결 문자열: Supabase 대시보드 → Project Settings → Database →
#   "Connection string" → URI 복사 (비밀번호 포함).
#
# 사용:
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres' \
#     bash scripts/apply-dkbot-migration.sh
#
# (또는 더 간단히: 대시보드 SQL Editor 에 supabase/migrations/0010_dkbot_pgvector.sql 붙여넣기)
# ---------------------------------------------------------------------------
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$HERE/supabase/migrations/0010_dkbot_pgvector.sql"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL 환경변수가 필요합니다 (Supabase 대시보드의 Database Connection string URI)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql 이 필요합니다. macOS: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

echo "▶ 적용: $SQL"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
echo "✓ 완료. 이제 설정 화면의 'AI 색인 재생성' 또는 POST /api/chat/reindex 로 임베딩을 생성하세요."
