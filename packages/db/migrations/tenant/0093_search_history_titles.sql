-- Every version's titles, a place's row (#608): title terms alone under every version are found through
-- titles alone, not every place's words, which nearly every place holds. Folded as `vector` is, from
-- each version's title place; the per-row check of every version's titles stays.

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres alters no table with one; so they fire here, as 0090 does.
set constraints all immediate;

alter table search_history add column title_vector tsvector not null default '';

-- Each place's titles over its versions, oldest first, as `rebuildHistory` folds them. A version with
-- no title folds nothing, so only those with one are read.
update search_history h set title_vector = f.title_vector
from (
  select t.artifact_id, t.node,
         search_history_agg(t.vector order by t.revision_no, t.version_no) as title_vector
  from (
    select e.artifact_id, e.node, s.vector, v.revision_no, v.version_no
    from search_entry e
    join search_text s on s.entry_id = e.id and s.place = 'title'
    join artifact_version v on v.id = e.version_id
    where e.kind in ('component', 'document', 'section')
    union all
    select e.artifact_id, e.node, s.vector, v.revision_no, v.version_no
    from search_earlier e
    join search_earlier_text s on s.entry_id = e.id and s.place = 'title'
    join artifact_version v on v.id = e.version_id
    where e.kind in ('component', 'document', 'section')
  ) t
  group by t.artifact_id, t.node
) f
where f.artifact_id = h.artifact_id and coalesce(f.node, '') = coalesce(h.node, '');

-- Every writer names it: a place written without one would find no title.
alter table search_history alter column title_vector drop default;

create index search_history_title on search_history using gin (title_vector);
analyze search_history;

set constraints all deferred;
