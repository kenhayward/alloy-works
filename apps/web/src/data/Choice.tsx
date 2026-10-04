import { useId } from 'react';

import styles from './QueryDefinitionPage.module.css';

/**
 * A select or a text area and its label, joined by `for`: a label wrapping one would hold every
 * option's text, or the text first typed, beside its own words, and be read so.
 */
export function Choice({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <span className={styles['choice']}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </span>
  );
}

/** Lines of words, each a paragraph, in a status region, or an empty one. */
export function Status({ lines }: { readonly lines: readonly string[] | null }) {
  return (
    <div role="status">
      {lines?.map((line, at) => (
        <p key={at}>{line}</p>
      ))}
    </div>
  );
}
