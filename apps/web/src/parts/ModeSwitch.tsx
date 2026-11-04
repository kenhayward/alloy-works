import { Icon } from '../editor/Icon.js';
import { words as say } from '../words/words.js';
import { NameTip } from './NameTip.js';
import styles from './ModeSwitch.module.css';

/**
 * The modes on offer, in the header (document-view.md, "Modes"; CNT-154): radios, or the word where
 * reading is all there is. A document's and a component's page alike (ADR-0085).
 */
export function ModeSwitch<Mode extends string>({
  group,
  offered,
  chosen,
  onChoose,
}: {
  /** The radios' name, one per page. */
  group: string;
  offered: readonly { readonly mode: Mode; readonly name: string }[];
  chosen: Mode;
  onChoose: (mode: Mode) => void;
}) {
  if (offered.length <= 1) return <p className={styles['modeShown']}>{say('document.reading')}</p>;
  return (
    <div role="radiogroup" aria-label={say('document.mode')} className={styles['mode']}>
      {offered.map(({ mode, name }) => (
        <NameTip key={mode} name={name} below>
          <label data-chosen={chosen === mode}>
            <input
              type="radio"
              name={group}
              checked={chosen === mode}
              onChange={() => onChoose(mode)}
            />
            <Icon name={name} size={14} />
            <span className={styles['modeName']}>{name}</span>
          </label>
        </NameTip>
      ))}
    </div>
  );
}
