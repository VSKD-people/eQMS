-- Database invariants for VeQMS. Run after migrations and the demo seed:
--   psql -v ON_ERROR_STOP=1 -f test/001_invariants.sql
-- Each block raises if a rule is broken. Runs as the API role (veqms_app) wherever the rule concerns the API.
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.k(key text) returns uuid language sql immutable as $$ select md5('veqms-seed:' || key)::uuid $$;
create or replace function pg_temp.expect_error(sql text, pattern text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm !~* pattern then raise exception 'expected error matching "%", got "%" for: %', pattern, sqlerrm, sql; end if;
    return;
  end;
  raise exception 'expected an error matching "%" but the statement succeeded: %', pattern, sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to veqms_app;
grant execute on function pg_temp.k(text) to veqms_app;

-- A second tenant, to prove isolation.
set role veqms_owner;
select set_config('app.tenant_id', pg_temp.k('other-tenant')::text, false);
insert into app.tenants (id, name) values (pg_temp.k('other-tenant'), 'Other tenant');
insert into app.settings (tenant_id) values (pg_temp.k('other-tenant'));
insert into app.users (id, tenant_id, email, name, initials) values (pg_temp.k('other-user'), pg_temp.k('other-tenant'), 'x@other.example', 'Other Person', 'OP');
reset role;

\echo '1. Row-level security: a tenant sees only its own rows, and cannot write into another tenant'
set role veqms_app;
select set_config('app.tenant_id', pg_temp.k('tenant')::text, false), set_config('app.user_id', pg_temp.k('vic')::text, false);
do $$ begin
  assert (select count(*) from app.users where id = pg_temp.k('other-user')) = 0, 'other tenant user visible';
  assert (select count(*) from app.users) = 13, 'own users not visible';
  perform pg_temp.expect_error(format('insert into app.groups (tenant_id, name) values (%L, %L)', pg_temp.k('other-tenant'), 'Sneaky'), 'row-level security');
end $$;
select set_config('app.tenant_id', '', false);
do $$ begin assert (select count(*) from app.users) = 0, 'rows visible with no tenant set'; end $$;
select set_config('app.tenant_id', pg_temp.k('tenant')::text, false);

\echo '2. The API role can never delete, and cannot touch DDL or the tenant directory'
do $$ begin
  perform pg_temp.expect_error('delete from app.tasks', 'permission denied');
  perform pg_temp.expect_error('delete from app.training_records', 'permission denied');
  perform pg_temp.expect_error('truncate app.audit_log', 'permission denied');
  perform pg_temp.expect_error('create table app.x (id int)', 'permission denied');
  perform pg_temp.expect_error($q$insert into app.tenant_directory values ('t', gen_random_uuid())$q$, 'permission denied');
end $$;

\echo '3. Audit trail: append-only, contiguous, hash-chained; tampering is detected'
do $$
declare n0 bigint; r record;
begin
  select count(*) into n0 from app.audit_log;
  perform app.audit('test', 'Test', 'T-1', 'First test entry', null, '{"a":1}');
  perform app.audit('test', 'Test', 'T-1', 'Second test entry');
  assert (select count(*) from app.audit_log) = n0 + 2, 'audit rows not added';
  select * into r from app.verify_audit_chain(); assert r.ok, 'chain should verify';
  assert (select max(seq) from app.audit_log) = n0 + 2, 'sequence not contiguous';
  perform pg_temp.expect_error('update app.audit_log set summary = ''x''', 'permission denied|insert-only');
  -- A forged sequence number or hash is overwritten by the database, so the chain stays intact.
  insert into app.audit_log (tenant_id, actor_label, action, object_type, object_id, summary, prev_hash, hash, seq) values (app.current_tenant(), 'x', 'x', 'x', 'x', 'forged entry', 'forged', 'forged', 1);
  assert (select hash <> 'forged' and seq = n0 + 3 from app.audit_log where summary = 'forged entry'), 'forged values were kept';
  select * into r from app.verify_audit_chain(); assert r.ok, 'chain should still verify';
end $$;
reset role;
-- A superuser bypassing the trigger to edit history is caught by the verifier.
alter table app.audit_log disable trigger audit_no_update;
update app.audit_log set summary = 'tampered' where tenant_id = pg_temp.k('tenant') and seq = 5;
alter table app.audit_log enable trigger audit_no_update;
set role veqms_app;
do $$ declare r record; begin
  select * into r from app.verify_audit_chain();
  assert not r.ok and r.broken_at = 5, format('tamper not detected: %s', row_to_json(r));
end $$;
reset role;

\echo '4. Training records: system dates, trainee-only confirmation, locked once completed, never deleted'
set role veqms_app;
select set_config('app.user_id', pg_temp.k('vic')::text, false);
do $$
declare rec uuid; v_assigned timestamptz; v_completed timestamptz; c uuid;
begin
  -- A typed date is ignored: the system sets assigned_at.
  insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, assigned_at, due_at, completed_at, statement)
  select app.current_tenant(), pg_temp.k('lena'), id, number, title, '1.1', 'Group change', '2000-01-01', now() + interval '14 days', '2000-01-02', 'forged'
  from app.documents where number = 'SOP-018' returning id, assigned_at, completed_at into rec, v_assigned, v_completed;
  assert v_assigned > now() - interval '1 minute', 'assigned_at should be system time';
  assert v_completed is null, 'a new allocation cannot arrive completed';

  -- Victoria cannot confirm Lena's record.
  perform pg_temp.expect_error(format($q$update app.training_records set completed_at = now(), statement = 'x' where id = %L$q$, rec), 'only .* can confirm');
  -- Allocation details cannot change.
  perform pg_temp.expect_error(format($q$update app.training_records set due_at = now() + interval '90 days' where id = %L$q$, rec), 'allocation details cannot change');

  -- Lena confirms her own record; the time is the system's, not the one supplied.
  perform set_config('app.user_id', pg_temp.k('lena')::text, false);
  update app.training_records set completed_at = '1999-12-31', statement = 'I confirm I have read and understood SOP-018, version 1.1', via = 'Microsoft 365 single sign-on' where id = rec;
  assert (select completed_at from app.training_records where id = rec) > now() - interval '1 minute', 'completed_at should be system time';

  -- Locked once completed: nobody can change it.
  perform pg_temp.expect_error(format($q$update app.training_records set statement = 'changed' where id = %L$q$, rec), 'completed and locked');
  perform pg_temp.expect_error(format($q$update app.training_records set closed_at = now(), closed_reason = 'x' where id = %L$q$, rec), 'completed and locked');

  -- The audit trail has the allocation and the completion, with old and new values.
  assert (select count(*) from app.audit_log where object_id = rec::text and action in ('training.allocate', 'training.complete')) = 2, 'record changes not audited';
  assert (select before->>'completedAt' from app.audit_log where object_id = rec::text and action = 'training.complete') is null, 'old value missing';
  assert (select after->>'completedAt' from app.audit_log where object_id = rec::text and action = 'training.complete') is not null, 'new value missing';

  -- A correction is a new record with a reason; the original stays as it was.
  perform set_config('app.user_id', pg_temp.k('vic')::text, false);
  perform pg_temp.expect_error(format($q$insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, correction_of) select tenant_id, user_id, document_id, document_number, title, version, 'Correction', id from app.training_records where id = %L$q$, rec), 'check constraint');
  insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, allocated_by, alloc_reason, due_at, correction_of, correction_reason)
  select tenant_id, user_id, document_id, document_number, title, version, pg_temp.k('vic'), 'Correction', now() + interval '14 days', id, 'Confirmed during a demo, not a real read'
  from app.training_records where id = rec returning id into c;
  assert (select completed_at from app.training_records where id = rec) is not null, 'original must stay completed';
  assert exists (select 1 from app.audit_log where object_id = c::text and action = 'training.correct'), 'correction not audited';

  -- Only one live allocation per person, document and version.
  perform pg_temp.expect_error(format($q$insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason) select tenant_id, user_id, document_id, document_number, title, version, 'Duplicate' from app.training_records where id = %L$q$, rec), 'duplicate key');

  -- Closing an open allocation needs a reason and locks it.
  update app.training_records set closed_at = now(), closed_reason = 'Superseded by v1.2' where id = c;
  perform pg_temp.expect_error(format($q$update app.training_records set closed_reason = 'other' where id = %L$q$, c), 'closed and locked');
