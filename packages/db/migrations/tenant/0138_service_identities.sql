-- Service identities (IAM-033; the G8 plan, G8-G): a principal of kind `service` that an
-- administrator makes, with no issuer, subject or address, so no sign-in finds it and no invitation
-- claims it; roles are granted to it as to a person, and its tokens are issued by an administrator.

-- A service has no address, and is no invitation.
-- Replaced only where 0014 made it, so a schema migrated without 0014 (its own test) still migrates.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'principal_invited_by_address'
      and conrelid = (current_schema() || '.principal')::regclass
  ) then
    alter table principal drop constraint principal_invited_by_address;
    alter table principal add constraint principal_invited_by_address
      check (issuer is not null or email is not null or kind = 'service');
  end if;
end
$$;

create table service_identity (
  principal_id uuid primary key references principal on delete cascade,
  description text not null default '' check (description = btrim(description) and char_length(description) <= 500),
  created_by uuid references principal on delete set null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

-- Nothing turns a person into a service or a service into a person, and a service never gains an
-- identity a sign-in would find: so no claim, sign-in or update makes one from somebody (IAM-033).
create function principal_service_kept() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (old.kind = 'service') <> (new.kind = 'service') then
    raise exception 'a principal never becomes or stops being a service' using errcode = 'check_violation';
  end if;
  if new.kind = 'service' and (new.issuer is not null or new.subject is not null or new.email is not null) then
    raise exception 'a service has no issuer, subject or address' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger principal_service_kept before insert or update on principal
  for each row execute function principal_service_kept();

-- A service identity's row is a service's.
create function service_identity_is_service() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from principal where id = new.principal_id and kind = 'service') then
    raise exception 'a service identity is a service principal' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger service_identity_is_service before insert or update of principal_id on service_identity
  for each row execute function service_identity_is_service();

-- The audit log's kinds gain the service identity's.
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
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
