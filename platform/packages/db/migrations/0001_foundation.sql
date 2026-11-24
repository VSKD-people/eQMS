-- 0001 foundation: tenancy, identity helpers, users, roles, groups.
-- Every tenant table: tenant_id, forced row-level security, audit columns.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Identity of the current request. The API sets both with SET LOCAL (set_config(..., true)) per transaction.
create function app_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app_user_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Fills created_by/updated_by/updated_at. Timestamps are UTC (timestamptz).
create function touch_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(new.created_by, app_user_id());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := app_user_id();
  return new;
end $$;

-- Rejects the statement. Used for insert-only and locked tables.
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed', tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

create table tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table site (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, name)
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  site_id uuid references site(id),
  entra_object_id text,
  email citext not null,
  display_name text not null,
  status text not null default 'Active' check (status in ('Active', 'Disabled')),
  disabled_at timestamptz,
  sessions_revoked_at timestamptz,
  manager_id uuid references app_user(id),
  clearance text not null default 'Internal' check (clearance in ('Public', 'Internal', 'Confidential', 'Restricted')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, email),
  unique (tenant_id, entra_object_id),
  check ((status = 'Disabled') = (disabled_at is not null))
);
-- Users are never deleted: signatures and training records must stay attached to them.
create trigger app_user_no_delete before delete on app_user for each row execute function forbid_change();

create table user_role (
  tenant_id uuid not null references tenant(id),
  user_id uuid not null references app_user(id),
  role text not null check (role in ('admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor')),
  granted_at timestamptz not null default now(),
  granted_by uuid,
  primary key (user_id, role)
);

create table app_group (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, name)
);

create table group_member (
  tenant_id uuid not null references tenant(id),
  group_id uuid not null references app_group(id),
  user_id uuid not null references app_user(id),
  primary key (group_id, user_id)
);

create trigger site_touch before insert or update on site for each row execute function touch_row();
create trigger app_user_touch before insert or update on app_user for each row execute function touch_row();
create trigger app_group_touch before insert or update on app_group for each row execute function touch_row();

-- Row-level security: a row is visible only inside its own tenant. FORCE applies it to the table owner too.
do $$
declare t text;
begin
  foreach t in array array['site', 'app_user', 'user_role', 'app_group', 'group_member'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;
-- tenant itself: a request may see only its own tenant row.
alter table tenant enable row level security;
alter table tenant force row level security;
create policy tenant_isolation on tenant using (id = app_tenant()) with check (id = app_tenant());
