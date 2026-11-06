-- The mail queue (mail.md; the EM plan, EM-F to EM-N): a row a mail to send, holding whom it is to and
-- why, never an address or a word of it, so erasing a person or their address leaves nothing to send;
-- and every attempt, its code and the relay's SMTP code, never the relay's words (EM-N).

-- Whether the channel is failing, since when, and its last success (EM-N).
alter table mail_channel
  add column failing_since timestamptz,
  add column last_success_at timestamptz;

create table email_delivery (
  -- Its `Message-ID` and `X-Alloy-Event-Id`, kept across retries (EM-L).
  id uuid primary key default gen_random_uuid(),
  -- A test is the first; notifications, invitations and closure notices follow (EMc, EMd).
  purpose text not null check (purpose in ('test')),
  principal_id uuid not null references principal (id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'sent', 'given_up', 'dropped')),
  -- Why it was never sent, decided again at sending (EM-G).
  dropped_reason text check (dropped_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint email_delivery_dropped_why check ((state = 'dropped') = (dropped_reason is not null)),
  attempts integer not null default 0 check (attempts >= 0),
  next_at timestamptz not null default now(),
  locked_until timestamptz,
  -- Its age is counted from here, its first claim, so one never recorded still ages; a wait costs
  -- no attempt (EM-M).
  first_attempt_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_delivery_due on email_delivery (next_at) where state = 'pending';
create index email_delivery_listing on email_delivery (created_at desc, id);
create index email_delivery_principal on email_delivery (principal_id);

create table email_attempt (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references email_delivery on delete cascade,
  at timestamptz not null default now(),
  -- The connector's code where it was not sent, and the relay's SMTP code where it gave one.
  failure text check (failure ~ '^[a-z][a-z0-9_]{0,63}$'),
  smtp_code integer check (smtp_code between 200 and 599),
  latency_ms integer not null check (latency_ms >= 0)
);
create index email_attempt_delivery on email_attempt (delivery_id, at);
