-- Archival (LIF-020; the AH plan, AH-A to AH-E; lifecycle.md): a component or a document archived
-- leaves ordinary listings and search, and stays retrievable.

-- The closed sets gain `retire` (ADR-0060), which a token may be scoped to as to every permission but
-- `read`.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

alter table api_token drop constraint api_token_scopes_closed;
alter table api_token add constraint api_token_scopes_closed check (
  scopes <@ array[
    'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire'
  ]::text[]
  and (array_ndims(scopes) = 1 or scopes = '{}')
  and api_token_scopes_distinct(scopes)
);

-- Administrator gains it, edited or not (AH-A): whoever administers may retire.
update role set permissions = permissions || array['retire']
  where name = 'Administrator' and not 'retire' = any(permissions);

-- Each act, inserted and never changed (AH-C): archived while the latest act a snapshot sees is
-- `archived`. Only a component or a document, by the key into artifact's (id, kind).
create table artifact_archival (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  act text not null check (act in ('archived', 'unarchived')),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict
);
create index artifact_archival_latest on artifact_archival (artifact_id, id desc);

-- An act equal to the one before it says nothing happened; the first is never an unarchive.
create function artifact_archival_changes() returns trigger
language plpgsql as $$
declare
  previous text;
begin
  execute format(
    'select act from %I.artifact_archival where artifact_id = $1 order by id desc limit 1',
    tg_table_schema
  ) into previous using new.artifact_id;
  if coalesce(previous, 'unarchived') = new.act then
    raise exception 'artifact_archival: % is already %', new.artifact_id, new.act;
  end if;
  return new;
end
$$;

create trigger artifact_archival_changes before insert on artifact_archival
  for each row execute function artifact_archival_changes();

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on artifact_archival from %I', current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, act, by) on artifact_archival to %I', current_schema()
  );
  execute format('grant select on artifact_archival to %I', current_schema());
end
$$;

-- Search leaves it out (AH-D): set by the acts, and by indexing, so an edit does not bring it back.
alter table search_entry add column archived boolean not null default false;

-- The kinds gain artifact.unarchived. The check is the domain's list again.
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
