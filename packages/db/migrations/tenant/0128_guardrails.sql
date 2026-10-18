-- Guardrails (GEN-049; the G5 plan, G5-F): phrases a tenant forbids in what a model is sent and in
-- what it returns, each with its reason, set and retired by an administrator and audited. A phrase,
-- never a pattern: no tenant expression runs in the service. A retired rule is kept, as the reason a
-- run was refused.

create table guardrail (
  id uuid primary key default gen_random_uuid(),
  phrase text not null check (char_length(phrase) between 1 and 200),
  applies text not null check (applies in ('sent', 'returned', 'both')),
  reason text not null check (char_length(reason) between 1 and 500),
  made_by uuid references principal on delete set null,
  made_at timestamptz not null default now(),
  retired_at timestamptz
);

-- A rule is made and retired, once; nothing else of it changes, and none is deleted.
create function guardrail_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'guardrail: a rule is kept, never deleted';
  end if;
  if new.made_by is null and old.made_by is not null
    and (to_jsonb(new) - 'made_by') = (to_jsonb(old) - 'made_by') then
    return new;
  end if;
  if old.retired_at is not null or new.retired_at is null
    or (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at') then
    raise exception 'guardrail: a rule is retired once, and nothing else of it changes';
  end if;
  return new;
end
$$;
create trigger guardrail_kept before update or delete on guardrail
  for each row execute function guardrail_kept();

-- The audit log's kinds gain the guardrails'.
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
      'generation.discarded',
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
