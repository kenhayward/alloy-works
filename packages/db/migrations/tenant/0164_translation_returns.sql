-- A translation job's file returned (docs/design/translation.md, "Translation jobs"; the XL plan, XL-F,
-- XL-G): the file kept by its hash as it came, read by the worker; each item it made a version of, held
-- for a person with the words that came back, or refused; and what a conflicted return is offered first.

set constraints all immediate;

create table translation_job_return (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references translation_job on delete restrict,
  object_key text not null check (char_length(object_key) between 1 and 200),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes int not null check (bytes >= 0),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  state text not null default 'reading' check (state in ('reading', 'read', 'failed')),
  -- Why the file was refused whole, as a code; null unless failed.
  failure text check (failure is null or char_length(failure) between 1 and 40),
  returned int check (returned >= 0),
  held int check (held >= 0),
  refused int check (refused >= 0),
  read_at timestamptz,
  constraint translation_job_return_read check ((state = 'reading') = (read_at is null)),
  constraint translation_job_return_failed check ((state = 'failed') = (failure is not null))
);
create index translation_job_return_job on translation_job_return (job_id, at desc);
create index translation_job_return_object on translation_job_return (object_key);

-- What came back of an item, and the words held for a person where it was not applied (XL-G): the
-- variant's content as read, which a decision cuts or drops.
alter table translation_job_item add column return_id uuid references translation_job_return on delete restrict;
alter table translation_job_item add column held_content jsonb
  check (held_content is null or jsonb_typeof(held_content) = 'object');
alter table translation_job_item add constraint translation_job_item_held check (
  (held_content is null) or outcome = 'held'
);

-- What a conflicted return is offered first (LOC-035, LOC-036): a person always decides.
alter table translation_policy add column conflict text not null default 'review'
  check (conflict in ('review', 'accept', 'reject'));

do $$
begin
  execute format('revoke insert, update, delete, truncate on translation_job_return from %I', current_schema());
  execute format(
    'grant select, insert (id, job_id, object_key, sha256, bytes, by), update (state, failure, returned, held, refused, read_at) on translation_job_return to %I',
    current_schema()
  );
  execute format(
    'grant update (return_id, held_content) on translation_job_item to %I',
    current_schema()
  );
  execute format('grant update (conflict) on translation_policy to %I', current_schema());
end
$$;

-- The kinds gain translation.job_returned and translation.job_decided. The check is the domain's list again.
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
      'translation.marked_current',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
