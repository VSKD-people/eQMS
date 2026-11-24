-- 0004 signatures: insert-only, one row per record, fresh sign-in, segregation of duties.

create table signature (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  record_id uuid not null,
  record_version_id uuid,
  signer_id uuid not null references app_user(id),
  meaning text not null check (meaning in ('Authored', 'Reviewed', 'Approved', 'Closed', 'Justified', 'Read and understood')),
  statement_text text not null check (length(btrim(statement_text)) > 0),
  signed_at_utc timestamptz not null default now(),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  intent_at timestamptz not null,
  auth_time timestamptz not null,
  acrs text not null,
  via_docusign boolean not null default false,
  sod_override_by uuid references app_user(id),
  sod_override_reason text,
  foreign key (record_id, tenant_id) references record(id, tenant_id),
  foreign key (record_version_id, tenant_id) references document_version(id, tenant_id),
  -- A fresh sign-in, later than the moment the signing started. An older sign-in is refused however recent.
  check (auth_time > intent_at),
  check ((sod_override_by is null) = (sod_override_reason is null))
);
create trigger signature_no_change before update or delete on signature for each row execute function forbid_change();
create trigger signature_no_truncate before truncate on signature for each statement execute function forbid_change();

create function signature_rules() returns trigger language plpgsql as $$
declare v document_version;
begin
  new.tenant_id := app_tenant();
  if new.record_version_id is not null then
    select * into v from document_version where id = new.record_version_id;
    if v.id is null or v.record_id <> new.record_id then
      raise exception 'signature version does not belong to the record' using errcode = 'integrity_constraint_violation';
    end if;
    -- The hash signed must be the hash of the version content.
    if v.content_sha256 is distinct from new.content_sha256 then
      raise exception 'signed hash does not match the version content' using errcode = 'integrity_constraint_violation';
    end if;
    -- Segregation of duties: the author cannot approve unless a named admin override is recorded.
    if new.meaning = 'Approved' and new.signer_id = v.author_id and new.sod_override_by is null then
      raise exception 'segregation of duties: the author cannot approve their own version' using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return new;
end $$;
create trigger signature_rules before insert on signature for each row execute function signature_rules();

alter table signature enable row level security;
alter table signature force row level security;
create policy tenant_isolation on signature using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- A document cannot become Effective without an approval signature on an approved version.
-- Approvals made before the DocuSign go-live are marked migrated and do not need a signature row here.
create function record_effective_rule() returns trigger language plpgsql as $$
begin
  if new.type = 'Document' and new.state = 'Effective' and old.state is distinct from 'Effective' then
    if not exists (
      select 1 from document_version v
      where v.record_id = new.id and v.approved_at is not null
        and (v.migrated_from_kstarrs
             or exists (select 1 from signature s where s.record_version_id = v.id and s.meaning = 'Approved'))
    ) then
      raise exception 'document % cannot become Effective without an approval signature', new.number
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return new;
end $$;
create trigger record_effective_rule before update on record for each row execute function record_effective_rule();
