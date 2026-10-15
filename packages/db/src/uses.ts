import { readOutline, walkOutline, type ReadableSet } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { deletedAmong } from './deletion.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { workflowStates } from './workflow.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCES = `lax $.** ? (@.type == "reference" && @.component == $c)`;

/** One reference to the component in a document's latest outline, and how it follows it (REU-007). */
export interface UsingReference {
  readonly node: string;
  /** `latest` sees each new version, `approved` each approved revision, `pinned` nothing (R1-C). */
  readonly mode: 'latest' | 'approved' | 'pinned';
  readonly version: { readonly id: string; readonly number: string } | null;
}

export interface UsingDocument {
  readonly id: string;
  readonly title: string;
  /** Its workflow state now, and whether that state is an approved one (REU-009). */
  readonly state: {
    readonly key: string;
    readonly name: string;
    readonly approved: boolean;
  } | null;
  readonly references: readonly UsingReference[];
}

/** Named where the reader may read, else flagged: never counted (SCH-032; REL-020). */
interface Pins<T> {
  readonly named: readonly T[];
  readonly unreadable: boolean;
}

export interface ComponentUses {
  /** Live references: each document whose latest version places it, which a change may reach. */
  readonly documents: readonly UsingDocument[];
  readonly unreadableDocuments: boolean;
  /** Pins a change never reaches (REU-052's distinction). */
  readonly baselines: Pins<{
    readonly id: string;
    readonly name: string;
    readonly document: string;
  }>;
  readonly publications: Pins<{ readonly id: string; readonly title: string }>;
}

const NONE: ComponentUses = {
  documents: [],
  unreadableDocuments: false,
  baselines: { named: [], unreadable: false },
  publications: { named: [], unreadable: false },
};

/**
 * Where a component is used (REU-006, REU-007; the R1 plan, R1-A to R1-C), computed when asked: the
 * documents whose latest version places it, each reference with its mode, and the baselines and
 * publications pinning a version of it. What `by` may not read, or is deleted, is never named, and
 * only whether there is any is said. The caller has decided `by` may read the component.
 */
export async function componentUses(
  trx: TenantTransaction,
  by: string,
  componentId: string,
): Promise<ComponentUses> {
  if (!UUID.test(componentId)) return NONE;
  const readable = await loadReadableSet(trx, by);
  const c = JSON.stringify({ c: componentId });

  // From the documents any version of which placed it, to those whose latest does.
  const { rows: latest } = await sql<{
    id: string;
    space_id: string;
    version_id: string;
    content: unknown;
  }>`
    select latest.artifact_id as id, a.space_id, latest.id as version_id, latest.content
      from (
        select distinct on (v.artifact_id) v.artifact_id, v.id, v.content
          from artifact_version v
         where v.kind = 'document'
           and v.artifact_id in (
             select artifact_id from artifact_version
              where kind = 'document'
                and jsonb_path_exists(content, ${REFERENCES}::jsonpath, ${c}::jsonb))
         order by v.artifact_id, v.revision_no desc, v.version_no desc
      ) latest
      join artifact a on a.id = latest.artifact_id
     where jsonb_path_exists(latest.content, ${REFERENCES}::jsonpath, ${c}::jsonb)`.execute(trx);
  const shown = await readableAmong(trx, readable, latest);
  const outlines = shown.flatMap((row) => {
    const read = readOutline(row.content, { artifact: row.id, version: row.version_id });
    return read.ok ? [{ id: row.id, outline: read.outline }] : [];
  });
  const pinnedIds = new Set<string>();
  for (const { outline } of outlines) {
    walkOutline(outline.nodes, (node) => {
      if (node.type === 'reference' && node.component === componentId) {
        if (node.mode.kind === 'pinned') pinnedIds.add(node.mode.version);
      }
    });
  }
  const numbers = await versionNumbers(trx, componentId, [...pinnedIds]);
  const states = await workflowStates(
    trx,
    outlines.map((each) => each.id),
  );
  const documents: UsingDocument[] = outlines.map(({ id, outline }) => {
    const references: UsingReference[] = [];
    walkOutline(outline.nodes, (node) => {
      if (node.type !== 'reference' || node.component !== componentId) return;
      const { mode } = node;
      references.push({
        node: node.id,
        mode: mode.kind,
        version:
          mode.kind === 'pinned'
            ? { id: mode.version, number: numbers.get(mode.version) ?? '' }
            : null,
      });
    });
    const state = states.get(id);
    return {
      id,
      title: outline.title,
      state: state ? { key: state.key, name: state.name, approved: state.approved } : null,
      references,
    };
  });
  documents.sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id));

  // Pins a change never reaches: a baseline's, and a publication's inputs.
  const { rows: baselines } = await sql<{
    id: string;
    name: string;
    document: string;
    space_id: string;
  }>`
    select b.id, b.name, b.document_id as document, a.space_id
      from baseline b join artifact a on a.id = b.document_id
     where b.id in (select baseline_id from baseline_pin where artifact_id = ${componentId})
     order by b.name collate "C", b.id`.execute(trx);
  const seenBaselines = await readableAmong(
    trx,
    readable,
    baselines.map((row) => ({ ...row, subject: row.document })),
  );
  const { rows: publications } = await sql<{ id: string; title: string; space_id: string }>`
    select p.id, d.content ->> 'title' as title, a.space_id
      from publication p join artifact a on a.id = p.id
      join artifact_version d on d.id = p.document_version_id
     where p.id in (select i.publication_id from publication_input i
                      join artifact_version v on v.id = i.version_id
                     where v.artifact_id = ${componentId})
     order by p.published_at, p.id`.execute(trx);
  const seenPublications = await readableAmong(trx, readable, publications);

  return {
    documents,
    // An outline that does not read is flagged, never dropped silently: a version may reach it.
    unreadableDocuments: outlines.length < shown.total,
    baselines: {
      named: seenBaselines.map(({ id, name, document }) => ({ id, name, document })),
      unreadable: seenBaselines.length < seenBaselines.total,
    },
    publications: {
      named: seenPublications.map(({ id, title }) => ({ id, title: title ?? '' })),
      unreadable: seenPublications.length < seenPublications.total,
    },
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Those `readable` may read, by `subject`'s identity where given, and `total`, how many are not
 * deleted: a deleted one is neither named nor counted among the unreadable (DL-B), since nothing
 * reaches it.
 */
async function readableAmong<
  T extends { readonly id: string; readonly space_id: string; readonly subject?: string },
>(
  trx: TenantTransaction,
  readable: ReadableSet | undefined,
  rows: readonly T[],
): Promise<T[] & { readonly total: number }> {
  const deleted = await deletedAmong(
    trx,
    rows.map((row) => row.subject ?? row.id),
  );
  const live = rows.filter((row) => !deleted.has(row.subject ?? row.id));
  const shown = live.filter(
    (row) =>
      readable !== undefined &&
      mayReadArtifact(readable, { id: row.subject ?? row.id, spaceId: row.space_id }),
  );
  return Object.assign(shown, { total: live.length });
}

/** Each pinned version's number, `revision.version`, among the component's own versions alone. */
async function versionNumbers(
  trx: TenantTransaction,
  componentId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'revision_no', 'version_no'])
    .where('artifact_id', '=', componentId)
    .where('id', 'in', [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, `${row.revision_no}.${row.version_no}`]));
}
