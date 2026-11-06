-- Component groups (the CG plan, CG-A to CG-J; REU-060 to REU-063): an artifact kind of their own, in
-- exactly one space and every version authored, each version a title and its members pinned. A group
-- is approved through the component workflow (CG-A): its workflow rows are the component kind's, so
-- each table keyed to an artifact by its workflow kind references `workflow_kind`, an artifact's kind
-- but a group's, which is `component`. No group exists before this, so nothing is backfilled.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary', 'bibliographyEntry',
   'citationStyle', 'term', 'vocabulary', 'licence', 'componentGroup'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition', 'dataset', 'prompt', 'bibliographyEntry', 'term',
                   'componentGroup'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition',
                    'dataset', 'prompt', 'bibliographyEntry', 'term', 'componentGroup'));
set constraints artifact_version_component_type_recorded deferred;

-- The workflow an artifact moves under: its kind's, but a group's, which is the component's (CG-A).
alter table artifact add column workflow_kind text not null
  generated always as (case when kind = 'componentGroup' then 'component' else kind end) stored;
alter table artifact add constraint artifact_workflow_kind unique (id, workflow_kind);

alter table workflow_transition drop constraint workflow_transition_artifact_id_kind_fkey;
alter table workflow_transition add constraint workflow_transition_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;
alter table workflow_approval drop constraint workflow_approval_artifact_id_kind_fkey;
alter table workflow_approval add constraint workflow_approval_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;
alter table revision_designation drop constraint revision_designation_artifact_id_kind_fkey;
alter table revision_designation add constraint revision_designation_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;
alter table artifact_dates drop constraint artifact_dates_artifact_id_kind_fkey;
alter table artifact_dates add constraint artifact_dates_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;
alter table review_lapse drop constraint review_lapse_artifact_id_kind_fkey;
alter table review_lapse add constraint review_lapse_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;
alter table artifact_scope drop constraint artifact_scope_artifact_id_kind_fkey;
alter table artifact_scope add constraint artifact_scope_artifact_id_kind_fkey
  foreign key (artifact_id, kind) references artifact (id, workflow_kind) on delete restrict;

-- A version pinning members is found from them, for deletion and moving (CG-J).
create index artifact_version_group_members on artifact_version using gin ((content -> 'members'))
  where kind = 'componentGroup';

set constraints all deferred;
