-- Search at scale: a query of title terms alone, and filters (#605). Indexes only, created plainly in
-- this transaction: deployments are dev scale.

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres indexes no table with one; so they fire here, as 0090 does.
set constraints all immediate;

-- Titles' words, so a query of title terms alone is found through titles alone; an expression rather
-- than a partial index, so the planner keeps statistics of titles' words and counts their matches.
create index search_text_title on search_text using gin ((case when place = 'title' then vector end));
analyze search_text;

-- A kind filtered for, under every version, as `search_entry_kind` serves the latest.
create index search_history_kind on search_history (kind);

set constraints all deferred;
