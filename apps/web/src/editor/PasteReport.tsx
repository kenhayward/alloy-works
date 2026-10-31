import type { ReportEntry } from '@alloy-works/domain';
import { useId, type Ref } from 'react';

import styles from './PasteReport.module.css';
import { reportWords } from './reportWords.js';
import { words } from '../words/words.js';

/**
 * What a paste report lists: everything but the new identifiers. The pipeline gives every pasted
 * block and mark one (CNT-132), so they would fill every report, and an author can neither see an
 * identifier nor do anything about one. They stay in the report the pipeline returned.
 */
export function shownOfPaste(report: readonly ReportEntry[]): ReportEntry[] {
  return report.filter(
    (entry) =>
      !(
        entry.action === 'rewritten' &&
        (entry.subject === 'blockIdentifier' || entry.subject === 'markIdentifier')
      ),
  );
}

export interface PasteReportProps {
  readonly entries: readonly ReportEntry[];
  readonly onClose: () => void;
  /**
   * Given while a paste holding headings waits on the author (CNT-187): kept as one component, or
   * broken out through an import. Nothing is pasted until one is chosen; Close pastes nothing.
   */
  readonly held?: {
    readonly onKeep: () => void;
    readonly onBreakOut: () => void;
    readonly busy: boolean;
  };
  /** The region's element, one of the regions `F6` moves between while it is shown (CNT-077). */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * What the last paste kept differently or left out, shown to the author at the time (CNT-063): each
 * of the report's fixed sentences, how many times it happened, and what arrived - a link's target, a
 * language tag - as text, never as markup, because what arrived is data (content-model.md).
 */
export function PasteReport({ entries, onClose, held, ref }: PasteReportProps) {
  const heading = useId();
  return (
    <section ref={ref} className={styles['report']} aria-labelledby={heading} tabIndex={-1}>
      <h3 id={heading} className={styles['heading']}>
        {words('editor.paste-report')}
      </h3>
      {held && <p className={styles['held']}>{words('editor.this-paste-holds-headings-keep')}</p>}
      <ul className={styles['entries']}>
        {entries.map((entry, index) => (
          <li key={index}>
            {reportWords(entry)}
            {entry.count !== undefined && entry.count > 1 && (
              <span className={styles['count']}>
                {' '}
                {words('editor.paste.times', { count: entry.count })}
              </span>
            )}
            {entry.detail !== undefined && (
              <>
                {' '}
                <code className={styles['detail']}>{entry.detail}</code>
              </>
            )}
          </li>
        ))}
      </ul>
      {held && (
        <>
          <button type="button" disabled={held.busy} onClick={held.onKeep}>
            {words('editor.keep-as-one-component')}
          </button>
          <button type="button" disabled={held.busy} onClick={held.onBreakOut}>
            {words('editor.break-out-into-sections-and')}
          </button>
        </>
      )}
      <button type="button" onClick={onClose}>
        {words('editor.close')}
      </button>
    </section>
  );
}
