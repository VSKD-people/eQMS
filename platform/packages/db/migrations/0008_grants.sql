-- 0008 grants: the application role gets the least it needs. Compliance rules do not depend on this alone:
-- triggers in 0002 to 0006 also refuse the changes.

revoke all on all tables in schema public from public;
revoke create on schema public from public;
grant usage on schema public to veqms_app;

grant select, insert, update on
  site, app_user, app_group, record, document_version, training_assignment,
  docusign_settings, docusign_envelope, docusign_signer, outbox_event
to veqms_app;
grant select on tenant to veqms_app;
grant select, insert, delete on user_role, group_member to veqms_app;
-- Insert-only tables: no update or delete grant exists.
grant select, insert on audit_log_entry, signature, training_record, docusign_send to veqms_app;
grant select on docusign_allowance_use to veqms_app;
