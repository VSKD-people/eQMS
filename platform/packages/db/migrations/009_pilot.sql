-- Running before Microsoft 365, Adobe Sign and SharePoint are connected (docs/11-configuration.md):
--   1. email and password sign-in held in VeQMS (AUTH_MODE=local), until Microsoft sign-in replaces it;
--   2. files kept in a write-once table (STORAGE_MODE=database), so a container host needs no disk;
--   3. simulated signatures (ADOBE_SIGN_MODE=mock) recorded as simulated, never as Adobe Sign, and refused unless the
--      tenant's settings allow them (the pilot and the demo do; production doesn't).
set role veqms_owner;

-- 1. Email and password sign-in. One row per person who signs in this way; the password is stored only as a scrypt
-- hash. Rows are never deleted: a leaver's account is closed through users.status, as with Microsoft sign-in.
create table app.local_credentials (
  user_id uuid primary key references app.users(id),
  tenant_id uuid not null references app.tenants(id),
  password_hash text not null check (password_hash like 'scrypt$%'),
  must_change boolean not null default true,         -- set by an administrator's temporary password
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table app.local_credentials enable row level security;
alter table app.local_credentials force row level security;
create policy tenant_isolation on app.local_credentials using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
revoke delete, truncate on app.local_credentials from veqms_app;

-- 2. Files in the database. Write-once, like the immutable records container: a key is written once and never
-- changed or removed. No tenant column: keys carry the record IDs, as blob names do.
create table app.file_store (
  key text primary key check (length(key) between 1 and 512 and key not like '/%' and key not like '%..%'),
  content_type text not null,
  bytes bytea not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size integer not null check (size >= 0),
  created_at timestamptz not null default now()
);
create trigger file_store_insert_only before update or delete on app.file_store for each row execute function app.forbid_change();
revoke update, delete, truncate on app.file_store from veqms_app;

-- 3. Simulated signatures.
alter table app.settings add column allow_simulated_signatures boolean not null default false;
alter table app.agreements drop constraint agreements_provider_check;
alter table app.agreements add constraint agreements_provider_check check (provider in ('adobe', 'simulated'));
alter table app.signatures drop constraint signatures_source_check;
alter table app.signatures add constraint signatures_source_check check (source in ('adobe', 'kstarrs', 'simulated'));
create or replace function app.signature_source_guard() returns trigger language plpgsql as $$
begin
  if new.source = 'simulated' and not coalesce((select s.allow_simulated_signatures from app.settings s where s.tenant_id = new.tenant_id), false) then
    raise exception 'simulated signatures are not allowed for this tenant: signatures must come from Adobe Sign' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger signatures_source_guard before insert on app.signatures for each row execute function app.signature_source_guard();

reset role;
