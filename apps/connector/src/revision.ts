import { REVISION_MAX_CHARACTERS } from '@alloy-works/domain';

/**
 * A revision as the connector captures it (the FR plan, FR-C): the kind it was read as and the
 * source's own text, which a check sends back as a condition or compares - so only printable ASCII,
 * and within the most a revision may be. Undefined where the source's text cannot be one.
 */
export function revisionOf(kind: string, text: string): string | undefined {
  const revision = `${kind}:${text}`;
  return /^[\x20-\x7e]+$/.test(text) && revision.length <= REVISION_MAX_CHARACTERS
    ? revision
    : undefined;
}
