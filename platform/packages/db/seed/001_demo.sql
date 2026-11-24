-- Demo tenant for development and user acceptance testing. Sample data only: never load into production.
-- Mirrors the prototype's personas and scenarios. Loaded in import mode so historical dates are kept.
-- IDs are deterministic (md5 of a key), so links in docs and tests stay stable.
set role veqms_owner;
set app.import_mode = 'on';

create or replace function pg_temp.k(key text) returns uuid language sql immutable as $$ select md5('veqms-seed:' || key)::uuid $$;
create or replace function pg_temp.d(days integer, hh integer default 10) returns timestamptz language sql stable as
$$ select date_trunc('day', now()) + make_interval(days => days, hours => hh) $$;
create or replace function pg_temp.sha(t text) returns text language sql immutable as $$ select encode(digest(t, 'sha256'), 'hex') $$;

do $$ begin perform set_config('app.tenant_id', pg_temp.k('tenant')::text, false); end $$;

insert into app.tenants (id, name) values (pg_temp.k('tenant'), 'VeQMS demo');
insert into app.tenant_directory (entra_tenant_id, tenant_id) values ('dev-tenant', pg_temp.k('tenant'));
insert into app.settings (tenant_id, signing_go_live) values (pg_temp.k('tenant'), pg_temp.d(-120, 9));

-- People (Entra object ids 'dev-<key>' are used by the development sign-in only)
insert into app.users (id, tenant_id, entra_oid, email, name, initials, job_title, site, status, clearance, manager_id, left_on)
select pg_temp.k(u.key), pg_temp.k('tenant'), 'dev-' || u.key, u.email, u.name, u.ini, u.title, u.site, u.status, u.clr, null, u.left_on
from (values
  ('vic', 'victoria@veqms.example', 'Victoria E.', 'VE', 'HR Administrator · Support Owner', 'London', 'active', 'Restricted', null::timestamptz),
  ('sam', 'jim.speir@veqms.example', 'Jim Speir', 'JS', 'IT Operations Lead', 'London', 'active', 'Confidential', null),
  ('priya', 'carrie.foreman@veqms.example', 'Carrie Foreman', 'CF', 'Information Security Analyst', 'London', 'active', 'Restricted', null),
  ('tom', 'pj.walters@veqms.example', 'PJ Walters', 'PW', 'Head of IT', 'London', 'active', 'Restricted', null),
  ('grace', 'louise.harvey@veqms.example', 'Louise Harvey', 'LH', 'Operations Manager', 'Manila', 'active', 'Confidential', null),
  ('daniel', 'daniel.greenwood@veqms.example', 'Daniel Greenwood', 'DG', 'Customer Support Agent', 'Manila', 'active', 'Internal', null),
  ('hannah', 'lucy.parkin@veqms.example', 'Lucy Parkin', 'LP', 'System Administrator', 'London', 'active', 'Confidential', null),
  ('aud', 'fraser.scott@auditors.example', 'Fraser Scott', 'FS', 'External ISMS auditor', 'External', 'active', 'Confidential', null),
  ('omar', 'omar.haddad@veqms.example', 'Omar Haddad', 'OH', 'Network Engineer', 'London', 'active', 'Confidential', null),
  ('mia', 'mia.santos@veqms.example', 'Mia Santos', 'MS', 'HR Coordinator', 'Manila', 'active', 'Confidential', null),
  ('lena', 'lena.novak@veqms.example', 'Lena Novak', 'LN', 'Finance Officer', 'London', 'active', 'Internal', null),
  ('jake', 'jake.turner@veqms.example', 'Jake Turner', 'JT', 'Developer', 'London', 'active', 'Internal', null),
  ('mark', 'mark.davies@veqms.example', 'Mark Davies', 'MD', 'Developer (left)', 'London', 'left', 'Internal', now() - interval '40 days')
) as u(key, email, name, ini, title, site, status, clr, left_on);
update app.users set manager_id = pg_temp.k('tom') where id in (pg_temp.k('sam'), pg_temp.k('hannah'), pg_temp.k('omar'), pg_temp.k('jake'), pg_temp.k('mark'));
update app.users set manager_id = pg_temp.k('vic') where id in (pg_temp.k('priya'), pg_temp.k('grace'), pg_temp.k('lena'));
update app.users set manager_id = pg_temp.k('grace') where id in (pg_temp.k('daniel'), pg_temp.k('mia'));

