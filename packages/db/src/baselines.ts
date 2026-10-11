import {
  baselineDigestInput,
  baselineNameProblem,
  labelFor,
  nameKey,
  type BaselinePins,
  type PublishFailure,
} from '@alloy-works/domain';
import { AUDIT_LOG_KEPT, labelled, labels, recordEvent } from './audit.js';
import { readableComponents } from './documents.js';
import { resolvePublishable, type PublishRefusal } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';

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

  const template = await trx
    .selectFrom('document_template')
    .select(['template_id', 'template_version_id'])
    .where('document_id', '=', input.documentId)
    .executeTakeFirst();
  const versions = [
    found.latest.id,
    found.layout.versionId,
    found.theme.versionId,
    ...(template ? [template.template_version_id] : []),
    ...found.resolved.map((each) => each.version),
    ...found.assets.map((each) => each.version),
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
  const pins: BaselinePins = {
    document: pinned(found.latest.id),
    layout: pinned(found.layout.versionId),
    theme: pinned(found.theme.versionId),
    template: template ? pinned(template.template_version_id) : null,
    occurrences: found.resolved.map((each) => ({ node: each.node, ...pinned(each.version) })),
    assets: found.assets.map((each) => pinned(each.version)),
    bindings: found.bindings.map((each) => ({
      node: each.node,
      binding: each.binding,
      digest: each.digest,
      datasetVersion: each.datasetVersion,
      datasetDigest: digests.get(each.datasetVersion)!,
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
  const readable = await readableComponents(trx, reader, [...pins.map((each) => each.artifact_id)]);
  const bindings = await trx
    .selectFrom('baseline_binding as b')
    .innerJoin('artifact_version as v', 'v.id', 'b.dataset_version')
    .select(['b.node', 'b.binding', 'b.digest', 'b.dataset_version', 'v.version_digest'])
    .where('b.baseline_id', '=', baselineId)
    .execute();
  const occurrences = pins.filter((each) => each.kind === 'component');
  const shown = new Set(
    occurrences.filter((each) => readable.has(each.artifact_id)).map((each) => each.node!),
  );
  const assets = pins.filter((each) => each.kind === 'asset');
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
        .filter((each) => readable.has(each.artifact_id))
        .map((each) => ({ version: each.version_id, digest: each.version_digest })),
      bindings: bindings
        .filter((each) => shown.has(each.node))
        .map((each) => ({
          node: each.node,
          binding: each.binding,
          digest: each.digest,
          datasetVersion: each.dataset_version,
          datasetDigest: each.version_digest,
        })),
    },
    withheld: {
      nodes: occurrences.filter((each) => !shown.has(each.node!)).map((each) => each.node!),
      assets: assets.filter((each) => !readable.has(each.artifact_id)).length,
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
