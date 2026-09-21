import styles from './States.module.css';

/** Nothing here yet: the sentence, and the one action that would fill it. Never an illustration. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles['empty']} data-state="empty">
      {children}
    </div>
  );
}
