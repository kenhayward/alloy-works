import { Chip } from './Chip.js';
import styles from './parts.module.css';

/** What a screen reader hears of somebody from outside (IAM-045; the R13 plan, R13-A). */
export const OUTSIDE_SAID = 'from outside the organisation';

/**
 * **Outside**, beside the name of somebody from outside the organisation (IAM-045; R13-A): the word
 * the People page uses, read as "from outside the organisation". Nothing for anybody inside it.
 */
export function Outside({ person }: { readonly person: { readonly external?: true | undefined } }) {
  if (person.external !== true) return null;
  return (
    <>
      {/* Apart on screen, and none in what is said: the name, then ', from outside'. */}
      <span aria-hidden="true"> </span>
      <Chip>
        <span aria-hidden="true">Outside</span>
        <span className={styles['hiddenText']}>{`, ${OUTSIDE_SAID}`}</span>
      </Chip>
    </>
  );
}
