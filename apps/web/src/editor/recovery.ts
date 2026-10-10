/**
 * The words Recovery says (component-editor.md, "Recovery, as W11 builds it"), in the reader's own
 * time and in en-GB, as `heldSentence` says when a holder is expected back: the time alone where it is
 * today, and the day with it where it is not.
 */

/** When something was saved: `14:02`, or `14:02:07` with `seconds`, and the day where not today. */
export function savedTime(at: string, now: Date = new Date(), seconds = false): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return 'an unknown time';
  const time = when.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
  if (when.toDateString() === now.toDateString()) return time;
  return `${time} on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
}

/** What a component opened after a closed tab says above its text, beside Recover (RC-F). */
export function unsavedSentence(savedAt: string, now: Date = new Date()): string {
  return `Changes you saved at ${savedTime(savedAt, now)} were never made a version.`;
}

/**
 * One iteration, named by when it was saved, to the second: iterations arrive every few seconds, so
 * the minute alone would name several at once.
 */
export function iterationLabel(savedAt: string, now: Date = new Date()): string {
  return `the text saved at ${savedTime(savedAt, now, true)}`;
}

/** A label begun as a sentence. */
export const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Where this tab keeps the time of the unsaved changes it was told to put away (the R1 plan). */
const dismissedKey = (componentId: string) => `alloy-works:unsaved-dismissed:${componentId}`;

/** The time of the unsaved changes this tab put away for this component, or null. */
export function dismissedFor(componentId: string): string | null {
  try {
    return globalThis.sessionStorage.getItem(dismissedKey(componentId));
  } catch {
    return null;
  }
}

/** Puts away, for this tab, the unsaved changes saved at `savedAt`; newer ones are offered again. */
export function keepDismissed(componentId: string, savedAt: string): void {
  try {
    globalThis.sessionStorage.setItem(dismissedKey(componentId), savedAt);
  } catch {
    // Not kept: the notice comes back on the next opening, which costs a second Dismiss.
  }
}
