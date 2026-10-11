-- Publishing a baseline (docs/design/baselines.md; the BL plan, BL-F): a request names the baseline it
-- is made from, and its rows are exactly that baseline's pins, held at commit; the publication names
-- it too, as its request does, and says so in `approval`, which T1 made a closed column for this.

alter table publication_request
  add column baseline_id uuid references baseline on delete restrict;

alter table publication
  add column baseline_id uuid references baseline on delete restrict,
  drop constraint publication_approval_check,
  add constraint publication_approval check (
    (approval = 'none' and baseline_id is null)
    or (approval = 'baseline' and baseline_id is not null)
  );

do $$
begin
  execute format('grant insert (baseline_id) on publication_request to %I', current_schema());
end
$$;

-- A request made from a baseline is that baseline, read from its pins and never resolved again: its
-- document version, layout and theme are the baseline's, and its occurrences, images and bindings are
-- exactly the baseline's, by node, version, resolution and dataset version. Held when the transaction
-- that made it commits, once every row is in.
create function publication_request_is_its_baseline() returns trigger
language plpgsql as $$
declare
  same boolean;
begin
  execute format(
    $check$
    select
      exists (
        select 1 from %1$I.publication_request r join %1$I.baseline b on b.id = r.baseline_id
        where r.id = $1 and r.document_id = b.document_id
          and r.document_version_id = b.document_version_id
          and r.layout_version_id is not distinct from b.layout_version_id
          and r.theme_version_id is not distinct from b.theme_version_id
      )
      and (select count(*) from %1$I.publication_request_occurrence o where o.request_id = $1)
        = (select count(*) from %1$I.baseline_pin p where p.baseline_id = $2 and p.node is not null)
      and not exists (
        select 1 from %1$I.baseline_pin p
        where p.baseline_id = $2 and p.node is not null and not exists (
          select 1 from %1$I.publication_request_occurrence o
          where o.request_id = $1 and o.node = p.node and o.version_id = p.version_id
        )
      )
      and (select count(*) from %1$I.publication_request_asset a where a.request_id = $1)
        = (select count(*) from %1$I.baseline_pin p where p.baseline_id = $2 and p.node is null)
      and not exists (
        select 1 from %1$I.baseline_pin p
        where p.baseline_id = $2 and p.node is null and not exists (
          select 1 from %1$I.publication_request_asset a
          where a.request_id = $1 and a.version_id = p.version_id
        )
      )
      and (select count(*) from %1$I.publication_request_binding q where q.request_id = $1)
        = (select count(*) from %1$I.baseline_binding p where p.baseline_id = $2)
      and not exists (
        select 1 from %1$I.baseline_binding p
        where p.baseline_id = $2 and not exists (
          select 1 from %1$I.publication_request_binding q
          where q.request_id = $1 and q.node = p.node and q.binding = p.binding
            and q.digest = p.digest and q.resolution = p.resolution
            and q.dataset_version = p.dataset_version
        )
      )
    $check$,
    tg_table_schema
  ) into same using new.id, new.baseline_id;
  if same is not true then
    raise exception
      'publication_request: a request made from a baseline is exactly what the baseline pins';
  end if;
  return null;
end
$$;

create constraint trigger publication_request_is_its_baseline
  after insert on publication_request
  deferrable initially deferred
  for each row when (new.baseline_id is not null)
  execute function publication_request_is_its_baseline();

-- A publication names the baseline its request was made from, and only that one.
create function publication_baseline_is_its_requests() returns trigger
language plpgsql as $$
declare
  same boolean;
begin
  execute format(
    'select exists (select 1 from %I.publication_request r '
    'where r.id = $1 and r.baseline_id is not distinct from $2)',
    tg_table_schema
  ) into same using new.request_id, new.baseline_id;
  if same is not true then
    raise exception 'publication: a publication names the baseline its request was made from';
  end if;
  return null;
end
$$;

create constraint trigger publication_baseline_is_its_requests
  after insert on publication
  deferrable initially deferred
  for each row execute function publication_baseline_is_its_requests();