insert into app.user_roles (tenant_id, user_id, role)
select pg_temp.k('tenant'), pg_temp.k(r.key), r.role from (values
  ('vic', 'qm'), ('vic', 'approver'), ('vic', 'process'), ('sam', 'author'), ('sam', 'reviewer'), ('priya', 'reviewer'), ('priya', 'author'),
  ('tom', 'approver'), ('tom', 'process'), ('grace', 'process'), ('grace', 'reviewer'), ('grace', 'author'), ('daniel', 'employee'),
  ('hannah', 'admin'), ('aud', 'auditor'), ('omar', 'reviewer'), ('omar', 'author'), ('mia', 'employee'), ('mia', 'author'),
  ('lena', 'employee'), ('jake', 'employee'), ('mark', 'employee')
) as r(key, role);

insert into app.groups (id, tenant_id, name, description) values
  (pg_temp.k('g:all'), pg_temp.k('tenant'), 'All staff', 'Everyone with an active account'),
  (pg_temp.k('g:it'), pg_temp.k('tenant'), 'IT team', 'IT operations, security and development'),
  (pg_temp.k('g:mgr'), pg_temp.k('tenant'), 'Managers', 'People managers and process owners'),
  (pg_temp.k('g:support'), pg_temp.k('tenant'), 'Support team', 'Customer support, Manila');
insert into app.group_members (tenant_id, group_id, user_id)
select pg_temp.k('tenant'), pg_temp.k('g:' || m.g), pg_temp.k(m.key) from (values
  ('all', 'vic'), ('all', 'sam'), ('all', 'priya'), ('all', 'tom'), ('all', 'grace'), ('all', 'daniel'), ('all', 'hannah'), ('all', 'omar'), ('all', 'mia'), ('all', 'lena'), ('all', 'jake'),
  ('it', 'sam'), ('it', 'priya'), ('it', 'tom'), ('it', 'hannah'), ('it', 'omar'), ('it', 'jake'),
  ('mgr', 'vic'), ('mgr', 'tom'), ('mgr', 'grace'), ('support', 'grace'), ('support', 'daniel'), ('support', 'mia')
) as m(g, key);

insert into app.templates (tenant_id, code, name, kind, doc_type, version, state, sections) values
  (pg_temp.k('tenant'), 'TPL-POL', 'Policy', 'Document', 'Policy', '1.2', 'Effective', '{"1. Purpose","2. Scope","3. Policy statements","4. Roles and responsibilities","5. Exceptions","6. Review"}'),
  (pg_temp.k('tenant'), 'TPL-SOP', 'Procedure (SOP)', 'Document', 'Procedure', '2.0', 'Effective', '{"1. Purpose","2. Scope","3. Roles","4. Procedure","5. Records","6. Related documents"}'),
  (pg_temp.k('tenant'), 'TPL-VP', 'Validation plan', 'Document', 'Validation plan', '1.0', 'Effective', '{"1. System and scope","2. Approach and risk","3. Deliverables","4. Acceptance criteria","5. Roles"}'),
  (pg_temp.k('tenant'), 'TPL-VEN', 'Vendor approval', 'Document', 'Vendor approval', '1.0', 'Effective', '{"1. Vendor and service","2. Assessment","3. Risks and conditions","4. Decision"}');

