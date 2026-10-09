import { offersMatchCase, withoutMatchCase, type FilterDraft } from './definitionDraft.js';
import styles from './QueryDefinitionPage.module.css';

/** Match case on a contains or starts with filter (DAT-119, MC-C): unticked, the filter ignores case. */
export function MatchCase({
  filter,
  name,
  onChange,
}: {
  readonly filter: FilterDraft;
  /** Its name where a row's words name it, as "Match case of filter 1". */
  readonly name?: string;
  readonly onChange: (filter: FilterDraft) => void;
}) {
  if (!offersMatchCase(filter.is)) return null;
  return (
    <label className={styles['check']}>
      <input
        type="checkbox"
        {...(name === undefined ? {} : { 'aria-label': name })}
        checked={filter.matchCase === true}
        onChange={(event) =>
          onChange(event.target.checked ? { ...filter, matchCase: true } : withoutMatchCase(filter))
        }
      />
      Match case
    </label>
  );
}
