import {
  carryForward,
  definitionsFor,
  readContent,
  validate,
  type MetadataFailure,
  type NotCarried,
  type VersionSubstance,
} from '@alloy-works/domain';
import { artifactPlace, recordEvent } from './audit.js';
import { componentFieldsNow } from './component-values.js';
import { isComponent, readLock, serialise, type LockState } from './editing.js';
import type { TenantTransaction } from './tables.js';
import { versionDigests } from './version-digest.js';
import {
  latestVersion,
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
  | { readonly answer: 'restore.unchanged' };

/** What restoring a version would make (VER-035): read by the preview and the write alike. */
export interface Restoration {
  readonly source: StoredVersion;
  readonly latest: StoredVersion;
  /** The source's values its fields no longer take, which the new version records as not carried. */
  readonly notCarried: readonly NotCarried[];
  readonly refusals: readonly RestoreRefusal[];
  /** What the new version would hold; undefined where the source does not read. */
  readonly substance: Extract<VersionSubstance, { kind: 'component' }> | undefined;
}

export interface RestoreAsked {
  readonly artifactId: string;
  /** The earlier version to restore, by id. */
  readonly version: string;
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
  if (!(await isComponent(trx, asked.artifactId))) return undefined;
  await serialise(trx, asked.artifactId);
  const source = await readVersion(trx, asked.version);
  if (!source || source.artifactId !== asked.artifactId) return undefined;
  const latest = await latestVersion(trx, asked.artifactId);
  if (!latest) return undefined;
  const read = readContent(source.content, { artifact: source.artifactId, version: source.id });
  if (!read.ok) {
    const refusals = [{ answer: 'restore.unreadable' } as const];
    return { source, latest, notCarried: [], refusals, substance: undefined };
  }
  const refusals: RestoreRefusal[] = [];
  const lock = await readLock(trx, asked.artifactId);
  if (lock) refusals.push({ answer: 'restore.locked', lock });
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
  return { source, latest, notCarried: carried.notCarried, refusals, substance };
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
  input: RestoreAsked & { readonly latest: string; readonly by: string },
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
  });
  if (recorded.answer === 'version.unchanged') return { answer: 'restore.unchanged' };
  if (recorded.answer !== 'recorded') return recorded;
  const place = await artifactPlace(trx, input.artifactId, recorded.version.id);
  await recordEvent(
    trx,
    {
      kind: 'content.restored',
      subject: { kind: 'component', id: input.artifactId, version: recorded.version.id },
      space: place.space,
      detail: { kind: 'component', from: source.id },
    },
    place.labels,
  );
  return { answer: 'restored', version: recorded.version };
}
