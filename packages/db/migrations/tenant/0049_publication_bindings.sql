-- The publish's binding stage (docs/design/bindings.md; the B3 plan, B3-A): what each binding of a
-- request held when it was asked for, recorded on the request; what each binding of a publication
-- printed from, recorded on the publication; and `provenance.json`, an output of its own beside the
-- PDF and the Word document wherever a publication holds a value (DAT-042, PUB-049).

-- One row per binding the request's resolved occurrences hold, each the latest resolution for its
-- document, node and binding whose digest matched the binding as the request read it (B3-C). Swept
-- with its request, so a preview's go when it does.
create table publication_request_binding (
  request_id uuid not null references publication_request on delete cascade,
  node text not null constraint publication_request_binding_node check (node ~ '^[a-z2-7]{26}$'),
  binding text not null constraint publication_request_binding_binding
    check (char_length(binding) >= 1 and binding is nfc normalized),
  digest text not null constraint publication_request_binding_digest
    check (digest ~ '^[0-9a-f]{64}$'),
  resolution bigint not null references binding_resolution (id) on delete restrict,
  dataset_version uuid not null,
  dataset_id uuid not null,
  dataset_kind text not null default 'dataset' check (dataset_kind = 'dataset'),
  primary key (request_id, node, binding),
  foreign key (dataset_version, dataset_id, dataset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- What a publication printed each value from: exactly its request's rows, held at commit below.
create table publication_binding (
  publication_id uuid not null references publication on delete restrict,
  node text not null constraint publication_binding_node check (node ~ '^[a-z2-7]{26}$'),
  binding text not null constraint publication_binding_binding
    check (char_length(binding) >= 1 and binding is nfc normalized),
  resolution bigint not null references binding_resolution (id) on delete restrict,
  dataset_version uuid not null,
  dataset_id uuid not null,
  dataset_kind text not null default 'dataset' check (dataset_kind = 'dataset'),
  primary key (publication_id, node, binding),
  foreign key (dataset_version, dataset_id, dataset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- PUB-050, as 0017 holds the rest: inserted and read, never changed.
do $$
begin
  execute format(
    'revoke update, delete, truncate on publication_request_binding, publication_binding from %I',
    current_schema()
  );
end
$$;

-- A request's binding is recorded while its request is queued, as an occurrence is, and is the
-- resolution it names: of the request's document, at its node and binding, under its digest, holding
-- its dataset version. So no row says a binding held what its document never resolved it to.
create function publication_request_binding_recorded() returns trigger
language plpgsql as $$
declare
  held boolean;
begin
  execute format(
    'select exists (select 1 from %1$I.publication_request r join %1$I.binding_resolution b '
    'on b.document_id = r.document_id where r.id = $1 and r.state = %2$L and b.id = $2 '
    'and b.node_id = $3 and b.binding_id = $4 and b.binding_digest = $5 and b.dataset_version = $6)',
    tg_table_schema,
    'queued'
  ) into held using new.request_id, new.resolution, new.node, new.binding, new.digest,
    new.dataset_version;
  if not held then
    raise exception
      'publication_request_binding: a binding is recorded while its request is queued, as its document resolved it';
  end if;
  return new;
end
$$;

create trigger publication_request_binding_recorded
  before insert on publication_request_binding
  for each row execute function publication_request_binding_recorded();

create trigger publication_binding_while_queued before insert on publication_binding
  for each row execute function publication_part_while_queued();

-- An output is a PDF, a Word document or `provenance.json` (B3-G): the last claims no standard, is made
-- by the pipeline at its version, and reports nothing.
alter table publication_output
  drop constraint publication_output_format,
  drop constraint publication_output_standard,
  drop constraint publication_output_producer,
  drop constraint publication_output_report;
alter table publication_output
  add constraint publication_output_format check (format in ('pdf', 'docx', 'provenance')),
  add constraint publication_output_standard check (
    (format = 'pdf' and standard is not distinct from 'ua-1')
    or (format in ('docx', 'provenance') and standard is null)
  ),
  add constraint publication_output_producer check (
    (format = 'pdf' and producer = 'typst' and producer_version ~ '^[1-9][0-9]*$')
    or (format = 'docx' and producer = 'word' and producer_version ~ '^word/[1-9][0-9]*$')
    or (format = 'provenance' and producer = 'pipeline' and producer_version ~ '^[1-9][0-9]*$')
  ),
  add constraint publication_output_report check (
    jsonb_typeof(report) = 'array' and (format = 'docx' or report = '[]'::jsonb)
  );

-- 0035's commit-time rule, widened: the outputs are the request's formats and one `provenance`
-- exactly where the request holds a binding - never named among its formats, which 0027 holds to PDF
-- and Word - and the publication's bindings are exactly the request's, by node, binding, resolution
-- and dataset version.
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
