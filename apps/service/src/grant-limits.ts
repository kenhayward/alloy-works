import { loadFacts, type GrantInForce, type TenantTransaction } from '@alloy-works/db';
import { beyondHolding, type AccessFacts, type Level, type Permission } from '@alloy-works/domain';
import { refusedBy, type Authorised } from './access.js';
import { AppError } from './errors.js';

/**
 * Refuses a change giving an administrative permission its maker does not hold where it stands (the GL
 * plan): 403, naming them in the message as `forbidden` names one, the first recorded as the refusal.
 */
export function refuseBeyondHolding(
  permissions: readonly Permission[],
  facts: AccessFacts,
  target: Level,
): void {
  const beyond = beyondHolding(permissions, facts);
  const [first] = beyond;
  if (first === undefined) return;
  const names = beyond.map((decision) => decision.permission).join(', ');
  throw refusedBy(
    new AppError(
      403,
      'grant_beyond_held',
      `You cannot give access you do not hold: ${names}.`,
      'IAM-088',
    ),
    first,
    facts,
    target,
    false,
  );
}

/** As `refuseBeyondHolding`, for each grant a change would give effect to, at that grant's own level. */
export async function refuseBeyondHoldingAt(
  trx: TenantTransaction,
  { principalId, facts: { scopes } }: Authorised,
  grants: readonly GrantInForce[],
): Promise<void> {
  for (const grant of grants) {
    const loaded = await loadFacts(trx, principalId, grant.level);
    if (!loaded) throw new Error('A grant in force stands at a level the tenant does not hold');
    refuseBeyondHolding(grant.permissions, { ...loaded, scopes }, grant.level);
  }
}
