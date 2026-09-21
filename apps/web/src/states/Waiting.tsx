import styles from './States.module.css';

/** Waiting on the service: the caller's words, beside a spinner assistive technology never hears. */
export function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles['waiting']}>
      <span className={styles['spinner']} data-spinner="" aria-hidden="true" />
      {children}
    </p>
  );
}
