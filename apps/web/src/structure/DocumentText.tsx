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
import { renderContent } from '@alloy-works/editor';
import { useEffect, useMemo, useRef } from 'react';

import { Lozenge } from '../states/Lozenge.js';
import styles from './DocumentText.module.css';
import { nodeName, type Names } from './tree.js';

/** What the text knows of any occurrence's contributions, as the outline panel does: nothing. */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

/** Said where a component's text does not read, or holds what the editor cannot show yet. */
const CANNOT_SHOW = 'This component holds content this editor cannot show yet.';

/** A component's text, rendered once for its content and set into the card: markup, not a view. */
function RenderedText({ content }: { content: unknown }) {
  const place = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => renderContent(content, document), [content]);
  useEffect(() => {
    const host = place.current;
    if (!host || rendered === null) return undefined;
    host.replaceChildren(rendered.cloneNode(true));
    return () => host.replaceChildren();
  }, [rendered]);
  if (rendered === null) return <p className={styles['cannot']}>{CANNOT_SHOW}</p>;
  return <div ref={place} className={styles['body']} />;
}

const Heading = ({ depth, children }: { depth: number; children: React.ReactNode }) => {
  const level = Math.min(6, depth + 2);
  const Tag = `h${level}` as 'h3';
  return <Tag className={styles['heading']}>{children}</Tag>;
};

/**
 * The document itself, in reading order (layout C's middle): each section a heading under its number,
 * each component reference a card under its own, which opens the component. Numbered by the outline
 * panel's own function over the same outline and scheme, so the tree and the text cannot disagree.
 * Each card shows its component's text, rendered rather than mounted, and one at a time can hold that
 * component's own editor in its place (interface slice 9).
 */
export function DocumentText({
  outline,
  scheme,
  names,
  texts,
  editing = null,
  onEdit,
  editor,
}: {
  outline: OutlineView;
  scheme: NumberingScheme | null;
  names: Names;
  /** Each occurrence's content by node, once read; absent until then, and for a withheld one. */
  texts?: ReadonlyMap<string, unknown>;
  /** The occurrence whose component is open for editing in place, if any: one at a time. */
  editing?: string | null;
  /** Asked to open a component in place, or with null to close it. */
  onEdit?: (node: string | null) => void;
  /** The editor for a component, put in its card in place of its text. */
  editor?: (component: string) => React.ReactNode;
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
          <div className={styles['card']} data-editing={editing === node.id}>
            <div className={styles['cardHead']}>
              {titled(node, depth)}
              {node.component === null ? (
                <Lozenge kind="notYoursToRead">Not yours to read</Lozenge>
              ) : (
                <span className={styles['actions']}>
                  {onEdit && editor && (
                    <button
                      type="button"
                      aria-label={`${editing === node.id ? 'Close' : 'Edit'} ${nodeName(node, names)}`}
                      onClick={() => onEdit(editing === node.id ? null : node.id)}
                    >
                      {editing === node.id ? 'Close' : 'Edit'}
                    </button>
                  )}
                  <a
                    className={styles['open']}
                    href={`#/components/${node.component}`}
                    aria-label={`Open ${nodeName(node, names)}`}
                  >
                    Open
                  </a>
                </span>
              )}
            </div>
            {node.component !== null &&
              (editing === node.id && editor ? (
                <div className={styles['editor']}>{editor(node.component)}</div>
              ) : (
                texts?.has(node.id) && <RenderedText content={texts.get(node.id)} />
              ))}
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
