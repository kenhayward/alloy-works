import { readOutline, walkOutline, type ReadableSet } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { deletedAmong } from './deletion.js';
import { mayReadArtifact } from './queryDefinitions.js';
import { referencesStored } from './reference-index.js';
import type { TenantTransaction } from './tables.js';
import { workflowStates } from './workflow.js';
import { collated } from './listing.js';
import type { InterfaceLanguage } from '@alloy-works/domain';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One reference to the component in a document's latest outline, and how it follows it (REU-007). */
export interface UsingReference {
  readonly node: string;
  /** `latest` sees each new version, `approved` each approved revision, `pinned` nothing (R1-C). */
  readonly mode: 'latest' | 'approved' | 'pinned';
  readonly version: { readonly id: string; readonly number: string } | null;
  /** Whether it carries local overrides in its document (REU-013; the R4 plan, R4-E). */
  readonly overridden: boolean;
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
 * Where a component is used (REU-006, REU-007; the R1 plan, R1-B, R1-C), read from the reference index: the
 * documents whose latest version places it, each reference with its mode, and the baselines and
 * publications pinning a version of it. What `by` may not read, or is deleted, is never named, and
 * only whether there is any is said. The caller has decided `by` may read the component.
 */
export async function componentUses(
  trx: TenantTransaction,
  by: string,
  componentId: string,
  /** The reader's language, whose collation the names sort in (UI-H; LOC-003). */
  language?: InterfaceLanguage,
): Promise<ComponentUses> {
  if (!UUID.test(componentId) || !(await referencesStored(trx))) return NONE;
  const readable = await loadReadableSet(trx, by);

  // The documents whose latest versions place it, from the reference index (the R2 plan, R2-B).
  const { rows: latest } = await sql<{
    id: string;
    space_id: string;
    version_id: string;
    content: unknown;
  }>`
    select distinct a.id, a.space_id, v.id as version_id, v.content
      from reference r
      join artifact a on a.id = r.from_id and a.kind = 'document'
      join artifact_version v on v.id = r.from_version
     where r.to_id = ${componentId}`.execute(trx);
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
        overridden: (node.overrides?.length ?? 0) > 0,
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
     order by b.name ${await collated(trx, language)}, b.id`.execute(trx);
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

export interface AssetUses {
  /** Each component whose latest version places it. */
  readonly components: Pins<{ readonly id: string; readonly title: string }>;
  /** Each document whose latest version places one of those components. */
  readonly documents: Pins<{ readonly id: string; readonly title: string }>;
  readonly baselines: Pins<{
    readonly id: string;
    readonly name: string;
    readonly document: string;
  }>;
  readonly publications: Pins<{ readonly id: string; readonly title: string }>;
}

/**
 * **Where an image is used** (AST-018, AST-050; the AL plan, AL-K), read from the reference index as
 * a component's uses are: the components whose latest version places any version of it, the
 * documents placing those, and the baselines and publications pinning it. What `by` may not read, or
 * is deleted, is never named, and only whether there is any is said. The caller has decided `by` may
 * read the image.
 */
export async function assetUses(
  trx: TenantTransaction,
  by: string,
  assetId: string,
  language?: InterfaceLanguage,
): Promise<AssetUses> {
  const none = { named: [], unreadable: false };
  if (!UUID.test(assetId) || !(await referencesStored(trx))) {
    return { components: none, documents: none, baselines: none, publications: none };
  }
  const readable = await loadReadableSet(trx, by);
  const order = await collated(trx, language);
  const { rows: components } = await sql<{ id: string; space_id: string; title: string | null }>`
    select distinct a.id, a.space_id, v.content ->> 'title' as title
      from reference r
      join artifact a on a.id = r.from_id and a.kind = 'component'
      join artifact_version v on v.id = r.from_version
     where r.to_id = ${assetId}
     order by title ${order}, a.id`.execute(trx);
  const shownComponents = await readableAmong(trx, readable, components);
  const { rows: documents } = await sql<{ id: string; space_id: string; title: string | null }>`
    select distinct a.id, a.space_id, v.content ->> 'title' as title
      from reference r
      join artifact a on a.id = r.from_id and a.kind = 'document'
      join artifact_version v on v.id = r.from_version
     where r.to_id in (select c.from_id from reference c where c.to_id = ${assetId})
     order by title ${order}, a.id`.execute(trx);
  const shownDocuments = await readableAmong(trx, readable, documents);
  const { rows: baselines } = await sql<{
    id: string;
    name: string;
    document: string;
    space_id: string;
  }>`
    select b.id, b.name, b.document_id as document, a.space_id
      from baseline b join artifact a on a.id = b.document_id
     where b.id in (select baseline_id from baseline_pin where artifact_id = ${assetId})
     order by b.name ${order}, b.id`.execute(trx);
  const shownBaselines = await readableAmong(
    trx,
    readable,
    baselines.map((row) => ({ ...row, subject: row.document })),
  );
  const { rows: publications } = await sql<{ id: string; title: string; space_id: string }>`
    select p.id, d.content ->> 'title' as title, a.space_id
      from publication p join artifact a on a.id = p.id
      join artifact_version d on d.id = p.document_version_id
     where p.id in (select publication_id from publication_asset where asset_id = ${assetId})
     order by p.published_at, p.id`.execute(trx);
  const shownPublications = await readableAmong(trx, readable, publications);
  const titled = (rows: { id: string; title: string | null }[] & { total: number }) => ({
    named: rows.map(({ id, title }) => ({ id, title: title ?? '' })),
    unreadable: rows.length < rows.total,
  });
  return {
    components: titled(shownComponents),
    documents: titled(shownDocuments),
    baselines: {
      named: shownBaselines.map(({ id, name, document }) => ({ id, name, document })),
      unreadable: shownBaselines.length < shownBaselines.total,
    },
    publications: titled(shownPublications),
  };
}

/**
 * Those `readable` may read, by `subject`'s identity where given, and `total`, how many are not
 * deleted: a deleted one is neither named nor counted among the unreadable (DL-B), since nothing
 * reaches it.
 */
/** A style by what it styles (the R20 plan, R20-A): a paragraph's, a table's, or an image's. */
export type StyleKind = 'paragraph' | 'table' | 'image';

/** Where each kind of style is named in a component's blocks, as a JSON path over its content. */
const STYLE_PATHS: Readonly<Record<StyleKind, string>> = {
  paragraph: '$.** ? (@.style == $key && @.type != "table" && @.type != "boundTable")',
  table: '$.** ? ((@.type == "table" || @.type == "boundTable") && @.style == $key)',
  image: '$.** ? (@.imageStyle == $key)',
};

export interface StyleUses {
  readonly components: readonly { readonly id: string; readonly title: string }[];
  /** Whether a component the reader may not read uses it too: never which. */
  readonly unreadable: boolean;
}

/**
 * **Where a style is used** (REU-055; the R20 plan, R20-A): the components whose main line's latest
 * version names it - a paragraph style wherever a paragraph is, a table's cells among them - by title;
 * what `by` may not read, or is deleted, only said to exist. A style is named by its key, not an
 * artifact, so this reads the content rather than the reference index.
 */
export async function styleUses(
  trx: TenantTransaction,
  by: string,
  style: { readonly kind: StyleKind; readonly key: string },
): Promise<StyleUses> {
  const readable = await loadReadableSet(trx, by);
  const { rows } = await sql<{ id: string; space_id: string; title: string }>`
    select a.id, a.space_id, latest.content ->> 'title' as title
      from artifact a
      cross join lateral (
        select v.content from artifact_version v
         where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc
         limit 1
      ) latest
     where a.kind = 'component'
       and jsonb_path_exists(latest.content -> 'content', ${STYLE_PATHS[style.kind]}::jsonpath,
             jsonb_build_object('key', ${style.key}::text))`.execute(trx);
  const shown = await readableAmong(trx, readable, rows);
  return {
    components: shown
      .map((row) => ({ id: row.id, title: row.title }))
      .sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id)),
    unreadable: shown.total > shown.length,
  };
}

export async function readableAmong<
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
