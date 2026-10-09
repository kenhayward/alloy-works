import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { IconButton } from './IconButton.js';
import styles from './parts.module.css';

/**
 * A row's details beside its list (ADR-0049, decision 5): 440px, docked in a column of its own from
 * 1366px and floating over the list below it, which keeps its place either way. Named by its heading,
 * which takes the focus as it opens; Escape or Close closes it, and the focus goes back to the button
 * that opened it - unless the person has gone elsewhere meanwhile, such as another row's button,
 * whose own panel then takes it. Not modal: the list stays reachable.
 */
export function SidePanel({
  heading,
  description,
  icon,
  onClose,
  footer,
  children,
}: {
  heading: string;
  description?: React.ReactNode;
  /** A glyph from `Icon` beside the heading. */
  icon?: string;
  onClose: () => void;
  /** Actions that stay at the panel's foot, such as Cancel and Save. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // Read as the panel renders, before an earlier panel's clean-up moves the focus anywhere.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    title.current?.focus();
    const box = panel.current;
    return () => {
      const at = document.activeElement;
      const lost = at === null || at === document.body || (box !== null && box.contains(at));
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <aside
      ref={panel}
      className={styles['sidePanel']}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles['sidePanelHead']}>
        {icon !== undefined && (
          <span className={styles['sidePanelIcon']}>
            <Icon name={icon} />
          </span>
        )}
        <div className={styles['sidePanelTitle']}>
          <h2 id={id} ref={title} tabIndex={-1}>
            {heading}
          </h2>
          {description !== undefined && <p>{description}</p>}
        </div>
        <IconButton label="Close" shortcut="Escape" onClick={onClose}>
          <Icon name="Close" size={13} />
        </IconButton>
      </header>
      <div className={styles['sidePanelBody']}>{children}</div>
      {footer !== undefined && <footer className={styles['sidePanelFoot']}>{footer}</footer>}
    </aside>
  );
}
