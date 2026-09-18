import {
  carryForward,
  definitionsFor,
  parseContentDocument,
  resolveComponentFields,
} from '@alloy-works/domain';
import { currentDefinitionsFor } from './creation.js';
import {
  holding,
  isComponent,
  isRefusal,
  serialise,
  type EditingSession,
  type HolderRefusal,
} from './editing.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, recordVersion, type StoredVersion } from './versions.js';

export interface Cut extends EditingSession {
  /** The version the session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly note?: string;
}

export type CutAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  /** Nothing saved since the session opened from the current version, or nothing that differs. */
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | HolderRefusal
  | { readonly answer: 'artifact.missing' };

export type ReleaseAnswer =
  /** Released; `version` is the one cut, or null when there was nothing to cut. */
  | { readonly answer: 'released'; readonly version: StoredVersion | null }
  | Exclude<CutAnswer, { answer: 'recorded' } | { answer: 'version.unchanged' }>;

/**
 * Cuts a version (component-editor.md, "Cutting a version"): promotes the session's latest iteration
 * against the version it opened from (VER-006), with its values carried forward over the definitions
 * current now (MET-018), through `recordVersion` - which answers `version.unchanged` rather than
 * inserting a version that says nothing new. The iteration is left alone to expire (VER-003).
 */
export async function cutVersion(trx: TenantTransaction, input: Cut): Promise<CutAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const lock = await holding(trx, input);
  if (isRefusal(lock)) return lock;
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };

  // Filtered by principal as well as session: a session id is chosen by the client, not unique per
  // principal, so a session id reused by a second principal after the first's lock lapses must find
  // none of the first's iterations here.
  const iteration = await trx
    .selectFrom('iteration')
    .select(['content', 'metadata_values'])
    .where('artifact_id', '=', input.artifactId)
    .where('principal_id', '=', input.principal)
    .where('session_id', '=', input.session)
    .where('opened_from', '=', input.openedFrom)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!iteration) return { answer: 'version.unchanged', current };

  const typeRef = current.definitions.find((each) => each.kind === 'componentType');
  if (!typeRef) throw new Error(`Component ${input.artifactId} records no component type`);
  const definitions = await currentDefinitionsFor(trx, typeRef.id);
  if (!definitions) throw new Error(`No componentType ${typeRef.id} is stored in this tenant`);
  const { type, schemas, fields } = definitions;
  const effective = resolveComponentFields(
    type.definition,
    schemas.map((each) => each.definition),
    fields.map((each) => each.definition),
  );
  const carried = carryForward(iteration.metadata_values, effective);
  const recorded = await recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.principal,
    ...(input.note === undefined ? {} : { note: input.note }),
    substance: {
      kind: 'component',
      content: parseContentDocument(iteration.content),
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(type, schemas, fields),
    },
  });
  if (recorded.answer === 'artifact.missing') return recorded;
  return recorded.answer === 'recorded'
    ? { answer: 'recorded', version: recorded.version }
    : recorded;
}

/**
 * Done editing (component-editor.md, "Cutting a version"; COL-010): cuts a version of what changed, then
 * releases the lock. Nothing to cut is not a refusal - the lock is released and no version is made. A
 * refused cut releases nothing, so the lock is never let go over work the author has not been told
 * about.
 */
export async function releaseLock(trx: TenantTransaction, input: Cut): Promise<ReleaseAnswer> {
  const cut = await cutVersion(trx, input);
  if (cut.answer !== 'recorded' && cut.answer !== 'version.unchanged') return cut;
  await trx
    .deleteFrom('component_lock')
    .where('artifact_id', '=', input.artifactId)
    .where('session_id', '=', input.session)
    .execute();
  return { answer: 'released', version: cut.answer === 'recorded' ? cut.version : null };
}
