-- A window's presence keyed by whose it is as well as by its id (the PL final review, finding 6): every
-- reader of a document hears the others' window ids, and keyed by id alone one could beat under
-- another's id once their row went, and that person's own beats would then find it held and be lost.
alter table presence drop constraint presence_pkey;
alter table presence add primary key (principal_id, viewer);
