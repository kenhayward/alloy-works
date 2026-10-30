import type { TenantTransaction } from './tables.js';

/**
 * The environment's one CT Studio (docs/design/ct-studio-connect.md): the service identity its
 * deliveries act as, recorded rather than guessed from a name, the token CT Studio holds, so its
 * expiry can be shown and an old one told from a new one, and what the hand-off page last gave.
 */
export interface CtStudioRecord {
  readonly identityId: string;
  /** None once revoked, or for an adopted identity whose token was not named. */
  readonly tokenId: string | null;
  readonly address: string | null;
  readonly sinkId: string | null;
}

/** The environment's CT Studio, or undefined before the first connection. */
export async function readCtStudio(trx: TenantTransaction): Promise<CtStudioRecord | undefined> {
  const row = await trx.selectFrom('ct_studio').selectAll().executeTakeFirst();
  return (
    row && {
      identityId: row.identity_id,
      tokenId: row.token_id,
      address: row.address,
      sinkId: row.sink_id,
    }
  );
}

/**
 * Changes what is given of the record, keeping the rest; the first write must name the identity.
 * Answers the record as now stored.
 */
export async function writeCtStudio(
  trx: TenantTransaction,
  patch: Partial<CtStudioRecord>,
): Promise<CtStudioRecord> {
  const before = await readCtStudio(trx);
  const identityId = patch.identityId ?? before?.identityId;
  if (identityId === undefined) throw new Error('The first CT Studio record names its identity');
  const values = {
    identity_id: identityId,
    token_id: patch.tokenId === undefined ? (before?.tokenId ?? null) : patch.tokenId,
    address: patch.address === undefined ? (before?.address ?? null) : patch.address,
    sink_id: patch.sinkId === undefined ? (before?.sinkId ?? null) : patch.sinkId,
    updated_at: new Date(),
  };
  await trx
    .insertInto('ct_studio')
    .values({ singleton: true, ...values })
    .onConflict((conflict) => conflict.column('singleton').doUpdateSet(values))
    .execute();
  return (await readCtStudio(trx))!;
}
