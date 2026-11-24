#!/usr/bin/env bash
# Applies migrations/*.sql in order, once each, as the connecting (owner) user. Usage: migrate.sh <database> [psql args]
set -euo pipefail
DB="${1:?database name}"; shift || true
HERE="$(cd "$(dirname "$0")" && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q "$@" -d "$DB")
"${PSQL[@]}" -c "create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())"
for f in "$HERE"/../migrations/*.sql; do
  n="$(basename "$f")"
  if [ "$("${PSQL[@]}" -tA -c "select count(*) from schema_migration where name = '$n'")" = "0" ]; then
    echo "applying $n"
    "${PSQL[@]}" --single-transaction -f "$f" -c "insert into schema_migration (name) values ('$n')"
  fi
done
