-- Webhooks (webhooks.md; the WB plan): subscriptions, each a service identity's; deliveries, queued by
-- trigger in the act's own transaction (WB-D); and every attempt at one, kept for an administrator
-- (API-029).

create table webhook_subscription (
  id uuid primary key default gen_random_uuid(),
  -- Whose view decides what it receives (WB-B).
  service_identity uuid not null references service_identity (principal_id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  description text not null default ''
    check (description = btrim(description) and char_length(description) <= 500),
  event_types text[] not null check (
    event_types <@ array['content.version_cut', 'content.restored', 'artifact.archived', 'artifact.unarchived', 'workflow.transitioned', 'approval.given', 'gate.rejected', 'revision.effective', 'round.opened', 'round.closed', 'review.completed', 'review.reopened', 'review.lapsed', 'publication.requested', 'publication.produced', 'publication.failed', 'notification.created']::text[]
    and cardinality(event_types) between 1 and 17
  ),
  -- The signing secret, sealed by the connector to this subscription and its URL (WB-G); the one it
  -- replaced, which signs beside it until `previous_until`.
  sealed text not null,
  sealed_previous text,
  previous_until timestamptz,
  created_by uuid references principal on delete set null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason in ('failing', 'identity_disabled')),
  constraint webhook_subscription_disabled check ((disabled_at is null) = (disabled_reason is null)),
  -- What the disabling rule reads (WB-E).
  last_success_at timestamptz,
  failing_since timestamptz
);

create table webhook_delivery (
  -- The payload's `id`, kept across retries, so a receiver deduplicates by it.
  id uuid primary key,
  subscription_id uuid not null references webhook_subscription on delete cascade,
  type text not null,
  -- `audit:<n>` or `notification:<n>` (WB-C).
  sequence text not null,
  -- What readability is asked of at each attempt, where the event names an artifact (WB-B).
  artifact_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  state text not null default 'pending'
    check (state in ('pending', 'delivered', 'given_up', 'dropped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_at timestamptz not null default now(),
  locked_until timestamptz,
  first_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, sequence)
);
create index webhook_delivery_due on webhook_delivery (next_at) where state = 'pending';
create index webhook_delivery_listing on webhook_delivery (subscription_id, created_at desc, id);
create index webhook_delivery_kept on webhook_delivery (created_at);

create table webhook_attempt (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references webhook_delivery on delete cascade,
  at timestamptz not null default now(),
  -- The receiver's status, or null where it gave none.
  status integer check (status between 100 and 599),
  latency_ms integer not null check (latency_ms >= 0),
  failure text check (failure ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- At most 2 KiB of what it answered (WB-F).
  reply text check (char_length(reply) <= 2048)
);
create index webhook_attempt_delivery on webhook_attempt (delivery_id, at);

-- A notification's own sequence, so its event carries one (WB-C).
alter table notification add column sequence bigint generated always as identity;

-- An audited act of a wanted type queues a delivery for each enabled subscription wanting it, in the
-- act's own transaction: a rolled-back act queues nothing, a committed one queues it once (WB-D).
create function webhook_queue_audit() returns trigger
language plpgsql
as $$
begin
  if new.outcome <> 'done' or new.kind not in ('content.version_cut', 'content.restored', 'artifact.archived', 'artifact.unarchived', 'workflow.transitioned', 'approval.given', 'gate.rejected', 'revision.effective', 'round.opened', 'round.closed', 'review.completed', 'review.reopened', 'review.lapsed', 'publication.requested', 'publication.produced', 'publication.failed') then
    return null;
  end if;
  insert into webhook_delivery (id, subscription_id, type, sequence, artifact_id, payload)
  select d.id, s.id, new.kind, 'audit:' || new.sequence, new.subject,
         jsonb_build_object(
           'type', new.kind,
           'id', d.id,
           'sequence', 'audit:' || new.sequence,
           'at', new.at,
           'subject', jsonb_build_object(
             'kind', new.subject_kind, 'id', new.subject, 'version', new.subject_version),
           'detail', new.detail)
  from webhook_subscription s
  cross join lateral (select gen_random_uuid() as id) d
  where s.disabled_at is null and new.kind = any (s.event_types);
  return null;
end
$$;
create trigger webhook_queue_audit after insert on audit_event
  for each row execute function webhook_queue_audit();

-- A notification queues one for each enabled subscription of the identity it is addressed to.
create function webhook_queue_notification() returns trigger
language plpgsql
as $$
begin
  insert into webhook_delivery (id, subscription_id, type, sequence, artifact_id, payload)
  select d.id, s.id, 'notification.created', 'notification:' || new.sequence, new.artifact_id,
         jsonb_build_object(
           'type', 'notification.created',
           'id', d.id,
           'sequence', 'notification:' || new.sequence,
           'at', new.at,
           'subject', jsonb_build_object(
             'kind', 'notification', 'id', new.id, 'artifact', new.artifact_id),
           'detail', jsonb_build_object(
             'kind', new.kind, 'thread', new.thread_id, 'round', new.round_id))
  from webhook_subscription s
  cross join lateral (select gen_random_uuid() as id) d
  where s.disabled_at is null and s.service_identity = new.recipient
    and 'notification.created' = any (s.event_types);
  return null;
end
$$;
create trigger webhook_queue_notification after insert on notification
  for each row execute function webhook_queue_notification();
