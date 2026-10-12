-- Legal holds (LIF-022; the AH plan, AH-F to AH-H; lifecycle.md): placed on an artifact or a space
-- with who, when and why, and released only by a recorded act with its own reason.

-- A hold, inserted and never changed (AH-F): on an artifact, by the key into artifact's (id, kind), or
-- on a space, never both. The kinds a deletion would reach that a matter may need: content and what
-- was published of it. The reason is trimmed by its writer and kept here alone (LIF-030).
create table legal_hold (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid,
  kind text check (kind in ('component', 'document', 'publication', 'asset')),
  space_id uuid references space on delete restrict,
  reason text not null check (reason <> '' and reason = btrim(reason) and length(reason) <= 2000),
  applied_by uuid not null references principal on delete restrict,
  applied_at timestamptz not null default now(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint legal_hold_artifact_kind check ((artifact_id is null) = (kind is null)),
  constraint legal_hold_one_target check ((artifact_id is null) <> (space_id is null))
);
create index legal_hold_artifact on legal_hold (artifact_id) where artifact_id is not null;
create index legal_hold_space on legal_hold (space_id) where space_id is not null;

-- Its release, once (the key), with a reason of its own: in force while it has none.
create table legal_hold_release (
  hold_id uuid primary key references legal_hold on delete restrict,
  reason text not null check (reason <> '' and reason = btrim(reason) and length(reason) <= 2000),
  released_by uuid not null references principal on delete restrict,
  released_at timestamptz not null default now()
);

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on legal_hold, legal_hold_release from %I',
    current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, space_id, reason, applied_by) on legal_hold to %I',
    current_schema()
  );
  execute format(
    'grant insert (hold_id, reason, released_by) on legal_hold_release to %I', current_schema()
  );
  execute format('grant select on legal_hold, legal_hold_release to %I', current_schema());
end
$$;
