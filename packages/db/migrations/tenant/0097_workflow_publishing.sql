-- A baseline and a publication at a gate (VER-059, LIF-013, LIF-050, PUB-004; the WF2 plan, WF2-H,
-- WF2-I; workflow.md).

set constraints all immediate;

-- The gate a baseline was made at, by its transition key (VER-059): 0072 held it to none until LIF
-- had gates to name.
alter table baseline
  drop constraint baseline_gate,
  add constraint baseline_gate check (gate is null or gate ~ '^[a-z][a-z0-9_]*$');

do $$
begin
  execute format('grant insert (gate) on baseline to %I', current_schema());
end
$$;

-- A publication from a baseline taken at a gate is approved (PUB-004; WF2-I); one from a person's
-- baseline stays a baseline's, and one from the live document none.
alter table publication
  drop constraint publication_approval,
  add constraint publication_approval check (
    (approval = 'none' and baseline_id is null)
    or (approval in ('baseline', 'approved') and baseline_id is not null)
  );

-- The document seed's version 3, only where a tenant's newest document workflow is still the seed's
-- version 2: Approve also takes a baseline, from which its approver may publish (WF2-H, WF2-I).
insert into workflow_definition (kind, version_no, body)
select 'document', 3, jsonb_set(
  d.body,
  '{transitions,1,gate}',
  (d.body #> '{transitions,1,gate}') || '{"baseline": true, "publication": "permitted"}'::jsonb
)
from workflow_definition d
where d.kind = 'document' and d.version_no = 2 and d.by is null
  and d.body #>> '{transitions,1,key}' = 'approve'
  and not exists (select 1 from workflow_definition n where n.kind = 'document' and n.version_no > 2);

set constraints all deferred;
