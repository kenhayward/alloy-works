import type { TenantTransaction } from '@alloy-works/db';
import type { Identity } from './oidc.js';

/**
 * Whether a Google account may enter this environment, and as which principal (IAM-054). Signing in
 * to Google proves who someone is, not that they belong here: an account enters as a principal
 * admitted before, by an invitation to its verified address, or through a Workspace domain the
 * environment names. Returns that principal, or undefined for an account it does not admit.
 */
export async function admitGoogleAccount(
  trx: TenantTransaction,
  identity: Identity,
): Promise<string | undefined> {
  // Admitted before: found by issuer and subject alone, whatever its address says now.
  const known = await trx
    .updateTable('principal')
    .set({ email: identity.email, display_name: identity.name })
    .where('issuer', '=', identity.issuer)
    .where('subject', '=', identity.subject)
    .returning('id')
    .executeTakeFirst();
  if (known) return known.id;

  // Anyone new is decided on a verified address; Google verifies every Workspace address.
  const email = identity.email?.toLowerCase();
  if (!identity.emailVerified || !email) return undefined;
  const invited = await trx
    .selectFrom('invitation')
    .select('email')
    .where('email', '=', email)
    .where('principal_id', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  // Google sets hd only for an account the domain manages. A personal account has none, whatever
  // its address, so it can never come in through a named domain.
  const domain = identity.hostedDomain
    ? await trx
        .selectFrom('google_domain')
        .select('domain')
        .where('domain', '=', identity.hostedDomain.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (!invited && !domain) return undefined;

  const principal = await trx
    .insertInto('principal')
    .values({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      display_name: identity.name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (invited) {
    // Bound once, to this account: from now on the address is only a label on the principal, and
    // somebody else acquiring it later gains nothing.
    await trx
      .updateTable('invitation')
      .set({ principal_id: principal.id, accepted_at: new Date() })
      .where('email', '=', email)
      .execute();
  }
  return principal.id;
}
