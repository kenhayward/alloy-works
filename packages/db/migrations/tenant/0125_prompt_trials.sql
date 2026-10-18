-- A prompt's trial runs and the approval they gate (GEN-045, GN-F; the G4 plan, G4-E and G4-I): a run
-- may be a trial, routed by its prompt's purpose and proposing nothing; and the prompt workflow's
-- seed version 2, its Approve requiring a finished trial of the version approved. The domain refuses a
-- prompt workflow saved without it, so the requirement holds for every tenant from here on.

alter table generation_run drop constraint generation_run_purpose_check;
alter table generation_run add constraint generation_run_purpose_check
  check (purpose in ('drafting', 'chat', 'summarising', 'embedding', 'test', 'trial'));

-- Version 2, only where the newest is still the seed: 0123 seeded it today, so none has been edited.
insert into workflow_definition (kind, version_no, body)
select d.kind, 2, '{
  "states": [
    {"key": "draft", "name": "Draft", "initial": true, "approved": false},
    {"key": "in_review", "name": "In review", "initial": false, "approved": false},
    {"key": "approved", "name": "Approved", "initial": false, "approved": true}
  ],
  "transitions": [
    {"key": "submit", "name": "Submit", "from": "draft", "to": "in_review",
     "permission": "edit", "reasonRequired": false},
    {"key": "approve", "name": "Approve", "from": "in_review", "to": "approved",
     "permission": "approve", "reasonRequired": false, "requires": ["trial"],
     "gate": {"approvals": 1, "notAuthor": true, "reject": {"name": "Return", "to": "draft"},
              "designates": true, "baseline": false, "publication": "none"}},
    {"key": "reopen", "name": "Reopen", "from": "approved", "to": "draft",
     "permission": "edit", "reasonRequired": true}
  ]
}'::jsonb
from workflow_definition d
where d.kind = 'prompt' and d.version_no = 1
  and not exists (select 1 from workflow_definition n where n.kind = 'prompt' and n.version_no > 1);
