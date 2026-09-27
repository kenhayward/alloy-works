-- A listing read as of its first page (docs/design/service-foundations.md, "Listings and idempotency,
-- in T1"; SCH-022, LI-H). A version and a publication are inserted and never updated, so each records
-- the transaction that wrote it, and a later page of a listing keeps only what the first page's
-- snapshot could see: `pg_visible_in_snapshot(written_by, snapshot)`.
--
-- Added with no default, which rewrites nothing and so holds no long lock on the version chain, and
-- then defaulted for every row written after. A row from before this has none, and was committed
-- before any snapshot a listing takes, so a listing reads it as visible to every one.
alter table artifact_version add column written_by xid8;
alter table artifact_version alter column written_by set default pg_current_xact_id();

alter table publication add column written_by xid8;
alter table publication alter column written_by set default pg_current_xact_id();
