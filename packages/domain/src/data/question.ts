import { literalValues, type Binding } from './binding.js';
import { parametersDigestInput } from './identity.js';
import type { Provenance } from './provenance.js';

/**
 * Whether a binding asks the question its held result answers (the B2 plan, B2-E; BI-J): the same
 * definition, the same parameters - compared as the parameters digest is taken, a null left out - and
 * the version it resolves to, its pin or else `latestVersion`, the one the result ran. Only what it
 * takes or its mode may differ, which is what Keep holds a result across. A parameter taken from the
 * document is never unchanged: no document has one to compare.
 */
export function questionUnchanged(
  binding: Binding,
  held: Pick<Provenance, 'queryDefinition' | 'parameters'>,
  latestVersion: string,
): boolean {
  const values = literalValues(binding);
  return (
    'values' in values &&
    held.queryDefinition.artifact === binding.query &&
    held.queryDefinition.version === (binding.version ?? latestVersion) &&
    parametersDigestInput(values.values) === parametersDigestInput(held.parameters)
  );
}