-- Documents
insert into app.documents (id, tenant_id, number, doc_type, title, state, classification, owner_id, author_id, process, tags, effective_at, approval_due, training_days, training_quiz) values
  (pg_temp.k('POL-001'), pg_temp.k('tenant'), 'POL-001', 'Policy', 'Information Security Policy', 'Effective', 'Internal', pg_temp.k('vic'), pg_temp.k('vic'), 'ISMS · Governance', '{A.5.1}', pg_temp.d(-160), null, 14, true),
  (pg_temp.k('POL-003'), pg_temp.k('tenant'), 'POL-003', 'Policy', 'Information Classification Policy', 'Review closed', 'Internal', pg_temp.k('vic'), pg_temp.k('vic'), 'ISMS · Information handling', '{A.5.12}', pg_temp.d(-290), null, 14, true),
  (pg_temp.k('POL-004'), pg_temp.k('tenant'), 'POL-004', 'Policy', 'Access Control Policy', 'In approval', 'Internal', pg_temp.k('sam'), pg_temp.k('sam'), 'ISMS · Access control', '{A.5.15,A.8.3}', pg_temp.d(-390), pg_temp.d(-2, 17), 14, true),
  (pg_temp.k('SOP-012'), pg_temp.k('tenant'), 'SOP-012', 'Procedure', 'Backup and Restore Procedure', 'Effective', 'Internal', pg_temp.k('sam'), pg_temp.k('sam'), 'ISMS · Continuity', '{A.8.13}', pg_temp.d(-16), null, 14, true),
  (pg_temp.k('SOP-018'), pg_temp.k('tenant'), 'SOP-018', 'Procedure', 'Patch Management', 'Effective', 'Internal', pg_temp.k('omar'), pg_temp.k('omar'), 'ISMS · Vulnerability mgmt', '{A.8.8}', pg_temp.d(-90), null, 14, false),
  (pg_temp.k('VEN-001'), pg_temp.k('tenant'), 'VEN-001', 'Vendor approval', 'Offsite Backup Storage Provider', 'Effective', 'Confidential', pg_temp.k('tom'), pg_temp.k('grace'), 'ISMS · Supplier management', '{A.5.19}', pg_temp.d(-40), null, 14, false),
  (pg_temp.k('VP-001'), pg_temp.k('tenant'), 'VP-001', 'Validation plan', 'Validation Plan: VeQMS Electronic Quality Management System', 'Review closed', 'Internal', pg_temp.k('vic'), pg_temp.k('priya'), 'ISMS · Governance', '{CSV,"Part 11"}', null, null, 14, false);

create or replace function pg_temp.body(p text) returns jsonb language sql immutable as
$$ select jsonb_build_array(jsonb_build_object('t', 'h', 'x', '1. Purpose'), jsonb_build_object('t', 'p', 'x', p), jsonb_build_object('t', 'h', 'x', '2. Scope'), jsonb_build_object('t', 'p', 'x', 'Applies to all staff, contractors and systems in the ISMS scope.')) $$;

