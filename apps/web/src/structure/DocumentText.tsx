import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { useMemo } from 'react';

import { Lozenge } from '../states/Lozenge.js';
import styles from './DocumentText.module.css';
import { nodeName, type Names } from './tree.js';

/** What the text knows of any occurrence's contributions, as the outline panel does: nothing. */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

const Heading = ({ depth, children }: { depth: number; children: React.ReactNode }) => {
  const level = Math.min(6, depth + 2);
  const Tag = `h${level}` as 'h3';
  return <Tag className={styles['heading']}>{children}</Tag>;
};

/**
 * The document itself, in reading order (layout C's middle): each section a heading under its number,
 * each component reference a card under its own, which opens the component. Numbered by the outline
 * panel's own function over the same outline and scheme, so the tree and the text cannot disagree.
 * Read-only: putting each component's editor in place is interface slice 9's.
 */
export function DocumentText({
  outline,
  scheme,
  names,
}: {
  outline: OutlineView;
  scheme: NumberingScheme | null;
  names: Names;
}) {
  const numbers = useMemo(
    () =>
      scheme === null
        ? new Map<string, string>()
        : sectionNumbers(number(conditions(resolve(outline, NOTHING_KNOWN)), scheme)),
    [outline, scheme],
  );

  const titled = (node: OutlineViewNode, depth: number) => {
    const at = numbers.get(node.id);
    return (
      <Heading depth={depth}>
        {at !== undefined && (
          <>
            <span className={styles['number']}>{at}</span>{' '}
          </>
        )}
        {nodeName(node, names)}
      </Heading>
    );
  };

  const render = (nodes: readonly OutlineViewNode[], depth: number): React.ReactNode =>
    nodes.map((node) =>
      node.type === 'section' ? (
        <div key={node.id} className={styles['section']} data-node={node.id}>
          {titled(node, depth)}
          {render(node.children, depth + 1)}
        </div>
      ) : (
        <div key={node.id} className={styles['reference']} data-node={node.id}>
          <div className={styles['card']}>
            {titled(node, depth)}
            {node.component === null ? (
              <Lozenge kind="notYoursToRead">Not yours to read</Lozenge>
            ) : (
              <a
                className={styles['open']}
                href={`#/components/${node.component}`}
                aria-label={`Open ${nodeName(node, names)}`}
              >
                Open
              </a>
            )}
          </div>
          {render(node.children, depth + 1)}
        </div>
      ),
    );

  return (
    <section className={styles['text']} aria-label="The document's text">
      {render(outline.nodes, 1)}
    </section>
  );
}
