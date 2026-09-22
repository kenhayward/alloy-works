import styles from './SaveIndicator.module.css';
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
 * CNT-068: saved, saving or not saved, in words, as a chip on the title strip (interface slice 13).
 * The time of the last acknowledged save is its tooltip. `failing` (a retry is scheduled) and
 * `stopped` (nothing is retrying) both say `Not saved`: the retry is nothing the author acts on, and
 * what they are told when it stops arrives through the editor's status region. Not a live region
 * itself - it changes with every keystroke - so the change to not saved is announced there instead
 * (component-editor.md, "Accessibility").
 */
export function SaveIndicator({ save, savedAt, formatTime = localTime }: SaveIndicatorProps) {
  const dot = save === 'saving' ? 'saving' : save === 'saved' ? 'saved' : 'notSaved';
  const text = dot === 'saving' ? 'Saving' : dot === 'saved' ? 'Saved' : 'Not saved';
  return (
    <span
      className={styles['chip']}
      data-save={save}
      data-dot-state={dot}
      {...(savedAt === null ? {} : { title: `Saved at ${formatTime(savedAt)}` })}
    >
      <span className={styles['dot']} data-dot={dot} aria-hidden="true" />
      {text}
    </span>
  );
}