insert into app.document_versions (id, tenant_id, document_id, version, kind, state, summary, content, content_sha256, created_by, created_at, approved_at, migrated_from) values
  (pg_temp.k('POL-001@3.0'), pg_temp.k('tenant'), pg_temp.k('POL-001'), '3.0', 'major', 'Effective', 'Added objectives for 2026.', pg_temp.body('Set direction and support for information security.'), pg_temp.sha('POL-001@3.0'), pg_temp.k('vic'), pg_temp.d(-175), pg_temp.d(-161), 'KSTARRS'),
  (pg_temp.k('POL-003@1.0'), pg_temp.k('tenant'), pg_temp.k('POL-003'), '1.0', 'major', 'Effective', 'First issue.', pg_temp.body('Label information so everyone knows how to handle it.'), pg_temp.sha('POL-003@1.0'), pg_temp.k('vic'), pg_temp.d(-300), pg_temp.d(-290), 'KSTARRS'),
  (pg_temp.k('POL-003@1.1'), pg_temp.k('tenant'), pg_temp.k('POL-003'), '1.1', 'minor', 'Review closed', 'Added handling rules for printing and downloads.', pg_temp.body('Label information; Confidential may not be printed.'), pg_temp.sha('POL-003@1.1'), pg_temp.k('vic'), pg_temp.d(-4), null, null),
  (pg_temp.k('POL-004@1.0'), pg_temp.k('tenant'), pg_temp.k('POL-004'), '1.0', 'major', 'Effective', 'First issue.', pg_temp.body('Grant, review and remove access.'), pg_temp.sha('POL-004@1.0'), pg_temp.k('sam'), pg_temp.d(-400), pg_temp.d(-390), 'KSTARRS'),
  (pg_temp.k('POL-004@2.0'), pg_temp.k('tenant'), pg_temp.k('POL-004'), '2.0', 'major', 'In approval', 'Quarterly access reviews; leavers lose access within 60 minutes.', pg_temp.body('Grant, review and remove access; quarterly reviews.'), pg_temp.sha('POL-004@2.0'), pg_temp.k('sam'), pg_temp.d(-14), null, null),
  (pg_temp.k('SOP-012@2.1'), pg_temp.k('tenant'), pg_temp.k('SOP-012'), '2.1', 'minor', 'Superseded', 'Updated contact list.', pg_temp.body('Restore data after loss.'), pg_temp.sha('SOP-012@2.1'), pg_temp.k('sam'), pg_temp.d(-300), pg_temp.d(-298), 'KSTARRS'),
  (pg_temp.k('SOP-012@3.0'), pg_temp.k('tenant'), pg_temp.k('SOP-012'), '3.0', 'major', 'Effective', 'Point-in-time restore; second region; quarterly tests.', pg_temp.body('Restore data after loss, corruption or ransomware.'), pg_temp.sha('SOP-012@3.0'), pg_temp.k('sam'), pg_temp.d(-30), pg_temp.d(-16), null),
  (pg_temp.k('SOP-018@1.1'), pg_temp.k('tenant'), pg_temp.k('SOP-018'), '1.1', 'minor', 'Effective', 'Patch windows moved to Tuesday evenings.', pg_temp.body('Keep systems patched.'), pg_temp.sha('SOP-018@1.1'), pg_temp.k('omar'), pg_temp.d(-95), pg_temp.d(-90), null),
  (pg_temp.k('VEN-001@1.0'), pg_temp.k('tenant'), pg_temp.k('VEN-001'), '1.0', 'major', 'Effective', 'First approval of the provider.', pg_temp.body('Offsite storage for encrypted backup copies.'), pg_temp.sha('VEN-001@1.0'), pg_temp.k('grace'), pg_temp.d(-50), pg_temp.d(-40), null),
  (pg_temp.k('VP-001@1.0'), pg_temp.k('tenant'), pg_temp.k('VP-001'), '1.0', 'major', 'Review closed', 'First issue.', pg_temp.body('How we validate the eQMS before go-live.'), pg_temp.sha('VP-001@1.0'), pg_temp.k('priya'), pg_temp.d(-12), null, null);

insert into app.document_reviewers (tenant_id, document_id, user_id, status, reviewed_at) values
  (pg_temp.k('tenant'), pg_temp.k('POL-004'), pg_temp.k('priya'), 'Reviewed', pg_temp.d(-11)),
  (pg_temp.k('tenant'), pg_temp.k('POL-004'), pg_temp.k('omar'), 'Reviewed', pg_temp.d(-6, 15)),
  (pg_temp.k('tenant'), pg_temp.k('POL-003'), pg_temp.k('priya'), 'Reviewed', pg_temp.d(-1)),
  (pg_temp.k('tenant'), pg_temp.k('VP-001'), pg_temp.k('omar'), 'Reviewed', pg_temp.d(-2, 16));
