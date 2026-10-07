import { canonicalJson } from '../stored/canonical.js';
import { literalValues, type AnyBinding } from './binding.js';
import { parametersDigestInput } from './identity.js';
import type { Provenance } from './provenance.js';

/**
 * Whether a binding asks the question its held result answers (the B2 plan, B2-E; BI-J): the same
 * definition, the same parameters - compared as the parameters digest is taken, a null left out - and
 * the version it resolves to, its pin or else `latestVersion`, the one the result ran. Only what it
 * takes or its mode may differ, which is what Keep holds a result across; a bound table's binding
 * takes nothing (TB1-C), so only its mode. A parameter still taken from the document is never
 * unchanged: the service compares the binding with its document arguments substituted (TP2-D), and
 * the Value dialog, which has no document's values, compares spellings (`questionSpelledAlike`).
 */
export function questionUnchanged(
  binding: AnyBinding,
  held: Pick<Provenance, 'queryDefinition' | 'parameters'>,
  latestVersion: string,
): boolean {
  const values = literalValues(binding);
  return (
    values.fromDocument.length === 0 &&
    held.queryDefinition.artifact === binding.query &&
    held.queryDefinition.version === (binding.version ?? latestVersion) &&
    parametersDigestInput(values.values) === parametersDigestInput(held.parameters)
  );
}

/**
 * Whether a binding changed in the Value dialog asks the question it asked before (TP2-D's dialog
 * half): the same definition, the version each resolves to, and its parameters spelled alike
 * (`canonicalJson`), a null literal left out as the parameters digest leaves it, so a document
 * argument is the same where it names the same parameter. Only what it takes or its mode may differ.
 */
export function questionSpelledAlike(
  before: AnyBinding,
  after: AnyBinding,
  latestVersion: string,
): boolean {
  const spelled = (binding: AnyBinding) =>
    canonicalJson(
      Object.fromEntries(
        Object.entries(binding.parameters).filter(
          ([, parameter]) => !('literal' in parameter) || parameter.literal !== null,
        ),
      ),
    );
  return (
    before.query === after.query &&
    (before.version ?? latestVersion) === (after.version ?? latestVersion) &&
    spelled(before) === spelled(after)
  );
}
