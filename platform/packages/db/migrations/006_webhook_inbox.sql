-- Adobe Sign webhook notifications, queued. The webhook endpoint only records the notification and answers at once
-- (Adobe Sign expects a reply within 5 seconds); the API works through the queue in the background, and the daily
-- job picks up anything left. One row per notification ID, so a repeated delivery is ignored.
-- Like agreement_directory, this table has no tenant: a notification arrives before VeQMS knows whose it is.
set role veqms_owner;

create table app.webhook_inbox (
  id bigint generated always as identity primary key,
  provider text not null default 'adobe' check (provider in ('adobe')),
  event_id text not null,                     -- Adobe's notification ID; the payload hash if it has none
  event text,                                 -- e.g. AGREEMENT_ACTION_COMPLETED (for the record only)
  provider_agreement_id text,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,                   -- set when handled, or when given up on (see last_error)
  last_error text,
  unique (provider, event_id)
);
create index webhook_inbox_pending on app.webhook_inbox (next_attempt_at) where processed_at is null;

grant usage on all sequences in schema app to veqms_app;
revoke delete, truncate on app.webhook_inbox from veqms_app;

reset role;
