-- 0002 audit: append-only, hash-chained per tenant.
-- hash = sha256(prev_hash || canonical entry). The trigger computes seq, prev_hash and hash under a
-- per-tenant advisory lock, so the application cannot supply, skip or fork them.
-- Canonical form: jsonb text output with fixed field order and UTC microsecond timestamps.
-- This is NOT RFC 8785 (JCS). The Step 1 plan marks that choice "verify"; see docs/02-data-model.md.

create table audit_log_entry (
  tenant_id uuid not null references tenant(id),
  seq bigint not null,
  occurred_at_utc timestamptz not null,
  actor_id uuid,
  on_behalf_of_id uuid,
  action text not null,
  object_type text not null,
  object_id text not null,
  before_json jsonb,
  after_json jsonb,
  ip text,
  device text,
  prev_hash text not null,
  hash text not null,
  primary key (tenant_id, seq)
);

create function audit_canonical(e audit_log_entry) returns text language sql immutable as $$
  select jsonb_build_object(
    'tenant_id', e.tenant_id,
    'seq', e.seq,
    'occurred_at_utc', to_char(e.occurred_at_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_id', e.actor_id,
    'on_behalf_of_id', e.on_behalf_of_id,
    'action', e.action,
    'object_type', e.object_type,
    'object_id', e.object_id,
    'before_json', e.before_json,
    'after_json', e.after_json,
    'ip', e.ip,
    'device', e.device
  )::text
$$;

create function audit_chain_hash(prev text, e audit_log_entry) returns text language sql immutable as $$
  select encode(sha256(convert_to(prev || audit_canonical(e), 'UTF8')), 'hex')
$$;

create function audit_before_insert() returns trigger language plpgsql as $$
declare head record;
begin
  if app_tenant() is null then
    raise exception 'audit entry needs app.tenant_id' using errcode = 'insufficient_privilege';
  end if;
  new.tenant_id := app_tenant();
  -- Two saves at the same moment queue here instead of splitting the chain.
  perform pg_advisory_xact_lock(hashtextextended('audit:' || new.tenant_id::text, 0));
  select seq, hash into head from audit_log_entry where tenant_id = new.tenant_id order by seq desc limit 1;
  new.seq := coalesce(head.seq, 0) + 1;
  new.prev_hash := coalesce(head.hash, repeat('0', 64));
  new.occurred_at_utc := clock_timestamp();
  new.actor_id := coalesce(new.actor_id, app_user_id());
  new.hash := audit_chain_hash(new.prev_hash, new);
  return new;
end $$;

create trigger audit_before_insert before insert on audit_log_entry
  for each row execute function audit_before_insert();
create trigger audit_no_update before update or delete on audit_log_entry
  for each row execute function forbid_change();
create trigger audit_no_truncate before truncate on audit_log_entry
  for each statement execute function forbid_change();

alter table audit_log_entry enable row level security;
alter table audit_log_entry force row level security;
create policy tenant_isolation on audit_log_entry using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- Recomputes the whole chain for one tenant. Returns the first broken seq, or null when the chain is intact.
create function verify_audit_chain(p_tenant uuid default app_tenant())
returns table (ok boolean, entries bigint, first_bad_seq bigint) language plpgsql stable as $$
declare e audit_log_entry; prev text := repeat('0', 64); n bigint := 0; expected_seq bigint := 1;
begin
  for e in select * from audit_log_entry where tenant_id = p_tenant order by seq loop
    n := n + 1;
    if e.seq <> expected_seq or e.prev_hash <> prev or e.hash <> audit_chain_hash(prev, e) then
      return query select false, n, e.seq; return;
    end if;
    prev := e.hash; expected_seq := expected_seq + 1;
  end loop;
  return query select true, n, null::bigint;
end $$;
