#!/usr/bin/env bash
# Creates a throwaway database, applies the migrations and runs the invariant tests. Needs a superuser connection.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="${VEQMS_TEST_DB:-veqms_test}"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/roles.sql"
"$HERE/migrate.sh" "$DB"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/../tests/invariants.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /FAIL\|ERROR\|all passed/p'
"$HERE/../tests/concurrency.sh" "$DB"
