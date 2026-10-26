import { words } from '../words/words.js';
/**
 * A person's own view (the D7 plan, D7-H; DAT-091): a result fetched as the person asking, on a
 * connection that runs as each person, which everybody who may read the document sees once it is held.
 */

/** What is said before one's own view is held: DAT-091's warning. */
export const OWN_VIEW_WARNING = (): string => words('document.own-view.warning');

/** What is said where the warning was declined. */
export const NOT_HELD = (): string => words('document.own-view.not-held');

/**
 * The refusals a page says in the service's own words, where they arise: the person's identity at
 * the source, another person's own view, and an act stopped by a sign-out or a revoked token.
 */
const SAID_AS_ANSWERED: ReadonlySet<string> = new Set([
  'identity_unavailable',
  'identity_unmatched',
  'identity_role_unsafe',
  'identity_differs',
  'account_holds_privilege',
  'authority_ended',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A refusal's code, or undefined. */
export function codeOf(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

/** The service's words for a refusal of the person's identity or authority, or null for any other. */
export function identityRefusal(error: unknown): string | null {
  if (!isRecord(error) || typeof error.message !== 'string') return null;
  const code = codeOf(error);
  return code !== undefined && SAID_AS_ANSWERED.has(code) ? error.message : null;
}

/** Whose own view a result is, in words, or null for the connection account's (DAT-022, D7-J). */
export function whoseView(
  provenance: { readonly identity: string; readonly principal?: string | null },
  by: { readonly id: string; readonly displayName: string | null } | null,
): string | null {
  if (provenance.identity !== 'endUser') return null;
  return by !== null && by.id === provenance.principal && by.displayName !== null
    ? words('document.s-own-view', { displayName: by.displayName })
    : words('document.a-person-s-own-view');
}
