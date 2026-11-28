-- Controlled documents, versions, training audiences, and approvals through Adobe Sign (Part 11 support through its Bio-Pharma settings).
set role veqms_owner;

create table app.templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  code text not null,
  name text not null,
  kind text not null,
  doc_type text,
  version text not null,
  state text not null check (state in ('Draft', 'Effective', 'Obsolete')),
  sections text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table app.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,                    -- POL-004
  doc_type text not null,
  title text not null,
  state text not null default 'Draft' check (state in ('Draft', 'In review', 'In approval', 'Signing', 'Effective', 'Superseded', 'Obsolete')),
  classification text not null default 'Internal' check (classification in ('Public', 'Internal', 'Confidential', 'Restricted')),
  owner_id uuid not null references app.users(id),
  author_id uuid not null references app.users(id),
  process text not null,
  template_id uuid references app.templates(id),
  tags text[] not null default '{}',
  periodic_months integer not null default 12,
  review_due timestamptz,
  approval_due timestamptz,
  checked_out_by uuid references app.users(id),
  checked_out_at timestamptz,
  effective_at timestamptz,
  obsolete_reason text,
  training_days integer not null default 14 check (training_days > 0),
  training_quiz boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create trigger documents_touch before update on app.documents for each row execute function app.touch_updated_at();

create table app.document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  version text not null,
  kind text not null check (kind in ('major', 'minor')),
  state text not null default 'Draft' check (state in ('Draft', 'In review', 'In approval', 'Signing', 'Effective', 'Superseded', 'Obsolete')),
  summary text not null default '',
  content jsonb not null default '[]',     -- [{t:'h'|'p', x:'text'}]; real files live in blob storage
  source_blob text,                        -- uploaded DOCX/PDF, converted to PDF on our server
  content_sha256 text not null,            -- once submitted: the SHA-256 of the locked PDF (pdf_blob)
  pdf_blob text,                           -- the PDF locked at submit: reviewed, approved, signed and published as is
  verification jsonb,                      -- the four checks ticked at submit {footer, version, documentId, dates, note, by, at}
  retrain boolean not null default true,   -- decided at approval: does the change need retraining?
  retrain_reason text,                     -- required when no retraining is needed
  created_by uuid not null references app.users(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  agreement_id uuid,                        -- the completed approval agreement
  migrated_from text,                      -- e.g. 'KSTARRS' for approvals made before go-live
  unique (document_id, version),
  check (retrain or coalesce(retrain_reason, '') <> ''),
  check (verification is null or ((verification->>'footer')::boolean and (verification->>'version')::boolean and (verification->>'documentId')::boolean and (verification->>'dates')::boolean))
);
-- Content is editable only while the version is a draft. Approved versions only move to Superseded or Obsolete.
create or replace function app.version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'document versions cannot be deleted' using errcode = 'P0001'; end if;
  if (new.content is distinct from old.content or new.content_sha256 is distinct from old.content_sha256 or new.version is distinct from old.version
      or new.pdf_blob is distinct from old.pdf_blob or new.verification is distinct from old.verification)
     and old.state <> 'Draft' then
    raise exception 'version % of document % is locked (state %): start a new version to change it', old.version, old.document_id, old.state using errcode = 'P0001';
  end if;
  if old.state in ('Signing', 'Effective', 'Superseded', 'Obsolete') and (new.retrain is distinct from old.retrain or new.retrain_reason is distinct from old.retrain_reason) then
    raise exception 'the retraining decision for version % is fixed once it is out for signing', old.version using errcode = 'P0001';
  end if;
  if old.state in ('Superseded', 'Obsolete') and new.state is distinct from old.state then
    raise exception 'a % version cannot change state', old.state using errcode = 'P0001';
  end if;
  if old.state = 'Effective' and new.state not in ('Effective', 'Superseded', 'Obsolete') then
    raise exception 'an effective version can only become Superseded or Obsolete' using errcode = 'P0001';
  end if;
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception 'approval time is set once' using errcode = 'P0001';
  end if;
  if old.agreement_id is not null and old.approved_at is not null and new.agreement_id is distinct from old.agreement_id then
    raise exception 'the approval agreement of an approved version cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger document_versions_guard before update or delete on app.document_versions for each row execute function app.version_guard();

