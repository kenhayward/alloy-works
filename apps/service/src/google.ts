import { claimInvitation, type TenantTransaction } from '@alloy-works/db';
import type { Identity } from './oidc.js';

/**
 * Whether a Google account may enter this environment, and as which principal (IAM-054). Signing in
 * to Google proves who someone is, not that they belong here: an account enters as a principal
 * admitted before, as the principal an invitation to its verified address made, or through a Workspace
 * domain the environment names. Returns that principal, or undefined for an account it does not admit.
 */
export async function admitGoogleAccount(
  trx: TenantTransaction,
  identity: Identity,
): Promise<string | undefined> {
  // Admitted before: found by issuer and subject alone, whatever its address says now.
  const known = await trx
    .updateTable('principal')
    .set({
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.name,
    })
    .where('issuer', '=', identity.issuer)
    .where('subject', '=', identity.subject)
    .returning('id')
    .executeTakeFirst();
  if (known) return known.id;

  // Invited: bound once, to this account, only for an address Google verifies. From now on the
  // address is only a label on the principal, and somebody else acquiring it later gains nothing.
  const invited = await claimInvitation(trx, identity, 'google');
  if (invited) return invited;

  // Google sets hd only for an account the domain manages. A personal account has none, whatever
  // its address, so it can never come in through a named domain.
  const domain = identity.hostedDomain
    ? await trx
        .selectFrom('google_domain')
        .select('domain')
        .where('domain', '=', identity.hostedDomain.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (!domain) return undefined;

  const principal = await trx
    .insertInto('principal')
    .values({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return principal.id;
}
