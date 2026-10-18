import { sql } from 'kysely';

import { personView, type PersonView } from './person-view.js';
import type { TenantTransaction } from './tables.js';

/**
 * What of a document, or of a publication, came from a model (generation.md, "Proposals"; the G3 plan,
 * G3-C, G3-D; GEN-026, GEN-041): for each placed component version, every suggestion a run made on the
 * component - accepted, open, rejected or withdrawn - and every proposal its requester discarded, each
 * with who asked, who acted and when, and its run's model, endpoint, instructions and digest. An
 * accepted one says the version it went into and whether that version is in the one placed. Nothing
 * here is ever deleted or changed (0077, 0120, 0121), so a report of a publication is its record.
 */

/** A component version placed in a document or a publication, as the caller decided it may be read. */
export interface Placement {
  readonly node: string;
  readonly component: string;
  readonly version: string;
}

export interface GeneratedRun {
  readonly id: string;
  readonly model: string | null;
  readonly endpoint: string;
  /** The assistant's instructions' version, the product's (G2-F); a prompt's version arrives with G4. */
  readonly instructions: string | null;
  readonly promptVersion: string | null;
  readonly contextDigest: string;
}

export interface GeneratedItem {
  readonly kind: 'suggestion' | 'proposal';
  readonly id: string;
  readonly state: 'accepted' | 'open' | 'rejected' | 'withdrawn' | 'discarded';
  readonly askedBy: PersonView | null;
  readonly actedBy: PersonView | null;
  readonly actedAt: Date | null;
  /** For an accepted one: the version it went into, and whether that version is in the one placed. */
  readonly acceptedInto: {
    readonly version: string;
    readonly number: string;
    readonly inPlaced: boolean;
  } | null;
  readonly run: GeneratedRun;
}

export interface GeneratedPlacement extends Placement {
  readonly number: string;
  /** The version the placed one was restored from, where it was: what was accepted may be gone. */
  readonly restoredFrom: string | null;
  readonly items: readonly GeneratedItem[];
}

interface Row {
  kind: 'suggestion' | 'proposal';
  id: string;
  component_id: string;
  placed: string;
  state: GeneratedItem['state'];
  asked_by: string | null;
  asked_name: string | null;
  asked_kind: string | null;
  acted_by: string | null;
  acted_name: string | null;
  acted_kind: string | null;
  acted_at: Date | null;
  accepted_version: string | null;
  accepted_number: string | null;
  in_placed: boolean | null;
  run_id: string;
  model: string | null;
  endpoint: Record<string, unknown>;
  parameters: Record<string, unknown>;
  prompt_version: string | null;
  context_digest: string;
}

/**
 * Whether version `a` is in version `p`'s history (the G3 plan, G3-C): the same line at or before it,
 * or the main line at or before where `p`'s line diverged. Versions of a line are numbered below the
 * main line (ADR-0063), so numbers alone never compare across lines.
 */
const inHistory = (a: string, p: string) => sql<boolean>`(
  ${sql.ref(a)}.artifact_id = ${sql.ref(p)}.artifact_id and (
    ((to_jsonb(${sql.ref(a)}) ->> 'line_id') is not distinct from (to_jsonb(${sql.ref(p)}) ->> 'line_id')
      and (${sql.ref(a)}.revision_no, ${sql.ref(a)}.version_no)
        <= (${sql.ref(p)}.revision_no, ${sql.ref(p)}.version_no))
    or ((to_jsonb(${sql.ref(p)}) ->> 'line_id') is not null
      and (to_jsonb(${sql.ref(a)}) ->> 'line_id') is null
      and exists (select 1 from artifact_line l join artifact_version d on d.id = l.diverged_from
        where l.id = (to_jsonb(${sql.ref(p)}) ->> 'line_id')::uuid
          and (${sql.ref(a)}.revision_no, ${sql.ref(a)}.version_no) <= (d.revision_no, d.version_no)))
  ))`;

