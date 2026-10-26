import {
  asVariant,
  carryForward,
  definitionsFor,
  parseContentDocument,
  validate,
  type ContentDocument,
  type MetadataFailure,
} from '@alloy-works/domain';
import { componentFieldsNow } from './component-values.js';
import {
  holding,
  isComponent,
  readLock,
  onIterationLine,
  lockLinesStored,
  isRefusal,
  serialise,
  type EditingSession,
  type HolderRefusal,
} from './editing.js';
import type { TenantTransaction } from './tables.js';
import { recordVersion, type StoredVersion } from './versions.js';
import { headVersion, readLine } from './lines.js';
import { iterationLinesStored } from './retention.js';
import {
  checkTranslates,
  declareSourceChange,
  recordTranslates,
  type TranslatesRefusal,
} from './translation.js';

export interface Cut extends EditingSession {
  /** The version the session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly note?: string;
  /** On a language line, the main-line version the translator was shown (the TR plan, TR-C). */
  readonly translates?: string;
  /** On the main line, whether the change needs retranslating (TR-D); absent, it does. */
  readonly retranslate?: boolean;
}

export type CutAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  /** Nothing saved since the session opened from the current version, or nothing that differs. */
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | HolderRefusal
  /**
   * A fixed field's value differs from its default at the definitions the cut is made against
   * (MET-033): carrying forward never replaces a value that is present, so the cut refuses it.
   */
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  | { readonly answer: 'artifact.missing' }
  | TranslatesRefusal;

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
  const current = await headVersion(trx, input.artifactId, input.line);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };
  const translation =
    input.line === undefined
      ? undefined
      : (await readLine(trx, input.artifactId, input.line))?.language;
  if (translation) {
    const refused = await checkTranslates(trx, input.artifactId, input.translates);
    if (refused) return refused;
  }

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
    .$if(await iterationLinesStored(trx), (query) => onIterationLine(query, input.line))
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!iteration) return { answer: 'version.unchanged', current };

  const { definitions, effective } = await componentFieldsNow(trx, current);
  const { type, schemas, fields } = definitions;
  const carried = carryForward(iteration.metadata_values, effective);
  // Only a fixed value refuses a cut: a required field left empty never does (MET-023).
  const fixed = validate(effective, carried.values).filter((each) => each.rule === 'fixed');
  if (fixed.length > 0) return { answer: 'values.invalid', failures: fixed };
  const recorded = await recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.principal,
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.line === undefined ? {} : { line: input.line }),
    substance: {
      kind: 'component',
      // A variant's root is in its line's language, whatever a session sent (TR-B).
      content: translation
        ? asVariant(parseContentDocument(iteration.content), translation)
        : parseContentDocument(iteration.content),
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(type, schemas, fields),
    },
  });
  if (recorded.answer === 'artifact.missing') return recorded;
  if (recorded.answer === 'recorded' && translation && input.line !== undefined) {
    await recordTranslates(trx, {
      line: input.line,
      version: recorded.version.id,
      translates: input.translates!,
      by: input.principal,
    });
  }
  if (
    recorded.answer === 'recorded' &&
    input.line === undefined &&
    input.retranslate !== undefined
  ) {
    await declareSourceChange(trx, {
      artifactId: input.artifactId,
      version: recorded.version.id,
      retranslate: input.retranslate,
      by: input.principal,
    });
  }
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
    .$if(await lockLinesStored(trx), (query) =>
      input.line === undefined
        ? query.where('line_id', 'is', null)
        : query.where('line_id', '=', input.line),
    )
    .execute();
  return { answer: 'released', version: cut.answer === 'recorded' ? cut.version : null };
}

export type ReturnedAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  /** Another write moved the line between its head read here and the record: tried again. */
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  /** Somebody holds the line's lock: their session is not overwritten (XL-F). */
  | { readonly answer: 'lock.held' }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  | { readonly answer: 'artifact.missing' }
  | TranslatesRefusal;

/**
 * **A returned translation cut** (the XL plan, XL-F, XL-G): the one write path for words that come back
 * from a vendor, a version on a language line from content given whole rather than a session's
 * iteration - on the line's head, refused while anybody holds the line's lock, `translates` the source
 * version sent, the root in the line's language and the head's values carried forward as a cut's are.
 * Whether the caller may edit the component, and whether the source and the line are as they were
 * sent, are theirs to have decided.
 */
export async function cutReturned(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly line: string;
    readonly content: ContentDocument;
    readonly translates: string;
    readonly by: string;
  },
): Promise<ReturnedAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const line = await readLine(trx, input.artifactId, input.line);
  if (!line || line.closed || line.language === null) return { answer: 'artifact.missing' };
  if (await readLock(trx, input.artifactId, input.line)) return { answer: 'lock.held' };
  const refused = await checkTranslates(trx, input.artifactId, input.translates);
  if (refused) return refused;
  const current = await headVersion(trx, input.artifactId, input.line);
  if (!current) return { answer: 'artifact.missing' };
  const { definitions, effective } = await componentFieldsNow(trx, current);
  const { type, schemas, fields } = definitions;
  const carried = carryForward(current.values, effective);
  const fixed = validate(effective, carried.values).filter((each) => each.rule === 'fixed');
  if (fixed.length > 0) return { answer: 'values.invalid', failures: fixed };
  const recorded = await recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: current.id,
    author: input.by,
    line: input.line,
    substance: {
      kind: 'component',
      content: asVariant(input.content, line.language),
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(type, schemas, fields),
    },
  });
  if (recorded.answer !== 'recorded') return recorded;
  await recordTranslates(trx, {
    line: input.line,
    version: recorded.version.id,
    translates: input.translates,
    by: input.by,
  });
  return { answer: 'recorded', version: recorded.version };
}
