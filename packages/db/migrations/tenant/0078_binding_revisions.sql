-- A value revised by hand (docs/design/bindings.md, "A value revised by hand"; the RV plan, RV-A, RV-D
-- and RV-E): a person's value standing in front of a resolution, never in place of it (DAT-058); the
-- decision a resolve waiting on its images carries; and the revisions each request, publication and
-- baseline read.

create table binding_revision (
  id bigint generated always as identity primary key,
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  node_id text not null constraint binding_revision_node check (node_id ~ '^[a-z2-7]{26}$'),
  binding_id text not null
    constraint binding_revision_binding check (
      char_length(binding_id) >= 1 and binding_id is nfc normalized
    ),
  -- '' for an inline binding; a bound table's cell as the canonical JSON of { key, column } (RV-A).
  cell text not null
    constraint binding_revision_cell check (cell = '' or jsonb_typeof(cell::jsonb) = 'object'),
  -- The resolution it stands in front of: of the same document, node and binding (below).
  resolution bigint not null references binding_resolution (id) on delete restrict,
  act text not null constraint binding_revision_act check (act in ('revise', 'withdraw')),
  -- Canonical in its column's type, a string or a boolean, never blank; none exactly for a withdrawal.
  value jsonb
    constraint binding_revision_value check (
      (act = 'withdraw') = (value is null)
      and (
        value is null
        or jsonb_typeof(value) = 'boolean'
        or (
          jsonb_typeof(value) = 'string'
          and char_length(value #>> '{}') between 1 and 10000
          and btrim(value #>> '{}') <> ''
          and (value #>> '{}') is nfc normalized
          and (value #>> '{}') !~ '[[:cntrl:]]'
        )
      )
    ),
  reason text not null
    constraint binding_revision_reason check (
      char_length(reason) between 1 and 1000
      and btrim(reason) <> ''
      and reason is nfc normalized
      and reason !~ '[[:cntrl:]]'
    ),
  replaces bigint references binding_revision (id) on delete restrict,
  revised_by uuid not null references principal on delete restrict,
  revised_at timestamptz not null default now(),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict
);
create index binding_revision_latest
  on binding_revision (document_id, node_id, binding_id, cell, id desc);
create index binding_revision_resolution on binding_revision (resolution, cell, id desc);

-- In front of a resolution of its own binding, and replacing only a revision of its own cell.
create function binding_revision_its_own() returns trigger
language plpgsql as $$
declare
  own boolean;
begin
  execute format(
    'select exists (select 1 from %1$I.binding_resolution r where r.id = $1 '
    'and r.document_id = $2 and r.node_id = $3 and r.binding_id = $4) '
    'and ($5::bigint is null or exists (select 1 from %1$I.binding_revision v where v.id = $5 '
    'and v.document_id = $2 and v.node_id = $3 and v.binding_id = $4 and v.cell = $6))',
    tg_table_schema
  ) into own using new.resolution, new.document_id, new.node_id, new.binding_id, new.replaces,
    new.cell;
  if own is not true then
    raise exception
      'binding_revision: a revision stands in front of its own binding''s resolution, replacing its own cell''s';
  end if;
  return new;
end
$$;

create trigger binding_revision_its_own before insert on binding_revision
  for each row execute function binding_revision_its_own();

-- Inserted and read, by what the row says alone: never its number or its time.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on binding_revision from %I',
    current_schema()
  );
  execute format(
    'grant insert (document_id, document_kind, node_id, binding_id, cell, resolution, act, value, '
    'reason, replaces, revised_by) on binding_revision to %I',
    current_schema()
  );
  execute format('grant select on binding_revision to %I', current_schema());
end
$$;

-- A resolve waiting on its images carries its decision over the revisions standing (RV-D), checked
-- again when it finishes: { decision: 'withdraw' | 'keep', over: [revision ids] }, or none.
alter table dataset_pending
  add column revisions jsonb
    constraint dataset_pending_revisions check (
      revisions is null or (
        jsonb_typeof(revisions) = 'object'
        and revisions ->> 'decision' in ('withdraw', 'keep')
        and jsonb_typeof(revisions -> 'over') = 'array'
      )
    );
do $$
begin
  execute format('grant insert (revisions) on dataset_pending to %I', current_schema());
end
$$;

-- The revisions each request read (RV-E): those standing in front of the resolution its row records,
-- in ascending order. A publication and a baseline keep the same, compared whole below.
alter table publication_request_binding
  add column revisions bigint[] not null default '{}';
alter table publication_binding
  add column revisions bigint[] not null default '{}';
alter table baseline_binding
  add column revisions bigint[] not null default '{}';

-- Each revision a binding row names is a revision of its node and binding, standing in front of the
-- resolution the row records, named once, in order. Whether it was the latest for its cell when the
-- row was made is the act's to have decided: a baseline publishes the revisions it pinned.
create function binding_row_revisions() returns trigger
language plpgsql as $$
declare
  own boolean;
  document uuid;
begin
  if cardinality(new.revisions) = 0 then
    return new;
  end if;
  if tg_table_name = 'publication_request_binding' then
    execute format('select document_id from %I.publication_request where id = $1', tg_table_schema)
      into document using new.request_id;
  elsif tg_table_name = 'publication_binding' then
    execute format('select document_id from %I.publication where id = $1', tg_table_schema)
      into document using new.publication_id;
  else
    execute format('select document_id from %I.baseline where id = $1', tg_table_schema)
      into document using new.baseline_id;
  end if;
  execute format(
    'select $1 = array(select distinct e from unnest($1) e order by e) '
    'and not exists (select 1 from unnest($1) e where not exists ('
    'select 1 from %I.binding_revision v where v.id = e and v.act = %L and v.document_id = $2 '
    'and v.node_id = $3 and v.binding_id = $4 and v.resolution = $5))',
    tg_table_schema,
    'revise'
  ) into own using new.revisions, document, new.node, new.binding, new.resolution;
  if own is not true then
    raise exception
      '%: each revision named is its binding''s, in front of the resolution the row records, once and in order',
      tg_table_name;
  end if;
  return new;
end
$$;

create trigger publication_request_binding_revisions before insert on publication_request_binding
  for each row execute function binding_row_revisions();
create trigger publication_binding_revisions before insert on publication_binding
  for each row execute function binding_row_revisions();
create trigger baseline_binding_revisions before insert on baseline_binding
  for each row execute function binding_row_revisions();

-- 0050's commit-time rule, its bindings now compared with the revisions each read.
create or replace function publication_recorded_whole() returns trigger
language plpgsql as $$
declare
  whole boolean;
begin
  execute format(
    $check$
    select
      exists (
        select 1 from %1$I.publication_request r
        where r.id = $2 and r.state = 'done' and r.document_id = $3
          and r.document_version_id = $4 and r.requested_by = $5 and r.requested_at = $6
          and r.layout_version_id is not distinct from $7
          and r.theme_version_id is not distinct from $8
          and r.formats = $9
          and r.kind = 'publish'
      )
      and (select a.space_id from %1$I.artifact a where a.id = $1)
        = (select d.space_id from %1$I.artifact d where d.id = $3)
      and (select count(*) from %1$I.publication_output o where o.publication_id = $1)
        = cardinality($9) + (case when exists (
            select 1 from %1$I.publication_request_binding q where q.request_id = $2
          ) then 1 else 0 end)
      and not exists (
        select 1 from %1$I.publication_output o
        where o.publication_id = $1 and not (
          o.format = any ($9)
          or (o.format = 'provenance' and exists (
            select 1 from %1$I.publication_request_binding q where q.request_id = $2
          ))
        )
      )
      and not exists (
        select 1 from %1$I.publication_output o
        where o.publication_id = $1 and o.producer = 'typst'
          and o.producer_version is distinct from $10::text
      )
      and exists (
        select 1 from %1$I.publication_input i
        where i.publication_id = $1 and i.node is null and i.version_id = $4
      )
      and (select count(*) from %1$I.publication_input i where i.publication_id = $1 and i.node is not null)
        = (select count(*) from %1$I.publication_request_occurrence o where o.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_occurrence o
        where o.request_id = $2 and not exists (
          select 1 from %1$I.publication_input i
          where i.publication_id = $1 and i.node = o.node and i.version_id = o.version_id
        )
      )
      and (select count(*) from %1$I.publication_asset p where p.publication_id = $1)
        = (select count(*) from %1$I.publication_request_asset q where q.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_asset q
        where q.request_id = $2 and not exists (
          select 1 from %1$I.publication_asset p
          where p.publication_id = $1 and p.version_id = q.version_id
        )
      )
      and (select count(*) from %1$I.publication_binding p where p.publication_id = $1)
        = (select count(*) from %1$I.publication_request_binding q where q.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_binding q
        where q.request_id = $2 and not exists (
          select 1 from %1$I.publication_binding p
          where p.publication_id = $1 and p.node = q.node and p.binding = q.binding
            and p.resolution = q.resolution and p.dataset_version = q.dataset_version
            and p.revisions = q.revisions
        )
      )
    $check$,
    tg_table_schema
  ) into whole
  using new.id, new.request_id, new.document_id, new.document_version_id, new.publisher,
    new.published_at, new.layout_version_id, new.theme_version_id, new.formats,
    new.template_version;
  if whole is not true then
    raise exception
      'publication: a publication is recorded whole, by its request, as its request was made';
  end if;
  return null;
end
$$;

-- 0073's rule, a baseline's revisions among what its request is.
create or replace function publication_request_is_its_baseline() returns trigger
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
            and q.dataset_version = p.dataset_version and q.revisions = p.revisions
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
