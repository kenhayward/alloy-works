-- Prompts under a workflow of their own (GEN-001, GEN-045; the G4 plan, G4-E): reviewed and approved
-- as a query definition is, by the same gates. Approval's trial run arrives with its condition, as the
-- seed's version 2 (G4c).

set constraints all immediate;

alter table workflow_definition drop constraint workflow_definition_kind_check;
alter table workflow_definition add constraint workflow_definition_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt'));
alter table workflow_transition drop constraint workflow_transition_kind_check;
alter table workflow_transition add constraint workflow_transition_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt'));
alter table workflow_approval drop constraint workflow_approval_kind_check;
alter table workflow_approval add constraint workflow_approval_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt'));
alter table revision_designation drop constraint revision_designation_kind_check;
alter table revision_designation add constraint revision_designation_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt'));

-- The prompt seed, version 1: the query definition's, Approve a gate of one, not an author, rejecting
-- to Draft as Return.
insert into workflow_definition (kind, version_no, body)
values ('prompt', 1, '{
  "states": [
    {"key": "draft", "name": "Draft", "initial": true, "approved": false},
    {"key": "in_review", "name": "In review", "initial": false, "approved": false},
    {"key": "approved", "name": "Approved", "initial": false, "approved": true}
  ],
  "transitions": [
    {"key": "submit", "name": "Submit", "from": "draft", "to": "in_review",
     "permission": "edit", "reasonRequired": false},
    {"key": "approve", "name": "Approve", "from": "in_review", "to": "approved",
     "permission": "approve", "reasonRequired": false,
     "gate": {"approvals": 1, "notAuthor": true, "reject": {"name": "Return", "to": "draft"},
              "designates": true, "baseline": false, "publication": "none"}},
    {"key": "reopen", "name": "Reopen", "from": "approved", "to": "draft",
     "permission": "edit", "reasonRequired": true}
  ]
}'::jsonb);

-- Every prompt there is starts in draft, under version 1, at its latest version.
insert into workflow_transition (artifact_id, kind, version_id, to_state, definition_id, by)
select a.id, a.kind, latest.id, 'draft', d.id, first.author_id
from artifact a
join workflow_definition d on d.kind = a.kind and d.version_no = 1
left join lateral (select v.id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no desc, v.version_no desc limit 1) latest on true
left join lateral (select v.author_id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no, v.version_no limit 1) first on true
where a.kind = 'prompt'
order by a.id;

set constraints all deferred;
