-- Route 2: read-and-understood training records. Not Part 11 signatures, but each record is attributable,
-- tied to one version, dated by the system and locked once made. The database enforces all four.
set role veqms_owner;

create table app.training_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  user_id uuid not null references app.users(id),
  document_id uuid not null references app.documents(id),
  document_number text not null,
  title text not null,
  version text not null,
  allocated_by uuid references app.users(id),          -- null means the system
  alloc_reason text not null,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  statement text,
  quiz_result text,
  via text,                                            -- e.g. 'Microsoft 365 single sign-on'
  agreement_id uuid references app.agreements(id),       -- completed from an approval agreement (author, reviewers)
  correction_of uuid references app.training_records(id),
  correction_reason text,
  no_retrain boolean not null default false,
  closed_at timestamptz,
  closed_reason text,
  check (correction_of is null or coalesce(correction_reason, '') <> ''),
  check (not no_retrain or correction_of is not null),
  check (completed_at is null or closed_at is null)
);
create index training_by_user on app.training_records (tenant_id, user_id);
create index training_by_doc on app.training_records (tenant_id, document_id, version);
create unique index training_one_live_per_version on app.training_records (user_id, document_id, version)
  where closed_at is null and correction_of is null;

create or replace function app.training_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'training records cannot be deleted' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' and app.import_mode() then
    return new;                                       -- historical import: keep the original dates (logged as training.import)
  end if;

  if tg_op = 'INSERT' then
    new.assigned_at := now();                         -- dates are set by the system, never typed
    new.closed_at := null; new.closed_reason := null;
    if new.agreement_id is not null then
      new.completed_at := now();                      -- author and reviewers: completed when the agreement completes
      if coalesce(new.statement, '') = '' then raise exception 'a record from an approval agreement needs a statement' using errcode = 'P0001'; end if;
    else
      new.completed_at := null; new.statement := null; new.quiz_result := null; new.via := null;
    end if;
    return new;
  end if;

  -- UPDATE: completed and closed records are locked for everyone, administrators included.
  if old.completed_at is not null then
    raise exception 'training record % is completed and locked; record a correction instead', old.id using errcode = 'P0001';
  end if;
  if old.closed_at is not null then
    raise exception 'training record % is closed and locked', old.id using errcode = 'P0001';
  end if;
  if new.user_id <> old.user_id or new.document_id <> old.document_id or new.version <> old.version or new.title <> old.title
     or new.document_number <> old.document_number or new.assigned_at <> old.assigned_at or new.due_at is distinct from old.due_at
     or new.allocated_by is distinct from old.allocated_by or new.alloc_reason <> old.alloc_reason
     or new.correction_of is distinct from old.correction_of or new.no_retrain <> old.no_retrain or new.agreement_id is distinct from old.agreement_id then
    raise exception 'allocation details cannot change: close the record and allocate again' using errcode = 'P0001';
  end if;
  if new.completed_at is not null then
    if old.no_retrain then raise exception 'a correction record with no retraining cannot be completed' using errcode = 'P0001'; end if;
    if app.current_actor() is distinct from old.user_id then
      raise exception 'only % can confirm their own training record', old.user_id using errcode = 'P0003';
    end if;
    if coalesce(new.statement, '') = '' then raise exception 'the confirmation statement is required' using errcode = 'P0001'; end if;
    new.completed_at := now();
  elsif new.closed_at is not null then
    if coalesce(new.closed_reason, '') = '' then raise exception 'closing an allocation needs a reason' using errcode = 'P0001'; end if;
    new.closed_at := now();
  elsif new.statement is distinct from old.statement or new.quiz_result is distinct from old.quiz_result or new.via is distinct from old.via then
    raise exception 'only completion may set the statement' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger training_records_guard before insert or update or delete on app.training_records
  for each row execute function app.training_guard();

-- Knowledge-check questions per document (optional; used when documents.training_quiz is true).
create table app.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id),
  document_id uuid not null references app.documents(id),
  position integer not null,
  question text not null,
  options text[] not null check (array_length(options, 1) between 2 and 6),
  answer_index integer not null check (answer_index >= 0),
  active boolean not null default true,
  unique (document_id, position)
);

-- Every change to a training record or allocation goes into the audit trail with old and new values.
create or replace function app.training_audit() returns trigger language plpgsql as $$
declare snap jsonb; who text;
begin
  snap := jsonb_build_object('user', new.user_id, 'document', new.document_number, 'title', new.title, 'version', new.version,
    'allocatedBy', new.allocated_by, 'reason', new.alloc_reason, 'assignedAt', new.assigned_at, 'dueAt', new.due_at,
    'completedAt', new.completed_at, 'closedAt', new.closed_at, 'correctionOf', new.correction_of);
  select name into who from app.users where id = new.user_id;
  if tg_op = 'INSERT' then
    perform app.audit(case when app.import_mode() then 'training.import' when new.correction_of is not null then 'training.correct' when new.completed_at is not null then 'training.record' else 'training.allocate' end,
      'Training record', new.id::text,
      case when new.correction_of is not null then 'Correction of ' || new.correction_of || ' for ' || coalesce(who, '?') || ' on ' || new.document_number || ' v' || new.version || ': ' || new.correction_reason
           when new.completed_at is not null then 'Completed record for ' || coalesce(who, '?') || ' on ' || new.document_number || ' v' || new.version || ' from Adobe Sign agreement'
           else 'Allocated ' || new.document_number || ' v' || new.version || ' to ' || coalesce(who, '?') || ' (' || new.alloc_reason || ')' end,
      null, snap);
  else
    perform app.audit(case when new.completed_at is not null and old.completed_at is null then 'training.complete' else 'training.withdraw' end,
      'Training record', new.id::text,
      case when new.completed_at is not null and old.completed_at is null then coalesce(who, '?') || ' confirmed read and understood: ' || new.document_number || ' v' || new.version
           else 'Closed open allocation ' || new.document_number || ' v' || new.version || ' for ' || coalesce(who, '?') || ': ' || new.closed_reason end,
      jsonb_build_object('completedAt', old.completed_at, 'closedAt', old.closed_at, 'statement', old.statement),
      jsonb_build_object('completedAt', new.completed_at, 'closedAt', new.closed_at, 'closedReason', new.closed_reason, 'statement', new.statement, 'quiz', new.quiz_result, 'via', new.via));
  end if;
  return null;
end $$;
create trigger training_records_audit after insert or update on app.training_records for each row execute function app.training_audit();

reset role;