insert into app.document_approvers (tenant_id, document_id, user_id, position, status) values
  (pg_temp.k('tenant'), pg_temp.k('POL-004'), pg_temp.k('vic'), 1, 'Your turn'),
  (pg_temp.k('tenant'), pg_temp.k('POL-004'), pg_temp.k('tom'), 2, 'Waiting'),
  (pg_temp.k('tenant'), pg_temp.k('POL-003'), pg_temp.k('vic'), 1, 'Waiting'),   -- Victoria wrote it: sending is blocked (SoD)
  (pg_temp.k('tenant'), pg_temp.k('POL-003'), pg_temp.k('tom'), 2, 'Waiting'),
  (pg_temp.k('tenant'), pg_temp.k('VP-001'), pg_temp.k('vic'), 1, 'Waiting');

-- Audiences
insert into app.audience_groups (tenant_id, document_id, group_id)
select pg_temp.k('tenant'), pg_temp.k(a.doc), pg_temp.k('g:' || a.g) from (values ('POL-001', 'all'), ('POL-003', 'all'), ('POL-004', 'all'), ('SOP-012', 'all'), ('SOP-018', 'it'), ('VP-001', 'it')) as a(doc, g);
insert into app.audience_roles (tenant_id, document_id, role) values (pg_temp.k('tenant'), pg_temp.k('VP-001'), 'qm');

-- Approvals through Adobe Sign: SOP-012 v3.0 and VEN-001 v1.0 completed; POL-004 v2.0 out for signature.
create or replace function pg_temp.env(p_key text, p_doc text, p_ver text, p_subject text, p_status text, p_sent timestamptz, p_done timestamptz, p_by text)
returns void language plpgsql as $$
begin
  insert into app.agreements (id, tenant_id, provider_agreement_id, record_type, record_id, record_number, document_version_id, version, subject, purpose, status, sent_by, sent_at, completed_at,
    verification, pdf_blob, pdf_sha256, signed_pdf_blob, signed_pdf_sha256, audit_report_blob, audit_report_sha256)
  values (pg_temp.k(p_key), pg_temp.k('tenant'), 'demo-' || p_key, 'document', pg_temp.k(p_doc), p_doc, pg_temp.k(p_doc || '@' || p_ver), p_ver, p_subject, 'Document approval', p_status,
    pg_temp.k(p_by), p_sent, p_done,
    jsonb_build_object('footer', true, 'version', true, 'documentId', true, 'dates', true, 'by', pg_temp.k(p_by), 'at', p_sent),
    'agreements/' || p_key || '/original.pdf', pg_temp.sha(p_key || 'pdf'),
    case when p_status = 'completed' then 'agreements/' || p_key || '/signed.pdf' end, case when p_status = 'completed' then pg_temp.sha(p_key || 'signed') end,
    case when p_status = 'completed' then 'agreements/' || p_key || '/audit-report.pdf' end, case when p_status = 'completed' then pg_temp.sha(p_key || 'cert') end);
  insert into app.agreement_directory (provider_agreement_id, tenant_id, agreement_id) values ('demo-' || p_key, pg_temp.k('tenant'), pg_temp.k(p_key));
  insert into app.signing_transactions (tenant_id, allowance_year, transaction_no, agreement_id, sent_at, sent_by) values (pg_temp.k('tenant'), 0, 0, pg_temp.k(p_key), p_sent, pg_temp.k(p_by));
end $$;
select pg_temp.env('env:VEN-001', 'VEN-001', '1.0', 'VEN-001 v1.0 · Offsite Backup Storage Provider · Approval', 'completed', pg_temp.d(-43, 9), pg_temp.d(-40, 10), 'tom');
select pg_temp.env('env:SOP-012', 'SOP-012', '3.0', 'SOP-012 v3.0 · Backup and Restore Procedure · Approval', 'completed', pg_temp.d(-22, 9), pg_temp.d(-16, 11), 'sam');
select pg_temp.env('env:POL-004', 'POL-004', '2.0', 'POL-004 v2.0 · Access Control Policy · Approval', 'sent', pg_temp.d(-6, 15), null, 'sam');

