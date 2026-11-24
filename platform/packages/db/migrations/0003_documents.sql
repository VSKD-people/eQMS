-- 0003 documents: shared record header, document detail, immutable versions.

create table record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  site_id uuid references site(id),
  type text not null check (type in ('Document', 'ChangeRequest', 'Observation', 'QualityEvent', 'CAPA', 'PeriodicReview')),
  number text not null,
  title text not null,
  state text not null,
  owner_id uuid references app_user(id),
  classification text not null default 'Internal' check (classification in ('Public', 'Internal', 'Confidential', 'Restricted')),
  legal_hold boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number),
  unique (id, tenant_id)
);
create trigger record_touch before insert or update on record for each row execute function touch_row();
-- Soft delete only, and never under legal hold.
create trigger record_no_delete before delete on record for each row execute function forbid_change();
create function record_soft_delete_rule() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and old.legal_hold then
    raise exception 'record % is under legal hold and cannot be deleted', old.number using errcode = 'integrity_constraint_violation';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a deleted record cannot be restored here' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger record_soft_delete_rule before update on record for each row execute function record_soft_delete_rule();

create table document_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  record_id uuid not null,
  major int not null check (major >= 0),
  minor int not null check (minor >= 0),
  status text not null default 'Draft'
    check (status in ('Draft', 'In Review', 'Review Closed', 'In Approval', 'Approved', 'Pending Training', 'Effective', 'Superseded', 'Obsolete')),
  author_id uuid not null references app_user(id),
  file_blob_id text,
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  change_summary text not null check (length(btrim(change_summary)) > 0),
  approved_at timestamptz,
  migrated_from_kstarrs boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  foreign key (record_id, tenant_id) references record(id, tenant_id),
  unique (record_id, major, minor),
  unique (id, tenant_id)
);
create trigger document_version_touch before insert or update on document_version for each row execute function touch_row();
create trigger document_version_no_delete before delete on document_version for each row execute function forbid_change();

-- Once approved, the content fields cannot change. Status may still move forward (Effective, Superseded, Obsolete).
create function document_version_immutable() returns trigger language plpgsql as $$
begin
  if old.approved_at is not null then
    if new.approved_at is distinct from old.approved_at
       or new.content_sha256 is distinct from old.content_sha256
       or new.file_blob_id is distinct from old.file_blob_id
       or new.change_summary is distinct from old.change_summary
       or new.major <> old.major or new.minor <> old.minor
       or new.author_id <> old.author_id or new.record_id <> old.record_id then
      raise exception 'version %.% is approved and cannot be changed', old.major, old.minor
        using errcode = 'insufficient_privilege';
    end if;
    if new.status in ('Draft', 'In Review', 'Review Closed', 'In Approval') then
      raise exception 'an approved version cannot return to %', new.status using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  if new.status in ('Approved', 'Pending Training', 'Effective') and new.approved_at is null then
    raise exception 'status % needs approved_at', new.status using errcode = 'integrity_constraint_violation';
  end if;
  if new.approved_at is not null and new.content_sha256 is null then
    raise exception 'an approved version needs content_sha256' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger document_version_immutable before update on document_version for each row execute function document_version_immutable();
-- A version that arrives already approved (import) is held to the same rule.
create trigger document_version_insert_rule before insert on document_version for each row execute function document_version_immutable();

do $$
declare t text;
begin
  foreach t in array array['record', 'document_version'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;
