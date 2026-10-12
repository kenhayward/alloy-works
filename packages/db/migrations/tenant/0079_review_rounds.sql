-- Review rounds (collaboration.md, Review rounds; the RR plan, RR-A, RR-H): a round naming its
-- reviewers, its scope and its due date, kept against the document version it opened on; each
-- reviewer's acts and the round's closing, insert-only, state derived; and a notification of a round.

create table review_round (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  title text not null
    constraint review_round_title check (
      char_length(title) between 1 and 200 and btrim(title) = title and title is nfc normalized
      and title !~ '[[:cntrl:]]'
    ),
  -- The whole document, or outline nodes of it, each with what is beneath it (RR-B).
  scope text[] not null default '{}'
    constraint review_round_scope check (
      cardinality(scope) <= 200 and array_to_string(scope, ',') ~ '^([a-z2-7]{26}(,[a-z2-7]{26})*)?$'
    ),
  due_at timestamptz not null,
  -- A baseline of the document, which its reviewers read (COL-031), or none.
  baseline_id uuid references baseline on delete restrict,
  -- The document version it opened on, or the baseline's (COL-050).
  made_against uuid not null,
  opened_by uuid not null references principal on delete restrict,
  opened_at timestamptz not null default now(),
  made_tx bigint not null default txid_current(),
  constraint review_round_due check (due_at > opened_at),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  foreign key (made_against, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index review_round_document on review_round (document_id, opened_at desc, id);

-- Its reviewers, named when it opens and never changed (COL-028).
create table review_round_reviewer (
  round_id uuid not null references review_round on delete restrict,
  principal_id uuid not null references principal on delete restrict,
  primary key (round_id, principal_id)
);
create index review_round_reviewer_principal on review_round_reviewer (principal_id);

-- Each reviewer's acts, and the round's closing (RR-A, RR-D): state is read from these alone.
create table review_round_event (
  id bigint generated always as identity primary key,
  round_id uuid not null references review_round on delete restrict,
  act text not null
    constraint review_round_event_act check (act in ('started', 'completed', 'reopened', 'closed')),
  -- A reviewer's act names them; closing names who closed it.
  principal_id uuid not null references principal on delete restrict,
  outcome text
    constraint review_round_event_outcome check (outcome in ('commented', 'nothing_to_say')),
  -- A completion's: the document version it was made against (COL-050).
  version_id uuid references artifact_version on delete restrict,
  at timestamptz not null default now(),
  constraint review_round_event_completion check (
    (act = 'completed') = (outcome is not null) and (act = 'completed') = (version_id is not null)
  )
);
create index review_round_event_round on review_round_event (round_id, id);

-- A reviewer's act is a reviewer's: named on the round. Closing is anybody's the act allows.
create function review_round_event_by_a_reviewer() returns trigger
language plpgsql as $$
declare
  named boolean;
begin
  if new.act = 'closed' then
    return new;
  end if;
  execute format(
    'select exists (select 1 from %I.review_round_reviewer where round_id = $1 and principal_id = $2)',
    tg_table_schema
  ) into named using new.round_id, new.principal_id;
  if not named then
    raise exception 'review_round_event: a reviewer''s act is by a reviewer the round names';
  end if;
  return new;
end
$$;

create trigger review_round_event_by_a_reviewer before insert on review_round_event
  for each row execute function review_round_event_by_a_reviewer();

-- A round and its reviewers are recorded in the transaction that opened it (as a baseline's parts).
create function review_round_reviewer_with_its_round() returns trigger
language plpgsql as $$
declare
  same boolean;
begin
  execute format(
    'select exists (select 1 from %I.review_round where id = $1 and made_tx = txid_current())',
    tg_table_schema
  ) into same using new.round_id;
  if not same then
    raise exception 'review_round_reviewer: a round''s reviewers are named only as it opens';
  end if;
  return new;
end
$$;

create trigger review_round_reviewer_with_its_round before insert on review_round_reviewer
  for each row execute function review_round_reviewer_with_its_round();

-- Inserted and read: nothing changes or removes a round, a reviewer or an act.
do $$
begin
  execute format(
    'revoke update, delete, truncate on review_round, review_round_reviewer, review_round_event from %I',
    current_schema()
  );
end
$$;

-- A notification of a round (RR-H): a reviewer named. It names its round and its document, never a
-- thread; a thread's names its thread. A digest counts rounds beside the rest.
alter table notification
  add column round_id uuid references review_round on delete restrict,
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest')),
  add constraint notification_digest check (
    (kind = 'digest') = (counts is not null)
    and (
      kind = 'digest'
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind <> 'round' and actor is not null and thread_id is not null and round_id is null
          and artifact_id is not null)
    )
  );

alter table notification_held
  add column round_id uuid references review_round on delete restrict,
  alter column thread_id drop not null,
  drop constraint notification_held_kind;
alter table notification_held
  add constraint notification_held_kind check (kind in ('mention', 'reply', 'resolution', 'round')),
  add constraint notification_held_about check (
    (kind = 'round') = (round_id is not null and thread_id is null)
    and (kind = 'round' or thread_id is not null)
  );

alter table notification_preference drop constraint notification_preference_kind;
alter table notification_preference add constraint notification_preference_kind
  check (kind in ('mention', 'reply', 'resolution', 'round'));

-- The kinds the RR plan adds: a round opened and closed, a review completed and reopened. The check is
-- the domain's list again.
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
