import type { RevisionDecision } from '@alloy-works/api-contract';
import {
  artifactPlace,
  recordEvent,
  recordRevision,
  revisionsStanding,
  type StoredRevision,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  revisionCellKey,
  valueProblem,
  type CanonicalValue,
  type ColumnType,
  type RevisionCell,
} from '@alloy-works/domain';

import type { AppError } from '../errors.js';
import { refused } from '../wire-codes.js';

/** Where a revision stands: its document, node and binding. */
export interface RevisionPlace {
  readonly document: string;
  readonly node: string;
  readonly binding: string;
}

/**
 * **A revision on the log** (DAT-058; the RV plan, RV-C): `binding.revised`, about the document at its
 * latest version, naming where, the resolution, the revision recorded, and the value it was - the
 * query's, or the revision it replaces - and the value it became.
 */
export async function recordRevisionEvent(
  trx: TenantTransaction,
  revision: StoredRevision,
  act: 'revise' | 'withdraw' | 'keep',
  was: CanonicalValue,
): Promise<void> {
  const place = await artifactPlace(trx, revision.document);
  await recordEvent(
    trx,
    {
      kind: 'binding.revised',
      subject: { kind: 'document', id: revision.document, version: place.version },
      space: place.space,
      detail: {
        document: revision.document,
        node: revision.node,
        binding: revision.binding,
        ...(revision.cell === null ? {} : { cell: revision.cell }),
        act,
        resolution: revision.resolution,
        revision: revision.id,
        was,
        became: revision.value,
      },
    },
    place.labels,
  );
}

/**
 * **What an act recording a resolution must decide first** (DAT-060; RV-D): the revisions standing on
 * the resolution held, refused `revision_decision_required` where some stand and `asked` says nothing,
 * and `revision_precondition` where it names other than those. `current` answers the binding as it
 * stands, for the refusal. Under `lockBindings`, so what stands cannot move before it is carried.
 */
export async function revisionsDecided(
  trx: TenantTransaction,
  held: string | undefined,
  asked: RevisionDecision | undefined,
  current: () => Promise<Record<string, unknown>>,
): Promise<readonly StoredRevision[]> {
  const standing =
    held === undefined ? [] : ((await revisionsStanding(trx, [held])).get(held) ?? []);
  if (standing.length === 0) {
    if (asked !== undefined && asked.over.length > 0) throw await precondition(current);
    return [];
  }
  if (asked === undefined) {
    throw refused(
      409,
      'revision.decision_required',
      'A value revised by hand stands on what this binding holds: say whether to withdraw it or keep it.',
      { ...(await current()), revisions: standing.map((each) => each.id) },
    );
  }
  const same =
    asked.over.length === standing.length &&
    standing.every((each) => asked.over.includes(each.id));
  if (!same) throw await precondition(current);
  return standing;
}

const precondition = async (current: () => Promise<Record<string, unknown>>): Promise<AppError> =>
  refused(
    409,
    'revision.precondition',
    'The values revised by hand on this binding are no longer those this was decided over.',
    await current(),
  );

/**
 * **Carries the revisions decided over to the resolution just recorded** (RV-D), in the act's
 * transaction: kept, each recorded again in front of it with the same value and reason, replacing the
 * old, its value checked against the column it now stands in (`value_invalid`, naming the revision);
 * or withdrawn, each by a `withdraw` in front of the resolution it stood on. Each audited.
 */
export async function carryRevisions(
  trx: TenantTransaction,
  input: {
    readonly standing: readonly StoredRevision[];
    readonly decision: RevisionDecision['decision'] | undefined;
    readonly to: string;
    readonly by: string;
    /** The type of the column each revision stands in, in the result now held, or none. */
    readonly typeOf: (cell: RevisionCell | null) => ColumnType | undefined;
  },
): Promise<void> {
  for (const each of input.standing) {
    if (input.decision === 'withdraw') {
      const withdrawn = await recordRevision(trx, {
        document: each.document,
        node: each.node,
        binding: each.binding,
        cell: revisionCellKey(each.cell),
        resolution: each.resolution,
        act: 'withdraw',
        value: null,
        reason: each.reason,
        replaces: each.id,
        by: input.by,
      });
      await recordRevisionEvent(trx, withdrawn, 'withdraw', each.value);
      continue;
    }
    const type = input.typeOf(each.cell);
    if (type === undefined || type.base === 'image' || valueProblem(type, each.value) !== null) {
      throw refused(
        409,
        'value.invalid',
        `The value revised by hand, ${String(each.value)}, is not a value of its column in the new result: withdraw it instead.`,
        { revision: each.id },
      );
    }
    const kept = await recordRevision(trx, {
      document: each.document,
      node: each.node,
      binding: each.binding,
      cell: revisionCellKey(each.cell),
      resolution: input.to,
      act: 'revise',
      value: each.value,
      reason: each.reason,
      replaces: each.id,
      by: input.by,
    });
    await recordRevisionEvent(trx, kept, 'keep', each.value);
  }
}
