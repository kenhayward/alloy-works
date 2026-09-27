-- A mutating request's answer, kept against the idempotency key it came with (docs/design/
-- service-foundations.md, "Idempotency"; API-008). Written in the transaction that does the request's
-- work, so a record exists exactly when what it records does; read back for a repeat of the same request
-- with the same key, for a day. One row per principal and key: a principal's keys are their own.
create table idempotency_record (
  principal_id uuid not null references principal on delete cascade,
  key text not null check (key ~ '^[!-~]{1,255}$'),
  -- The route, and a SHA-256 of the method, path, query and body: what a repeat must match.
  operation text not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  status integer not null check (status between 200 and 299),
  body jsonb not null,
  made_at timestamptz not null default now(),
  primary key (principal_id, key)
);