end $$;
reset role;
do $$ begin perform pg_temp.expect_error('delete from app.training_records', 'cannot be deleted'); end $$; -- even the owner/superuser path is refused by the trigger
set role veqms_app;

\echo '5. Import mode is not available to the API role'
do $$
declare v timestamptz;
begin
  perform set_config('app.import_mode', 'on', false);
  insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, assigned_at)
  select app.current_tenant(), pg_temp.k('jake'), id, number, title, '1.0', 'Import attempt', '2001-01-01' from app.documents where number = 'VEN-001' returning assigned_at into v;
  assert v > now() - interval '1 minute', 'API role must not be able to backdate records';
  perform set_config('app.import_mode', '', false);
end $$;

\echo '6. DocuSign envelopes: verification check required, one open per record, fixed once sent, terminal states locked'
do $$
declare e uuid; vid uuid;
begin
  select id into vid from app.document_versions where document_id = pg_temp.k('POL-003') and version = '1.1';
  perform pg_temp.expect_error(format($q$insert into app.envelopes (tenant_id, record_type, record_id, record_number, document_version_id, version, subject, purpose, sent_by, verification, pdf_blob, pdf_sha256)
    values (app.current_tenant(), 'document', %L, 'POL-003', %L, '1.1', 's', 'Document approval', %L, '{"footer":true,"version":true,"documentId":true,"dates":false}', 'b', 'h')$q$, pg_temp.k('POL-003'), vid, pg_temp.k('vic')), 'check constraint');
  perform pg_temp.expect_error(format($q$insert into app.envelopes (tenant_id, record_type, record_id, record_number, version, subject, purpose, sent_by, verification, pdf_blob, pdf_sha256)
    values (app.current_tenant(), 'document', %L, 'POL-004', '2.0', 's', 'Document approval', %L, '{"footer":true,"version":true,"documentId":true,"dates":true}', 'b', 'h')$q$, pg_temp.k('POL-004'), pg_temp.k('sam')), 'one_open_envelope_per_record|duplicate key');
  insert into app.envelopes (tenant_id, record_type, record_id, record_number, document_version_id, version, subject, purpose, sent_by, verification, pdf_blob, pdf_sha256)
  values (app.current_tenant(), 'document', pg_temp.k('POL-003'), 'POL-003', vid, '1.1', 'POL-003 v1.1 · Approval', 'Document approval', pg_temp.k('vic'), '{"footer":true,"version":true,"documentId":true,"dates":true}', 'envelopes/x/original.pdf', 'abc') returning id into e;
  perform pg_temp.expect_error(format($q$update app.envelopes set subject = 'changed' where id = %L$q$, e), 'fixed once sent');
  perform pg_temp.expect_error(format($q$update app.envelopes set status = 'completed' where id = %L$q$, e), 'must store the signed PDF');
  perform pg_temp.expect_error(format($q$update app.envelopes set status = 'voided' where id = %L$q$, e), 'needs a reason');
  update app.envelopes set status = 'voided', voided_by = pg_temp.k('vic'), void_reason = 'Footer showed the wrong version' where id = e;
  perform pg_temp.expect_error(format($q$update app.envelopes set void_reason = 'other' where id = %L$q$, e), 'voided and cannot change');
  perform pg_temp.expect_error(format($q$insert into app.envelope_events (tenant_id, envelope_id, type) values (app.current_tenant(), %L, 'x'); update app.envelope_events set detail = 'x'$q$, e), 'permission denied|insert-only');
