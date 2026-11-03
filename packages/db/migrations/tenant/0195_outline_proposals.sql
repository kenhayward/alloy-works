-- A proposal may change a document's outline (GEN-062; the AT plan, ATe): `{ document, operations,
-- says }`, against the document's version in `made_against`, naming no component. Every operation is
-- made one version only as it is accepted. It changes no content, so it is accepted or discarded,
-- never kept, and names no suggestion. 0130's rule compares the whole row but its acted-on columns,
-- so it never changes.

alter table generation_proposal add column outline jsonb
  constraint generation_proposal_outline
  check (
    outline is null
    or (jsonb_typeof(outline) = 'object' and creates is null and cites is null and comment is null
        and component_id is null and made_against is not null
        and state in ('open', 'accepted', 'discarded'))
  );

alter table generation_proposal drop constraint generation_proposal_creates;
alter table generation_proposal add constraint generation_proposal_creates check (
  (outline is not null)
  or (creates is null and component_id is not null and made_against is not null)
  or (creates is not null and made_against is null
      and state in ('open', 'accepted', 'discarded')
      and (component_id is not null) = (state = 'accepted'))
);

alter table generation_proposal drop constraint generation_proposal_suggested;
alter table generation_proposal add constraint generation_proposal_suggested check (
  state not in ('kept', 'accepted', 'resolved') or suggestion_id is not null
  or (creates is not null and state = 'accepted')
  or (comment is not null and state = 'accepted')
  or (outline is not null and state = 'accepted')
);
