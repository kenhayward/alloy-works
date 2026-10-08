import type { HTMLAttributes, ReactNode } from 'react';

import styles from './parts.module.css';

/**
 * What a chip's colour means, and nothing else (ADR-0046): `warn` is not approved, changes not in a
 * version, a check failing; `info` is somebody else editing, or a newer version; `ok` is saved,
 * connected, passed; `danger` is refused or failed; `accent` is the one chosen; `neutral` is a fact.
 */
export type ChipTone = 'neutral' | 'accent' | 'warn' | 'info' | 'ok' | 'danger';

/** A chip: 4px corners, 12px words, its tone's ground and ink (ADR-0046, decision 4). */
export function Chip({
  tone = 'neutral',
  className,
  children,
  ...rest
}: {
  tone?: ChipTone;
  className?: string | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'children'>) {
  return (
    <span
      {...rest}
      className={`${styles['chip']}${className ? ` ${className}` : ''}`}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
