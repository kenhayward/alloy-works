import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import styles from './parts.module.css';

/** What the toolbar moves between: its buttons, an `aria-disabled` one among them. */
const ITEM = 'button:not([disabled])';

/**
 * A grouped toolbar (ADR-0046; WAI-ARIA's toolbar): one tab stop, the arrow keys, Home and End moving
 * along it and wrapping, and Tab coming back to the button last used, by key or by pointer. Its
 * buttons are whatever it holds, in order; `Toolbar.Divider` groups them. The stop is kept on the
 * buttons themselves after every render, so a button that comes or goes never strands it.
 */
export function Toolbar({
  label,
  className,
  children,
  ref,
}: {
  label: string;
  className?: string | undefined;
  children: ReactNode;
  ref?: Ref<HTMLDivElement> | undefined;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const stop = useRef(0);

  const items = () => [...(own.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];

  useLayoutEffect(() => {
    const all = items();
    if (stop.current >= all.length) stop.current = Math.max(0, all.length - 1);
    all.forEach((each, index) => {
      each.tabIndex = index === stop.current ? 0 : -1;
    });
  });

  const moveTo = (index: number) => {
    const all = items();
    if (all.length === 0) return;
    const at = (index + all.length) % all.length;
    all.forEach((each, i) => {
      each.tabIndex = i === at ? 0 : -1;
    });
    stop.current = at;
    all[at]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = items().indexOf(event.target as HTMLElement);
    if (from < 0) return;
    if (event.key === 'ArrowRight') moveTo(from + 1);
    else if (event.key === 'ArrowLeft') moveTo(from - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(items().length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={(element) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      role="toolbar"
      aria-label={label}
      className={className ?? styles['toolbar']}
      // So the region ring has somewhere to land even if the row were ever empty.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const at = items().indexOf(event.target as HTMLElement);
        if (at < 0) return;
        stop.current = at;
        items().forEach((each, index) => {
          each.tabIndex = index === at ? 0 : -1;
        });
      }}
    >
      {children}
    </div>
  );
}

/** A rule between a toolbar's groups, which nothing reads. */
Toolbar.Divider = function Divider({ className }: { className?: string | undefined }) {
  return <span className={className ?? styles['divider']} data-divider aria-hidden="true" />;
};
