-- Audit anchors. At a set interval the anchor job writes each tenant's audit chain head (last entry's number and
-- hash) to the immutable records container, so nobody, a database super-administrator included, can rewrite the
-- chain without it showing: the rewritten chain no longer matches the anchors stored outside the database.
-- This table lists the anchors written; the blobs are the evidence.
set role veqms_owner;

create table app.audit_anchors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  seq bigint not null,
  hash text not null,
  anchored_at timestamptz not null default now(),
  blob text not null,                        -- key of the JSON written to the records container
  unique (tenant_id, seq)
);
create trigger audit_anchors_insert_only before update or delete on app.audit_anchors for each row execute function app.forbid_change();

alter table app.audit_anchors enable row level security;
alter table app.audit_anchors force row level security;
create policy tenant_isolation on app.audit_anchors using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
revoke update, delete, truncate on app.audit_anchors from veqms_app;

reset role;
