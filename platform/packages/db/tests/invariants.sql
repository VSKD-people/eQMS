-- Database invariant tests. Run as a superuser by scripts/db-test.sh; each check switches to veqms_app.
-- Every compliance rule has a refusal test. Any failure raises and stops the run (ON_ERROR_STOP).
\set QUIET on
create schema test_util;
grant usage on schema test_util to veqms_app;

create function test_util.refuses(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'FAIL expected refusal like "%", got "%" for: %', p_like, sqlerrm, p_sql;
    end if;
    raise notice 'PASS refused (%): %', p_like, left(p_sql, 90);
    return;
  end;
  raise exception 'FAIL expected refusal like "%", but it succeeded: %', p_like, p_sql;
end $$;

create function test_util.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create function test_util.as_user(p_tenant uuid, p_user uuid) returns void language sql as $$
  select set_config('app.tenant_id', coalesce(p_tenant::text, ''), false),
         set_config('app.user_id', coalesce(p_user::text, ''), false);
$$;

-- ---------- Fixtures (superuser; RLS does not apply) ----------
insert into tenant (id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'Tenant A'),
  ('b0000000-0000-0000-0000-000000000001', 'Tenant B');
insert into app_user (id, tenant_id, email, display_name) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'author@a.example', 'Author A'),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'approver@a.example', 'Approver A'),
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'trainee@a.example', 'Trainee A'),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'user@b.example', 'User B');
insert into record (id, tenant_id, type, number, title, state) values
  ('a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-000000000001', 'Document', 'SOP-001', 'Test SOP', 'Draft'),
  ('b0000000-0000-0000-0000-00000000d001', 'b0000000-0000-0000-0000-000000000001', 'Document', 'SOP-001', 'Other tenant SOP', 'Draft');
insert into document_version (id, tenant_id, record_id, major, minor, author_id, content_sha256, change_summary) values
  ('a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001',
   0, 1, 'a0000000-0000-0000-0000-0000000000a1', repeat('a', 64), 'First issue');
insert into docusign_settings (tenant_id, allowance, year_start_month) values ('a0000000-0000-0000-0000-000000000001', 500, 4);

set role veqms_app;

-- ---------- Tenant isolation ----------
select test_util.as_user(null, null);
select test_util.ok((select count(*) from app_user) = 0, 'no tenant set: no rows visible');
select test_util.refuses($$insert into audit_log_entry (action, object_type, object_id) values ('x', 'y', 'z')$$, '%needs app.tenant_id%');

select test_util.as_user('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1');
select test_util.ok((select count(*) from app_user) = 3, 'tenant A sees only its 3 users');
select test_util.ok((select count(*) from record where number = 'SOP-001') = 1, 'tenant A sees only its own SOP-001');
select test_util.refuses($$insert into record (tenant_id, type, number, title, state) values ('b0000000-0000-0000-0000-000000000001', 'Document', 'X-1', 'x', 'Draft')$$, '%row-level security%');
with u as (update record set title = 'hijack' where id = 'b0000000-0000-0000-0000-00000000d001' returning 1)
  select test_util.ok(count(*) = 0, 'tenant A cannot update a tenant B record (0 rows matched)') from u;
select test_util.ok((select count(*) from tenant) = 1, 'tenant A sees only its own tenant row');

-- ---------- Users are never deleted ----------
select test_util.refuses($$delete from app_user where id = 'a0000000-0000-0000-0000-0000000000a3'$$, 'permission denied%');

-- ---------- Audit log ----------
insert into audit_log_entry (action, object_type, object_id, after_json) values ('record.create', 'record', 'SOP-001', '{"state":"Draft"}');
insert into audit_log_entry (action, object_type, object_id, before_json, after_json) values ('record.update', 'record', 'SOP-001', '{"title":"a"}', '{"title":"b"}');
select test_util.ok((select max(seq) from audit_log_entry) = 2, 'audit seq assigned by the database');
select test_util.ok((select prev_hash from audit_log_entry where seq = 2) = (select hash from audit_log_entry where seq = 1), 'audit entries are chained');
insert into audit_log_entry (tenant_id, action, object_type, object_id) values ('b0000000-0000-0000-0000-000000000001', 'x', 'y', 'forced-tenant');
select test_util.ok((select tenant_id = 'a0000000-0000-0000-0000-000000000001' and seq = 3 from audit_log_entry where object_id = 'forced-tenant'),
  'caller cannot write into another tenant chain (tenant taken from the session)');
