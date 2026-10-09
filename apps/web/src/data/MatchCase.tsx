import { offersMatchCase, withoutMatchCase, type FilterDraft } from './definitionDraft.js';
import styles from './QueryDefinitionPage.module.css';

/** Match case on a contains or starts with filter (DAT-119, MC-C): unticked, the filter ignores case. */
export function MatchCase({
  filter,
  onChange,
}: {
  readonly filter: FilterDraft;
  readonly onChange: (filter: FilterDraft) => void;
}) {
  if (!offersMatchCase(filter.is)) return null;
  return (
    <label className={styles['check']}>
      <input
        type="checkbox"
        checked={filter.matchCase === true}
        onChange={(event) =>
          onChange(event.target.checked ? { ...filter, matchCase: true } : withoutMatchCase(filter))
        }
      />
      Match case
    </label>
  );
}
