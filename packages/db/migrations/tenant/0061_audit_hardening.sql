-- The AU1 final review: erasure's search path pinned, and anonymous sign-in failures throttled.

-- `erase_labels` runs as the schema's owner, so it resolves names in this schema alone and then
-- pg_temp, which is last, so nothing a session creates can stand in for a table it names (L8).
do $$
begin
  execute format(
    'alter function erase_labels(uuid) set search_path = %I, pg_temp',
    current_schema()
  );
end
$$;

-- A provider failure naming nobody is recorded at most once a minute per route and failure, its
-- event counting the failures since the last (H1; as a token's use is throttled, AU1-G): an
-- unauthenticated caller cannot write events without limit. One row per route and failure, held
-- `FOR UPDATE` by the upsert that counts, so two failures at once take turns.
create table sign_in_failure_tally (
  route text not null check (route in ('organisation', 'google')),
  failure text not null,
  pending integer not null default 0 check (pending >= 0),
  recorded_at timestamptz,
  primary key (route, failure)
);
do $$
begin
  execute format('revoke delete, truncate on sign_in_failure_tally from %I', current_schema());
end
$$;
