-- VeQMS database: roles, schema and helper functions.
-- Run by the migration owner (the server admin in Azure, or the postgres user locally).
-- veqms_app is the role the API uses at runtime: no DDL, no DELETE, no BYPASSRLS.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'veqms_owner') then create role veqms_owner nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'veqms_app') then create role veqms_app nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'veqms_readonly') then create role veqms_readonly nologin nobypassrls; end if;
end $$;

-- The migration user must be able to act as the owner role (Azure: the server admin; locally: postgres).
grant veqms_owner to current_user;

create schema if not exists app authorization veqms_owner;
grant usage on schema app to veqms_app, veqms_readonly;

-- Per-transaction context. The API runs every request in a transaction and sets:
--   set local app.tenant_id = '<uuid>';  set local app.user_id = '<uuid>';
create or replace function app.current_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app.current_actor() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Import mode: only the owner role, with app.import_mode = 'on', may load historical records with their original
-- dates (the demo seed, and the one-off migration from KSTARRS/SharePoint). The API role can never use it.
create or replace function app.import_mode() returns boolean language sql stable as
$$ select current_user = 'veqms_owner' and coalesce(current_setting('app.import_mode', true), '') = 'on' $$;

-- Generic guard for tables that are insert-only (signatures, ledgers, events).
create or replace function app.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is insert-only: % is not allowed', tg_table_name, tg_op using errcode = 'P0001';
end $$;

-- Keep updated_at honest.
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table if not exists app.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
