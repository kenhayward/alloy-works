/** A refusal of a restore, as the preview or the write gives it (the RS plan, RS-E). */
export interface RestoreRefusal {
  readonly code: string;
  readonly holder?: { readonly name: string | null } | undefined;
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
    case 'version_precondition':
      return 'A newer version was saved since this was shown. Look at it again before restoring.';
    default:
      return 'This version could not be restored.';
  }
}
