/** A refusal of a restore, as the preview or the write gives it (the RS plan, RS-E). */
export interface RestoreRefusal {
  readonly code: string;
  readonly holder?: { readonly name: string | null } | undefined;
  /** outline_invalid: why, in the outline's own words. */
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
  return 'restored' in answer ? `Restored as version ${answer.restored}.` : answer.refused;
}

/** Why a version cannot be restored, in words. */
export function restoreRefusalWords(refusal: RestoreRefusal): string {
  switch (refusal.code) {
    case 'restore_locked':
      return `${refusal.holder?.name ?? 'Somebody'} is editing this component. It can be restored once they choose Done editing.`;
    case 'restore_unchanged':
      return 'The latest version already holds this, so restoring it would change nothing.';
    case 'restore_unreadable':
      return 'This version can no longer be read, so it cannot be restored.';
    case 'values_invalid':
      return 'A value this version holds is now fixed at another by its field, so it cannot be restored.';
    // A save's checks on what it would bring back (the RS final review).
    case 'content_invalid':
      return 'This version holds content that can no longer be saved, so it cannot be restored.';
    case 'definition_unreadable':
      return 'A table in this version shows a column of a query you may not read, so only someone who may read it can restore this version.';
    // A document's, refused by its outline's own guards (RS-F).
    case 'outline_invalid':
      return refusal.reason === undefined
        ? 'This version no longer fits the outline as it stands, so it cannot be restored.'
        : `${refusal.reason}, so this version cannot be restored.`;
    // VER-044: a component since deleted, by its last title.
    case 'reference_deleted':
      return `${refusal.title || 'A component it references'} has been deleted, so this version cannot be restored.`;
    case 'values_unresolved':
      return "This document's template names a field that no longer resolves, so this version's values cannot be checked.";
    case 'version_precondition':
      return 'A newer version was saved since this was shown. Look at it again before restoring.';
    default:
      return 'This version could not be restored.';
  }
}

/** Why a document's version cannot be restored, in words: its values by any field rule, not fixed alone. */
export function documentRestoreWords(refusal: RestoreRefusal): string {
  return refusal.code === 'values_invalid'
    ? 'A value this version holds no longer fits its field, so it cannot be restored.'
    : restoreRefusalWords(refusal);
}
