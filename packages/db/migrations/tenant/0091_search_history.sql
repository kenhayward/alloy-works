-- Every version searched from one row a place (SCH-003; the SV3 plan, SV3-I to SV3-N): a component's,
-- a document's and each section's words over every version, folded as each version is written, so
-- `versions=all` reads one row a place, bounded as the latest is. Derived, as 0088's rows are: the
-- run that applies this file writes every place's row from the projection (`rebuildHistory`).

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres alters no table with one; so they fire here, as 0090 does.
set constraints all immediate;

-- A newer version's words, then the earlier words it does not hold. `||` shifts its right operand's
-- positions, so the newer version's positions are kept as written: a vector grows with distinct words,
-- not versions (SV3-J).
create function search_history_fold(history tsvector, newer tsvector) returns tsvector
  language sql immutable strict parallel safe
  as $$ select newer || ts_delete(history, tsvector_to_array(newer)) $$;

-- A newer version's text, then every whitespace-separated token an earlier version held that it does
-- not, distinct and sorted, so a fold and a rebuild agree. `except` hashes: a list compared word by
-- word costs fifteen times as much.
create function search_history_body(history text, newer text) returns text
  language sql immutable strict parallel safe
  as $$
    select concat_ws(' ', nullif(newer, ''), (
      select string_agg(d.token, ' ' order by d.token collate "C")
      from (select t.token from regexp_split_to_table(history, '\s+') as t(token)
             where t.token <> ''
            except
            select regexp_split_to_table(newer, '\s+')) d))
  $$;

-- Over a place's versions, oldest first.
create aggregate search_history_agg(tsvector) (sfunc = search_history_fold, stype = tsvector);
create aggregate search_history_body_agg(text) (sfunc = search_history_body, stype = text);

create table search_history (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifact on delete restrict,
  kind text not null check (kind in ('component', 'document', 'section')),
  node text check ((node is not null) = (kind = 'section')),
  -- The newest version holding the place; the columns to `configuration` are that version's.
  version_id uuid not null references artifact_version on delete restrict,
  space_id uuid references space on delete restrict,
  title text not null,
  owner uuid references principal on delete restrict,
  changed_at timestamptz not null,
  component_type uuid references artifact on delete restrict,
  field_values jsonb not null default '{}',
  configuration regconfig not null,
  body text not null,
  vector tsvector not null,
  archived boolean not null default false,
  deleted boolean not null default false,
  constraint search_history_once unique nulls not distinct (artifact_id, node)
);
create index search_history_vector on search_history using gin (vector);
create index search_history_body_trigrams on search_history
  using gin (body extensions.gin_trgm_ops);
create index search_history_changed on search_history (changed_at, id);
create index search_history_space on search_history (space_id);
create index search_history_configuration on search_history (configuration);

set constraints all deferred;
