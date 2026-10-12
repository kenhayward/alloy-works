-- Threads, the inbox and review (collaboration.md; the TH plan, TH-A): a thread beside the content,
-- never in it (COL-019); comments and every text a comment has had (COL-051); a resolution, once
-- (COL-013); nothing deleted (COL-049, COL-050). And the inbox: a notification per recipient, a daily
-- event held for the fold, and each person's cadence per kind (COL-034, COL-035, COL-063).

create table thread (
  id uuid primary key default gen_random_uuid(),
  on_id uuid not null,
  on_kind text not null constraint thread_on_kind check (on_kind in ('component', 'document')),
  -- The version it was made against (COL-050), of what it is on.
  made_against uuid not null,
  -- Its anchor by kind (TH-C), checked at the door by `anchorStands`: a span or a cell or the whole
  -- of a component, or a node of a document.
  anchor jsonb not null
    constraint thread_anchor check (
      jsonb_typeof(anchor) = 'object'
      and (
        (on_kind = 'component' and anchor->>'kind' in ('span', 'cell', 'component'))
        or (on_kind = 'document' and anchor->>'kind' = 'node')
      )
    ),
  created_by uuid not null references principal on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (on_id, on_kind) references artifact (id, kind) on delete restrict,
  foreign key (made_against, on_id, on_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index thread_on on thread (on_id, created_at);

create table thread_comment (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references thread on delete restrict,
  author uuid not null references principal on delete restrict,
  created_at timestamptz not null default now()
);
create index thread_comment_thread on thread_comment (thread_id, created_at, id);

-- Every text a comment has had, the latest its own (COL-051): an edit adds a row.
create table thread_comment_text (
  id bigint generated always as identity primary key,
  comment_id uuid not null references thread_comment on delete restrict,
  parts jsonb not null constraint thread_comment_text_parts check (jsonb_typeof(parts) = 'array'),
  written_at timestamptz not null default now()
);
create index thread_comment_text_comment on thread_comment_text (comment_id, id);

-- Resolved once, by whom and when (COL-013); never reopened (TH-K).
create table thread_resolution (
  thread_id uuid primary key references thread on delete restrict,
  resolved_by uuid not null references principal on delete restrict,
  resolved_at timestamptz not null default now()
);

-- A notification: what happened, to whom, by whom, about which thread and artifact, and when - never
-- the text (COL-036). A digest carries counts of what it folded and identifiers alone (COL-053).
create table notification (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references principal on delete cascade,
  kind text not null
    constraint notification_kind check (kind in ('mention', 'reply', 'resolution', 'digest')),
  actor uuid references principal on delete restrict,
  thread_id uuid references thread on delete restrict,
  artifact_id uuid references artifact on delete restrict,
  counts jsonb,
  at timestamptz not null default now(),
  read_at timestamptz,
  constraint notification_digest check (
    (kind = 'digest') = (counts is not null)
    and (kind = 'digest' or (actor is not null and thread_id is not null and artifact_id is not null))
  )
);
create index notification_recipient on notification (recipient, at desc, id);
create index notification_at on notification (at);

-- A daily event, held until the worker folds it into a digest (TH-F).
create table notification_held (
  id bigint generated always as identity primary key,
  recipient uuid not null references principal on delete cascade,
  kind text not null constraint notification_held_kind check (kind in ('mention', 'reply', 'resolution')),
  actor uuid not null references principal on delete restrict,
  thread_id uuid not null references thread on delete restrict,
  artifact_id uuid not null references artifact on delete restrict,
  at timestamptz not null default now()
);
create index notification_held_recipient on notification_held (recipient, at);

-- What each person is told, per kind, and how often (COL-034); none is the default (TH-F).
create table notification_preference (
  principal_id uuid not null references principal on delete cascade,
  kind text not null
    constraint notification_preference_kind check (kind in ('mention', 'reply', 'resolution')),
  cadence text not null
    constraint notification_preference_cadence check (cadence in ('at_once', 'daily', 'never')),
  primary key (principal_id, kind)
);

-- Inserted and read; a thread, a comment, its texts and a resolution never changed or removed
-- (COL-049, COL-050). A notification read, or removed by its recipient or the sweep; held events
-- removed by the fold; a preference set and changed.
do $$
begin
  execute format(
    'revoke update, delete, truncate on thread, thread_comment, thread_comment_text, '
    'thread_resolution from %I',
    current_schema()
  );
  execute format('revoke update, truncate on notification, notification_held from %I', current_schema());
  execute format('grant update (read_at) on notification to %I', current_schema());
  execute format('revoke truncate on notification_preference from %I', current_schema());
end
$$;

-- The kinds the TH plan builds: a thread started, a comment added or edited, a thread resolved. The
-- check is the domain's list again.
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
      'revision.designated',
      'revision.effective',
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
      'suggestion.rejected',
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
