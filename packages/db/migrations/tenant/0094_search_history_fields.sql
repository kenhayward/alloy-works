-- Every version's fields' words, a place's row (#610): field terms alone under every version are found
-- through fields alone, not every place's words. All fields together, folded as `vector` is from each
-- version's field places; the per-row check of the field's own place, in every version, stays exact.
-- And the latest's field places by their own index, as 0092 indexes titles.

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres alters no table with one; so they fire here, as 0090 does.
set constraints all immediate;

alter table search_history add column fields_vector tsvector not null default '';

-- Each version's field places together, then each place's over its versions, oldest first, as
-- `rebuildHistory` folds them. A version with no field folds nothing, so only those with one are read.
update search_history h set fields_vector = f.fields_vector
from (
  select t.artifact_id, t.node,
         search_history_agg(t.vector order by t.revision_no, t.version_no) as fields_vector
  from (
    select e.artifact_id, e.node, v.revision_no, v.version_no,
           search_history_agg(s.vector order by s.place) as vector
    from search_entry e
    join search_text s on s.entry_id = e.id and s.place like 'field:%'
    join artifact_version v on v.id = e.version_id
    where e.kind in ('component', 'document', 'section')
    group by e.id, e.artifact_id, e.node, v.revision_no, v.version_no
    union all
    select e.artifact_id, e.node, v.revision_no, v.version_no,
           search_history_agg(s.vector order by s.place)
    from search_earlier e
    join search_earlier_text s on s.entry_id = e.id and s.place like 'field:%'
    join artifact_version v on v.id = e.version_id
    where e.kind in ('component', 'document', 'section')
    group by e.id, e.artifact_id, e.node, v.revision_no, v.version_no
  ) t
  group by t.artifact_id, t.node
) f
where f.artifact_id = h.artifact_id and coalesce(f.node, '') = coalesce(h.node, '');

-- Every writer names it: a place written without one would find no field.
alter table search_history alter column fields_vector drop default;

create index search_history_fields on search_history using gin (fields_vector);
-- Fields' words in the latest, every field together; the field's own place then tested exactly. An
-- expression, as 0092's titles are, so the planner keeps statistics of fields' words alone.
create index search_text_fields on search_text
  using gin ((case when place like 'field:%' then vector end));
analyze search_history;
analyze search_text;

set constraints all deferred;
