-- Change control, quality events, CAPA, observations, periodic reviews, links and automation.
-- The schema is complete now; Phase 1 builds API and screens for CAPA and deviation closure through Adobe Sign,
-- and later phases build the rest (see BUILD_PROMPT.md).
set role veqms_owner;

create table app.change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,
  title text not null,
  size text not null check (size in ('Major', 'Minor')),
  state text not null default 'Planning' check (state in ('Planning', 'Review', 'Approval', 'In execution', 'Effectiveness check', 'Closed')),
  classification text not null default 'Internal',
  owner_id uuid not null references app.users(id),
  process text not null,
  description text not null default '',
  reason text not null default '',
  impact text not null default '',
  effectiveness_criteria text not null default '',
  effectiveness_result text,
  effectiveness_verdict text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, number)
);
create table app.cr_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  change_request_id uuid not null references app.change_requests(id),
  title text not null,
  assignee_id uuid not null references app.users(id),
  due_at timestamptz,
  needs_signature boolean not null default true,
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Done')),
  done_at timestamptz
);

create table app.observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,
  title text not null,
  details text not null default '',
  area text not null,
  raised_by uuid not null references app.users(id),
  owner_id uuid not null references app.users(id),
  state text not null default 'New' check (state in ('New', 'Escalated', 'Closed')),
  closure_justification text,
  escalated_to uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create table app.quality_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,
  type text not null check (type in ('Nonconformance', 'Deviation', 'Complaint', 'Audit finding', 'Security incident')),
  title text not null,
  description text not null default '',
  state text not null default 'Open' check (state in ('Open', 'Assessment', 'CAPA raised', 'Closed')),
  severity text not null check (severity in ('Low', 'High')),
  classification text not null default 'Internal',
  owner_id uuid not null references app.users(id),
  process text not null,
  due_at timestamptz,
  assessment text not null default '',
  closure_justification text,              -- deviations: approved through Adobe Sign
  closure_agreement_id uuid references app.agreements(id),
  closure_signature_id uuid,                -- other types: in-app signature
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, number)
);

create table app.capas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,
  title text not null,
  source_event_id uuid references app.quality_events(id),
  severity text not null check (severity in ('Low', 'High')),
  classification text not null default 'Internal',
  state text not null default 'Planning' check (state in ('Planning', 'Execution', 'Effectiveness check', 'Closed')),
  owner_id uuid not null references app.users(id),
  process text not null,
  problem text not null default '',
  whys text[] not null default '{"","","","",""}',
  root_why integer,
  fishbone jsonb not null default '{}',
  risk jsonb not null default '{}',
  actions_locked boolean not null default false,
  effectiveness_criteria text not null default '',
  effectiveness_due timestamptz,
  effectiveness_result text,               -- recorded before the closure agreement is sent
  effectiveness_verdict text check (effectiveness_verdict in ('Effective', 'Not effective')),
  effectiveness_by uuid references app.users(id),
  effectiveness_at timestamptz,
  closure_agreement_id uuid references app.agreements(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, number)
);
create table app.capa_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  capa_id uuid not null references app.capas(id),
  type text not null check (type in ('Corrective', 'Preventive')),
  title text not null,
  assignee_id uuid not null references app.users(id),
  due_at timestamptz,
  linked_document_id uuid references app.documents(id),
  needs_signature boolean not null default true,
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Done')),
  done_at timestamptz
);
create table app.evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  record_type text not null,
  record_id uuid not null,
  file_name text not null,
  blob text not null,
  pdf_blob text,
  sha256 text not null,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'failed')),
  uploaded_by uuid not null references app.users(id),
  uploaded_at timestamptz not null default now()
);

create table app.periodic_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  number text not null,
  document_id uuid not null references app.documents(id),
  reviewer_id uuid not null references app.users(id),
  due_at timestamptz not null,
  notice_days integer not null default 60,
  approval_required boolean not null default true,
  state text not null default 'Open' check (state in ('Open', 'Completed')),
  outcome text check (outcome in ('No update needed', 'Needs update')),
  follow_up text,
  completed_at timestamptz,
  signature_id uuid,
  unique (tenant_id, number)
);

-- Links between any two records, visible from both ends.
create table app.record_links (
  tenant_id uuid not null references app.tenants(id),
  a_type text not null, a_id uuid not null,
  b_type text not null, b_id uuid not null,
  created_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  primary key (a_id, b_id),
  check (a_id <> b_id)
);

create table app.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  code text not null,
  name text not null,
  event text not null,
  conditions text not null,
  actions text[] not null,
  channels text[] not null,
  status text not null default 'Pending approval' check (status in ('Pending approval', 'Active', 'Off')),
  version integer not null default 1,
  approved_by uuid references app.users(id),
  approved_at timestamptz,
  unique (tenant_id, code, version)
);
create table app.automation_runs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id),
  rule_code text not null,
  at timestamptz not null default now(),
  record_type text,
  record_id uuid,
  result text not null,
  detail text not null
);
create trigger automation_runs_insert_only before update or delete on app.automation_runs for each row execute function app.forbid_change();

create table app.dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  job text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  last_error text,
  status text not null default 'failed' check (status in ('failed', 'retried', 'resolved')),
  created_at timestamptz not null default now()
);

reset role;
