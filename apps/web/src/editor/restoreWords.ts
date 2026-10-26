import { words } from '../words/words.js';

/** The outline's guards a restore meets, each worded here (the UI plan, UI-L). */
const GUARDS = [
  'reference_refused',
  'sections_added',
  'sections_removed',
  'sections_reordered',
  'required_removed',
] as const;
const guarded = (why: string | undefined): why is (typeof GUARDS)[number] =>
  (GUARDS as readonly (string | undefined)[]).includes(why);
/** A refusal of a restore, as the preview or the write gives it (the RS plan, RS-E). */
export interface RestoreRefusal {
  readonly code: string;
  readonly holder?: { readonly name: string | null } | undefined;
  /** outline_invalid: which of the outline's guards, by code, and why in the service's words. */
  readonly why?: (typeof GUARDS)[number] | (string & {}) | undefined;
  readonly reason?: string | undefined;
  /** reference_deleted: the reference's node, and its component's last title (VER-044). */
  readonly node?: string | undefined;
  readonly title?: string | undefined;
}

/** What a restore's write answered: the new version's number, or why not; 'sending' till then. */
export type RestoreAnswer =
  { readonly restored: string } | { readonly refused: string } | 'sending' | null;

/** What a restore answered, in words, for its live region; nothing before it has. */
export function restoreAnswerText(answer: RestoreAnswer): string {
  if (answer === null || answer === 'sending') return '';
  return 'restored' in answer
    ? words('editor.restored-as-version', { restored: answer.restored })
    : answer.refused;
}

/** Why a version cannot be restored, in words. */
export function restoreRefusalWords(refusal: RestoreRefusal): string {
  switch (refusal.code) {
    case 'restore_locked':
      return words('editor.is-editing-this-component-it', {
        value1: refusal.holder?.name ?? words('editor.somebody'),
      });
    case 'restore_unchanged':
      return words('editor.the-latest-version-already-holds');
    case 'restore_unreadable':
      return words('editor.this-version-can-no-longer');
    case 'values_invalid':
      return words('editor.a-value-this-version-holds');
    // A save's checks on what it would bring back (the RS final review).
    case 'content_invalid':
      return words('editor.this-version-holds-content-that');
    case 'definition_unreadable':
      return words('editor.a-table-in-this-version');
    // A document's, refused by its outline's own guards (RS-F).
    case 'outline_invalid':
      return guarded(refusal.why)
        ? words(`editor.restore.${refusal.why}`)
        : refusal.reason === undefined
          ? words('editor.this-version-no-longer-fits')
          : words('editor.so-this-version-cannot-be', { reason: refusal.reason });
    // VER-044: a component since deleted, by its last title.
    case 'reference_deleted':
      return words('editor.has-been-deleted-so-this', {
        value1: refusal.title || words('editor.a-component-it-references'),
      });
    case 'values_unresolved':
      return words('editor.this-document-s-template-names');
    case 'version_precondition':
      return words('editor.a-newer-version-was-saved');
    default:
      return words('editor.this-version-could-not-be');
  }
}

/** Why a document's version cannot be restored, in words: its values by any field rule, not fixed alone. */
export function documentRestoreWords(refusal: RestoreRefusal): string {
  return refusal.code === 'values_invalid'
    ? words('editor.a-value-this-version-holds-2')
    : restoreRefusalWords(refusal);
}
