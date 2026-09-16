import type { SaveState } from './session.js';

export interface SaveIndicatorProps {
  readonly save: SaveState;
  /** When the latest acknowledged save arrived, as milliseconds since the epoch; null before one. */
  readonly savedAt: number | null;
  /** Given in tests; the viewer's own locale and clock otherwise. */
  readonly formatTime?: (at: number) => string;
}

const localTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * CNT-068: saved, saving, or not saved and retrying, in words, with the time of the last acknowledged
 * save. Not a live region itself - it changes with every keystroke - so the change to "not saved" is
 * announced through the editor's one status region instead (component-editor.md, "Accessibility").
 */
export function SaveIndicator({ save, savedAt, formatTime = localTime }: SaveIndicatorProps) {
  const text =
    save === 'saving'
      ? 'Saving'
      : save === 'failing'
        ? 'Not saved, retrying'
        : savedAt === null
          ? 'No unsaved changes'
          : `Saved at ${formatTime(savedAt)}`;
  return <p data-save={save}>{text}</p>;
}
