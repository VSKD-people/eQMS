-- Local development only (docker-compose). Runs once when the postgres container first creates its data folder,
-- before the migrations. Creates a login for the API that is a member of veqms_app, so row-level security and the
-- no-DELETE rules apply locally exactly as in Azure. Never run this against a real server.
create role veqms_app nologin nobypassrls;
create role veqms_api login password 'veqms_api_local_only' in role veqms_app;
