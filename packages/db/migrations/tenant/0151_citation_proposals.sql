-- A proposal may cite a reference source's work (the XR plan, XR-I; LIB-040): an edit of a component
-- whose citation names no entry until it is accepted, carrying the record the source answered as it
-- was proposed, `{ source, identifier, csl, at }`, which domain's `citedSourceSchema` reads. Accepting
-- it matches or makes the entry as the person accepting. Never on a creation, and never changed:
-- 0130's rule compares the whole row but its acted-on columns.

alter table generation_proposal add column cites jsonb
  constraint generation_proposal_cites
  check (cites is null or (jsonb_typeof(cites) = 'object' and creates is null));
