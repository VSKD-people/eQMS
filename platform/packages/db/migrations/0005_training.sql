-- 0005 training: read-and-understood records are locked once completed.

create table training_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  record_id uuid not null,
  record_version_id uuid not null,
  user_id uuid not null references app_user(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  foreign key (record_id, tenant_id) references record(id, tenant_id),
  foreign key (record_version_id, tenant_id) references document_version(id, tenant_id),
  unique (record_version_id, user_id),
  unique (id, tenant_id)
);
create trigger training_assignment_touch before insert or update on training_assignment for each row execute function touch_row();
create trigger training_assignment_no_delete before delete on training_assignment for each row execute function forbid_change();

create table training_record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  assignment_id uuid not null,
  user_id uuid not null references app_user(id),
  completed_at timestamptz not null default now(),
  quiz_score numeric check (quiz_score between 0 and 100),
  corrects_id uuid references training_record(id),
  correction_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  foreign key (assignment_id, tenant_id) references training_assignment(id, tenant_id),
  check ((corrects_id is null) = (correction_reason is null))
);
create trigger training_record_no_change before update or delete on training_record for each row execute function forbid_change();
create trigger training_record_no_truncate before truncate on training_record for each statement execute function forbid_change();

create function training_record_rules() returns trigger language plpgsql as $$
begin
  new.tenant_id := app_tenant();
  -- Dates come from the system, never from the caller.
  new.completed_at := now();
  new.created_by := app_user_id();
  if new.corrects_id is null then
    -- Only the trainee confirms their own training.
    if new.user_id is distinct from app_user_id() then
      raise exception 'only the trainee can confirm their own training' using errcode = 'insufficient_privilege';
    end if;
  else
    -- A correction is a new record about the same assignment, with a reason.
    if not exists (select 1 from training_record o where o.id = new.corrects_id and o.assignment_id = new.assignment_id) then
      raise exception 'a correction must refer to a record on the same assignment' using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return new;
end $$;
create trigger training_record_rules before insert on training_record for each row execute function training_record_rules();

do $$
declare t text;
begin
  foreach t in array array['training_assignment', 'training_record'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;
