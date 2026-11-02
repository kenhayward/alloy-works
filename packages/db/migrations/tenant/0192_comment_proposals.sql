-- A proposal may be a comment on a component (GEN-009): where it stands and its words, `{ anchor,
-- parts }`, starting a thread as the person only as it is accepted. It changes no content, so it is
-- accepted or discarded, never kept, and names no suggestion. 0130's rule compares the whole row but
-- its acted-on columns, so it never changes.

alter table generation_proposal add column comment jsonb
  constraint generation_proposal_comment
  check (
    comment is null
    or (jsonb_typeof(comment) = 'object' and creates is null and cites is null
        and state in ('open', 'accepted', 'discarded'))
  );

alter table generation_proposal drop constraint generation_proposal_suggested;
alter table generation_proposal add constraint generation_proposal_suggested check (
  state not in ('kept', 'accepted', 'resolved') or suggestion_id is not null
  or (creates is not null and state = 'accepted')
  or (comment is not null and state = 'accepted')
);
