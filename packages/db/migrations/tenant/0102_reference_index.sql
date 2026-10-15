-- The reference index (relationships.md, "References"; the R2 plan, R2-A): one row per reference in
-- each artifact's latest version, replaced in the transaction that cuts a version, so where-used and
-- impact read an index rather than every version's content. Derived: rebuilt from content if ever
-- doubted, so its rows go with what they name.

set constraints all immediate;

create table reference (
  id bigint generated always as identity primary key,
  from_id uuid not null references artifact on delete cascade,
  -- The latest version holding it; the rows for an artifact's previous version are gone.
  from_version uuid not null references artifact_version on delete cascade,
  -- The node holding it, where it has one: a reference's, a figure's, an image's, a binding's.
  node text,
  to_id uuid not null references artifact on delete cascade,
  to_kind text not null,
  mode text not null check (mode in ('latest', 'approved', 'pinned')),
  -- The version a pinned reference takes.
  to_version uuid references artifact_version on delete cascade,
  constraint reference_pinned check ((mode = 'pinned') = (to_version is not null))
);
create index reference_to on reference (to_id);
create index reference_from on reference (from_id);

-- A document's references to components, each in its mode.
insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
with latest_version as (
  -- Each artifact's latest version, as every read of "latest" orders it.
  select distinct on (artifact_id) id, artifact_id, kind, content
    from artifact_version
   order by artifact_id, revision_no desc, version_no desc
)
select l.artifact_id, l.id, r ->> 'id', c.id, 'component', r -> 'mode' ->> 'kind',
       case when r -> 'mode' ->> 'kind' = 'pinned' then (r -> 'mode' ->> 'version')::uuid end
  from latest_version l
  cross join lateral jsonb_path_query(l.content, 'strict $.** ? (@.type == "reference")') r
  join artifact c on c.id = (r ->> 'component')::uuid and c.kind = 'component'
 where l.kind = 'document'
   and (r -> 'mode' ->> 'kind' <> 'pinned'
        or exists (select from artifact_version p
                    where p.id = (r -> 'mode' ->> 'version')::uuid and p.artifact_id = c.id));

-- A document's template: the version its latest move took it to, else the one it was made from.
insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
with latest_version as (
  -- Each artifact's latest version, as every read of "latest" orders it.
  select distinct on (artifact_id) id, artifact_id, kind, content
    from artifact_version
   order by artifact_id, revision_no desc, version_no desc
)
select l.artifact_id, l.id, null, t.artifact_id, 'template', 'pinned', t.id
  from latest_version l
  join document_template d on d.document_id = l.artifact_id
  join artifact_version t on t.id = coalesce(
    (select m.to_version_id from document_template_move m
      where m.document_id = l.artifact_id order by m.id desc limit 1),
    d.template_version_id)
 where l.kind = 'document';

-- A component's images, by the asset version each shows.
insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
with latest_version as (
  -- Each artifact's latest version, as every read of "latest" orders it.
  select distinct on (artifact_id) id, artifact_id, kind, content
    from artifact_version
   order by artifact_id, revision_no desc, version_no desc
)
select l.artifact_id, l.id, r ->> 'id', v.artifact_id, 'asset', 'pinned', v.id
  from latest_version l
  cross join lateral jsonb_path_query(
    l.content, 'strict $.** ? ((@.type == "figure" || @.type == "image") && exists(@.asset))') r
  join artifact_version v on v.id = (r ->> 'asset')::uuid and v.kind = 'asset'
 where l.kind = 'component';

-- A component's bindings, by the query definition each names, pinned where it names a version.
insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
with latest_version as (
  -- Each artifact's latest version, as every read of "latest" orders it.
  select distinct on (artifact_id) id, artifact_id, kind, content
    from artifact_version
   order by artifact_id, revision_no desc, version_no desc
)
select l.artifact_id, l.id, r ->> 'id', q.id, 'queryDefinition',
       case when p.id is null then 'latest' else 'pinned' end, p.id
  from latest_version l
  cross join lateral jsonb_path_query(l.content, 'strict $.** ? (@.type == "binding")') r
  join artifact q on q.id = (r ->> 'query')::uuid and q.kind = 'queryDefinition'
  left join artifact_version p on p.id = (r ->> 'version')::uuid and p.artifact_id = q.id
 where l.kind = 'component'
   -- A pin to another artifact's version is written by nothing, as `indexReferences` writes none.
   and (r ->> 'version' is null or p.id is not null);

-- A query definition's connection.
insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
with latest_version as (
  -- Each artifact's latest version, as every read of "latest" orders it.
  select distinct on (artifact_id) id, artifact_id, kind, content
    from artifact_version
   order by artifact_id, revision_no desc, version_no desc
)
select l.artifact_id, l.id, null, c.id, 'connection', 'latest', null
  from latest_version l
  join artifact c on c.id = (l.content ->> 'connection')::uuid and c.kind = 'connection'
 where l.kind = 'queryDefinition';

do $$
begin
  execute format('revoke insert, update, delete, truncate on reference from %I', current_schema());
  execute format(
    'grant insert (from_id, from_version, node, to_id, to_kind, mode, to_version), delete on reference to %I',
    current_schema()
  );
  execute format('grant select on reference to %I', current_schema());
end
$$;
