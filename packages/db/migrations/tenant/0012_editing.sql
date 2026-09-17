-- The lock (component-editor.md, "The session"; COL-011): one row per component while somebody holds
-- it, naming the principal and the editing session. A lock whose expires_at has passed holds nothing,
-- and its row stays until somebody claims the component or its holder releases it - so a timeout is a
-- clock, never a job, and cuts nothing (COL-010).
create table component_lock (
  artifact_id uuid primary key,
  -- Only a component is locked: carried so the key below can require it.
  kind text not null default 'component' check (kind = 'component'),
  principal_id uuid not null references principal on delete restrict,
  session_id uuid not null,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint component_lock_expires_after_claim check (expires_at > claimed_at)
);

-- The ephemeral store (storage-and-versioning.md, "Stores"): a whole snapshot of a component's content
-- and metadata values, written by its lock holder's editing session. Nothing references this table, which
-- is what keeps iterations out of comparison, audit and anything a reader sees (VER-005).
--
-- VER-003 keeps an iteration until the component's next version is cut, and for a declared window after
-- that: a sweep may remove a row only once it is past expires_at AND a later version of its artifact_id
-- exists. A sweep that instead deletes on expires_at alone, before any cut, could remove the only copy
-- of unsaved work while its session is still open (the editor plan's finding 2). Nothing here sweeps yet.
create table iteration (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  kind text not null default 'component' check (kind = 'component'),
  -- The editor who wrote it (VER-001): a reference, never a copy of their details.
  principal_id uuid not null references principal on delete restrict,
  session_id uuid not null,
  sequence integer not null check (sequence >= 1),
  -- The version the session opened from, which was the latest when this was accepted.
  opened_from uuid not null references artifact_version on delete restrict,
  created_at timestamptz not null default now(),
  -- Set at insert from the retention window, so changing the window never revives a row (VER-004). Not
  -- itself a deletion trigger: a row past expires_at is swept only once a later version also exists.
  expires_at timestamptz not null,
  content jsonb not null,
  metadata_values jsonb not null,
  -- SHA-256 over the canonical content and values: how a repeated sequence is told from a conflict.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  -- A sequence is accepted once per session, for its own principal: a retry makes no second row. A
  -- session id is chosen by the client and is not unique per principal, so principal_id is part of
  -- this key too - otherwise a session id reused by a second principal could collide on a sequence
  -- number the first principal already holds, rather than being accepted as that second principal's
  -- own row.
  unique (artifact_id, principal_id, session_id, sequence),
  constraint iteration_values_shape check (jsonb_typeof(metadata_values) = 'object'),
  constraint iteration_expires_after_creation check (expires_at > created_at)
);

-- VER-001 is a grant: the runtime role inserts and reads iterations and does nothing else to them.
-- Expiring them is a sweep nothing here runs yet, made by a role that is not the one serving requests.
-- The lock keeps the default grants: it is the runtime role's to claim, extend, move and release.
do $$
begin
  execute format('revoke update, delete, truncate on iteration from %I', current_schema());
end
$$;
