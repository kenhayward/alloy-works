-- SCIM (the ID plan, IDc; docs/design/identity.md, "SCIM"; IAM-008): a provider provisions through a
-- service identity of its own, its people linked by the claim it names, never by email (IN-E).
alter table identity_provider
  add column scim_claim text not null default 'sub' check (scim_claim in ('sub', 'oid')),
  add column scim_identity uuid references principal;

-- A principal's provider, and the value of its claim from their last sign-in or their push. Everybody
-- signed in so far has their subject as that value, under the default claim. `provisioned_at` is who a
-- provider has pushed, and null again once it deletes them.
alter table principal
  add column provider_id uuid references identity_provider,
  add column provider_key text,
  add column scim_user_name text,
  add column provisioned_at timestamptz;
update principal p set provider_id = i.id, provider_key = p.subject
  from identity_provider i where i.issuer = p.issuer;
create unique index principal_provider_key on principal (provider_id, provider_key)
  where provider_key is not null;

-- Somebody pushed need have no identity yet, and no address.
alter table principal drop constraint principal_invited_by_address;
alter table principal add constraint principal_invited_by_address
  check (issuer is not null or email is not null or kind = 'service' or provider_id is not null);

-- A SCIM group, held whether or not a group here stands for it, so one made later picks up its members.
create table scim_group (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references identity_provider on delete cascade,
  display_name text not null,
  external_id text,
  created_at timestamptz not null default now(),
  unique (provider_id, display_name)
);
create table scim_group_member (
  scim_group_id uuid not null references scim_group on delete cascade,
  principal_id uuid not null references principal on delete cascade,
  primary key (scim_group_id, principal_id)
);
create index scim_group_member_principal on scim_group_member (principal_id);

do $$
begin
  execute format(
    'grant update (provider_id, provider_key, scim_user_name, provisioned_at, display_name, email, email_verified, issuer, subject) on principal to %I',
    current_schema()
  );
end
$$;

-- The kinds gain scim.provisioned. The check is the domain's list again.
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