select test_util.refuses($$update audit_log_entry set action = 'forged' where seq = 1$$, 'permission denied%');
select test_util.refuses($$delete from audit_log_entry where seq = 1$$, 'permission denied%');
select test_util.refuses($$truncate audit_log_entry$$, 'permission denied%');
select test_util.ok((select ok from verify_audit_chain()), 'audit chain verifies');

-- ---------- Document versions ----------
select test_util.refuses($$insert into document_version (tenant_id, record_id, major, minor, author_id, change_summary) values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 0, 2, 'a0000000-0000-0000-0000-0000000000a1', '  ')$$, '%change_summary%');
select test_util.refuses($$update document_version set status = 'Approved' where id = 'a0000000-0000-0000-0000-00000000e001'$$, '%needs approved_at%');
select test_util.refuses($$delete from document_version where id = 'a0000000-0000-0000-0000-00000000e001'$$, 'permission denied%');

-- ---------- Effective needs an approval signature ----------
update document_version set status = 'Approved', approved_at = now() where id = 'a0000000-0000-0000-0000-00000000e001';
select test_util.refuses($$update record set state = 'Effective' where id = 'a0000000-0000-0000-0000-00000000d001'$$, '%without an approval signature%');
select test_util.refuses($$update document_version set content_sha256 = repeat('b', 64) where id = 'a0000000-0000-0000-0000-00000000e001'$$, '%approved and cannot be changed%');
select test_util.refuses($$update document_version set change_summary = 'rewritten' where id = 'a0000000-0000-0000-0000-00000000e001'$$, '%approved and cannot be changed%');
select test_util.refuses($$update document_version set status = 'Draft' where id = 'a0000000-0000-0000-0000-00000000e001'$$, '%cannot return to Draft%');

-- ---------- Signatures ----------
select test_util.refuses($$insert into signature (record_id, record_version_id, signer_id, meaning, statement_text, content_sha256, intent_at, auth_time, acrs)
  values ('a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-0000000000a2', 'Approved', 'I approve this version', repeat('a', 64), now(), now() - interval '1 minute', 'c1')$$, '%signature_check%');
select test_util.refuses($$insert into signature (record_id, record_version_id, signer_id, meaning, statement_text, content_sha256, intent_at, auth_time, acrs)
  values ('a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-0000000000a1', 'Approved', 'I approve this version', repeat('a', 64), now(), now() + interval '1 second', 'c1')$$, '%segregation of duties%');
select test_util.refuses($$insert into signature (record_id, record_version_id, signer_id, meaning, statement_text, content_sha256, intent_at, auth_time, acrs)
  values ('a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-0000000000a2', 'Approved', 'I approve this version', repeat('c', 64), now(), now() + interval '1 second', 'c1')$$, '%does not match the version content%');
insert into signature (id, record_id, record_version_id, signer_id, meaning, statement_text, content_sha256, intent_at, auth_time, acrs)
  values ('a0000000-0000-0000-0000-00000000f001', 'a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-0000000000a2',
          'Approved', 'I approve this version', repeat('a', 64), now(), now() + interval '1 second', 'c1');
select test_util.ok(true, 'a fresh, independent approval signature is accepted');
select test_util.refuses($$update signature set meaning = 'Reviewed' where id = 'a0000000-0000-0000-0000-00000000f001'$$, 'permission denied%');
select test_util.refuses($$delete from signature where id = 'a0000000-0000-0000-0000-00000000f001'$$, 'permission denied%');
update record set state = 'Effective' where id = 'a0000000-0000-0000-0000-00000000d001';
select test_util.ok((select state from record where id = 'a0000000-0000-0000-0000-00000000d001') = 'Effective', 'document becomes Effective once signed');

-- ---------- Records: soft delete only, never under legal hold ----------
select test_util.refuses($$delete from record where id = 'a0000000-0000-0000-0000-00000000d001'$$, 'permission denied%');
update record set legal_hold = true where id = 'a0000000-0000-0000-0000-00000000d001';
select test_util.refuses($$update record set deleted_at = now() where id = 'a0000000-0000-0000-0000-00000000d001'$$, '%legal hold%');

-- ---------- Training records ----------
insert into training_assignment (id, record_id, record_version_id, user_id, due_at, tenant_id)
  values ('a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001',
          'a0000000-0000-0000-0000-0000000000a3', now() + interval '14 days', 'a0000000-0000-0000-0000-000000000001');
