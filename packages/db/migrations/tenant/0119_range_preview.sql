-- The warm range preview (CNT-151, PUB-080, PUB-076; publishing.md, "The warm range preview"; the R22
-- plan): a request of a third kind, `range`, recording the document's inputs once as a preview's are,
-- and a range preview on it - the occurrence being edited, its author's editing session, and the pages
-- around the edit as PNG images, untagged by design (PUB-061), replaced at each save the session
-- records. Kept an hour after it last changed, then swept with its request.

alter table publication_request
  drop constraint publication_request_kind,
  add constraint publication_request_kind check (kind in ('publish', 'preview', 'range')),
  drop constraint publication_request_preview_whole,
  add constraint publication_request_preview_whole check (
    kind <> 'preview'
    or (
      (state = 'done') = (preview_key is not null)
      and (state = 'done') = (preview_sha256 is not null)
      and (state = 'done') = (preview_bytes is not null)
      and (state = 'done') = (expires_at is not null)
    )
  );

-- 0036's rule, a range's request among what the sweep deletes an hour after it finished; the sweep
-- itself waits an hour past the range's last change.
create or replace function publication_request_swept_only() returns trigger
language plpgsql as $$
begin
  if not (
    old.kind in ('preview', 'range')
    and old.finished_at is not null
    and old.finished_at <= now() - interval '1 hour'
  ) then
    raise exception
      'publication_request: only a preview is deleted, an hour after it finished';
  end if;
  return old;
end
$$;

create table range_preview (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references publication_request on delete cascade,
  document_id uuid not null,
  requested_by uuid not null references principal on delete cascade,
  -- The occurrence being edited, and the component it places.
  node text not null check (node ~ '^[a-z2-7]{26}$'),
  component_id uuid not null,
  -- The author's editing session: its latest iteration is what the range shows of the component.
  session_id uuid not null,
  -- Each refresh asked for counts up; `made` is the last one written, so a reader knows it is current.
  wanted integer not null default 1 check (wanted >= 1),
  made integer not null default 0 check (made >= 0 and made <= wanted),
  -- The iteration the pages show, by its sequence, or none where they show the version.
  sequence integer,
  pages integer check (pages >= 1),
  range_from integer,
  range_to integer,
  failure text,
  changed_at timestamptz not null default now(),
  check ((range_from is null) = (range_to is null) and (range_from is null or range_from <= range_to))
);
create index range_preview_changed on range_preview (changed_at);

-- Each page of the range as the warm compile drew it, replaced whole at each refresh.
create table range_page (
  range_id uuid not null references range_preview on delete cascade,
  page integer not null check (page >= 1),
  png bytea not null,
  primary key (range_id, page)
);
