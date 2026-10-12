-- What changed since (SCH-025; the CP plan, CP-I): versions cut, and values resolved or accepted,
-- after an instant. Neither table had an index on its time, so the question across a space would have
-- read every row.
-- Every migration runs in one transaction, and an earlier one's deferred checks on artifact_version may
-- still be pending in it; Postgres refuses to index the table until they have fired, so they fire here,
-- as 0020 does.
set constraints all immediate;

create index artifact_version_created on artifact_version (created_at, artifact_id);
create index binding_resolution_resolved on binding_resolution (resolved_at, document_id);

set constraints all deferred;
