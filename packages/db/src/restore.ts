import {
  carryForward,
  definitionsFor,
  hasMember,
  readContent,
  readOutline,
  sameValue,
  validate,
  type ContentDocument,
  type MetadataFailure,
  type MetadataValues,
  type NotCarried,
  type OutlineDocument,
  type VersionSubstance,
} from '@alloy-works/domain';
import { artifactPlace, recordEvent } from './audit.js';
import { componentFieldsNow } from './component-values.js';
import { shareDeletion } from './deletion.js';
import { recordRepoints, restoredOutline, type RestoredOutlineRefusal } from './documents.js';
import { isComponent, readLock, serialise, type LockState } from './editing.js';
import { headVersion } from './lines.js';
import type { TenantTransaction } from './tables.js';
import { recordTranslates, translatedBy } from './translation.js';
import { versionDigests } from './version-digest.js';
import {
  latestVersion,
  lockArtifact,
  readVersion,
  recordRestoredVersion,
  type StoredVersion,
} from './versions.js';

/** Why a restore would not be made (the RS plan, RS-E), the first of them answering a write. */
export type RestoreRefusal =
  /** The source's content no longer reads at today's schema. */
  | { readonly answer: 'restore.unreadable' }
  /** Somebody holds the lock, the restorer included: an open session is never cut under. */
  | { readonly answer: 'restore.locked'; readonly lock: LockState }
  /** A value a field now fixes at another (MET-033), as a cut refuses it. */
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  /** What it would make is what the latest already is. */
  | { readonly answer: 'restore.unchanged' }
  /** A component's: what the caller's `check` refuses, as a save's checks would. */
  | ContentRefusal
  /** A document's: `editOutline`'s guards over the whole outline (RS-F). */
  | RestoredOutlineRefusal;

/** What restoring a version would make (VER-035): read by the preview and the write alike. */
export interface Restoration {
  readonly source: StoredVersion;
  readonly latest: StoredVersion;
  /** The source's values its fields no longer take, which the new version records as not carried. */
  readonly notCarried: readonly NotCarried[];
  /** A component's: each value it would hold, carried forward, otherwise than the latest. */
  readonly changed: readonly RestoredValue[];
  readonly refusals: readonly RestoreRefusal[];
  /** What the new version would hold; undefined where the source does not read. */
  readonly substance: Extract<VersionSubstance, { kind: 'component' | 'document' }> | undefined;
  /** A document's outline now and as the restore would make it, for comparing them; else undefined. */
  readonly outlines?: { readonly latest: OutlineDocument; readonly restored: OutlineDocument };
}

/** The save's content checks, as a component's restore answers them (the RS final review). */
export type ContentRefusal =
  | { readonly answer: 'content.invalid' }
  | { readonly answer: 'definition.unreadable' }
  | { readonly answer: 'citation.unreadable' }
  | { readonly answer: 'term.unreadable' };

/** A value a restore changes, by field: absent on a side that holds none. */
export interface RestoredValue {
  readonly field: string;
  readonly latest?: unknown;
  readonly restored?: unknown;
}

/** Each field whose value `restored` holds otherwise than `latest`, by field. */
function changedValues(latest: MetadataValues, restored: MetadataValues): RestoredValue[] {
  const fields = [...new Set([...Object.keys(latest), ...Object.keys(restored)])].sort();
  return fields
    .filter((field) =>
      hasMember(latest, field) && hasMember(restored, field)
        ? !sameValue(latest[field], restored[field])
        : hasMember(latest, field) !== hasMember(restored, field),
    )
    .map((field) => ({
      field,
      ...(hasMember(latest, field) ? { latest: latest[field] } : {}),
      ...(hasMember(restored, field) ? { restored: restored[field] } : {}),
    }));
}

export interface RestoreAsked {
  readonly artifactId: string;
  /** The earlier version to restore, by id. */
  readonly version: string;
  /** Who restores: a document's references are checked as theirs (RS-F). */
  readonly by: string;
  /**
   * A component's: the save's checks on the content restored, for whoever restores, against the
   * latest it would follow (SG-B, as `acceptSuggestion`'s). Run by the preview and the write alike.
   */
  readonly check?: (
    content: ContentDocument,
    latest: StoredVersion,
  ) => Promise<ContentRefusal | undefined>;
  /**
   * A component's line to restore on (LOC-012), by its id: an earlier version of that line's, made the
   * line's next; the main line where absent. A closed line takes none.
   */
  readonly line?: string;
}

/**
 * The one resolver behind the preview and the write (VER-035; the RS plan, RS-B): the source's content
 * as read now, migrated to today's schema, and its values carried forward over the definitions current
 * now (MET-018), with every refusal. Under the component's serialising lock, so a write reads exactly
 * what it records. Undefined where the version is not one of this component's.
 */
