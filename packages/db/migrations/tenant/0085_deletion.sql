-- Deletion (LIF-023, LIF-021, LIF-024, VER-047, VER-048; the DL plan, DL-A to DL-F; lifecycle.md): a
-- component or a document deleted is a tombstone, refused while anything depends on it. Nothing is
-- removed.

-- Each act, inserted and never changed (DL-B): deleted while the latest act a snapshot sees is
-- `deleted`. Only a component or a document, by the key into artifact's (id, kind).
create table artifact_deletion (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  act text not null check (act in ('deleted', 'undeleted')),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict
);
create index artifact_deletion_latest on artifact_deletion (artifact_id, id desc);

-- An act equal to the one before it says nothing happened; the first is never an undelete.
create function artifact_deletion_changes() returns trigger
language plpgsql as $$
declare
  previous text;
begin
  execute format(
    'select act from %I.artifact_deletion where artifact_id = $1 order by id desc limit 1',
    tg_table_schema
  ) into previous using new.artifact_id;
  if coalesce(previous, 'undeleted') = new.act then
    raise exception 'artifact_deletion: % is already %', new.artifact_id, new.act;
  end if;
  return new;
end
$$;

create trigger artifact_deletion_changes before insert on artifact_deletion
  for each row execute function artifact_deletion_changes();

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on artifact_deletion from %I', current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, act, by) on artifact_deletion to %I', current_schema()
  );
  execute format('grant select on artifact_deletion to %I', current_schema());
end
$$;

-- Search leaves it out: set by the acts, and by indexing, so an edit does not bring it back.
alter table search_entry add column deleted boolean not null default false;

-- What a deletion asks of its dependants (DL-C): a baseline pinning any version, a publication or a
-- queued request placing one.
create index baseline_pin_artifact on baseline_pin (artifact_id);
create index publication_input_version on publication_input (version_id);
create index publication_request_occurrence_component
  on publication_request_occurrence (component_id);

-- The kinds gain artifact.undeleted, and retention.changed for DL2. The check is the domain's list
-- again.
alter table audit_event drop constraint audit_event_kind;
alter table audit_event add constraint audit_event_kind check (
    kind in (
      'access.granted',
      'access.refused',
      'access.revoked',
      'approval.given',
      'approval.rejected',
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
      'hold.applied',
      'hold.removed',
      'import.restored',
      'invitation.accepted',
      'invitation.sent',
      'invitation.withdrawn',
      'library.changed',
      'line.merged',
      'lock.taken',
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
      'review.reopened',
      'revision.designated',
      'revision.effective',
      'round.closed',
      'round.opened',
      'secret.accessed',
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
      'thread.resolved',
      'thread.started',
      'token.issued',
      'token.revoked',
      'token.used',
      'tool.used',
      'webhook.changed',
      'workflow.transitioned'
    )
  );
