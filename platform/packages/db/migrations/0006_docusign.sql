-- 0006 DocuSign: one live envelope per version, every send counted, allowance by allowance year.

create table docusign_settings (
  tenant_id uuid primary key references tenant(id),
  allowance int not null default 500 check (allowance > 0),
  year_start_month int not null default 1 check (year_start_month between 1 and 12),
  go_live date,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table docusign_envelope (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  record_id uuid not null,
  record_version_id uuid not null,
  envelope_id text,
  status text not null default 'Created' check (status in ('Created', 'Sent', 'Delivered', 'Completed', 'Declined', 'Voided', 'Expired')),
  sent_at timestamptz,
  completed_at timestamptz,
  signed_pdf_blob_id text,
  certificate_blob_id text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  foreign key (record_id, tenant_id) references record(id, tenant_id),
  foreign key (record_version_id, tenant_id) references document_version(id, tenant_id),
  unique (id, tenant_id),
  check (status <> 'Completed' or (completed_at is not null and signed_pdf_blob_id is not null and certificate_blob_id is not null))
);
-- One envelope per version holds every signer, so only one can be live at a time.
create unique index docusign_one_live_envelope on docusign_envelope (record_version_id)
  where status in ('Created', 'Sent', 'Delivered');
create unique index docusign_envelope_id_unique on docusign_envelope (tenant_id, envelope_id) where envelope_id is not null;
create trigger docusign_envelope_touch before insert or update on docusign_envelope for each row execute function touch_row();
create trigger docusign_envelope_no_delete before delete on docusign_envelope for each row execute function forbid_change();

create table docusign_signer (
  tenant_id uuid not null references tenant(id),
  envelope_row_id uuid not null,
  routing_order int not null check (routing_order > 0),
  user_id uuid not null references app_user(id),
  role text not null check (role in ('Author', 'Reviewer', 'Approver')),
  status text not null default 'Waiting' check (status in ('Waiting', 'Sent', 'Signed', 'Declined')),
  primary key (envelope_row_id, routing_order, user_id),
  foreign key (envelope_row_id, tenant_id) references docusign_envelope(id, tenant_id)
);

-- Every send is one row. Insert-only, so the allowance count cannot be reduced.
create table docusign_send (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  envelope_row_id uuid not null,
  sent_at timestamptz not null default now(),
  allowance_year int not null,
  sent_by uuid,
  foreign key (envelope_row_id, tenant_id) references docusign_envelope(id, tenant_id),
  unique (envelope_row_id)
);
create trigger docusign_send_no_change before update or delete on docusign_send for each row execute function forbid_change();

-- First calendar year of the allowance year that contains the date. With start month 4, 2026-02-10 is in 2025.
create function allowance_year(p_at timestamptz, p_start_month int) returns int language sql immutable as $$
  select case when extract(month from p_at at time zone 'UTC')::int >= p_start_month
              then extract(year from p_at at time zone 'UTC')::int
              else extract(year from p_at at time zone 'UTC')::int - 1 end
$$;

create function docusign_send_rules() returns trigger language plpgsql as $$
declare s docusign_settings;
begin
  new.tenant_id := app_tenant();
  new.sent_at := now();
  new.sent_by := app_user_id();
  select * into s from docusign_settings where tenant_id = new.tenant_id;
  new.allowance_year := allowance_year(new.sent_at, coalesce(s.year_start_month, 1));
  return new;
end $$;
create trigger docusign_send_rules before insert on docusign_send for each row execute function docusign_send_rules();

create view docusign_allowance_use with (security_invoker = true) as
  select d.tenant_id, d.allowance_year, count(*)::int as used,
         coalesce(max(s.allowance), 500) - count(*)::int as remaining
  from docusign_send d left join docusign_settings s on s.tenant_id = d.tenant_id
  group by d.tenant_id, d.allowance_year;

do $$
declare t text;
begin
  foreach t in array array['docusign_settings', 'docusign_envelope', 'docusign_signer', 'docusign_send'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;