async function resolve(
  trx: TenantTransaction,
  asked: RestoreAsked,
): Promise<Restoration | undefined> {
  if (!(await isComponent(trx, asked.artifactId))) return resolveDocument(trx, asked);
  await serialise(trx, asked.artifactId);
  const source = await readVersion(trx, asked.version);
  if (!source || source.artifactId !== asked.artifactId) return undefined;
  // On a line, one of the line's own versions, after its head (LOC-012).
  if (source.line !== (asked.line ?? null)) return undefined;
  const latest = await headVersion(trx, asked.artifactId, asked.line);
  if (!latest) return undefined;
  const read = readContent(source.content, { artifact: source.artifactId, version: source.id });
  if (!read.ok) {
    const refusals = [{ answer: 'restore.unreadable' } as const];
    return { source, latest, notCarried: [], changed: [], refusals, substance: undefined };
  }
  const refusals: RestoreRefusal[] = [];
  const lock = await readLock(trx, asked.artifactId, asked.line);
  if (lock) refusals.push({ answer: 'restore.locked', lock });
  const checked = await asked.check?.(read.document, latest);
  if (checked) refusals.push(checked);
  const { definitions, effective } = await componentFieldsNow(trx, latest);
  const carried = carryForward(source.values, effective);
  // Only a fixed value refuses, as at a cut (promotion.ts): a required field left empty never does.
  const fixed = validate(effective, carried.values).filter((each) => each.rule === 'fixed');
  if (fixed.length > 0) refusals.push({ answer: 'values.invalid', failures: fixed });
  const substance = {
    kind: 'component',
    content: read.document,
    values: carried.values,
    notCarried: carried.notCarried,
    definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
  } as const;
  if (versionDigests(substance).versionDigest === latest.versionDigest) {
    refusals.push({ answer: 'restore.unchanged' });
  }
  const changed = changedValues(latest.values, carried.values);
  return { source, latest, notCarried: carried.notCarried, changed, refusals, substance };
}

/**
 * A document's restore (the RS plan, RS-F): its outline as read now, references and modes as they
 * stood, and its own values, under `editOutline`'s guards over the whole outline; its parameters as
 * they stand now (TP1-E). Under the document's advisory lock, as a version is recorded: a document has
 * no editing lock (COL-N02), so nothing else refuses it.
 */
async function resolveDocument(
  trx: TenantTransaction,
  asked: RestoreAsked,
): Promise<Restoration | undefined> {
  // A document has no lines.
  if (asked.line !== undefined) return undefined;
  if ((await latestVersion(trx, asked.artifactId))?.kind !== 'document') return undefined;
  // Its references are a deletion's dependants (DL-D), the deletion lock before the document's.
  await shareDeletion(trx);
  await lockArtifact(trx, asked.artifactId);
  const source = await readVersion(trx, asked.version);
  if (!source || source.artifactId !== asked.artifactId) return undefined;
  const latest = (await latestVersion(trx, asked.artifactId))!;
  const now = readOutline(latest.content, { artifact: latest.artifactId, version: latest.id });
  // The latest not reading is a broken store, thrown as `editOutline` throws it.
  if (!now.ok) throw new Error(`The document ${latest.artifactId} at ${latest.id} does not read`);
  const read = readOutline(source.content, { artifact: source.artifactId, version: source.id });
  if (!read.ok) {
    const refusals = [{ answer: 'restore.unreadable' } as const];
    return { source, latest, notCarried: [], changed: [], refusals, substance: undefined };
  }
  const restored = await restoredOutline(trx, {
    documentId: asked.artifactId,
    author: asked.by,
    latest: { outline: now.outline, values: latest.values },
    restored: { outline: read.outline, values: source.values },
  });
  const refusals: RestoreRefusal[] = [...restored.refusals];
  // Its values as an outline act writes them, so the preview's digest is the write's.
  const substance = {
    kind: 'document',
    content: restored.outline,
    values: restored.values,
    parameters: latest.parameters,
  } as const;
  if (versionDigests(substance).versionDigest === latest.versionDigest) {
    refusals.push({ answer: 'restore.unchanged' });
  }
  const outlines = { latest: now.outline, restored: restored.outline };
  return { source, latest, notCarried: [], changed: [], refusals, substance, outlines };
}

/** What a restore would make, inserting nothing (VER-035). The caller has decided `edit` and `read`. */
export function previewRestore(
  trx: TenantTransaction,
  asked: RestoreAsked,
): Promise<Restoration | undefined> {
  return resolve(trx, asked);
}

export type RestoreAnswer =
  | { readonly answer: 'restored'; readonly version: StoredVersion }
  | RestoreRefusal
  /** The latest is not the one the restore was previewed against. Names the current one. */
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'artifact.missing' };

/**
 * Restores an earlier version (VER-032, VER-033; storage-and-versioning.md): a new version, numbered
 * after the latest, holding what the preview showed and naming its source, audited `content.restored`
 * beside the cut. The earlier row is untouched. `latest` is the version the preview was made against.
 */
export async function restoreVersion(
  trx: TenantTransaction,
  input: RestoreAsked & { readonly latest: string },
): Promise<RestoreAnswer> {
  const restoration = await resolve(trx, input);
  if (!restoration) return { answer: 'artifact.missing' };
  const { source, latest, refusals, substance } = restoration;
  if (latest.id !== input.latest) return { answer: 'version.precondition', current: latest };
  if (refusals[0] !== undefined) return refusals[0];
  const recorded = await recordRestoredVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: latest.id,
    author: input.by,
    substance: substance!,
    restoredFrom: source.id,
    ...(input.line === undefined ? {} : { line: input.line }),
  });
  if (recorded.answer === 'version.unchanged') return { answer: 'restore.unchanged' };
  if (recorded.answer !== 'recorded') return recorded;
  const place = await artifactPlace(trx, input.artifactId, recorded.version.id);
  await recordEvent(
    trx,
    {
      kind: 'content.restored',
      subject: { kind: source.kind, id: input.artifactId, version: recorded.version.id },
      space: place.space,
      detail: {
        kind: source.kind,
        from: source.id,
        ...(input.line === undefined ? {} : { line: input.line }),
      },
    },
    place.labels,
  );
  // A language line's version translates what the one it restores did (TR-C).
  const translated = input.line === undefined ? undefined : await translatedBy(trx, source.id);
  if (translated !== undefined) {
    await recordTranslates(trx, {
      line: input.line!,
      version: recorded.version.id,
      translates: translated,
      by: input.by,
    });
  }
  if (restoration.outlines) {
    const { latest: before, restored } = restoration.outlines;
    await recordRepoints(trx, recorded.version, before, restored);
  }
  return { answer: 'restored', version: recorded.version };
}
