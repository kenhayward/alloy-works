-- Search at scale, the latest path (the SV3 plan, SV3-A, SV3-B, SV3-E; #602). Indexes only, created
-- plainly in this transaction: deployments are dev scale.

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres indexes no table with one; so they fire here, as 0075 does.
set constraints all immediate;

-- The definitions a search reads - readable fields, and component types' names - by artifact, newest
-- first, never by scanning every version.
create index artifact_version_definitions on artifact_version
  (artifact_id, revision_no desc, version_no desc) where kind in ('field', 'componentType');

-- The walk: the newest matches first, in a total order.
create index search_entry_changed on search_entry (changed_at, id);

-- Which configurations are in use, one probe each, so the words are matched by a constant tsquery
-- per configuration, which the word index serves.
create index search_entry_configuration on search_entry (configuration);
create index search_earlier_configuration on search_earlier (configuration);

set constraints all deferred;
