-- Tenants, people, roles, groups, settings, numbering, audit trail, signatures, tasks and notifications.
set role veqms_owner;

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
-- Looked up before a tenant is known (sign-in), so it has no tenant policy. Holds no personal data.
create table app.tenant_directory (
  entra_tenant_id text primary key,
  tenant_id uuid not null references app.tenants(id)
);

create table app.users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  entra_oid text,                       -- Entra ID object id (oid claim); null until first sign-in or SCIM
  scim_external_id text,
  email text not null,
  name text not null,
  initials text not null,
  job_title text,
  site text,
  manager_id uuid references app.users(id),
  status text not null default 'active' check (status in ('active', 'revoked', 'left')),
  clearance text not null default 'Internal' check (clearance in ('Public', 'Internal', 'Confidential', 'Restricted')),
  started_on timestamptz not null default now(),
  left_on timestamptz,
  sessions_revoked_at timestamptz,      -- tokens issued before this are refused (revoke-now)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entra_oid),
  unique (tenant_id, email)
);
create trigger users_touch before update on app.users for each row execute function app.touch_updated_at();

create table app.user_roles (
  tenant_id uuid not null references app.tenants(id),
  user_id uuid not null references app.users(id),
  role text not null check (role in ('admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor')),
  granted_by uuid references app.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
-- Privileged role requests need a second admin (two-person rule).
create table app.role_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  user_id uuid not null references app.users(id),
  role text not null,
  requested_by uuid not null references app.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references app.users(id),
  decided_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  check (decided_by is null or decided_by <> requested_by)
);

