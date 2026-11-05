import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { NameTip } from './NameTip.js';
import styles from './parts.module.css';
import { words } from '../words/words.js';

/**
 * A button whose face is an icon, named in words (ADR-0046, decision 6): `label` is its name for a
 * screen reader and, with its shortcut spelled out, its title for a pointer. `pressed` makes it a
 * toggle; left out, it claims no pressed state. `tooltip` replaces the title where the name says more
 * than a pointer needs, such as a row's "Access to General" titled "Access".
 *
 * `tip` is for an icon in a panel's header: it stands in place of the browser's title, at once and
 * under the icon (ADR-0075), saying `label` or its own shorter `name`, and any `hint` beneath; at the
 * icon's end, or centred under one in a row (`align`).
 */
export function IconButton({
  label,
  shortcut,
  tooltip,
  tip,
  pressed,
  className,
  children,
  ref,
  ...rest
}: {
  label: string;
  shortcut?: string | undefined;
  tooltip?: string | undefined;
  tip?:
    | true
    | { readonly name?: string; readonly hint?: string; readonly align?: 'center' | 'end' }
    | undefined;
  pressed?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement> | undefined;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'aria-pressed'>) {
  const shown = tip === undefined ? undefined : tip === true ? {} : tip;
  const button = (
    <button
      ref={ref}
      type="button"
      className={className ?? styles['iconButton']}
      aria-label={label}
      {...(shown === undefined
        ? {
            title:
              tooltip ??
              (shortcut === undefined ? label : words('parts.with-shortcut', { label, shortcut })),
          }
        : {})}
      {...(shown?.hint === undefined ? {} : { 'aria-description': shown.hint })}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    >
      {children}
    </button>
  );
  if (shown === undefined) return button;
  return (
    <NameTip
      below
      align={shown.align ?? 'end'}
      name={shown.name ?? label}
      keys={shortcut}
      hint={shown.hint}
    >
      {button}
    </NameTip>
  );
}
