-- The delivery bridge's stored shapes (docs/design/ct-studio-sink.md; the CS plan, Task 5; API-067,
-- API-068, API-071): a delivery CT Studio asked for, the elements a document's persistent identity has
-- made, and a space's bridge settings. Nothing here holds content: a delivery names the artifacts it
-- made and keeps the source's provenance, never its words.

-- A delivery, by its key. The key is unique while the delivery is open or written; a refused delivery
-- gives its key up (null), so a retry with the same key starts fresh and the row stays as the record.
create table bridge_delivery (
  id uuid primary key default gen_random_uuid(),
  key text unique check (key <> ''),
  space_id uuid not null references space on delete restrict,
  family text not null check (family in ('document', 'data')),
  state text not null default 'running' check (state in ('running', 'written', 'refused')),
  -- The service identity's token the delivery was asked with, kept to re-check it in the job.
  token_id uuid not null,
  -- The package waiting in the object store for the job; gone once the delivery is written or refused.
  package_key text check (package_key is null or package_key <> ''),
  -- The source document's persistent identity, once the delivery has made or found its document.
  persistent_id uuid,
  receipt jsonb check (receipt is null or jsonb_typeof(receipt) = 'object'),
  refusal jsonb check (refusal is null or jsonb_typeof(refusal) = 'object'),
  -- What the delivery could not carry, with the report flags and unmapped properties (API-071).
  carried jsonb not null default '[]' check (jsonb_typeof(carried) = 'array'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- A written delivery has its receipt, a refused one its refusal and no key, and an open one neither.
  constraint bridge_delivery_state check (
    case state
      when 'running' then receipt is null and refusal is null and finished_at is null and key is not null
      when 'written' then receipt is not null and refusal is null and finished_at is not null and key is not null
      else receipt is null and refusal is not null and finished_at is not null and key is null
    end
  )
);
create index bridge_delivery_space on bridge_delivery (space_id, created_at);
create index bridge_delivery_package on bridge_delivery (package_key) where package_key is not null;
-- The SVG originals a written delivery kept, by key, which every release of an object asks after
-- (`objectInUse`, Ruling 27): containment on the provenance's `originals`.
create index bridge_delivery_originals on bridge_delivery
  using gin ((provenance -> 'originals') jsonb_path_ops);

-- The artifact a source document's element became, by the document's persistent identity, so a
-- redelivery finds what it made before (API-069).
create table bridge_element (
  persistent_id uuid not null,
  element text not null check (element <> ''),
  artifact_id uuid not null references artifact on delete restrict,
  -- The outline node that places it, where it has one.
  node text,
  primary key (persistent_id, element)
);
create index bridge_element_artifact on bridge_element (artifact_id);

-- Per target space: what delivered components and documents are made from, and which template field
-- each property name fills. A space with no row is not set up for delivery.
create table bridge_settings (
  space_id uuid primary key references space on delete restrict,
  component_type uuid,
  template uuid,
  property_map jsonb not null default '{}' check (jsonb_typeof(property_map) = 'object'),
  connection_id uuid,
  table_schema text check (table_schema is null or table_schema <> ''),
  changed_by uuid not null references principal on delete restrict,
  changed_at timestamptz not null default now()
);

-- The kinds gain bridge.delivered, bridge.refused and bridge.settings_changed. The check is the
-- domain's list again.
alter table audit_event drop constraint audit_event_kind;
alter table audit_event add constraint audit_event_kind check (
    kind in (
      'access.granted',
      'access.refused',
      'access.revoked',
      'approval.given',
      'artifact.archived',
      'artifact.deleted',
      'artifact.unarchived',
      'artifact.undeleted',
      'asset.ingested',
      'asset.refused',
      'asset.relicensed',
      'asset.replaced',
      'audit.label_erased',
      'authentication.sign_in_failed',
      'authentication.signed_in',
      'authentication.signed_out',
      'baseline.made',
      'baseline.superseded',
      'binding.accepted',
      'binding.checked',
      'binding.confirmed',
      'binding.resolved',
      'binding.revised',
      'bridge.delivered',
      'bridge.refused',
      'bridge.settings_changed',
      'channel.changed',
      'comment.added',
      'comment.edited',
      'component.type_changed',
      'connection.changed',
      'connection.credential_set',
      'connection.made',
      'connection.retired',
      'connection.tested',
      'content.restored',
      'content.version_cut',
      'dataset.named',
      'dates.set',
      'export.downloaded',
      'export.produced',
      'extension.changed',
      'gate.rejected',
      'generation.accepted',
      'generation.budget_set',
      'generation.discarded',
      'generation.embedding_confirmed',
      'generation.limit_set',
      'generation.run',
      'group.deleted',
      'group.made',
      'group.member_added',
      'group.member_removed',
      'guardrail.retired',
      'guardrail.set',
      'hold.applied',
      'hold.removed',
      'import.abandoned',
      'import.accepted',
      'import.restored',
      'invitation.accepted',
      'invitation.sent',
      'invitation.withdrawn',
      'library.changed',
      'line.diverged',
      'line.merged',
      'line.returned',
      'lock.taken',
      'model_endpoint.changed',
      'model_endpoint.credential_set',
      'model_endpoint.made',
      'model_endpoint.retired',
      'model_endpoint.tested',
      'model_route.set',
      'organisation.changed',
      'publication.failed',
      'publication.produced',
      'publication.requested',
      'publication.shared_accessed',
      'reference.repointed',
      'relationship.changed',
      'relationship.made',
      'relationship.removed',
      'retention.changed',
      'review.completed',
      'review.lapsed',
      'review.reopened',
      'revision.accepted',
      'revision.designated',
      'revision.effective',
      'round.closed',
      'round.opened',
      'scope.set',
      'secret.accessed',
      'section.waived',
      'service_identity.created',
      'service_identity.disabled',
      'service_identity.renamed',
      'settings.changed',
      'sign_in_route.closed',
      'sign_in_route.configured',
      'space.archived',
      'space.made',
      'space.renamed',
      'space.restored',
      'style.changed',
      'suggestion.accepted',
      'suggestion.made',
      'suggestion.rejected',
      'suggestion.withdrawn',
      'support.granted',
      'support.revoked',
      'support.used',
      'template.moved',
      'tenant.administrator_claimed',
      'tenant.administrator_named',
      'tenant.closed',
      'tenant.invited',
      'theme.moved',
      'thread.made_internal',
      'thread.resolved',
      'thread.started',
      'token.issued',
      'token.revoked',
      'token.used',
      'tool.used',
      'translation.declared',
      'translation.job_closed',
      'translation.job_decided',
      'translation.job_returned',
      'translation.job_sent',
      'translation.machine_accepted',
      'translation.marked_current',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);

-- A delivery is a record, kept when it is refused (API-067): the runtime role may change its state and
-- receipt but not delete it. An element's mapping is not a record of an act, and is replaced in place.
do $$
begin
  execute format('revoke delete, truncate on bridge_delivery from %I', current_schema());
end
$$;

-- bridge.delivered and bridge.refused are webhook event types (API-071), queued as 0142 queues the
-- rest. A refusal is recorded with the outcome 'refused', which the guard admits for the bridge's kinds; its
-- subject is the space, whose readability the delivery worker asks of the subscriber.
create or replace function webhook_queue_audit() returns trigger
language plpgsql
as $$
begin
  if (new.outcome <> 'done' and new.kind not like 'bridge.%') or new.kind not in ('content.version_cut', 'content.restored', 'artifact.archived', 'artifact.unarchived', 'workflow.transitioned', 'approval.given', 'gate.rejected', 'revision.effective', 'round.opened', 'round.closed', 'review.completed', 'review.reopened', 'review.lapsed', 'publication.requested', 'publication.produced', 'publication.failed', 'bridge.delivered', 'bridge.refused') then
    return null;
  end if;
  insert into webhook_delivery (id, subscription_id, type, sequence, artifact_id, payload)
  select d.id, d.subscription, new.kind, 'audit:' || new.sequence, new.subject,
         jsonb_build_object(
           'type', new.kind,
           'id', d.id,
           'sequence', 'audit:' || new.sequence,
           'at', new.at,
           'subject', jsonb_build_object(
             'kind', new.subject_kind, 'id', new.subject, 'version', new.subject_version),
           'detail', new.detail)
  from (select gen_random_uuid() as id, s.id as subscription
          from webhook_subscription s
         where s.disabled_at is null and new.kind = any (s.event_types)) d;
  return null;
end
$$;

-- A subscription may want them: the check is the domain's list again (webhookEventTypes).
alter table webhook_subscription drop constraint webhook_subscription_event_types_check;
alter table webhook_subscription add constraint webhook_subscription_event_types_check check (
  event_types <@ array['content.version_cut', 'content.restored', 'artifact.archived', 'artifact.unarchived', 'workflow.transitioned', 'approval.given', 'gate.rejected', 'revision.effective', 'round.opened', 'round.closed', 'review.completed', 'review.reopened', 'review.lapsed', 'publication.requested', 'publication.produced', 'publication.failed', 'bridge.delivered', 'bridge.refused', 'notification.created']::text[]
  and cardinality(event_types) between 1 and 19
);
