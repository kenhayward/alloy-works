import { recordedTerms, usesIn } from './publication-terms.js';
import {
  citationPlaces,
  termWarnings,
  baselineDigestInput,
  baselineNameProblem,
  labelFor,
  nameKey,
  parseProvenance,
  PUBLISHING_FORMATS,
  readContent,
  readLayout,
  readOutline,
  selectOutline,
  unsupportedFormats,
  type BaselinePins,
  type PublishFailure,
  type StoredProfile,
} from '@alloy-works/domain';
import { documentTemplate } from './templates.js';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { AUDIT_LOG_KEPT, labelled, labels, recordEvent } from './audit.js';
import type { HeldResolution } from './datasets.js';
import { readableComponents } from './documents.js';
import {
  documentCitesAPage,
  recordPublicationEvent,
  resolvePublishable,
  type PublishRefusal,
} from './publishing.js';
import { enqueueJob } from './queue.js';
import { readableArtifacts } from './readable-artifacts.js';
import { revisionsNamed } from './revisions.js';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';

/** The value each revision holds, by identifier (RV-E): what a baseline's digest pins of it. */
async function revisionValues(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<Map<string, string | boolean>> {
  return new Map(
    (await revisionsNamed(trx, ids)).flatMap((each) =>
      each.value === null ? [] : [[each.id, each.value] as const],
    ),
  );
}

/** A binding pin's revisions, by identifier and value, ascending; none where it pinned none. */
const pinnedRevisions = (ids: readonly string[], values: ReadonlyMap<string, string | boolean>) =>
  ids.length === 0 ? {} : { revisions: ids.map((id) => ({ id, value: values.get(id)! })) };

/** What making a baseline answers (docs/design/baselines.md; the BL plan, Task 1). */
export type MakeBaselineAnswer =
  | { readonly answer: 'made'; readonly baseline: string }
  /** The name cannot be stored (VER-046), and why. */
  | { readonly answer: 'name.invalid'; readonly problem: string }
  /** Another baseline of this document has this name, whatever its case (VER-046). */
  | { readonly answer: 'name.taken' }
  /**
   * Resolving found what a request would record as a failure (BL-A): an occurrence unreadable or
   * unresolved, an image, a component's own values. Each by its node, never by what it names.
   */
  | { readonly answer: 'baseline.unresolved'; readonly failures: readonly PublishFailure[] }
  | PublishRefusal;

/**
 * A baseline of the document's latest version, made by `maker` (VER-017; the BL plan, BL-A to BL-D):
 * resolved by `resolvePublishable`, as a publish is, and refused on anything a publish refuses or
 * records as a failure. What resolved is inserted once - the document, layout, theme and template
 * versions, each occurrence's version by its node, each image's asset version, each binding's dataset
 * version and the dataset's name - with the digest over all of it (VER-043), and `baseline.made` on
 * the log, in the caller's transaction, where `publish` on the document has been decided.
 */
export async function makeBaseline(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly name: string;
    readonly maker: string;
    /** The gate it is made at, by its transition key (VER-059); none for a person's. */
    readonly gate?: string;
  },
): Promise<MakeBaselineAnswer> {
  const name = input.name.normalize('NFC');
  const problem = baselineNameProblem(name);
  if (problem !== null) return { answer: 'name.invalid', problem };

  const found = await resolvePublishable(trx, {
    documentId: input.documentId,
    version: input.version,
    principal: input.maker,
    formats: null,
    kind: 'publish',
  });
  if (found.answer !== 'publishable') return found;
  if (found.failures.length > 0) return { answer: 'baseline.unresolved', failures: found.failures };

  // The version it is bound to now: the one it was moved to, where it was (the WF6 final review).
  const link = await documentTemplate(trx, input.documentId);
  const template = link && { template_id: link.template, template_version_id: link.version };
  const versions = [
    found.latest.id,
    found.layout.versionId,
    found.theme.versionId,
    ...(template ? [template.template_version_id] : []),
    ...found.resolved.map((each) => each.version),
    ...found.assets.map((each) => each.version),
    ...found.entries.map((each) => each.version),
    ...found.terms.map((each) => each.version),
    ...found.bindings.map((each) => each.datasetVersion),
  ];
  const digests = new Map(
    (
      await trx
        .selectFrom('artifact_version')
        .select(['id', 'version_digest'])
        .where('id', 'in', [...new Set(versions)])
        .execute()
    ).map((row) => [row.id, row.version_digest]),
  );
  const pinned = (version: string) => ({ version, digest: digests.get(version)! });
  const values = await revisionValues(
    trx,
    found.bindings.flatMap((each) => each.revisions),
  );
  const pins: BaselinePins = {
    document: pinned(found.latest.id),
    layout: pinned(found.layout.versionId),
    theme: pinned(found.theme.versionId),
    template: template ? pinned(template.template_version_id) : null,
    occurrences: found.resolved.map((each) => ({ node: each.node, ...pinned(each.version) })),
    assets: found.assets.map((each) => pinned(each.version)),
    ...(found.entries.length === 0
      ? {}
      : { entries: found.entries.map((each) => pinned(each.version)) }),
    ...(found.terms.length === 0 ? {} : { terms: found.terms.map((each) => pinned(each.version)) }),
    bindings: found.bindings.map((each) => ({
      node: each.node,
      binding: each.binding,
      digest: each.digest,
      datasetVersion: each.datasetVersion,
      datasetDigest: digests.get(each.datasetVersion)!,
      ...pinnedRevisions(each.revisions, values),
    })),
  };

  const made = await trx
    .insertInto('baseline')
    .values({
      document_id: input.documentId,
      name,
      name_key: nameKey(name),
      document_version_id: found.latest.id,
      made_by: input.maker,
      layout_id: found.layout.artifactId,
      layout_version_id: found.layout.versionId,
      theme_id: found.theme.artifactId,
      theme_version_id: found.theme.versionId,
      template_id: template?.template_id ?? null,
      template_version_id: template?.template_version_id ?? null,
      digest: sha256Hex(baselineDigestInput(pins)),
      ...(input.gate === undefined ? {} : { gate: input.gate }),
    })
    .onConflict((conflict) => conflict.columns(['document_id', 'name_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!made) return { answer: 'name.taken' };

  const parts = [
    ...found.resolved.map((each) => ({
      baseline_id: made.id,
      node: each.node,
      version_id: each.version,
      artifact_id: each.component,
      kind: 'component' as const,
    })),
    ...found.assets.map((each) => ({
      baseline_id: made.id,
      node: null,
      version_id: each.version,
      artifact_id: each.asset,
      kind: 'asset' as const,
    })),
    // Each entry version its citations read, so its publish never reads a later one (LIB-047).
    ...found.entries.map((each) => ({
      baseline_id: made.id,
      node: null,
      version_id: each.version,
      artifact_id: each.entry,
      kind: 'bibliographyEntry' as const,
    })),
    // Each term version its uses read, decided as its maker (TMb; TM-G): only what the maker may read.
    ...found.terms.map((each) => ({
      baseline_id: made.id,
      node: null,
      version_id: each.version,
      artifact_id: each.term,
      kind: 'term' as const,
    })),
  ];
  if (parts.length > 0) await trx.insertInto('baseline_pin').values(parts).execute();
  if (found.bindings.length > 0) {
    const names = await datasetNames(trx, [
      ...new Set(found.bindings.map((each) => each.datasetId)),
    ]);
    await trx
      .insertInto('baseline_binding')
      .values(
        found.bindings.map((each) => ({
          baseline_id: made.id,
          node: each.node,
          binding: each.binding,
          digest: each.digest,
          resolution: each.resolution,
          dataset_version: each.datasetVersion,
          dataset_id: each.datasetId,
          dataset_name: names.get(each.datasetId) ?? null,
          ...(each.revisions.length === 0 ? {} : { revisions: [...each.revisions] }),
        })),
      )
      .execute();
  }
  await recordBaselineEvent(
    trx,
    'baseline.made',
    { document: input.documentId, version: found.latest.id },
    { baseline: made.id },
  );
  return { answer: 'made', baseline: made.id };
}

/** Each dataset's latest name, as provenance prints it; one never named has none. */
async function datasetNames(
  trx: TenantTransaction,
  datasets: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await trx
    .selectFrom('dataset_name')
    .distinctOn('dataset_id')
    .select(['dataset_id', 'name'])
    .where('dataset_id', 'in', datasets)
    .orderBy('dataset_id')
    .orderBy('id', 'desc')
    .execute();
  return new Map(rows.map((row) => [row.dataset_id, row.name]));
}

/**
 * The images of these the principal may read, by the readable-set predicate every listing of content
 * uses, as a publish decides an image (figures 3, ruling R6): what a baseline's read shows and its
 * publish asks of the publisher alike (the BL final review, finding 1).
 */
async function readableAssets(
  trx: TenantTransaction,
  principal: string,
  assets: readonly string[],
  /** An entry's too (CIc), and a term's (TMb), read by the same predicate. */
  kind: 'asset' | 'bibliographyEntry' | 'term' = 'asset',
): Promise<ReadonlySet<string>> {
  if (assets.length === 0) return new Set();
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return new Set();
  const rows = await trx
    .selectFrom('artifact as a')
    .select('a.id')
    .where('a.id', 'in', [...new Set(assets)])
    .where('a.kind', '=', kind)
    .where((eb) => readableArtifacts(eb, readable))
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** A baseline as one list shows it (VER-049): superseded or not, and by which. */
export interface BaselineSummary {
  readonly id: string;
  readonly documentId: string;
  readonly name: string;
  readonly madeBy: { readonly id: string; readonly name: string | null };
  readonly madeAt: Date;
  readonly digest: string;
  readonly superseded: {
    readonly by: string;
    readonly principal: string;
    readonly at: Date;
  } | null;
}

/** A baseline read whole, as `reader` may read it (BL-G). */
export interface BaselineRecord extends BaselineSummary {
  /** Every pin the reader may read: all of them for a reader of everything, who can recompute the digest. */
  readonly pins: BaselinePins;
  /**
   * What the reader may not read, as little as says it is there: each occurrence's node, and how many
   * images. Never a component, a version or a binding.
   */
  readonly withheld: { readonly nodes: readonly string[]; readonly assets: number };
  /**
   * The profile in force when it was taken (VER-020; the R11 plan, R11-F): the pinned document
   * version's, which its publication runs under. Null where that version declares none.
   */
  readonly profile: StoredProfile | null;
}

const summaries = (trx: TenantTransaction) =>
  trx
    .selectFrom('baseline as b')
    .innerJoin('principal as p', 'p.id', 'b.made_by')
    .leftJoin('baseline_supersession as s', 's.baseline_id', 'b.id')
    .select([
      'b.id',
      'b.document_id',
      'b.name',
      'b.made_by',
      'p.display_name',
      'b.made_at',
      'b.digest',
      's.superseded_by',
      's.superseded_by_principal',
      's.superseded_at',
    ]);

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaries>['execute']>>[number];

const summaryOf = (row: SummaryRow): BaselineSummary => ({
  id: row.id,
  documentId: row.document_id,
  name: row.name,
  madeBy: { id: row.made_by, name: row.display_name },
  madeAt: row.made_at,
  digest: row.digest,
  superseded:
    row.superseded_by === null
      ? null
      : { by: row.superseded_by, principal: row.superseded_by_principal!, at: row.superseded_at! },
});

/**
 * A document's baselines, newest first (VER-049): `current`, `superseded`, or both when no state is
 * named. Who may read the document is the caller's to decide; nothing here names a component.
 */
export async function listBaselines(
  trx: TenantTransaction,
  documentId: string,
  state?: 'current' | 'superseded',
): Promise<BaselineSummary[]> {
  let query = summaries(trx).where('b.document_id', '=', documentId);
  if (state === 'current') query = query.where('s.baseline_id', 'is', null);
  if (state === 'superseded') query = query.where('s.baseline_id', 'is not', null);
  const rows = await query.orderBy('b.made_at', 'desc').orderBy('b.id').execute();
  return rows.map(summaryOf);
}

/** The document a baseline is of, or none: what a route on it is decided on (BL-H). */
export async function baselineDocument(
  trx: TenantTransaction,
  baselineId: string,
): Promise<string | undefined> {
  const row = await trx
    .selectFrom('baseline')
    .select('document_id')
    .where('id', '=', baselineId)
    .executeTakeFirst();
  return row?.document_id;
}

/**
 * A baseline read whole as `reader` (BL-G): each pin of a component they may read with its version
 * and digest, and each one they may not as its node alone - never its component or version (IAM-073);
 * images likewise, counted. The document, layout, theme and template versions are the document's
 * reader's. Bindings only at nodes the reader may read.
 */
export async function readBaseline(
  trx: TenantTransaction,
  baselineId: string,
  reader: string,
): Promise<BaselineRecord | undefined> {
  const row = await summaries(trx)
    .innerJoin('artifact_version as dv', 'dv.id', 'b.document_version_id')
    .innerJoin('artifact_version as lv', 'lv.id', 'b.layout_version_id')
    .innerJoin('artifact_version as tv', 'tv.id', 'b.theme_version_id')
    .leftJoin('artifact_version as pv', 'pv.id', 'b.template_version_id')
    .select([
      'b.document_version_id',
      'dv.version_digest as document_digest',
      'b.layout_version_id',
      'lv.version_digest as layout_digest',
      'b.theme_version_id',
      'tv.version_digest as theme_digest',
      'b.template_version_id',
      'pv.version_digest as template_digest',
      sql<StoredProfile | null>`dv.content -> 'profile'`.as('profile'),
    ])
    .where('b.id', '=', baselineId)
    .executeTakeFirst();
  if (!row) return undefined;
  const pins = await trx
    .selectFrom('baseline_pin as p')
    .innerJoin('artifact_version as v', 'v.id', 'p.version_id')
    .select(['p.node', 'p.version_id', 'p.artifact_id', 'p.kind', 'v.version_digest'])
    .where('p.baseline_id', '=', baselineId)
    .execute();
  const readable = await readableComponents(
    trx,
    reader,
    pins.filter((each) => each.kind === 'component').map((each) => each.artifact_id),
  );
  const readableImages = await readableAssets(
    trx,
    reader,
    pins.filter((each) => each.kind === 'asset').map((each) => each.artifact_id),
  );
  const bindings = await trx
    .selectFrom('baseline_binding as b')
    .innerJoin('artifact_version as v', 'v.id', 'b.dataset_version')
    .select(['b.node', 'b.binding', 'b.digest', 'b.dataset_version', 'v.version_digest'])
    // Through the row whole: a schema before 0078 has no such column (RV-E).
    .select(
      sql<
        string[] | null
      >`(select array_agg(e) from jsonb_array_elements_text(to_jsonb(b) -> 'revisions') e)`.as(
        'revisions',
      ),
    )
    .where('b.baseline_id', '=', baselineId)
    .execute();
  const values = await revisionValues(
    trx,
    bindings.flatMap((each) => each.revisions ?? []),
  );
  const occurrences = pins.filter((each) => each.kind === 'component');
  const shown = new Set(
    occurrences.filter((each) => readable.has(each.artifact_id)).map((each) => each.node!),
  );
  const assets = pins.filter((each) => each.kind === 'asset');
  const entries = pins.filter((each) => each.kind === 'bibliographyEntry');
  const readableEntries = await readableAssets(
    trx,
    reader,
    entries.map((each) => each.artifact_id),
    'bibliographyEntry',
  );
  const terms = pins.filter((each) => each.kind === 'term');
  const readableTerms = await readableAssets(
    trx,
    reader,
    terms.map((each) => each.artifact_id),
    'term',
  );
  return {
    ...summaryOf(row),
    pins: {
      document: { version: row.document_version_id, digest: row.document_digest },
      layout: { version: row.layout_version_id, digest: row.layout_digest },
      theme: { version: row.theme_version_id, digest: row.theme_digest },
      template:
        row.template_version_id === null
          ? null
          : { version: row.template_version_id, digest: row.template_digest! },
      occurrences: occurrences
        .filter((each) => shown.has(each.node!))
        .map((each) => ({
          node: each.node!,
          version: each.version_id,
          digest: each.version_digest,
        })),
      assets: assets
        .filter((each) => readableImages.has(each.artifact_id))
        .map((each) => ({ version: each.version_id, digest: each.version_digest })),
      ...(entries.length === 0
        ? {}
        : {
            entries: entries
              .filter((each) => readableEntries.has(each.artifact_id))
              .map((each) => ({ version: each.version_id, digest: each.version_digest })),
          }),
      ...(terms.length === 0
        ? {}
        : {
            terms: terms
              .filter((each) => readableTerms.has(each.artifact_id))
              .map((each) => ({ version: each.version_id, digest: each.version_digest })),
          }),
      bindings: bindings
        .filter((each) => shown.has(each.node))
        .map((each) => ({
          node: each.node,
          binding: each.binding,
          digest: each.digest,
          datasetVersion: each.dataset_version,
          datasetDigest: each.version_digest,
          ...pinnedRevisions(each.revisions ?? [], values),
        })),
    },
    profile: row.profile ?? null,
    withheld: {
      nodes: occurrences.filter((each) => !shown.has(each.node!)).map((each) => each.node!),
      assets: assets.filter((each) => !readableImages.has(each.artifact_id)).length,
    },
  };
}

/** What superseding a baseline answers (VER-049; BL-E). */
export type SupersedeAnswer =
  | { readonly answer: 'superseded' }
  /** The superseding baseline is not a later one of the same document. */
  | { readonly answer: 'superseder.invalid' }
  /** It is superseded already, once being all a baseline is. */
  | { readonly answer: 'superseded.already' };

/**
 * `baselineId` superseded by `by`, a later baseline of the same document (BL-E), once, recorded with
 * who and when and on the log. The baseline itself is untouched, read, listed and published as before.
 */
export async function supersedeBaseline(
  trx: TenantTransaction,
  input: { readonly baseline: string; readonly by: string; readonly principal: string },
): Promise<SupersedeAnswer> {
  const rows = await trx
    .selectFrom('baseline')
    .select(['id', 'document_id', 'document_version_id', 'made_at'])
    .where('id', 'in', [input.baseline, input.by])
    .execute();
  const self = rows.find((row) => row.id === input.baseline);
  const later = rows.find((row) => row.id === input.by);
  if (!self) throw new Error(`The baseline ${input.baseline} is gone`);
  if (!later || later.document_id !== self.document_id || !(later.made_at > self.made_at)) {
    return { answer: 'superseder.invalid' };
  }
  const recorded = await trx
    .insertInto('baseline_supersession')
    .values({
      baseline_id: self.id,
      document_id: self.document_id,
      superseded_by: later.id,
      superseded_by_principal: input.principal,
    })
    .onConflict((conflict) => conflict.column('baseline_id').doNothing())
    .returning('baseline_id')
    .executeTakeFirst();
  if (!recorded) return { answer: 'superseded.already' };
  await recordBaselineEvent(
    trx,
    'baseline.superseded',
    { document: self.document_id, version: self.document_version_id },
    { baseline: self.id, by: later.id },
  );
  return { answer: 'superseded' };
}

/** A baseline's event, about the document version it pins, as a publication's is. */
async function recordBaselineEvent(
  trx: TenantTransaction,
  kind: 'baseline.made' | 'baseline.superseded',
  of: { readonly document: string; readonly version: string },
  detail: Readonly<Record<string, unknown>>,
): Promise<void> {
  const placed = await trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select(['v.content', 'a.space_id', 's.name as space_name', AUDIT_LOG_KEPT.as('logged')])
    .where('v.id', '=', of.version)
    .executeTakeFirstOrThrow();
  if (placed.logged === false) return;
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'document', id: of.document, version: of.version },
      space: placed.space_id,
      detail,
    },
    labels(
      labelled(
        'subject',
        labelFor('document', placed.content as Record<string, unknown>),
        of.document,
      ),
      labelled('space', placed.space_name, placed.space_id),
    ),
  );
}

/** What asking to publish a baseline answers (BL-F). */
export type BaselinePublicationAnswer =
  | { readonly answer: 'requested'; readonly request: { readonly id: string } }
  /**
   * The requester may not read something the baseline pins: each occurrence by its node, and how many
   * images. A publication reads everything it prints as its publisher, as a publish does (PUB-094).
   */
  | {
      readonly answer: 'baseline.unreadable';
      readonly nodes: readonly string[];
      readonly assets: number;
    }
  /** A format the baseline's layout does not make, each named once (PUB-014). */
  | { readonly answer: 'format.unsupported'; readonly formats: readonly string[] }
  /** It cites a page, and the PDF was not asked for (PUB-074). */
  | { readonly answer: 'page_reference.without_pdf' };

/**
 * A publish of a baseline (PUB-046; BL-F): a request read from its pins and never resolved again -
 * its document version, layout and theme, each occurrence's version, each image and each binding's
 * dataset version - which 0073 holds at commit to be exactly the baseline's. Only the checks that
 * need the formats run, against the pinned layout and content; everything else was decided when the
 * baseline was made. `publish` on the baseline's document has been decided in this transaction.
 */
export async function requestBaselinePublication(
  trx: TenantTransaction,
  input: {
    readonly baseline: string;
    readonly formats: readonly string[];
    readonly requester: string;
  },
): Promise<BaselinePublicationAnswer> {
  const baseline = await trx
    .selectFrom('baseline as b')
    .innerJoin('artifact_version as d', 'd.id', 'b.document_version_id')
    .innerJoin('artifact_version as l', 'l.id', 'b.layout_version_id')
    .select([
      'b.document_id',
      'b.document_version_id',
      'b.layout_id',
      'b.layout_version_id',
      'b.theme_id',
      'b.theme_version_id',
      'd.content as outline',
      'l.content as layout',
    ])
    .where('b.id', '=', input.baseline)
    .executeTakeFirstOrThrow();
  const layout = readLayout(baseline.layout, {
    artifact: baseline.layout_id,
    version: baseline.layout_version_id,
  });
  if (!layout.ok)
    throw new Error(`The layout ${layout.artifact} at ${layout.version} does not read`);
  const unsupported = unsupportedFormats(layout.layout, input.formats);
  if (unsupported.length > 0) return { answer: 'format.unsupported', formats: unsupported };
  if (input.formats.length === 0 || new Set(input.formats).size !== input.formats.length) {
    return { answer: 'format.unsupported', formats: [] };
  }

  const pins = await trx
    .selectFrom('baseline_pin as p')
    .innerJoin('artifact_version as v', 'v.id', 'p.version_id')
    .select(['p.node', 'p.version_id', 'p.artifact_id', 'p.kind', 'v.content'])
    .where('p.baseline_id', '=', input.baseline)
    .execute();
  const occurrences = pins.filter((each) => each.kind === 'component');
  const assets = pins.filter((each) => each.kind === 'asset');
  const entries = pins.filter((each) => each.kind === 'bibliographyEntry');
  const terms = pins.filter((each) => each.kind === 'term');
  const readable = await readableComponents(
    trx,
    input.requester,
    occurrences.map((each) => each.artifact_id),
  );
  const readableImages = await readableAssets(
    trx,
    input.requester,
    assets.map((each) => each.artifact_id),
  );
  const nodes = occurrences
    .filter((each) => !readable.has(each.artifact_id))
    .map((each) => each.node!);
  const images = assets.filter((each) => !readableImages.has(each.artifact_id)).length;
  if (nodes.length > 0 || images > 0) {
    return { answer: 'baseline.unreadable', nodes, assets: images };
  }
  // An entry it pinned the requester may not read fails each citation of it by name (CNT-054), as a
  // publish of the latest does: the pin is recorded, as 0073 holds it to be, and never read.
  const readableEntries = await readableAssets(
    trx,
    input.requester,
    entries.map((each) => each.artifact_id),
    'bibliographyEntry',
  );
  const hidden = new Set(
    entries
      .filter((each) => !readableEntries.has(each.artifact_id))
      .map((each) => each.artifact_id),
  );
  const unresolved: PublishFailure[] =
    hidden.size === 0
      ? []
      : occurrences.flatMap((each) => {
          const read = readContent(each.content, {
            artifact: each.artifact_id,
            version: each.version_id,
          });
          if (!read.ok) throw new Error(`The component ${each.artifact_id} does not read`);
          return citationPlaces(read.document)
            .filter((place) => hidden.has(place.entry))
            .map((place) => ({
              stage: 'resolve' as const,
              code: 'citation_unresolved' as const,
              node: each.node!,
              block: place.block,
              detail: `${place.n}: ${place.entry}`,
            }));
        });

  const outline = readOutline(baseline.outline, {
    artifact: baseline.document_id,
    version: baseline.document_version_id,
  });
  if (!outline.ok) throw new Error(`The document ${baseline.document_id} does not read`);
  const contents = occurrences.map((each) => {
    const read = readContent(each.content, {
      artifact: each.artifact_id,
      version: each.version_id,
    });
    if (!read.ok) throw new Error(`The component ${each.artifact_id} does not read`);
    return read.document;
  });
  // A term it pinned the requester may not read prints its words and is reported (TMb), as a publish
  // of the latest does: the pin is recorded and never read.
  const uses = usesIn(
    occurrences.map((each, n) => ({
      node: each.node!,
      component: each.artifact_id,
      content: contents[n]!,
    })),
    outline.outline,
    baseline.document_id,
  );
  const readablePins = await readableAssets(
    trx,
    input.requester,
    terms.map((each) => each.artifact_id),
    'term',
  );
  const warnings = termWarnings(
    uses,
    await recordedTerms(
      trx,
      uses,
      terms.map((each) => ({ term: each.artifact_id, version: each.version_id })),
      new Set(
        terms.filter((each) => !readablePins.has(each.artifact_id)).map((each) => each.artifact_id),
      ),
    ),
    outline.outline.language,
  );

  if (!input.formats.includes('pdf')) {
    // What its profile keeps alone: a title it leaves out is never set (the R11 final review).
    const kept = selectOutline(outline.outline, outline.outline.profile?.values ?? {}).outline;
    if (documentCitesAPage(kept, contents)) {
      return { answer: 'page_reference.without_pdf' };
    }
  }

  const formats = PUBLISHING_FORMATS.filter((format) => input.formats.includes(format));
  // Under the profile the pinned version declares, recorded where it says something, as a publish's is
  // (VER-020; R11-F): never the empty profile in its place.
  const profile = (baseline.outline as { profile?: StoredProfile }).profile;
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: baseline.document_id,
      document_version_id: baseline.document_version_id,
      formats,
      requested_by: input.requester,
      failures: JSON.stringify(unresolved),
      layout_id: baseline.layout_id,
      layout_version_id: baseline.layout_version_id,
      theme_id: baseline.theme_id,
      theme_version_id: baseline.theme_version_id,
      baseline_id: input.baseline,
      ...(profile === undefined ? {} : { profile: JSON.stringify(profile) }),
      ...(warnings.length === 0 ? {} : { warnings: JSON.stringify(warnings) }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (occurrences.length > 0) {
    await trx
      .insertInto('publication_request_occurrence')
      .values(
        occurrences.map((each) => ({
          request_id: request.id,
          node: each.node!,
          component_id: each.artifact_id,
          version_id: each.version_id,
        })),
      )
      .execute();
  }
  if (assets.length > 0 || entries.length > 0 || terms.length > 0) {
    await trx
      .insertInto('publication_request_asset')
      .values([
        ...assets.map((each) => ({
          request_id: request.id,
          version_id: each.version_id,
          asset_id: each.artifact_id,
        })),
        // The entry versions it pinned, never their latest (LIB-047).
        ...entries.map((each) => ({
          request_id: request.id,
          version_id: each.version_id,
          asset_id: each.artifact_id,
          asset_kind: 'bibliographyEntry' as const,
        })),
        // And the term versions it pinned (TMb).
        ...terms.map((each) => ({
          request_id: request.id,
          version_id: each.version_id,
          asset_id: each.artifact_id,
          asset_kind: 'term' as const,
        })),
      ])
      .execute();
  }
  const bindings = await trx
    .selectFrom('baseline_binding')
    .selectAll()
    .where('baseline_id', '=', input.baseline)
    .execute();
  if (bindings.length > 0) {
    await trx
      .insertInto('publication_request_binding')
      .values(
        bindings.map((each) => ({
          request_id: request.id,
          node: each.node,
          binding: each.binding,
          digest: each.digest,
          resolution: each.resolution,
          dataset_version: each.dataset_version,
          dataset_id: each.dataset_id,
          // What the baseline pinned (RV-E), named only where it pinned any.
          ...((each.revisions ?? []).length === 0 ? {} : { revisions: each.revisions }),
        })),
      )
      .execute();
  }
  await enqueueJob(trx, 'publish', request.id);
  await recordPublicationEvent(
    trx,
    'publication.requested',
    { document: baseline.document_id, version: baseline.document_version_id },
    { request: request.id, formats, baseline: input.baseline },
  );
  return { answer: 'requested', request: { id: request.id } };
}

/** A binding as a baseline pinned it, with what it held then (BL-I). */
export interface PinnedBinding {
  readonly node: string;
  readonly binding: string;
  /** The binding's digest as its result was taken under, when the baseline was made. */
  readonly digest: string;
  /** The dataset's name when the baseline was made, or none. */
  readonly datasetName: string | null;
  /** The resolution it pinned, as a document holds one, with nothing waiting: a baseline moves on to nothing. */
  readonly held: HeldResolution;
  /** The revisions it pinned, standing in front of that resolution, ascending (RV-E). */
  readonly revisions: readonly string[];
}

/**
 * Every binding a baseline pins, with the resolution and dataset version it held when it was made
 * (BL-I): what its page shows each value from, never the document's latest resolution. Who may read
 * which is the caller's to decide, by the node's component.
 */
export async function pinnedBindings(
  trx: TenantTransaction,
  baselineId: string,
): Promise<PinnedBinding[]> {
  const rows = await trx
    .selectFrom('baseline_binding as k')
    .innerJoin('binding_resolution as r', 'r.id', 'k.resolution')
    .innerJoin('artifact_version as v', 'v.id', 'k.dataset_version')
    .select([
      'k.node',
      'k.binding',
      'k.digest',
      'k.dataset_name',
      'r.id',
      'r.document_id',
      'r.replaces',
      'r.act',
      'r.resolved_by',
      'r.resolved_at',
      'k.dataset_id',
      'k.dataset_version',
      'v.revision_no',
      'v.version_no',
      'v.content',
    ])
    .select(
      sql<
        string[] | null
      >`(select array_agg(e) from jsonb_array_elements_text(to_jsonb(k) -> 'revisions') e)`.as(
        'revisions',
      ),
    )
    .where('k.baseline_id', '=', baselineId)
    .orderBy('k.node')
    .orderBy('k.binding')
    .execute();
  return rows.map((row) => ({
    node: row.node,
    binding: row.binding,
    digest: row.digest,
    datasetName: row.dataset_name,
    revisions: row.revisions ?? [],
    held: {
      id: String(row.id),
      document: row.document_id,
      node: row.node,
      binding: row.binding,
      digest: row.digest,
      replaces: row.replaces,
      act: row.act,
      by: row.resolved_by,
      at: new Date(row.resolved_at),
      held: {
        dataset: row.dataset_id,
        version: row.dataset_version,
        number: { revision: row.revision_no, version: row.version_no },
        // Written by `recordDatasetVersion`, which parsed it: one that does not parse is a broken store.
        provenance: parseProvenance(row.content),
      },
      waiting: null,
    },
  }));
}