end $$;

\echo '7. DocuSign sends: numbered per allowance year, insert-only, refused beyond the allowance'
do $$
declare e uuid; n integer; used integer;
begin
  select count(*) into used from app.docusign_sends where allowance_year = app.allowance_year(now(), 1);
  select id into e from app.envelopes where record_number = 'POL-003' and status = 'voided';
  insert into app.docusign_sends (tenant_id, allowance_year, send_no, envelope_id, sent_by) values (app.current_tenant(), 1900, 999, e, pg_temp.k('vic')) returning send_no into n;
  assert n = used + 1, format('send number should be %s, got %s', used + 1, n);
  assert (select allowance_year from app.docusign_sends where envelope_id = e) = app.allowance_year(now(), 1), 'allowance year not set by the database';
  perform pg_temp.expect_error(format($q$update app.docusign_sends set send_no = 1 where envelope_id = %L$q$, e), 'permission denied|insert-only');
end $$;
reset role;
update app.settings set docusign_allowance = (select count(*) from app.docusign_sends where tenant_id = pg_temp.k('tenant') and allowance_year = app.allowance_year(now(), 1)) where tenant_id = pg_temp.k('tenant');
set role veqms_app;
select set_config('app.tenant_id', pg_temp.k('tenant')::text, false);
do $$
declare e uuid; vid uuid;
begin
  select id into vid from app.document_versions where document_id = pg_temp.k('VP-001');
  insert into app.envelopes (tenant_id, record_type, record_id, record_number, document_version_id, version, subject, purpose, sent_by, verification, pdf_blob, pdf_sha256)
  values (app.current_tenant(), 'document', pg_temp.k('VP-001'), 'VP-001', vid, '1.0', 'VP-001 v1.0 · Approval', 'Document approval', pg_temp.k('vic'), '{"footer":true,"version":true,"documentId":true,"dates":true}', 'b', 'h') returning id into e;
  perform pg_temp.expect_error(format($q$insert into app.docusign_sends (tenant_id, allowance_year, send_no, envelope_id, sent_by) values (app.current_tenant(), 0, 0, %L, %L)$q$, e, pg_temp.k('vic')), 'allowance of .* is used up');
