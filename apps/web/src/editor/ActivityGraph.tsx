import { useState, type KeyboardEvent } from 'react';

import { Icon } from './Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { words } from '../words/words.js';
import styles from './VersionTimeline.module.css';

export interface ActivityWeek {
  readonly start: string;
  readonly versions: number;
  readonly approvals: number;
}

const WEEKS = 52;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const isoDay = (at: Date) => at.toISOString().slice(0, 10);
/** The Monday, in UTC, of the week an instant falls in, as the service counts them. */
const mondayOf = (at: Date) => {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000);
};

/** The last year's weeks, oldest first: each the service counted, and nought for any other. */
export function weeksShown(weeks: readonly ActivityWeek[], now: Date): readonly ActivityWeek[] {
  const held = new Map(weeks.map((each) => [each.start, each]));
  const last = mondayOf(now).getTime();
  return Array.from({ length: WEEKS }, (_, at) => {
    const start = isoDay(new Date(last - (WEEKS - 1 - at) * WEEK_MS));
    return held.get(start) ?? { start, versions: 0, approvals: 0 };
  });
}

/**
 * Versions a week over the last year, approvals marked above their weeks (the plan, D10). One tab stop,
 * moved by the arrow keys and saying each week in words, never fifty-two buttons. Choosing a week moves
 * the list to it.
 */
export function ActivityGraph({
  weeks,
  now = new Date(),
  shown,
  onGo,
  onHide,
}: {
  weeks: readonly ActivityWeek[];
  now?: Date;
  /** The instants the list now reaches, marked on the graph; null where it is narrowed. */
  shown: { readonly from: Date; readonly to: Date } | null;
  onGo: (before: Date) => void;
  onHide: () => void;
}) {
  const all = weeksShown(weeks, now);
  const [chosen, setChosen] = useState(WEEKS - 1);
  const most = Math.max(1, ...all.map((each) => each.versions));
  const week = all[chosen]!;
  const go = (at: number) => {
    const next = all[at]!;
    onGo(new Date(new Date(`${next.start}T00:00:00.000Z`).getTime() + WEEK_MS - 1));
  };
  const keyed = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') setChosen((at) => Math.max(0, at - 1));
    else if (event.key === 'ArrowRight') setChosen((at) => Math.min(WEEKS - 1, at + 1));
    else if (event.key === 'Home') setChosen(0);
    else if (event.key === 'End') setChosen(WEEKS - 1);
    else if (event.key === 'Enter' || event.key === ' ') go(chosen);
    else return;
    event.preventDefault();
  };
  const inWindow = (start: string) => {
    if (shown === null) return false;
    const from = new Date(`${start}T00:00:00.000Z`).getTime();
    return from + WEEK_MS > shown.from.getTime() && from <= shown.to.getTime();
  };
  return (
    <div className={styles['graph']}>
      <div
        role="slider"
        tabIndex={0}
        className={styles['graphBars']}
        aria-label={words('editor.versions-a-week')}
        aria-valuemin={0}
        aria-valuemax={WEEKS - 1}
        aria-valuenow={chosen}
        aria-valuetext={words('editor.week-of', {
          start: week.start,
          versions: week.versions,
          approvals: week.approvals,
        })}
        onKeyDown={keyed}
      >
        {all.map((each, at) => (
          <span
            key={each.start}
            className={styles['graphWeek']}
            data-chosen={at === chosen ? '' : undefined}
            data-shown={inWindow(each.start) ? '' : undefined}
            onClick={() => {
              setChosen(at);
              go(at);
            }}
          >
            {each.approvals > 0 && <span className={styles['graphApproval']} />}
            <span
              className={styles['graphBar']}
              style={{ height: `${(each.versions / most) * 100}%` }}
            />
          </span>
        ))}
      </div>
      <IconButton label={words('editor.hide-the-activity-graph')} onClick={onHide}>
        <Icon name="Activity graph" size={14} />
      </IconButton>
    </div>
  );
}
