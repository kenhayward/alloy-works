-- Terms (terms.md, "The term"; the TM plan, TM-A, TM-I): an artifact kind of their own, each in exactly
-- one space and every version authored, archived as an entry is, found by search by their labels and
-- definitions; their standing a workflow kind of their own, draft, approved and deprecated, as a
-- prompt's is (0123). A term is deprecated by its state's key, which the domain's check keeps in every
-- term workflow. No term exists before this, so nothing is reindexed and no `definedTerm` mark names
-- one in the reference index.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary', 'bibliographyEntry',
   'citationStyle', 'term'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition', 'dataset', 'prompt', 'bibliographyEntry', 'term'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition',
                    'dataset', 'prompt', 'bibliographyEntry', 'term'));
set constraints artifact_version_component_type_recorded deferred;

alter table artifact_archival drop constraint artifact_archival_kind_check;
alter table artifact_archival add constraint artifact_archival_kind_check
  check (kind in ('component', 'document', 'bibliographyEntry', 'term'));

alter table search_entry drop constraint search_entry_kind_check;
alter table search_entry add constraint search_entry_kind_check check (kind in
  ('component', 'document', 'section', 'publication', 'template', 'asset',
   'field', 'metadataSchema', 'componentType', 'queryDefinition', 'thread', 'term'));

alter table workflow_definition drop constraint workflow_definition_kind_check;
alter table workflow_definition add constraint workflow_definition_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt', 'term'));
alter table workflow_transition drop constraint workflow_transition_kind_check;
alter table workflow_transition add constraint workflow_transition_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt', 'term'));
alter table workflow_approval drop constraint workflow_approval_kind_check;
alter table workflow_approval add constraint workflow_approval_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt', 'term'));
alter table revision_designation drop constraint revision_designation_kind_check;
alter table revision_designation add constraint revision_designation_kind_check
  check (kind in ('component', 'document', 'queryDefinition', 'prompt', 'term'));

-- The term seed, version 1: the domain's `SEED_TERM_WORKFLOW`.
insert into workflow_definition (kind, version_no, body)
values ('term', 1, '{
  "states": [
    {"key": "draft", "name": "Draft", "initial": true, "approved": false},
    {"key": "approved", "name": "Approved", "initial": false, "approved": true},
    {"key": "deprecated", "name": "Deprecated", "initial": false, "approved": false}
  ],
  "transitions": [
    {"key": "approve", "name": "Approve", "from": "draft", "to": "approved",
     "permission": "approve", "reasonRequired": false,
     "gate": {"approvals": 1, "notAuthor": true, "reject": {"name": "Return", "to": "draft"},
              "designates": true, "baseline": false, "publication": "none"}},
    {"key": "deprecate", "name": "Deprecate", "from": "approved", "to": "deprecated",
     "permission": "approve", "reasonRequired": true},
    {"key": "reinstate", "name": "Reinstate", "from": "deprecated", "to": "approved",
     "permission": "approve", "reasonRequired": true},
    {"key": "reopen", "name": "Reopen", "from": "approved", "to": "draft",
     "permission": "edit", "reasonRequired": true}
  ]
}'::jsonb);

-- Every term there is starts in draft, under version 1, at its latest version: none yet, as 0123 did.
insert into workflow_transition (artifact_id, kind, version_id, to_state, definition_id, by)
select a.id, a.kind, latest.id, 'draft', d.id, first.author_id
from artifact a
join workflow_definition d on d.kind = a.kind and d.version_no = 1
left join lateral (select v.id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no desc, v.version_no desc limit 1) latest on true
left join lateral (select v.author_id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no, v.version_no limit 1) first on true
where a.kind = 'term'
order by a.id;

set constraints all deferred;