insert into app.agreement_signers (tenant_id, agreement_id, user_id, role_label, meaning, routing_order, signer_email, status, sent_at, signed_at)
select pg_temp.k('tenant'), pg_temp.k(x.env), pg_temp.k(x.u), x.label, x.meaning, x.ord, (select email from app.users where id = pg_temp.k(x.u)), x.st, x.sent, x.signed from (values
  ('env:VEN-001', 'grace', 'Author', 'Authored', 1, 'signed', pg_temp.d(-43, 9), pg_temp.d(-43, 10)),
  ('env:VEN-001', 'sam', 'Reviewer', 'Reviewed', 2, 'signed', pg_temp.d(-43, 10), pg_temp.d(-43, 11)),
  ('env:VEN-001', 'vic', 'QA approver', 'Approved', 3, 'signed', pg_temp.d(-43, 11), pg_temp.d(-40, 10)),
  ('env:SOP-012', 'sam', 'Author', 'Authored', 1, 'signed', pg_temp.d(-22, 9), pg_temp.d(-22, 9)),
  ('env:SOP-012', 'priya', 'Reviewer', 'Reviewed', 2, 'signed', pg_temp.d(-22, 9), pg_temp.d(-22, 10)),
  ('env:SOP-012', 'tom', 'QA approver 1', 'Approved', 3, 'signed', pg_temp.d(-22, 10), pg_temp.d(-17, 16)),
  ('env:SOP-012', 'vic', 'QA approver 2', 'Approved', 4, 'signed', pg_temp.d(-17, 16), pg_temp.d(-16, 11)),
  ('env:POL-004', 'sam', 'Author', 'Authored', 1, 'signed', pg_temp.d(-6, 15), pg_temp.d(-6, 16)),
  ('env:POL-004', 'priya', 'Reviewer', 'Reviewed', 2, 'signed', pg_temp.d(-6, 16), pg_temp.d(-6, 17)),
  ('env:POL-004', 'omar', 'Reviewer', 'Reviewed', 2, 'signed', pg_temp.d(-6, 16), pg_temp.d(-5, 9)),
  ('env:POL-004', 'vic', 'QA approver 1', 'Approved', 3, 'sent', pg_temp.d(-5, 9), null),
  ('env:POL-004', 'tom', 'QA approver 2', 'Approved', 4, 'waiting', null, null)
) as x(env, u, label, meaning, ord, st, sent, signed);

insert into app.agreement_events (tenant_id, agreement_id, at, type, user_id, detail, source)
select pg_temp.k('tenant'), s.agreement_id, coalesce(s.signed_at, s.sent_at), case when s.status = 'signed' then 'signed' else 'sent' end, s.user_id, null, 'webhook'
from app.agreement_signers s where s.sent_at is not null;

update app.document_versions set agreement_id = pg_temp.k('env:SOP-012') where id = pg_temp.k('SOP-012@3.0');
update app.document_versions set agreement_id = pg_temp.k('env:VEN-001') where id = pg_temp.k('VEN-001@1.0');
update app.document_versions set agreement_id = pg_temp.k('env:POL-004') where id = pg_temp.k('POL-004@2.0');

insert into app.signatures (tenant_id, record_type, record_id, record_number, document_version_id, user_id, meaning, signed_at, source, agreement_id, content_sha256, statement)
select pg_temp.k('tenant'), 'document', e.record_id, e.record_number, e.document_version_id, s.user_id, s.meaning, s.signed_at, 'adobe_sign', e.id, e.pdf_sha256,
       'Signed in Adobe Sign (Bio-Pharma settings): identity checked at signing; signature meaning “' || s.meaning || '”.'
from app.agreement_signers s join app.agreements e on e.id = s.agreement_id where e.status = 'completed';
insert into app.signatures (tenant_id, record_type, record_id, record_number, document_version_id, user_id, meaning, signed_at, source, content_sha256, statement)
select pg_temp.k('tenant'), 'document', v.document_id, d.number, v.id, pg_temp.k(case when d.number = 'POL-004' then 'tom' else 'tom' end), 'Approved', v.approved_at, 'kstarrs', v.content_sha256,
       'Migrated from KSTARRS (approved before go-live).'
