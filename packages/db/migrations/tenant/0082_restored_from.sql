-- What a restored version was restored from (VER-033; the RS plan, RS-C): an earlier version of the
-- same artifact, never itself. Authorship, as the note is, so outside both digests (ADR-0024). Null
-- for every version not restored. The runtime role's insert grant is the table's, so it covers this.
--
-- The deferred checks are fired first, as 0057 explains: a fresh environment's earlier migrations
-- leave a pending trigger event on the chain, and a table with one cannot be altered.
set constraints all immediate;
alter table artifact_version add column restored_from uuid;
alter table artifact_version
  add constraint artifact_version_restored_from
  foreign key (restored_from, artifact_id, kind)
  references artifact_version (id, artifact_id, kind) on delete restrict;
alter table artifact_version
  add constraint artifact_version_restored_from_not_itself check (restored_from <> id);
set constraints all deferred;
