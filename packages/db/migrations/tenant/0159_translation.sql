-- Translation (docs/design/translation.md; the TR plan, TR-A to TR-H): a component's variant in a
-- language is a line of its own; each of its versions records the main-line version it translates;
-- a main-line version declares whether it needs retranslating; the editing lock is a line's.

set constraints all immediate;

-- A language line (TR-A): its language a BCP 47 tag the domain checks, one per language per component.
alter table artifact_line add column language text
  check (language is null or char_length(language) between 2 and 35);
create unique index artifact_line_language on artifact_line (artifact_id, language)
  where language is not null;

-- What each version on a language line translates (TR-C): the main-line version the translator was
-- shown, at a cut or by Mark current. Insert-only; the newest row a line's.
create table translation_state (
  id bigint generated always as identity primary key,
  line_id uuid not null references artifact_line on delete restrict,
  version_id uuid not null references artifact_version on delete restrict,
  translates uuid not null references artifact_version on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id()
);
create index translation_state_line on translation_state (line_id, id desc);

-- A recorded source holds whatever its caller (the TR security review): the version is the line's own,
-- and what it translates is a main-line version of the line's own component.
create function translation_state_holds() returns trigger
language plpgsql as $$
declare
  held boolean;
begin
  execute format(
    'select exists (
       select 1 from %1$I.artifact_line l
         join %1$I.artifact_version v on v.id = $2 and v.line_id = l.id
         join %1$I.artifact_version t on t.id = $3 and t.line_id is null
                                      and t.artifact_id = l.artifact_id
        where l.id = $1 and l.language is not null)',
    tg_table_schema
  ) into held using new.line_id, new.version_id, new.translates;
  if not held then
    raise exception 'translation_state: % is not a version of line % translating its own source',
      new.version_id, new.line_id;
  end if;
  return new;
end
$$;
create trigger translation_state_holds before insert on translation_state
  for each row execute function translation_state_holds();

-- Whether a main-line version needs retranslating (TR-D; LOC-015, LOC-031): declared at its cut,
-- revisable. Insert-only; the newest row a version's; a version with none needs it.
create table source_change (
  id bigint generated always as identity primary key,
  version_id uuid not null references artifact_version on delete restrict,
  retranslate boolean not null,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id()
);
create index source_change_version on source_change (version_id, id desc);

-- The editing lock is a line's (TR-H): the main line's row carries no line, as before.
alter table component_lock add column line_id uuid references artifact_line on delete restrict;
alter table component_lock drop constraint component_lock_pkey;
alter table component_lock add constraint component_lock_line unique nulls not distinct (artifact_id, line_id);

do $$
begin
  execute format('revoke insert, update, delete, truncate on translation_state from %I', current_schema());
  execute format(
    'grant insert (line_id, version_id, translates, by) on translation_state to %I',
    current_schema()
  );
  execute format('grant select on translation_state to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on source_change from %I', current_schema());
  execute format('grant insert (version_id, retranslate, by) on source_change to %I', current_schema());
  execute format('grant select on source_change to %I', current_schema());
  execute format('grant insert (language) on artifact_line to %I', current_schema());
end
$$;

-- The kinds gain translation.declared and translation.marked_current. The check is the domain's list again.
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
      'translation.marked_current',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
