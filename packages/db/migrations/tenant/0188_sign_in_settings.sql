-- What Administration's Sign-in needs (the ID plan, IDb; docs/design/identity.md): an environment's
-- session lifetimes (IAM-038), a sign-in asked for again within a session (IAM-012), and people disabled
-- by hand and later by SCIM.

-- One row, today's fixed lifetimes (IAM-038; IN-F).
create table session_settings (
  singleton boolean primary key default true check (singleton),
  idle_minutes integer not null default 60 check (idle_minutes between 5 and 1440),
  absolute_hours integer not null default 12 check (absolute_hours between 1 and 720)
);
insert into session_settings default values;

-- When a session's person last authenticated: at its start, and again at each re-authentication.
alter table session add column authenticated_at timestamptz not null default now();
update session set authenticated_at = created_at;

-- A re-authentication goes through a sign-in's callbacks, marking the session asking rather than making
-- one (IAM-012). It is accepted only for an authentication after the attempt began.
alter table sign_in_attempt
  add column created_at timestamptz not null default now(),
  add column session_id uuid references session on delete cascade;
alter table sign_in_handoff add column session_id uuid references session on delete cascade;

-- A person disabled: no session, no token, and no way back in until enabled.
alter table principal
  add column disabled_at timestamptz,
  add column disabled_by text check (disabled_by in ('person', 'scim')),
  add constraint principal_disabled_whole check ((disabled_at is null) = (disabled_by is null));

do $$
begin
  execute format('grant update (disabled_at, disabled_by) on principal to %I', current_schema());
  execute format('grant update (authenticated_at) on session to %I', current_schema());
  execute format('grant update (through_google) on invitation to %I', current_schema());
end
$$;

-- The kinds gain sign_in.configured, authentication.reauthenticated and a person's disablement. The
-- check is the domain's list again.
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
      'round.closed',
      'round.opened',
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
