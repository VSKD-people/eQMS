-- SharePoint as the file store (PJ Walters' decisions of 24 November 2026). Authors write in Word in a Drafts library;
-- VeQMS converts the draft to PDF at submit, and publishes the locked PDF of each Effective version to a controlled
-- library that only the VeQMS app can write to. A delta sync watches both libraries: in the controlled library any
-- change not made by VeQMS raises an integrity alert; a nightly check re-hashes every published file.
set role veqms_owner;

-- The Word file behind each document (Drafts library). One file per document, edited version after version.
alter table app.documents
  add column draft_item_id text,
  add column draft_web_url text,
  add column draft_edited_at timestamptz;   -- last change seen by the delta sync

alter table app.document_versions
  add column pdf_source_tag text,           -- the Word file's change tag (cTag) when the PDF was made (live mode)
  add column published_item_id text,        -- the file in the controlled library
  add column published_web_url text,
  add column published_at timestamptz,
  add column publish_status text not null default 'none'
    check (publish_status in ('none', 'pending', 'published', 'superseded', 'failed')),
  add column publish_attempts integer not null default 0,
  add column publish_error text;

-- Where the published copy is, once known, never changes; the PDF's source tag is fixed with the PDF.
create or replace function app.version_publish_guard() returns trigger language plpgsql as $$
begin
  if old.published_item_id is not null and new.published_item_id is distinct from old.published_item_id then
    raise exception 'the published file of version % cannot change', old.version using errcode = 'P0001';
  end if;
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'the publish time of version % is set once', old.version using errcode = 'P0001';
  end if;
  if old.state <> 'Draft' and new.pdf_source_tag is distinct from old.pdf_source_tag then
    raise exception 'version % is locked (state %): its PDF source cannot change', old.version, old.state using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger document_versions_publish_guard before update on app.document_versions for each row execute function app.version_publish_guard();

-- One row per delta sync of a library. A failed run leaves the last good token in place, so the next run resumes there.
create table app.sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  library text not null check (library in ('drafts', 'controlled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running' check (outcome in ('running', 'ok', 'failed')),
  delta_token text,                          -- the token to resume from after this run (set when it succeeds)
  changes integer not null default 0,
  alerts integer not null default 0,
  error text
);
create index sync_runs_latest on app.sync_runs (tenant_id, library, started_at desc);
-- A run is written once when it starts and once when it finishes; a finished run never changes.
create or replace function app.sync_run_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'sync runs cannot be deleted' using errcode = 'P0001'; end if;
  if old.outcome <> 'running' then raise exception 'a finished sync run cannot change' using errcode = 'P0001'; end if;
  if new.library is distinct from old.library or new.started_at is distinct from old.started_at or new.tenant_id is distinct from old.tenant_id then
    raise exception 'only the outcome of a sync run can be recorded' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sync_runs_guard before update or delete on app.sync_runs for each row execute function app.sync_run_guard();

-- Integrity alerts for QA: a controlled file changed or removed outside VeQMS, a published file whose hash no longer
-- matches, or a publish that kept failing. Raised by the system; a Quality Manager resolves each with a note.
create table app.integrity_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  raised_at timestamptz not null default now(),
  kind text not null check (kind in ('outside-change', 'missing', 'hash-mismatch', 'publish-failed')),
  library text check (library in ('drafts', 'controlled')),
  document_id uuid references app.documents(id),
  version_id uuid references app.document_versions(id),
  item_id text,
  detail text not null,
  resolved_at timestamptz,
  resolved_by uuid references app.users(id),
  resolution text,
  check ((resolved_at is null) = (resolved_by is null) and (resolved_at is null) = (coalesce(resolution, '') = ''))
);
create index integrity_alerts_open on app.integrity_alerts (tenant_id) where resolved_at is null;
create or replace function app.integrity_alert_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'integrity alerts cannot be deleted' using errcode = 'P0001'; end if;
  if old.resolved_at is not null then raise exception 'a resolved integrity alert cannot change' using errcode = 'P0001'; end if;
  if (new.kind, new.library, new.document_id, new.version_id, new.item_id, new.detail, new.raised_at, new.tenant_id)
     is distinct from (old.kind, old.library, old.document_id, old.version_id, old.item_id, old.detail, old.raised_at, old.tenant_id) then
    raise exception 'only the resolution of an integrity alert can be recorded' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger integrity_alerts_guard before update or delete on app.integrity_alerts for each row execute function app.integrity_alert_guard();

do $$ declare t text; begin
  foreach t in array array['sync_runs', 'integrity_alerts'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy tenant_isolation on app.%I using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('revoke delete, truncate on app.%I from veqms_app', t);
  end loop;
end $$;

reset role;