create table app.document_reviewers (
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  user_id uuid not null references app.users(id),
  status text not null default 'Not started' check (status in ('Not started', 'Pending', 'Reviewed')),
  reviewed_at timestamptz,
  comment text,
  primary key (document_id, user_id)
);
create table app.document_approvers (
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  user_id uuid not null references app.users(id),
  position integer not null check (position in (1, 2)),
  status text not null default 'Waiting' check (status in ('Waiting', 'To approve', 'Approved', 'Signed')),
  decided_at timestamptz,                  -- approved in VeQMS (before signing in Adobe Sign)
  retrain boolean,                         -- this approver's retraining decision
  retrain_reason text,
  comment text,
  signed_at timestamptz,
  primary key (document_id, user_id),
  unique (document_id, position)
);
create table app.document_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  version_id uuid references app.document_versions(id),
  user_id uuid not null references app.users(id),
  block_index integer,
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Who must train on each document: groups (incl. All staff), roles, named people.
create table app.audience_groups (
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  group_id uuid not null references app.groups(id),
  primary key (document_id, group_id)
);
create table app.audience_roles (
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  role text not null,
  primary key (document_id, role)
);
create table app.audience_users (
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  user_id uuid not null references app.users(id),
  primary key (document_id, user_id)
);

-- ---------- Adobe Sign agreements (one per sign-off; every signer in order) ----------
create table app.agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  provider text not null default 'adobe' check (provider in ('adobe')), -- the e-signature service; Adobe Acrobat Sign
  provider_agreement_id text unique,          -- the agreement ID the provider returns when it accepts the agreement
  record_type text not null check (record_type in ('document', 'capa', 'quality_event')),
  record_id uuid not null,
  record_number text not null,
  document_version_id uuid references app.document_versions(id),
  version text,
  subject text not null,
  purpose text not null,
  status text not null default 'sent' check (status in ('sent', 'completed', 'declined', 'cancelled')),
  sent_by uuid not null references app.users(id),
  sent_at timestamptz not null default now(),
  completed_at timestamptz,
  declined_by uuid references app.users(id),
  decline_reason text,
  cancelled_by uuid references app.users(id),
  cancel_reason text,
  correction_of uuid references app.agreements(id),
  verification jsonb not null,               -- {footer, version, documentId, dates, note, by, at}
  pdf_blob text not null,
  pdf_sha256 text not null,
  signed_pdf_blob text,
  signed_pdf_sha256 text,
  audit_report_blob text,
  audit_report_sha256 text,
  check (verification ? 'footer' and verification ? 'version' and verification ? 'documentId' and verification ? 'dates'),
  check ((verification->>'footer')::boolean and (verification->>'version')::boolean and (verification->>'documentId')::boolean and (verification->>'dates')::boolean)
);
create unique index one_open_agreement_per_record on app.agreements (record_id) where status = 'sent';
create or replace function app.agreement_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'agreements cannot be deleted' using errcode = 'P0001'; end if;
  if old.status in ('completed', 'declined', 'cancelled') then
    raise exception 'agreement % is % and cannot change', old.id, old.status using errcode = 'P0001';
  end if;
  if new.record_id <> old.record_id or new.subject <> old.subject or new.pdf_sha256 <> old.pdf_sha256 or new.verification <> old.verification
     or new.sent_by <> old.sent_by or new.sent_at <> old.sent_at then
    raise exception 'agreement % contents are fixed once sent', old.id using errcode = 'P0001';
  end if;
  if new.status = 'completed' and (new.signed_pdf_sha256 is null or new.audit_report_sha256 is null) then
    raise exception 'a completed agreement must store the signed PDF and the Adobe Sign audit report' using errcode = 'P0001';
  end if;
  if new.status = 'declined' and coalesce(new.decline_reason, '') = '' then raise exception 'a declined agreement needs a reason' using errcode = 'P0001'; end if;
  if new.status = 'cancelled' and coalesce(new.cancel_reason, '') = '' then raise exception 'a voided agreement needs a reason' using errcode = 'P0001'; end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end $$;