export async function generatedReport(
  trx: TenantTransaction,
  placements: readonly Placement[],
): Promise<GeneratedPlacement[]> {
  if (placements.length === 0) return [];
  const versions = [...new Set(placements.map((each) => each.version))];
  const { rows: placed } = await sql<{
    id: string;
    number: string;
    restored_from: string | null;
  }>`select v.id, v.revision_no || '.' || v.version_no as number,
       (select f.revision_no || '.' || f.version_no from artifact_version f where f.id = v.restored_from)
         as restored_from
     from artifact_version v where v.id = any(${versions}::uuid[])`.execute(trx);
  const placedBy = new Map(placed.map((row) => [row.id, row]));

  const { rows } = await sql<Row>`
    with p as (
      select v.*, v.id as placed from artifact_version v where v.id = any(${versions}::uuid[])
    )
    select 'suggestion' as kind, g.id, g.component_id, p.placed,
           coalesce(case r.act when 'accepted' then 'accepted' when 'rejected' then 'rejected'
             when 'withdrawn' then 'withdrawn' end, 'open') as state,
           run.requested_by as asked_by, m.display_name as asked_name, m.kind as asked_kind,
           r.resolved_by as acted_by, rp.display_name as acted_name, rp.kind as acted_kind,
           r.resolved_at as acted_at,
           a.id as accepted_version,
           case when a.id is null then null else a.revision_no || '.' || a.version_no end
             as accepted_number,
           case when a.id is null then null else ${inHistory('a', 'p')} end as in_placed,
           run.id as run_id, run.model, run.endpoint, run.parameters, run.prompt_version,
           g.context_digest
      from p
      join suggestion g on g.component_id = p.artifact_id
      join generation_run run on run.id = (to_jsonb(g) ->> 'run_id')::uuid
      left join principal m on m.id = run.requested_by
      left join suggestion_resolution r on r.suggestion_id = g.id
      left join principal rp on rp.id = r.resolved_by
      left join artifact_version a on a.id = r.version_id
    union all
    select 'proposal', o.id, o.component_id, p.placed, 'discarded',
           run.requested_by, m.display_name, m.kind,
           o.acted_by, ap.display_name, ap.kind, o.acted_at,
           null, null, null,
           run.id, run.model, run.endpoint, run.parameters, run.prompt_version, run.context_digest
      from p
      join generation_proposal o on o.component_id = p.artifact_id and o.state = 'discarded'
      join generation_run run on run.id = o.run_id
      left join principal m on m.id = run.requested_by
      left join principal ap on ap.id = o.acted_by
    order by acted_at nulls first, id`.execute(trx);

  const person = (id: string | null, name: string | null, kind: string | null) =>
    id === null ? null : personView(id, name, kind);
  return placements.flatMap((placement) => {
    const items = rows
      .filter((row) => row.placed === placement.version)
      .map((row): GeneratedItem => ({
        kind: row.kind,
        id: row.id,
        state: row.state,
        askedBy: person(row.asked_by, row.asked_name, row.asked_kind),
        actedBy: person(row.acted_by, row.acted_name, row.acted_kind),
        actedAt: row.acted_at,
        acceptedInto:
          row.accepted_version === null
            ? null
            : {
                version: row.accepted_version,
                number: row.accepted_number!,
                inPlaced: row.in_placed === true,
              },
        run: {
          id: row.run_id,
          model: row.model,
          endpoint: String(row.endpoint.name ?? ''),
          instructions:
            typeof row.parameters.instructions === 'string' ? row.parameters.instructions : null,
          promptVersion: row.prompt_version,
          contextDigest: row.context_digest,
        },
      }));
    if (items.length === 0) return [];
    const at = placedBy.get(placement.version);
    return [
      {
        ...placement,
        number: at?.number ?? '',
        restoredFrom: at?.restored_from ?? null,
        items,
      },
    ];
  });
}

/** The component versions a publication printed, by node, as it recorded them (G3-D). */
export async function publicationPlacements(
  trx: TenantTransaction,
  id: string,
): Promise<Placement[]> {
  const { rows } = await sql<{ node: string; version_id: string; artifact_id: string }>`
    select i.node, i.version_id, v.artifact_id from publication_input i
      join artifact_version v on v.id = i.version_id
     where i.publication_id = ${id} and i.node is not null
     order by i.node`.execute(trx);
  return rows.map((row) => ({
    node: row.node,
    component: row.artifact_id,
    version: row.version_id,
  }));
}
