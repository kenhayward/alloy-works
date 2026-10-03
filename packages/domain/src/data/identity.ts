import { canonicalJson } from '../stored/canonical.js';
import type { ParameterValues } from './parameters.js';

/**
 * A dataset's identity is the question it answers (data.md, "The dataset"): one definition, the same
 * parameters, the same identity as the source sees it. These are its two derived parts.
 */

/**
 * The identity a run was made as, as the source sees it: `service` for every service-account run,
 * which is every run in D3. The end-user forms - `asserted:<principal>`, `delegated:<issuer>|<subject>`
 * - arrive with D7 (DAT-084).
 */
export function identityKey(identity: { readonly kind: 'service' }): 'service' {
  if (identity.kind !== 'service') throw new Error('An identity key is the service alone in D3');
  return 'service';
}

/**
 * The input to the parameters digest: the values that ran, as canonical JSON (RFC 8785's shape:
 * members sorted, no whitespace), a list in its order. **A value left out and a value given null are
 * one question** - a definition binds either as null, and D2-R checks them alike - so a null member is
 * left out, and the two share a dataset. Hashed by the caller.
 */
export function parametersDigestInput(values: ParameterValues): string {
  return canonicalJson(
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)),
  );
}
