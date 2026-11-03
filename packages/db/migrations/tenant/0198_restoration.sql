-- A tenant restored from its export (the EI plan, EIc).
create table restoration (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references principal on delete restrict,
  requested_at timestamptz not null default now(),
  state text not null default 'awaiting_archive' check (state in (
    'awaiting_archive', 'checking', 'previewed', 'refused', 'applying', 'restored', 'failed'
  )),
  object_key text,
  sha256 text,
  plan jsonb,
  answers jsonb,
  refusal jsonb,
  finished_at timestamptz
);
create index restoration_requested on restoration (requested_at desc, id desc);

-- That this tenant was restored, once, and whether what fell due has been looked at (EI-M).
create table tenant_restore (
  only_one boolean primary key default true check (only_one),
  restoration_id uuid not null references restoration on delete restrict,
  restored_at timestamptz not null default now(),
  due_reviewed_at timestamptz,
  due_reviewed_by uuid references principal on delete restrict
);

-- Each restored event, beside its new sequence: not signed, so the database cannot vouch for it (EI-H).
create table audit_restored (
  sequence bigint primary key,
  original_sequence bigint not null,
  restore_id uuid not null
);

-- A webhook may arrive with no secret, off (EI-G).
alter table webhook_subscription alter column sealed drop not null;
alter table webhook_subscription drop constraint webhook_subscription_disabled_reason_check;
alter table webhook_subscription add constraint webhook_subscription_disabled_reason_check check (
  disabled_reason in ('failing', 'identity_disabled', 'restored')
);

alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'import_environment'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

-- Nobody loses an act on upgrade. No token holds this one: restoring is a person's act (IMP-048).
update role set permissions = permissions || array['import_environment']
  where 'administer' = any(permissions);

alter table audit_event drop constraint audit_event_kind;
alter table audit_event add constraint audit_event_kind check (
    kind in (
      'import.previewed',
      'import.refused',
      'import.review_ended',
      'access.granted',
      'access.refused',
      'access.revoked',
      'approval.given',
      'artifact.archived',
      'artifact.deleted',
      'artifact.moved',
      'artifact.unarchived',
      'artifact.undeleted',
      'asset.derivatives_discarded',
      'asset.ingested',
      'asset.refused',
      'asset.relicensed',
      'asset.replaced',
      'audit.label_erased',
      'authentication.reauthenticated',
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
      'principal.disabled',
      'principal.enabled',
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
      'role.made',
      'round.closed',
      'round.opened',
      'scim.provisioned',
      'scope.set',
      'secret.accessed',
      'section.waived',
      'service_identity.created',
      'service_identity.disabled',
      'service_identity.renamed',
      'settings.changed',
      'sign_in.configured',
      'sign_in_route.closed',
      'sign_in_route.configured',
      'space.archived',
      'space.language_changed',
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
      'theme.declared',
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
