-- A publication's PDF whose accessibility check was given up for good (W14.1, from its final review).
-- A `check_pdf` job that fails its last attempt is queued again by the worker's sweep (0040), but only
-- so often: once a publication's checks have given up three times, the sweep leaves it, and records so
-- here, so its page can say it could not be checked rather than that it is not checked yet. The count
-- of given-up jobs is the platform's, in a queue no tenant's role may read; this row is what the sweep
-- decided from it, written as the tenant, where the service reads it with the publication.
--
-- One row per PDF output, keyed to the output itself, and insert-only for the runtime role: what was
-- given up was given up. A check recorded afterwards - by a job queued by hand - still stands beside it,
-- and a check is what the page shows where there is one. Deleted only with its publication.
create table publication_check_given_up (
  publication_id uuid not null references publication on delete cascade,
  format text not null check (format = 'pdf'),
  -- How many of its checks had given up when the sweep left it.
  give_ups integer not null check (give_ups > 0),
  given_up_at timestamptz not null default now(),
  primary key (publication_id, format),
  foreign key (publication_id, format)
    references publication_output (publication_id, format) on delete cascade
);

-- Select and insert, and the insert by what was decided alone: never the time, which is the database's.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on publication_check_given_up from %I',
    current_schema()
  );
  execute format(
    'grant insert (publication_id, format, give_ups) on publication_check_given_up to %I',
    current_schema()
  );
  execute format('grant select on publication_check_given_up to %I', current_schema());
end
$$;
