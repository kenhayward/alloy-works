-- The budget (GEN-034, ADM-013, ADM-014, ADM-034; the G6 plan, G6-B to G6-D): the environment's
-- monthly limit on what models cost, in one currency, with the percents at which it alerts; who is
-- told; and which alerts a month has sent. Nothing stops when it is spent.

create table generation_budget (
  only_one boolean primary key default true check (only_one),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  limit_micros bigint not null check (limit_micros between 1 and 1000000000000000),
  -- Ascending, each from 1 to 100, at least one below 100: an alert before the limit (ADM-013).
  thresholds integer[] not null check (
    cardinality(thresholds) between 1 and 5
    and thresholds[1] < 100
    and 1 <= all (thresholds) and 100 >= all (thresholds)
  ),
  set_by uuid references principal on delete set null,
  set_at timestamptz not null default now()
);

create table generation_budget_recipient (
  principal_id uuid primary key references principal on delete cascade,
  added_by uuid references principal on delete set null,
  added_at timestamptz not null default now()
);

-- Each threshold alerts once a month at a limit: a changed limit may alert again.
create table generation_budget_alert (
  month date not null,
  threshold integer not null,
  limit_micros bigint not null,
  at timestamptz not null default now(),
  primary key (month, threshold, limit_micros)
);

-- A budget's notification (G6-D): to a recipient, from nobody, on nothing; its counts say how much.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind = 'budget' and actor is null and round_id is null and thread_id is null
          and artifact_id is null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget') and actor is not null and thread_id is not null
          and round_id is null and artifact_id is not null)
    )
  );

-- The audit log's kinds gain the budget's.
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
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