create trigger agreements_guard before update or delete on app.agreements for each row execute function app.agreement_guard();

-- Webhooks arrive without a signed-in user: this directory maps an Adobe Sign agreement ID to its tenant.
create table app.agreement_directory (
  provider_agreement_id text primary key,
  tenant_id uuid not null references app.tenants(id),
  agreement_id uuid not null references app.agreements(id)
);

create table app.agreement_signers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  agreement_id uuid not null references app.agreements(id),
  user_id uuid not null references app.users(id),
  role_label text not null,
  meaning text not null check (meaning in ('Authored', 'Reviewed', 'Approved')),
  routing_order integer not null check (routing_order > 0),
  signer_email text not null,                 -- the address the agreement went to: how Adobe Sign's participants are matched
  status text not null default 'waiting' check (status in ('waiting', 'sent', 'signed', 'declined', 'cancelled')),
  sent_at timestamptz,
  signed_at timestamptz,
  unique (agreement_id, user_id)
);
create table app.agreement_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id),
  agreement_id uuid not null references app.agreements(id),
  at timestamptz not null default now(),
  type text not null,                         -- sent, signed, completed, declined, cancelled, status-check, webhook
  user_id uuid references app.users(id),
  detail text,
  source text not null default 'app' check (source in ('app', 'webhook', 'poll')),
  payload_sha256 text                         -- hash of the raw webhook notification, for evidence
);
create trigger agreement_events_insert_only before update or delete on app.agreement_events for each row execute function app.forbid_change();

-- Every Adobe Sign transaction (one agreement sent), numbered within its allowance year. The database refuses a
-- transaction beyond the yearly allowance.
create table app.signing_transactions (
  tenant_id uuid not null references app.tenants(id),
  allowance_year integer not null,
  transaction_no integer not null,
  agreement_id uuid not null unique references app.agreements(id),
  sent_at timestamptz not null default now(),
  sent_by uuid not null references app.users(id),
  primary key (tenant_id, allowance_year, transaction_no)
);
create or replace function app.allowance_year(p_at timestamptz, p_start_month integer) returns integer language sql immutable as $$
  select case when extract(month from p_at at time zone 'UTC')::int >= p_start_month
              then extract(year from p_at at time zone 'UTC')::int else extract(year from p_at at time zone 'UTC')::int - 1 end
$$;
create or replace function app.signing_transaction_before_insert() returns trigger language plpgsql as $$
declare s app.settings; used integer;
begin
  select * into s from app.settings where tenant_id = new.tenant_id;
  if not found then raise exception 'no settings for tenant %', new.tenant_id using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transactions:' || new.tenant_id::text, 0));
  if not (app.import_mode() and new.sent_at is not null) then new.sent_at := now(); end if;
  new.allowance_year := app.allowance_year(new.sent_at, s.allowance_year_start_month);
  select count(*) into used from app.signing_transactions where tenant_id = new.tenant_id and allowance_year = new.allowance_year;
  if used >= s.signing_allowance then
    raise exception 'The Adobe Sign allowance of % transactions for % is used up', s.signing_allowance, new.allowance_year using errcode = 'P0002';
  end if;
  new.transaction_no := used + 1;
  return new;
end $$;
create trigger signing_transactions_number before insert on app.signing_transactions for each row execute function app.signing_transaction_before_insert();
create trigger signing_transactions_insert_only before update or delete on app.signing_transactions for each row execute function app.forbid_change();

reset role;