-- The approver tries to confirm on the trainee's behalf.
select test_util.as_user('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2');
select test_util.refuses($$insert into training_record (assignment_id, user_id) values ('a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-0000000000a3')$$, '%only the trainee%');
select test_util.as_user('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a3');
insert into training_record (id, assignment_id, user_id, completed_at)
  values ('a0000000-0000-0000-0000-00000000c101', 'a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-0000000000a3', '2001-01-01');
select test_util.ok((select completed_at > now() - interval '1 minute' from training_record where id = 'a0000000-0000-0000-0000-00000000c101'), 'completion date set by the system, not the caller');
select test_util.refuses($$update training_record set quiz_score = 100 where id = 'a0000000-0000-0000-0000-00000000c101'$$, 'permission denied%');
select test_util.refuses($$delete from training_record where id = 'a0000000-0000-0000-0000-00000000c101'$$, 'permission denied%');
select test_util.as_user('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2');
select test_util.refuses($$insert into training_record (assignment_id, user_id, corrects_id) values ('a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-00000000c101')$$, '%training_record_check%');
insert into training_record (assignment_id, user_id, corrects_id, correction_reason)
  values ('a0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-00000000c101', 'Recorded against the wrong version');
select test_util.ok((select count(*) from training_record) = 2, 'a correction is a new record; the original stays');

-- ---------- DocuSign ----------
insert into docusign_envelope (id, tenant_id, record_id, record_version_id, status)
  values ('a0000000-0000-0000-0000-0000000e0001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'Sent');
select test_util.refuses($$insert into docusign_envelope (tenant_id, record_id, record_version_id, status) values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-00000000e001', 'Created')$$, '%docusign_one_live_envelope%');
insert into docusign_send (envelope_row_id) values ('a0000000-0000-0000-0000-0000000e0001');
select test_util.ok((select used = 1 and remaining = 499 from docusign_allowance_use), 'a send is counted against the allowance');
select test_util.refuses($$insert into docusign_send (envelope_row_id) values ('a0000000-0000-0000-0000-0000000e0001')$$, '%duplicate key%');
select test_util.refuses($$delete from docusign_send$$, 'permission denied%');
select test_util.refuses($$update docusign_envelope set status = 'Completed', completed_at = now() where id = 'a0000000-0000-0000-0000-0000000e0001'$$, '%docusign_envelope_check%');
select test_util.ok(allowance_year('2026-02-10', 4) = 2025 and allowance_year('2026-04-01', 4) = 2026 and allowance_year('2026-12-31', 1) = 2026, 'allowance year boundaries');

-- ---------- Second layer: triggers refuse even a role that holds every grant ----------
reset role;
select test_util.as_user('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2');
select test_util.refuses($$update audit_log_entry set action = 'forged' where seq = 1$$, '%is not allowed%');
select test_util.refuses($$delete from audit_log_entry$$, '%is not allowed%');
select test_util.refuses($$truncate audit_log_entry$$, '%is not allowed%');
select test_util.refuses($$update signature set meaning = 'Reviewed'$$, '%is not allowed%');
select test_util.refuses($$delete from signature$$, '%is not allowed%');
select test_util.refuses($$update training_record set quiz_score = 100$$, '%is not allowed%');
select test_util.refuses($$delete from docusign_send$$, '%is not allowed%');
select test_util.refuses($$delete from app_user$$, '%is not allowed%');
select test_util.refuses($$delete from record$$, '%is not allowed%');
select test_util.refuses($$delete from document_version$$, '%is not allowed%');

-- ---------- Every tenant table has forced row-level security ----------
select test_util.ok(not exists (
  select 1 from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and not (c.relrowsecurity and c.relforcerowsecurity)
), 'every table with tenant_id has row-level security enabled and forced');

-- ---------- Tamper detection (rolled back) ----------
begin;
set local session_replication_role = replica;  -- superuser only: bypasses the triggers, as a rogue admin could
update audit_log_entry set action = 'forged' where tenant_id = 'a0000000-0000-0000-0000-000000000001' and seq = 1;
select test_util.ok((select not ok and first_bad_seq = 1 from verify_audit_chain('a0000000-0000-0000-0000-000000000001')), 'tampered audit entry is detected');
rollback;
select test_util.ok((select ok from verify_audit_chain('a0000000-0000-0000-0000-000000000001')), 'audit chain verifies after the tests');

drop schema test_util cascade;
\echo 'invariants: all passed'
