-- What waits on a person (home.md, Needs your attention; the HM plan, HM-C): their own iterations,
-- newest first, so their changes not yet in a version are found without reading everyone's.
create index iteration_principal on iteration (principal_id, artifact_id, created_at desc);
