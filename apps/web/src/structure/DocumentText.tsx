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
import { useEffect, useMemo, useRef, useState } from 'react';

import { textOffsetIn } from '../editor/caret.js';

import { Lozenge } from '../states/Lozenge.js';
import styles from './DocumentText.module.css';
import { nodeName, type Names } from './tree.js';

/** What the text knows of any occurrence's contributions, as the outline panel does: nothing. */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

/** Said where a component's text does not read, or holds what the editor cannot show yet. */
const CANNOT_SHOW = 'This component holds content this editor cannot show yet.';

/** Where an editor opened in place stands in the document, and how it is closed. */
export interface Place {
  /** The occurrence's section number, where the scheme gives it one. */
  readonly number?: string;
  /** How many characters into the text it was opened, for the caret; absent if not by the text. */
  readonly openAt?: number;
  /** Closes it, as Done does. */
  readonly onDone: () => void;
}

/**
 * The character a click landed on, counted through the rendered text, as `caret.ts` counts it. Null
 * where the browser cannot say, as jsdom cannot, or the point is outside the text.
 */
function offsetOfClick(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return textOffsetIn(root, position.offsetNode, position.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return textOffsetIn(root, range.startContainer, range.startOffset);
  return null;
}

/**
 * A component's text, rendered once for its content and set into the card: markup, not a view.
 * Given `onOpen`, the text is the way into the component's editor (interface slice 13): a click
 * opens it with the caret where the click landed, and Enter opens it from the keyboard, the text
 * being a stop in the tab order. A click that ends a selection opens nothing, so text can still be
 * selected and copied, and a link in it is not followed.
 */
function RenderedText({
  content,
  onOpen,
}: {
  content: unknown;
  onOpen?: (openAt: number) => void;
}) {
  const place = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => renderContent(content, document), [content]);
  useEffect(() => {
    const host = place.current;
    if (!host || rendered === null) return undefined;
    host.replaceChildren(rendered.cloneNode(true));
    return () => host.replaceChildren();
  }, [rendered]);
  if (rendered === null) return <p className={styles['cannot']}>{CANNOT_SHOW}</p>;
  if (!onOpen) return <div ref={place} className={styles['body']} />;
  return (
    <div
      ref={place}
      className={styles['body']}
      data-opens="true"
      tabIndex={0}
      title="Click to edit"
      onClick={(event) => {
        const host = place.current;
        if (!host) return;
        if ((event.target as Element).closest('a')) event.preventDefault();
        const selection = host.ownerDocument.getSelection();
        if (selection && !selection.isCollapsed && host.contains(selection.anchorNode)) return;
        onOpen(offsetOfClick(host, event.clientX, event.clientY) ?? 0);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
        event.preventDefault();
        onOpen(0);
      }}
    />
  );
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
  /** The editor for a component, put in its card in place of its text, where it stands. */
  editor?: (component: string, place: Place) => React.ReactNode;
}) {
  // Where the text was clicked to open the one card being edited; read once, as that editor opens.
  const [openAt, setOpenAt] = useState<number | undefined>(undefined);
  const open = (node: string) => (at: number) => {
    setOpenAt(at);
    onEdit?.(node);
  };
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
            {/* While it is being edited the editor's own strip carries the number and the title,
                and its Done is the way out, so the head would only say them a second time. */}
            {!(editing === node.id && editor && node.component !== null) && (
              <div className={styles['cardHead']}>
                {titled(node, depth)}
                {node.component === null ? (
                  <Lozenge kind="notYoursToRead">Not yours to read</Lozenge>
                ) : (
                  <span className={styles['actions']}>
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
            )}
            {node.component !== null &&
              (editing === node.id && editor
                ? editor(node.component, {
                    ...(numbers.get(node.id) === undefined
                      ? {}
                      : { number: numbers.get(node.id)! }),
                    ...(openAt === undefined ? {} : { openAt }),
                    onDone: () => onEdit?.(null),
                  })
                : texts?.has(node.id) && (
                    <RenderedText
                      content={texts.get(node.id)}
                      {...(onEdit && editor ? { onOpen: open(node.id) } : {})}
                    />
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
