-- The preview sweep (docs/design/publishing.md, "Preview"; PV-F): a preview's request is kept an hour
-- after it finished, for its asker, and then deleted by the worker's sweep, done or failed, with the
-- versions and images it recorded. A publish's request is never deleted: a publication carries its
-- request's id, and nothing sweeps a publish yet.

-- The runtime role may delete a request, and nothing else of what 0017 and 0022 revoked: never truncate
-- the table, and never delete an occurrence or an image of a request itself. Those go with their request
-- by their keys' `on delete cascade` (0017, 0022), which Postgres runs as the table's owner, and no
-- trigger on either table refuses a delete.
do $$
begin
  execute format('grant delete on publication_request to %I', current_schema());
end
$$;

-- Whatever role deletes it, a request is deleted only as the sweep deletes one: a preview, finished an
-- hour ago or more by the database's clock, which is the clock that finished it. So a publish is never
-- deleted, nor a preview still queued, nor one its asker may still be reading.
create function publication_request_swept_only() returns trigger
language plpgsql as $$
begin
  if not (
    old.kind = 'preview'
    and old.finished_at is not null
    and old.finished_at <= now() - interval '1 hour'
  ) then
    raise exception
      'publication_request: only a preview is deleted, an hour after it finished';
  end if;
  return old;
end
$$;

create trigger publication_request_swept_only before delete on publication_request
  for each row execute function publication_request_swept_only();

-- The sweep finds what it deletes by kind and time.
create index publication_request_preview_finished on publication_request (finished_at)
  where kind = 'preview';
