import {
  parseProvenance,
  takeDigestInput,
  takeOutcomeSchema,
  type Binding,
  type TakeOutcome,
} from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';

/** What a binding takes: a column of the only row, or of the row a key names. */
type Take = Binding['take'];

/**
 * A take's digest, by which `dataset_take` keys an outcome (the B1 plan, B1-H): SHA-256 over the
 * take's canonical form (`takeDigestInput`), as 64 lower-case hexadecimal digits.
 */
export function takeDigest(take: Take): string {
  return sha256Hex(takeDigestInput(take));
}

/** Two column types alike member for member, whatever order a store wrote their members in. */
function sameType(a: object, b: object): boolean {
  const spelt = (type: object) => JSON.stringify(type, Object.keys(type).sort());
  return spelt(a) === spelt(b);
}

/** One outcome as `dataset_take` holds it. */
export interface StoredTake {
  readonly version: string;
  readonly takeDigest: string;
  readonly outcome: TakeOutcome;
}

/**
 * Records what a take of a dataset version gave (B1-H): **the one writer of `dataset_take`**, called by
 * resolve and check in their recording transactions and by the bindings view on a miss. The outcome is
 * held to `takeOutcomeSchema`, strict - a value canonical in its column's type and not a text of
 * `White_Space` alone, a `take_invalid` naming its column - and a value to the column its version's
 * provenance declares under that name, with that type, so nothing stored says what `takeValue` would
 * not. A row already held for the version and the take is kept: the outcome
 * is a function of the two, and a second writer computed the same. Throws on anything else - a version
 * that is not a dataset's, an outcome not of its shape - since every caller took it with `takeValue`.
 */
export async function recordTake(
  trx: TenantTransaction,
  input: { readonly version: string; readonly take: Take; readonly outcome: TakeOutcome },
): Promise<void> {
  const parsed = takeOutcomeSchema.safeParse(input.outcome);
  if (!parsed.success) throw new Error('A take outcome is a value with its column, or a failure');
  const outcome = parsed.data;
  const version = await trx
    .selectFrom('artifact_version')
    .select(['artifact_id', 'content'])
    .where('id', '=', input.version)
    .where('kind', '=', 'dataset')
    .executeTakeFirst();
  if (!version) throw new Error(`This environment holds no dataset version ${input.version}`);
  if ('value' in outcome) {
    const declared = parseProvenance(version.content).columns.find(
      (column) => column.name === outcome.column.name,
    );
    if (!declared || !sameType(declared.type, outcome.column.type)) {
      throw new Error(
        `Dataset version ${input.version} declares no column ${outcome.column.name} of that type`,
      );
    }
  }
  await trx
    .insertInto('dataset_take')
    .values({
      dataset_version: input.version,
      artifact_id: version.artifact_id,
      take_digest: takeDigest(input.take),
      outcome: JSON.stringify(outcome),
    })
    .onConflict((conflict) => conflict.columns(['dataset_version', 'take_digest']).doNothing())
    .execute();
}

/**
 * The outcomes `dataset_take` holds for these versions and takes, in the order asked, leaving out each
 * it holds none for: the bindings view's first read, which computes and records a miss.
 */
export async function takesOf(
  trx: TenantTransaction,
  asked: readonly { readonly version: string; readonly takeDigest: string }[],
): Promise<StoredTake[]> {
  if (asked.length === 0) return [];
  const rows = await trx
    .selectFrom('dataset_take')
    .select(['dataset_version', 'take_digest', 'outcome'])
    .where('dataset_version', 'in', [...new Set(asked.map((each) => each.version))])
    .where('take_digest', 'in', [...new Set(asked.map((each) => each.takeDigest))])
    .execute();
  const held = new Map(
    rows.map((row) => [`${row.dataset_version} ${row.take_digest}`, row.outcome as TakeOutcome]),
  );
  return asked.flatMap(({ version, takeDigest }) => {
    const outcome = held.get(`${version} ${takeDigest}`);
    return outcome === undefined ? [] : [{ version, takeDigest, outcome }];
  });
}