create table app.groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  name text not null,
  description text,
  entra_group_id text,
  unique (tenant_id, name)
);
create table app.group_members (
  tenant_id uuid not null references app.tenants(id),
  group_id uuid not null references app.groups(id),
  user_id uuid not null references app.users(id),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table app.settings (
  tenant_id uuid primary key references app.tenants(id),
  signing_allowance integer not null default 500 check (signing_allowance > 0),
  allowance_year_start_month integer not null default 1 check (allowance_year_start_month between 1 and 12),
  allowance_warn_at integer not null default 50 check (allowance_warn_at >= 0),
  signing_go_live timestamptz,            -- approvals before this are marked as migrated from KSTARRS
  ack_statement text not null default 'I confirm I have read and understood {doc}, version {version}'
    check (position('{doc}' in ack_statement) > 0 and position('{version}' in ack_statement) > 0),
  reminder_days integer[] not null default '{3,1}',
  overdue_repeat_days integer not null default 2,
  signature_statement text not null default 'I sign this record with the meaning “{meaning}”. I understand this electronic signature is the legally binding equivalent of my handwritten signature.',
  updated_at timestamptz not null default now()
);
create trigger settings_touch before update on app.settings for each row execute function app.touch_updated_at();

-- Record numbering (POL-004, CAPA-009 …) per tenant and prefix, gap-free under concurrency.
create table app.counters (
  tenant_id uuid not null references app.tenants(id),
  prefix text not null,
  value integer not null default 0,
  primary key (tenant_id, prefix)
);
create or replace function app.next_number(p_prefix text) returns text language plpgsql as $$
declare v integer;
begin
  insert into app.counters (tenant_id, prefix, value) values (app.current_tenant(), p_prefix, 1)
  on conflict (tenant_id, prefix) do update set value = app.counters.value + 1
  returning value into v;
  return p_prefix || '-' || lpad(v::text, 3, '0');
end $$;

-- ---------- Audit trail: append-only, hash-chained per tenant ----------
create table app.audit_log (
  tenant_id uuid not null references app.tenants(id),
  seq bigint not null,
  at timestamptz not null default clock_timestamp(),
  actor_id uuid,                       -- null for the system (automation, webhooks)
  actor_label text not null,           -- name at the time, or 'System'
  on_behalf_of uuid,
  action text not null,
  object_type text not null,
  object_id text not null,
  summary text not null,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  prev_hash text not null,
  hash text not null,
  primary key (tenant_id, seq)
);
create index audit_object on app.audit_log (tenant_id, object_type, object_id);

create or replace function app.audit_entry_hash(
  p_tenant uuid, p_seq bigint, p_at timestamptz, p_actor uuid, p_actor_label text, p_on_behalf uuid, p_action text,
  p_object_type text, p_object_id text, p_summary text, p_before jsonb, p_after jsonb, p_prev text
) returns text language sql immutable as $$
  select encode(digest(p_prev || jsonb_build_object(
    'tenant', p_tenant, 'seq', p_seq, 'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor, 'actorLabel', p_actor_label, 'onBehalfOf', p_on_behalf, 'action', p_action,
    'objectType', p_object_type, 'objectId', p_object_id, 'summary', p_summary, 'before', p_before, 'after', p_after
  )::text, 'sha256'), 'hex')
$$;

create or replace function app.audit_before_insert() returns trigger language plpgsql as $$
declare last_seq bigint; last_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit:' || new.tenant_id::text, 0));
  select seq, hash into last_seq, last_hash from app.audit_log where tenant_id = new.tenant_id order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.at := clock_timestamp();
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.hash := app.audit_entry_hash(new.tenant_id, new.seq, new.at, new.actor_id, new.actor_label, new.on_behalf_of, new.action,
                                   new.object_type, new.object_id, new.summary, new.before, new.after, new.prev_hash);
  return new;
end $$;
create trigger audit_chain before insert on app.audit_log for each row execute function app.audit_before_insert();
create trigger audit_no_update before update or delete on app.audit_log for each row execute function app.forbid_change();
create trigger audit_no_truncate before truncate on app.audit_log for each statement execute function app.forbid_change();

-- Recompute the chain for the current tenant. Returns the first broken entry, if any.
create or replace function app.verify_audit_chain() returns table (ok boolean, entries bigint, broken_at bigint) language plpgsql stable as $$
declare r record; prev text := repeat('0', 64); expected_seq bigint := 1; n bigint := 0;
begin
  for r in select * from app.audit_log where tenant_id = app.current_tenant() order by seq loop
    n := n + 1;
    if r.seq <> expected_seq or r.prev_hash <> prev or r.hash <> app.audit_entry_hash(r.tenant_id, r.seq, r.at, r.actor_id, r.actor_label, r.on_behalf_of, r.action, r.object_type, r.object_id, r.summary, r.before, r.after, r.prev_hash) then
      return query select false, n, r.seq; return;
    end if;
    prev := r.hash; expected_seq := expected_seq + 1;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- Convenience used by the API and by triggers: write one audit entry as the current actor.
create or replace function app.audit(p_action text, p_object_type text, p_object_id text, p_summary text, p_before jsonb default null, p_after jsonb default null)
returns void language plpgsql as $$
declare v_actor uuid := app.current_actor(); v_label text;
begin
  select name into v_label from app.users where id = v_actor;
  insert into app.audit_log (tenant_id, actor_id, actor_label, action, object_type, object_id, summary, before, after, prev_hash, hash)
  values (app.current_tenant(), v_actor, coalesce(v_label, 'System'), p_action, p_object_type, p_object_id, p_summary, p_before, p_after, '', '');
end $$;

-- ---------- Signatures: insert-only, for both routes ----------
create table app.signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  record_type text not null,
  record_id uuid not null,
  record_number text not null,
  document_version_id uuid,
  user_id uuid not null references app.users(id),
  meaning text not null,
  stage text,
  signed_at timestamptz not null,
  -- Every signature comes from Adobe Sign, or was migrated from KSTARRS. Nothing is signed inside VeQMS:
  -- read-and-understood confirmations are training records, not signatures.
  source text not null check (source in ('adobe', 'kstarrs')),
  agreement_id uuid,                     -- the Adobe Sign agreement the signature came from
  content_sha256 text not null,
  statement text not null,
  created_at timestamptz not null default now()
);
create trigger signatures_insert_only before update or delete on app.signatures for each row execute function app.forbid_change();

-- ---------- Tasks and notifications ----------
create table app.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  kind text not null,
  record_type text not null,
  record_id uuid not null,
  record_number text not null,
  assignee_id uuid not null references app.users(id),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  note text,
  ref uuid,                              -- agreement id, training record id, action id …
  fyi boolean not null default false,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index tasks_open on app.tasks (tenant_id, assignee_id) where status = 'open';

create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  user_id uuid not null references app.users(id),
  kind text not null check (kind in ('action', 'info', 'fyi', 'reminder', 'overdue', 'warn', 'security')),
  title text not null,
  body text not null default '',
  record_type text,
  record_id uuid,
  href text,
  mandatory boolean not null default false,
  channels text[] not null default '{in-app}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on app.notifications (tenant_id, user_id, created_at desc);

-- Every message sent per channel, kept as evidence that people were told.
create table app.notification_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id),
  notification_id uuid references app.notifications(id),
  user_id uuid not null references app.users(id),
  channel text not null,
  status text not null,
  detail text,
  at timestamptz not null default now()
);
create trigger notification_log_insert_only before update or delete on app.notification_log for each row execute function app.forbid_change();

reset role;
