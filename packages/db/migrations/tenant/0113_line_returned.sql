-- A line brought back (LIF-045; the R16 plan, R16-F): its record is 0112's line_return; the kinds
-- gain line.returned. And an iteration's line (the R16 final review), so the sweep keeps a line's
-- unsaved work until the line's own next cut, and Recover offers it on that line alone.

set constraints all immediate;

alter table iteration add column line_id uuid references artifact_line on delete restrict;

-- The next cut after an iteration is on its own line: the main line's after a main-line version, the
-- line's after anything a line's iteration opened from.
create or replace function iteration_swept_only() returns trigger
language plpgsql as $$
declare
  cut timestamptz;
  window_days integer;
begin
  execute format(
    'select later.created_at
       from %1$I.artifact_version opened
       join %1$I.artifact_version later on later.artifact_id = opened.artifact_id
      where opened.id = $1
        and (($2::uuid is null and later.line_id is null
              and (later.revision_no, later.version_no) > (opened.revision_no, opened.version_no))
          or ($2::uuid is not null and later.line_id = $2
              and (opened.line_id is null or later.version_no > opened.version_no)))
      order by later.revision_no, later.version_no
      limit 1',
    tg_table_schema
  ) into cut using old.opened_from, old.line_id;
  execute format('select iteration_retention_days from %I.editing_policy', tg_table_schema)
    into window_days;
  if cut is null or window_days is null or cut + make_interval(days => window_days) > now() then
    raise exception
      'iteration: kept until the next version is cut, and for the window after it';
  end if;
  return old;
end
$$;

-- The kinds gain line.returned. The check is the domain's list again.

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
