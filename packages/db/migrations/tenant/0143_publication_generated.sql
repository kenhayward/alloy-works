-- A publication's generated content (PUB-082; the GC plan, GC-B): each accepted suggestion a run made
-- and each component a run made, accepted, in a version the publication printed, by the rule
-- `generatedReport` uses (`inHistory`: accepted into that version's history, or into the main line
-- before where its line diverged). Written beside publication_input as the publication is recorded,
-- so one accepted afterwards is never in it. The suggestion and proposal by id alone; the run kept
-- (GEN-046).

create table publication_generated (
  publication_id uuid not null references publication on delete restrict,
  node text not null,
  version_id uuid not null references artifact_version on delete restrict,
  kind text not null check (kind in ('suggestion', 'creation')),
  suggestion_id uuid,
  proposal_id uuid,
  run_id uuid not null references generation_run on delete restrict,
  foreign key (publication_id, node) references publication_input (publication_id, node)
    on delete restrict,
  check ((kind = 'suggestion') = (suggestion_id is not null)),
  check (kind = 'suggestion' or proposal_id is not null)
);
create unique index publication_generated_suggestion on publication_generated
  (publication_id, node, suggestion_id) where kind = 'suggestion';
create unique index publication_generated_creation on publication_generated
  (publication_id, node, proposal_id) where kind = 'creation';

-- PUB-050, as 0017 holds the rest: inserted and read, never changed.
do $$
begin
  execute format(
    'revoke update, delete, truncate on publication_generated from %I',
    current_schema()
  );
end
$$;

-- What a publication's list is, in `tenant`'s schema, of what was accepted by `at`: the one rule, which
-- the recording, the backfill and the check at commit all read. Qualified by the schema given, as the
-- checks of 0017 are, so it holds whatever the session's search path.
create function publication_generated_due(tenant text, publication uuid, at timestamptz)
returns table (
  node text, version_id uuid, kind text, suggestion_id uuid, proposal_id uuid, run_id uuid
)
language plpgsql stable as $$
declare
  -- Version `a` in placed version `p`'s history: its line at or before it, or the main line at or
  -- before where `p`'s line diverged (generated-report.ts, `inHistory`).
  history constant text := format($h$
    a.artifact_id = p.artifact_id and (
      (a.line_id is not distinct from p.line_id
        and (a.revision_no, a.version_no) <= (p.revision_no, p.version_no))
      or (p.line_id is not null and a.line_id is null and exists (
        select 1 from %1$I.artifact_line l join %1$I.artifact_version d on d.id = l.diverged_from
         where l.id = p.line_id
           and (a.revision_no, a.version_no) <= (d.revision_no, d.version_no))))
  $h$, tenant);
begin
  return query execute format($q$
    select i.node, i.version_id, 'suggestion'::text, g.id,
           (select o.id from %1$I.generation_proposal o where o.suggestion_id = g.id
             order by o.made_at, o.id limit 1),
           g.run_id
      from %1$I.publication_input i
      join %1$I.artifact_version p on p.id = i.version_id
      join %1$I.suggestion g on g.component_id = p.artifact_id and g.run_id is not null
      join %1$I.suggestion_resolution r on r.suggestion_id = g.id and r.act = 'accepted'
        and r.resolved_at <= $2
      join %1$I.artifact_version a on a.id = r.version_id
     where i.publication_id = $1 and i.node is not null and %2$s
    union all
    -- A component made from a proposal (G5-E): its first version, the model's text, accepted as made.
    select i.node, i.version_id, 'creation'::text, null::uuid, o.id, o.run_id
      from %1$I.publication_input i
      join %1$I.artifact_version p on p.id = i.version_id
      join %1$I.generation_proposal o on o.component_id = p.artifact_id and o.state = 'accepted'
        and o.creates is not null and o.acted_at <= $2
      join %1$I.artifact_version a on a.artifact_id = o.component_id and a.revision_no = 0
        and a.version_no = 1 and a.line_id is null
     where i.publication_id = $1 and i.node is not null and %2$s
  $q$, tenant, history) using publication, at;
end
$$;

-- Every publication already made, as it would have been recorded: what was accepted by the time its
-- request was finished. Before the trigger below, which refuses a row for a finished request.
insert into publication_generated
  (publication_id, node, version_id, kind, suggestion_id, proposal_id, run_id)
select p.id, d.node, d.version_id, d.kind, d.suggestion_id, d.proposal_id, d.run_id
  from publication p
  join publication_request r on r.id = p.request_id
  cross join lateral publication_generated_due(current_schema(), p.id, r.finished_at) d;

-- Recorded in the transaction that makes the publication, while its request is queued (0017's check).
create trigger publication_generated_while_queued before insert on publication_generated
  for each row execute function publication_part_while_queued();

-- No publication claims generated content it does not hold: at commit, every row is one the rule
-- finds. A subset, not equality, so an acceptance committed while the publication is recorded never
-- fails it; `recordPublication` writes the whole list by the same rule.
create function publication_generated_held() returns trigger
language plpgsql as $$
declare
  held boolean;
begin
  execute format(
    $check$
    select not exists (
      select g.node, g.version_id, g.kind, g.suggestion_id, g.proposal_id, g.run_id
        from %1$I.publication_generated g where g.publication_id = $1
      except
      select * from %1$I.publication_generated_due(%2$L, $1, now())
    )
    $check$,
    tg_table_schema,
    tg_table_schema
  ) into held using new.id;
  if held is not true then
    raise exception
      'publication_generated: a publication lists only the accepted generated content it printed';
  end if;
  return null;
end
$$;

create constraint trigger publication_generated_held after insert on publication
  deferrable initially deferred
  for each row execute function publication_generated_held();
