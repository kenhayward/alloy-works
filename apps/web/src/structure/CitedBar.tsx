import { useEffect, useState } from 'react';

import styles from './CitedBar.module.css';
import { Icon } from '../editor/Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { words } from '../words/words.js';

/**
 * The parts the assistant's last answer cited, stepped through above the text (the DP plan, after
 * Diariz's cited moments): how many, which is shown, and on, back and clear. Shows nothing with
 * nothing cited; a new set of parts starts again at the first.
 */
export function CitedBar({
  nodes,
  onShow,
  onClear,
}: {
  /** The cited parts' nodes, in the order the answer cites them. */
  nodes: readonly string[];
  onShow: (node: string) => void;
  onClear: () => void;
}) {
  const [at, setAt] = useState(0);
  const key = nodes.join(' ');
  useEffect(() => setAt(0), [key]);
  if (nodes.length === 0) return null;
  const go = (step: number) => {
    const next = (at + step + nodes.length) % nodes.length;
    setAt(next);
    onShow(nodes[next]!);
  };
  return (
    <section className={styles['bar']} aria-label={words('document.cited-by-the-assistant')}>
      <span className={styles['label']}>{words('document.cited-by-the-assistant')}</span>
      <span>{words('document.cited-at', { at: at + 1, count: nodes.length })}</span>
      <span className={styles['spacer']} />
      <IconButton label={words('document.previous-cited-part')} onClick={() => go(-1)}>
        <Icon name="Previous page" size={14} />
      </IconButton>
      <IconButton label={words('document.next-cited-part')} onClick={() => go(1)}>
        <Icon name="Next page" size={14} />
      </IconButton>
      <IconButton label={words('document.clear-the-cited-parts')} onClick={onClear}>
        <Icon name="Close" size={14} />
      </IconButton>
    </section>
  );
}
