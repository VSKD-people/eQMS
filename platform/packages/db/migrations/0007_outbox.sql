-- 0007 outbox: events are written in the same transaction as the change; workers read them later.

create table outbox_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  record_id uuid,
  event_type text not null,
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0 check (attempts >= 0)
);
create index outbox_unprocessed on outbox_event (created_at) where processed_at is null;
create trigger outbox_no_delete before delete on outbox_event for each row execute function forbid_change();
alter table outbox_event enable row level security;
alter table outbox_event force row level security;
create policy tenant_isolation on outbox_event using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