from app.document_versions v join app.documents d on d.id = v.document_id where v.migrated_from = 'KSTARRS';

-- Training records (read and understood). Historical, so loaded in import mode with their original dates.
do $$
declare
  u record; x record; v_done boolean; v_assigned timestamptz; v_completed timestamptz;
begin
  for x in select * from (values ('POL-001', '3.0', -160), ('POL-003', '1.0', -288), ('POL-004', '1.0', -388), ('SOP-012', '2.1', -298), ('SOP-012', '3.0', -15)) as t(doc, ver, ago) loop
    for u in select us.* from app.users us join app.group_members gm on gm.user_id = us.id and gm.group_id = pg_temp.k('g:all') where us.status = 'active' loop
      v_assigned := pg_temp.d(x.ago);
      v_done := not (x.doc = 'SOP-012' and x.ver = '3.0' and u.initials in ('VE', 'DG', 'JT'));
      v_completed := case when v_done then v_assigned + make_interval(days => 1 + (abs(hashtext(u.id::text || x.doc)) % 9)) end;
      insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, allocated_by, alloc_reason, assigned_at, due_at, completed_at, statement, via)
      select pg_temp.k('tenant'), u.id, d.id, d.number, d.title, x.ver, null, 'New version effective', v_assigned, v_assigned + interval '14 days', v_completed,
             case when v_done then 'I confirm I have read and understood ' || d.number || ', version ' || x.ver end,
             case when v_done then 'Microsoft 365 single sign-on' end
      from app.documents d where d.number = x.doc;
    end loop;
  end loop;
  -- IT team: SOP-018 v1.1 (Jake still open and overdue)
  for u in select us.* from app.users us join app.group_members gm on gm.user_id = us.id and gm.group_id = pg_temp.k('g:it') loop
    insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, assigned_at, due_at, completed_at, statement, via)
    select pg_temp.k('tenant'), u.id, d.id, d.number, d.title, '1.1', 'New version effective', pg_temp.d(-90), pg_temp.d(-76),
           case when u.initials <> 'JT' then pg_temp.d(-84) end, case when u.initials <> 'JT' then 'I confirm I have read and understood SOP-018, version 1.1' end,
           case when u.initials <> 'JT' then 'Microsoft 365 single sign-on' end
    from app.documents d where d.number = 'SOP-018';
  end loop;
  -- The leaver keeps their records
  insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, assigned_at, due_at, completed_at, statement, via)
  select pg_temp.k('tenant'), pg_temp.k('mark'), d.id, d.number, d.title, '2.1', 'New version effective', pg_temp.d(-298), pg_temp.d(-284), pg_temp.d(-290), 'I confirm I have read and understood SOP-012, version 2.1', 'Microsoft 365 single sign-on'
  from app.documents d where d.number = 'SOP-012';
end $$;

-- Tasks for the demo
insert into app.tasks (tenant_id, kind, record_type, record_id, record_number, assignee_id, due_at, note, ref)
values
  (pg_temp.k('tenant'), 'esign', 'document', pg_temp.k('POL-004'), 'POL-004', pg_temp.k('vic'), pg_temp.d(-2, 17), 'QA approver 1 of 2 · author and reviewers have signed', pg_temp.k('env:POL-004')),
  (pg_temp.k('tenant'), 'send-approval', 'document', pg_temp.k('POL-003'), 'POL-003', pg_temp.k('vic'), pg_temp.d(2, 17), 'Verify the PDF, then send one Adobe Sign agreement', null),
  (pg_temp.k('tenant'), 'send-approval', 'document', pg_temp.k('VP-001'), 'VP-001', pg_temp.k('vic'), pg_temp.d(3, 17), 'QA approval of a validation plan', null);
insert into app.tasks (tenant_id, kind, record_type, record_id, record_number, assignee_id, due_at, ref)
select tenant_id, 'training', 'document', document_id, document_number, user_id, due_at, id from app.training_records where completed_at is null;

