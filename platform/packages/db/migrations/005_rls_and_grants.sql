-- Row-level security on every tenant table, and least-privilege grants for the API role.
-- veqms_app can read and write its own tenant's rows only, and can never DELETE anything.

set client_min_messages = warning;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'app' and c.relkind = 'r' and c.relname not in ('tenant_directory', 'envelope_directory')
  loop
    execute format('alter table app.%I enable row level security', t.relname);
    execute format('alter table app.%I force row level security', t.relname);
    execute format('drop policy if exists tenant_isolation on app.%I', t.relname);
    execute format('create policy tenant_isolation on app.%I using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t.relname);
  end loop;
end $$;

-- tenants: a tenant sees only itself. Not forced, so the owner can look tenants up for sign-in.
alter table app.tenants enable row level security;
drop policy if exists tenant_self on app.tenants;
create policy tenant_self on app.tenants using (id = app.current_tenant());

grant select, insert, update on all tables in schema app to veqms_app;
grant select on all tables in schema app to veqms_readonly;
grant usage on all sequences in schema app to veqms_app;
revoke delete, truncate on all tables in schema app from veqms_app, veqms_readonly;
revoke update on app.audit_log, app.signatures, app.envelope_events, app.docusign_sends, app.notification_log, app.automation_runs, app.schema_migrations from veqms_app;
revoke insert, update on app.tenants, app.tenant_directory, app.schema_migrations from veqms_app;
-- Configuration that is replaced as a whole (audiences, reviewer and approver lists, group membership from SCIM, role assignments)
-- may be deleted by the API; every change is audited with old and new values. Quality records never are.
grant delete on app.audience_groups, app.audience_roles, app.audience_users, app.document_reviewers, app.document_approvers, app.group_members, app.user_roles to veqms_app;
grant execute on all functions in schema app to veqms_app, veqms_readonly;

alter default privileges for role veqms_owner in schema app grant select, insert, update on tables to veqms_app;
alter default privileges for role veqms_owner in schema app grant select on tables to veqms_readonly;
