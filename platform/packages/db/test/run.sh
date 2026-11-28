#!/usr/bin/env bash
# Runs the database invariant tests against a scratch database.
# Needs psql and a PostgreSQL 16 server you can create databases on. Uses PGHOST/PGPORT/PGUSER/PGPASSWORD.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-veqms_invariants}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null; done
for f in seed/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null; done
psql -v ON_ERROR_STOP=1 -q -At -d "$DB" -f test/001_invariants.sql | grep -E '^[0-9]+\.|All database invariants hold'
psql -q -d postgres -c "drop database if exists $DB"
