import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import styles from './parts.module.css';

/**
 * A button whose face is an icon, named in words (ADR-0046, decision 6): `label` is its name for a
 * screen reader and, with its shortcut spelled out, its title for a pointer. `pressed` makes it a
 * toggle; left out, it claims no pressed state.
 */
export function IconButton({
  label,
  shortcut,
  pressed,
  className,
  children,
  ref,
  ...rest
}: {
  label: string;
  shortcut?: string | undefined;
  pressed?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement> | undefined;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'aria-pressed'>) {
  return (
    <button
      ref={ref}
      type="button"
      className={className ?? styles['iconButton']}
      aria-label={label}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    >
      {children}
    </button>
  );
}