-- Quality: a deviation that closes through Adobe Sign, and a CAPA in its effectiveness check
insert into app.quality_events (id, tenant_id, number, type, title, description, state, severity, owner_id, process, due_at, assessment, created_at)
values (pg_temp.k('QE-017'), pg_temp.k('tenant'), 'QE-017', 'Deviation', 'Quarterly restore test ran 9 days late', 'The Q3 restore test under SOP-012 ran 9 days late because the test server was being rebuilt.',
        'Assessment', 'Low', pg_temp.k('grace'), 'ISMS · Continuity', pg_temp.d(4, 17), 'One-off delay; the test passed and the schedule stays the same.', pg_temp.d(-6));
insert into app.quality_events (id, tenant_id, number, type, title, description, state, severity, owner_id, process, created_at)
values (pg_temp.k('QE-013'), pg_temp.k('tenant'), 'QE-013', 'Security incident', 'Staff clicked a phishing simulation link', '6 of 22 staff clicked the link in the September simulation.', 'CAPA raised', 'Low', pg_temp.k('priya'), 'ISMS · Awareness', pg_temp.d(-58));
insert into app.capas (id, tenant_id, number, title, source_event_id, severity, state, owner_id, process, problem, actions_locked, effectiveness_criteria, effectiveness_due, created_at)
values (pg_temp.k('CAPA-005'), pg_temp.k('tenant'), 'CAPA-005', 'Phishing simulation follow-up', pg_temp.k('QE-013'), 'Low', 'Effectiveness check', pg_temp.k('priya'), 'ISMS · Awareness',
        '6 of 22 staff clicked the link.', true, 'Next simulation click rate under 10%.', pg_temp.d(17), pg_temp.d(-55));
insert into app.tasks (tenant_id, kind, record_type, record_id, record_number, assignee_id, due_at)
values (pg_temp.k('tenant'), 'effectiveness', 'capa', pg_temp.k('CAPA-005'), 'CAPA-005', pg_temp.k('vic'), pg_temp.d(17)),
       (pg_temp.k('tenant'), 'qe-assess', 'quality_event', pg_temp.k('QE-017'), 'QE-017', pg_temp.k('grace'), pg_temp.d(4));

insert into app.counters (tenant_id, prefix, value) values
  (pg_temp.k('tenant'), 'POL', 10), (pg_temp.k('tenant'), 'SOP', 21), (pg_temp.k('tenant'), 'WI', 4), (pg_temp.k('tenant'), 'VEN', 1), (pg_temp.k('tenant'), 'VP', 1), (pg_temp.k('tenant'), 'VR', 0),
  (pg_temp.k('tenant'), 'QE', 17), (pg_temp.k('tenant'), 'CAPA', 9), (pg_temp.k('tenant'), 'CR', 17), (pg_temp.k('tenant'), 'PR', 37);

select app.audit('seed', 'Tenant', pg_temp.k('tenant')::text, 'Loaded demo data (sample records, import mode)');

reset app.import_mode;
reset role;

-- Knowledge-check questions (SOP-012)
set role veqms_owner;
set app.import_mode = 'on';
select set_config('app.tenant_id', md5('veqms-seed:tenant')::uuid::text, false);
insert into app.quiz_questions (tenant_id, document_id, position, question, options, answer_index) values
  (md5('veqms-seed:tenant')::uuid, md5('veqms-seed:SOP-012')::uuid, 1, 'How often is a restore test run?', '{"Once a year","Every quarter","Only after an incident"}', 1),
  (md5('veqms-seed:tenant')::uuid, md5('veqms-seed:SOP-012')::uuid, 2, 'What is the recovery point objective (RPO)?', '{"1 hour","1 business day","1 week"}', 0),
  (md5('veqms-seed:tenant')::uuid, md5('veqms-seed:SOP-012')::uuid, 3, 'Where are backup copies kept?', '{"Only in the primary region","Encrypted, and copied to a second region","On staff laptops"}', 1);
reset app.import_mode;
reset role;
