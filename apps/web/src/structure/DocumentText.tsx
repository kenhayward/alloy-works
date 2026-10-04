import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
  type SectionViewNode,
} from '@alloy-works/domain';
import {
  drawEquation,
  renderContent,
  TEXT_CLASS,
  type BindingContext,
  type ReferenceContext,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { heldSentence } from '../editor/held.js';
import { bindingContexts, statesByNode, type BindingState } from './bindingContexts.js';
import { referenceContexts } from './contexts.js';
import { textOffsetIn } from '../editor/caret.js';

import { Lozenge } from '../states/Lozenge.js';
import styles from './DocumentText.module.css';
import { nodeName, titleText, type Names } from './tree.js';
import { innerWidth, useCanvas } from '../theme/Canvas.js';
import { useStyledImages } from '../theme/images.js';
import { useUnresolvedMarks } from '../theme/check.js';
import { usePresentation } from '../theme/presentation.js';
import { VersionChoice, versionSaid, type Choosing } from './VersionChoice.js';

/** The room the document's column has for its measure, at Fit: its own, inside its padding. */
const ownRoom = (element: HTMLElement) => innerWidth(element);

/** What the text knows of an occurrence's contributions until the page has heard: nothing. */
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
  /** What the document offers its references, for the occurrence being edited (ruling R11). */
  readonly referenceContext?: ReferenceContext | null;
  /**
   * What the document holds for each binding of the occurrence being edited (the B1 plan, B1-D): null
   * where the page has not read it, or could not.
   */
  readonly bindingContext?: BindingContext | null;
  /** What the bindings view says of each of its bindings, by identifier, for its Value panel. */
  readonly bindingStates?: ReadonlyMap<string, BindingState>;
  /** Opens a value's provenance, from the Value panel's **Provenance** (B1-M). */
  readonly onProvenance?: (binding: string) => void;
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

/** Whether the reader may edit an occurrence's component now, and who holds it (CNT-074). */
export interface Editable {
  readonly mayEdit: boolean;
  readonly lock: {
    readonly holder: { readonly name: string | null };
    readonly expectedRelease: string;
    readonly yours: boolean;
  } | null;
}

/**
 * What a card says of its component before it is opened (CNT-074): who holds it and when they are
 * expected back, that the reader holds it themselves in another window, or that they may read it
 * and not edit it - and nothing where they may edit it now, where the page has not heard, or where
 * the same component is open on this page already. A hold past its expected release holds nothing:
 * it lapses as that time passes, and the next claim takes it.
 */
function EditableState({ state, openHere }: { state: Editable | undefined; openHere: boolean }) {
  if (state === undefined) return null;
  const lock =
    state.lock !== null && new Date(state.lock.expectedRelease).getTime() > Date.now()
      ? state.lock
      : null;
  if (lock?.yours) {
    return openHere ? null : (
      <p className={styles['state']}>You are editing this component in another window.</p>
    );
  }
  if (lock !== null) {
    return (
      <p className={styles['state']}>
        {heldSentence({ name: lock.holder.name, expectedRelease: lock.expectedRelease })}
      </p>
    );
  }
  if (!state.mayEdit) {
    return <p className={styles['state']}>You may read this component but not edit it.</p>;
  }
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
  context,
  bindings,
  onOpen,
  onProvenance,
}: {
  content: unknown;
  /** What its references print from, where it stands in a document (ruling R12). */
  context: ReferenceContext | null;
  /** What the document holds for its bindings (the B1 plan, B1-D), or null where it is not known. */
  bindings: BindingContext | null;
  onOpen?: (openAt: number) => void;
  /**
   * Opens a value's provenance (B1-M; DAT-041): a click on a value, or Enter on it - a button, whose
   * Enter the browser makes a click - never opens the editor.
   */
  onProvenance?: (binding: string, opener: HTMLElement) => void;
}) {
  const place = useRef<HTMLDivElement>(null);
  useStyledImages(place);
  useUnresolvedMarks(place);
  const rendered = useMemo(
    () => renderContent(content, document, context, bindings),
    [content, context, bindings],
  );
  /** Whether a click was on a value, which then opens its provenance and nothing else. */
  const onValue = (target: EventTarget): boolean => {
    const value = (target as Element).closest?.('button[data-binding]');
    if (!(value instanceof HTMLElement)) return false;
    onProvenance?.(value.dataset.binding ?? '', value);
    return true;
  };
  useEffect(() => {
    const host = place.current;
    if (!host || rendered === null) return undefined;
    host.replaceChildren(rendered.cloneNode(true));
    return () => host.replaceChildren();
  }, [rendered]);
  if (rendered === null) return <p className={styles['cannot']}>{CANNOT_SHOW}</p>;
  const classes = `${styles['body']} ${TEXT_CLASS}`;
  if (!onOpen) {
    return (
      <div
        ref={place}
        className={classes}
        onClick={onProvenance ? (event) => void onValue(event.target) : undefined}
      />
    );
  }
  return (
    <div
      ref={place}
      className={classes}
      data-opens="true"
      tabIndex={0}
      title="Click to edit"
      onClick={(event) => {
        const host = place.current;
        if (!host) return;
        if (onValue(event.target)) return;
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

/**
 * An equation in a section's heading, drawn by the editor's own drawing - native MathML, named by its
 * alternative, never markup set as HTML - exactly as it is in a component's text and in the title's
 * field (equations 3, ruling R4). React owns the holder and renders nothing into it; the drawing is
 * all that is inside.
 */
function HeadingEquation({ mathml }: { mathml: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (holder.current !== null) drawEquation(holder.current, { mathml }, 'inline');
  }, [mathml]);
  return <span ref={holder} className="aw-equation" />;
}

/**
 * A section's title as its heading shows it: its words, and each equation drawn as MathML where the
 * tree and every sentence read it as its alternative. What else a title may hold is not drawn here, as
 * it is not named by `nodeName` either, and a title with no words is an untitled section.
 */
function SectionTitle({ title }: { title: SectionViewNode['title'] }) {
  if (titleText(title).trim() === '') return <>Untitled section</>;
  return (
    <>
      {title.map((run, index) => (
        <Fragment key={index}>
          {run.type === 'text' ? (
            run.value
          ) : run.type === 'equation' ? (
            <HeadingEquation mathml={run.mathml} />
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A section's or a component's heading, set in the theme's heading role for its depth as the
 * publication sets it (document-view.md, "One scroll"; CNT-072) - a deeper one in the sixth.
 */
const Heading = ({ depth, children }: { depth: number; children: React.ReactNode }) => {
  const level = Math.min(6, depth + 2);
  const Tag = `h${level}` as 'h3';
  return (
    <Tag className={styles['heading']} data-role={`heading${Math.min(6, depth)}`}>
      {children}
    </Tag>
  );
};

/**
 * The document itself, in reading order (layout C's middle), as one scroll on one canvas
 * (document-view.md, "One scroll"): each section and each component reference a heading under its
 * number, in the theme's heading role for its depth, and each component's text beneath its own with no
 * card around it - its edges and its label shown on hover, on focus and under Show boundaries.
 * Numbered by the outline panel's own function over the same outline and scheme, so the tree and the
 * text cannot disagree. Each component's text is rendered rather than mounted, and one at a time can
 * hold that component's own editor in its place (interface slice 9).
 */
export function DocumentText({
  outline,
  scheme,
  words = null,
  names,
  texts,
  editing = null,
  onEdit,
  editor,
  editable,
  contributions = NOTHING_KNOWN,
  boundaries = false,
  marked = null,
  resolved,
  choosing,
  bindingStates = null,
  onProvenance,
}: {
  outline: OutlineView;
  scheme: NumberingScheme | null;
  /** What a relative cross-reference prints for above and below (cross-references 2, ruling R9). */
  words?: { readonly above: string; readonly below: string } | null;
  names: Names;
  /** Each occurrence's content by node, once read; absent until then, and for a withheld one. */
  texts?: ReadonlyMap<string, unknown>;
  /** The occurrence whose component is open for editing in place, if any: one at a time. */
  editing?: string | null;
  /** Whether the reader may edit each occurrence's component now, and who holds it, by node. */
  editable?: ReadonlyMap<string, Editable>;
  /** Asked to open a component in place, or with null to close it. */
  onEdit?: (node: string | null) => void;
  /** The editor for a component, put in its card in place of its text, where it stands. */
  editor?: (component: string, place: Place) => React.ReactNode;
  /**
   * What each occurrence contributes, by node, as the page last heard it: what a reference to a
   * figure, a table or a footnote is numbered from. Until it is heard, those show their kind and
   * caption, and a section its number.
   */
  contributions?: ReadonlyMap<string, readonly Contribution[]>;
  /** Whether every component's edges and label are shown, rather than on hover and focus (CNT-073). */
  boundaries?: boolean;
  /** The node a link took the reader to, marked until they choose another (STR-045). */
  marked?: string | null;
  /** The number of the version each occurrence resolves to, by node, where the reader is told one. */
  resolved?: ReadonlyMap<string, string>;
  /**
   * How a reference's version is chosen from its label (CNT-158): given only in Authoring, to a
   * reader who may restructure the document. Without it the label says the version and offers nothing.
   */
  choosing?: Choosing;
  /**
   * What the bindings view says of every binding the texts hold (the B1 plan, B1-I), or null where the
   * page has not read it, or could not: then no value is shown, and no error (B1-N).
   */
  bindingStates?: readonly BindingState[] | null;
  /** Opens a value's provenance, from the text or the editor opened in place (B1-M). */
  onProvenance?: (node: string, binding: string, opener: HTMLElement | null) => void;
}) {
  // The whole document is one canvas, the theme's paper (document-view.md, "One scroll"; CNT-072).
  const column = useRef<HTMLElement>(null);
  const canvas = useCanvas(ownRoom, column as RefObject<HTMLDivElement | null>);
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
  const contexts = useMemo(
    () => referenceContexts(outline, scheme, contributions, words),
    [outline, scheme, contributions, words],
  );
  // Each occurrence's values, formatted in the theme's formats for the document's language (B1-G).
  const presentation = usePresentation();
  const theme = presentation?.state === 'ready' ? presentation.theme : null;
  const bindingContextsByNode = useMemo(
    () => (bindingStates === null ? null : bindingContexts(bindingStates, theme, outline.language)),
    [bindingStates, theme, outline.language],
  );
  const bindingStatesByNode = useMemo(
    () => (bindingStates === null ? null : statesByNode(bindingStates)),
    [bindingStates],
  );

  // The component open in place on this page, whichever occurrence it was opened from.
  const openComponent = useMemo(() => {
    const find = (nodes: readonly OutlineViewNode[]): string | null => {
      for (const node of nodes) {
        if (node.id === editing) return node.type === 'reference' ? node.component : null;
        const within = find(node.children);
        if (within !== null) return within;
      }
      return null;
    };
    return editing === null ? null : find(outline.nodes);
  }, [editing, outline]);

  const titled = (node: OutlineViewNode, depth: number) => {
    const at = numbers.get(node.id);
    // In a holder the measure wide on the canvas, so the heading's indents and alignment stand inside
    // the measure while its section and component keep the column's width (issue #333).
    return (
      <div className={styles['measured']}>
        <Heading depth={depth}>
          {at !== undefined && (
            <>
              <span className={styles['number']}>{at}</span>{' '}
            </>
          )}
          {node.type === 'section' ? <SectionTitle title={node.title} /> : nodeName(node, names)}
        </Heading>
      </div>
    );
  };

  const render = (nodes: readonly OutlineViewNode[], depth: number): React.ReactNode =>
    nodes.map((node) =>
      node.type === 'section' ? (
        <div
          key={node.id}
          className={styles['section']}
          data-node={node.id}
          data-marked={marked === node.id ? 'true' : undefined}
        >
          {titled(node, depth)}
          {render(node.children, depth + 1)}
        </div>
      ) : (
        <div
          key={node.id}
          className={styles['reference']}
          data-node={node.id}
          data-marked={marked === node.id ? 'true' : undefined}
        >
          <div className={styles['component']} data-component="" data-editing={editing === node.id}>
            {/* The component's label (CNT-073): what it is, which version and how it is placed
                (CNT-162), whether the reader may edit it and who holds it, and Open - seen on hover, on
                focus and under Show boundaries, and always there for a screen reader. While it is
                being edited the editor's own strip says it. */}
            {!(editing === node.id && editor && node.component !== null) && (
              <div className={styles['label']} data-label="">
                <span className={styles['labelName']}>{nodeName(node, names)}</span>
                {node.component === null ? (
                  <Lozenge kind="notYoursToRead">Not yours to read</Lozenge>
                ) : (
                  <>
                    {choosing ? (
                      <VersionChoice
                        node={node}
                        component={node.component}
                        name={nodeName(node, names)}
                        said={versionSaid(node.mode, resolved?.get(node.id))}
                        choosing={choosing}
                      />
                    ) : (
                      <span className={styles['versionSaid']}>
                        {versionSaid(node.mode, resolved?.get(node.id))}
                      </span>
                    )}
                    <EditableState
                      state={editable?.get(node.id)}
                      openHere={openComponent !== null && openComponent === node.component}
                    />
                    <a
                      className={styles['open']}
                      href={`#/components/${node.component}`}
                      aria-label={`Open ${nodeName(node, names)}`}
                    >
                      Open
                    </a>
                  </>
                )}
              </div>
            )}
            {!(editing === node.id && editor && node.component !== null) && titled(node, depth)}
            {node.component !== null &&
              (editing === node.id && editor
                ? editor(node.component, {
                    ...(numbers.get(node.id) === undefined
                      ? {}
                      : { number: numbers.get(node.id)! }),
                    ...(openAt === undefined ? {} : { openAt }),
                    referenceContext: contexts.get(node.id) ?? null,
                    bindingContext: bindingContextsByNode?.get(node.id) ?? null,
                    ...(bindingStatesByNode?.has(node.id)
                      ? { bindingStates: bindingStatesByNode.get(node.id)! }
                      : {}),
                    ...(onProvenance
                      ? {
                          onProvenance: (binding: string) =>
                            onProvenance(node.id, binding, document.activeElement as HTMLElement),
                        }
                      : {}),
                    onDone: () => onEdit?.(null),
                  })
                : texts?.has(node.id) && (
                    <RenderedText
                      content={texts.get(node.id)}
                      context={contexts.get(node.id) ?? null}
                      bindings={bindingContextsByNode?.get(node.id) ?? null}
                      {...(onEdit && editor ? { onOpen: open(node.id) } : {})}
                      {...(onProvenance
                        ? {
                            onProvenance: (binding: string, opener: HTMLElement) =>
                              onProvenance(node.id, binding, opener),
                          }
                        : {})}
                    />
                  ))}
          </div>
          {render(node.children, depth + 1)}
        </div>
      ),
    );

  return (
    <section
      ref={column}
      className={[styles['text'], canvas.className].filter(Boolean).join(' ')}
      style={canvas.style}
      data-boundaries={boundaries ? 'shown' : undefined}
      aria-label="The document's text"
    >
      {render(outline.nodes, 1)}
    </section>
  );
}
