-- Cluster-level roles. Run once as a superuser before the migrations. Passwords are set outside this repository.
do $$ begin
  if not exists (select from pg_roles where rolname = 'veqms_owner') then create role veqms_owner nologin; end if;
  if not exists (select from pg_roles where rolname = 'veqms_app') then create role veqms_app nologin nobypassrls; end if;
end $$;
