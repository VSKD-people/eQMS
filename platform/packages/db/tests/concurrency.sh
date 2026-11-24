#!/usr/bin/env bash
# Concurrent saves must queue on the per-tenant lock and leave one unbroken chain (Step 1 audit-integrity test).
set -euo pipefail
DB="${1:?database}"; T='a0000000-0000-0000-0000-000000000001'; N=8; EACH=25
for i in $(seq 1 $N); do
  (for j in $(seq 1 $EACH); do
     echo "begin; set local role veqms_app; select set_config('app.tenant_id', '$T', true);
           insert into audit_log_entry (action, object_type, object_id) values ('concurrency', 'test', '$i-$j'); commit;"
   done | psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null) &
done
wait
read -r ok n bad < <(psql -X -tA -F ' ' -d "$DB" -c "select ok, entries, coalesce(first_bad_seq, 0) from verify_audit_chain('$T')")
expected=$(( N * EACH ))
c=$(psql -X -tA -d "$DB" -c "select count(*) from audit_log_entry where action = 'concurrency'")
if [ "$ok" = "t" ] && [ "$c" = "$expected" ]; then echo "PASS concurrent saves: $c entries from $N sessions, one unbroken chain of $n"; else echo "FAIL concurrency: ok=$ok count=$c first_bad=$bad"; exit 1; fi