end $$;
reset role;
update app.settings set docusign_allowance = 500 where tenant_id = pg_temp.k('tenant');
set role veqms_app;
select set_config('app.tenant_id', pg_temp.k('tenant')::text, false);

\echo '8. Document versions: content locked after draft; approved versions only move to Superseded or Obsolete'
do $$ begin
  perform pg_temp.expect_error(format($q$update app.document_versions set content = '[]' where id = %L$q$, (select id from app.document_versions where document_id = pg_temp.k('SOP-012') and version = '3.0')), 'is locked');
  perform pg_temp.expect_error(format($q$update app.document_versions set state = 'Draft' where id = %L$q$, (select id from app.document_versions where document_id = pg_temp.k('SOP-012') and version = '3.0')), 'can only become');
  perform pg_temp.expect_error(format($q$update app.document_versions set state = 'Effective' where id = %L$q$, (select id from app.document_versions where document_id = pg_temp.k('SOP-012') and version = '2.1')), 'cannot change state');
end $$;

\echo '9. Signatures are insert-only; record numbers are gap-free'
do $$ begin
  perform pg_temp.expect_error('update app.signatures set meaning = ''Reviewed''', 'permission denied|insert-only');
  assert app.next_number('WI') = 'WI-005' and app.next_number('WI') = 'WI-006', 'numbering not sequential';
end $$;

\echo '10. Audit chain still verifies after all the tests (except the deliberate tamper, entry 5)'
do $$ declare r record; begin select * into r from app.verify_audit_chain(); assert r.broken_at = 5, 'unexpected chain state'; end $$;
reset role;
\echo 'All database invariants hold.'
