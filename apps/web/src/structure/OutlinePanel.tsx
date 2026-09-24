import {
  canonicaliseTitle,
  conditions,
  hasText,
  mayBeFront,
  number,
  resolve,
  sectionNumbers,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
  type SectionViewNode,
} from '@alloy-works/domain';
import {
  mountTitleEditor,
  titleToEditor,
  type EquationAt,
  type EquationChoice,
  type TitleEditor,
} from '@alloy-works/editor';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// The title field's editor, and the equations in it, drawn as the component editor draws them.
import '@alloy-works/editor/style.css';

import { Icon } from '../editor/Icon.js';
import styles from './OutlinePanel.module.css';

import {
  breaksFrontFirst,
  dropMove,
  frontAfter,
  keyMove,
  leavesTheTopLevel,
  nodeLabel,
  nodeName,
  placeOf,
  sectionTitle,
  titleText,
  trimTitle,
  visibleOrder,
  ancestorsOf,
  type DropTarget,
  type Names,
} from './tree.js';

/**
 * The Equation dialog, loaded the first time a title asks for it, and Temml with it - the component
 * editor's reason (equations 1's final review, L5), and the same chunk of the product's own build.
 */
const EquationDialog = lazy(() =>
  import('../editor/EquationDialog.js').then(({ EquationDialog }) => ({ default: EquationDialog })),
);

/**
 * What a section's title field asks the Equation dialog for (equations 3, ruling R3): the equation
 * selected whole in it, to change, or none, to place one at the caret; and how to place the answer,
 * which says why it could not or answers null once it has.
 */
interface EquationRequest {
  readonly current: EquationAt | null;
  readonly place: (choice: EquationChoice) => string | null;
}

/** A component the panel can add a reference to: what `GET /v1/components` lists. */
export interface ComponentChoice {
  readonly id: string;
  readonly title: string;
}

/** What the page knows of the components the caller may read, for **Add component** to offer. */
export type ComponentChoices =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly signedOut: boolean }
  | { readonly state: 'loaded'; readonly items: readonly ComponentChoice[] };

/**
 * What one act came to: the outline the service returned; `'refused'`, where the page now shows an
 * outline other than the one the act was made against (a conflict, a refusal, a document gone read-only
 * or unreadable), so whatever was being edited gives way to it; `'unsent'`, where nothing changed and
 * nothing was recorded (a server error, no answer), so what was typed is kept for the retry the page's
 * notice asks for; or `'signedOut'`, the same except that no retry can succeed until the author signs
 * in again.
 */
export type Answered = OutlineView | 'refused' | 'unsent' | 'signedOut';

type RetitleOperation = Extract<OutlineOperation, { operation: 'retitle' }>;
/** A title as a node holds it. */
type Title = SectionViewNode['title'];

/** A retitle's answer, or word that a newer commit to the same section took its place. */
type RetitleAnswer = Answered | 'superseded';

/** A retitle waiting to be sent, with what it was committed behind. */
interface Held {
  readonly operation: RetitleOperation;
  readonly resolve: (answer: RetitleAnswer) => void;
  /** `refusals` and `signedOuts` when it was committed. */
  readonly refusals: number;
  readonly signedOuts: number;
}

/** A title that was not saved after its field closed, and whether signing out is why. */
interface LostTitle {
  readonly title: string;
  readonly signedOut: boolean;
}

/** "Methods", "Methods and Results", "Scope, Methods and Results". */
function listed(titles: readonly string[]): string {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

/** Said after a refusal's own sentence, naming each title it took. */
function titlesNotSaved(titles: readonly string[]): string {
  return titles.length === 1
    ? `Your title ${listed(titles)} was not saved.`
    : `Your titles ${listed(titles)} were not saved.`;
}

/** Names every title not saved after its field closed, once none is outstanding. */
function lostTitles(lost: readonly LostTitle[]): string {
  const titles = lost.map((each) => each.title);
  const which =
    titles.length === 1 ? `the title ${listed(titles)} was` : `the titles ${listed(titles)} were`;
  return lost.some((each) => each.signedOut)
    ? `You are signed out, so ${which} not saved. Sign in again to change this document.`
    : `${which.charAt(0).toUpperCase()}${which.slice(1)} not saved. ${
        titles.length === 1 ? 'Select the section' : 'Select each section'
      } and try it again.`;
}

export interface OutlinePanelProps {
  readonly outline: OutlineView;
  /** What stands above the panel's content in its box: the pane's tab strip. */
  readonly head?: ReactNode;
  /** The tab and the panel it shows, by id, when the panel is one tab's (interface slice 15). */
  readonly tab?: { readonly tab: string; readonly panel: string };
  /** The tree's root row, above the tree: the document itself. */
  readonly root?: ReactNode;
  /**
   * The scheme the outline is numbered with: the scheme of the layout version this document would be
   * published under (STR-036), never the product's default, so the panel shows the numbers a publish
   * prints. `null` where that scheme could not be read, and then nothing is numbered at all - a
   * fallback would show numbers no publish could produce.
   */
  readonly scheme: NumberingScheme | null;
  /** Whether the caller may restructure the outline at all; a reader is offered nothing to change. */
  readonly editable: boolean;
  /** An operation is in flight: everything that would send another waits for it. */
  readonly busy?: boolean;
  /**
   * Sends one structural act, answering what it came to (`Answered`). The page owns what happens
   * next - the version, the undo stack, what is announced.
   */
  readonly onOperation: (operation: OutlineOperation) => Promise<Answered>;
  /**
   * The one status sentence, which the page announces through the status bar (interface slice 15).
   * The panel reads it to know what its own last word was.
   */
  readonly notice: string | null;
  /** Says something through that same bar: a field refused before anything was sent. */
  readonly onNotice?: (message: string | null) => void;
  readonly canUndo?: boolean;
  readonly onUndo?: () => Promise<Answered>;
  /**
   * How many acts the page has answered `'refused'`, counted in the same render that shows the outline
   * the refusal left. A retitle held during a flight is sent only if this has not moved since it was
   * held: once the act in flight is refused, the page shows an outline the held title was not typed
   * against, and sending it would overwrite that outline without anyone having seen it (STR-059).
   */
  readonly refusals?: number;
  /**
   * How many acts the page has answered `'signedOut'`. A retitle held behind one is not sent, because
   * it could only be refused the same way. Behind any other failure it is sent: nothing was recorded,
   * so no outline was shown that it could overwrite - and if the failed act did record after all, the
   * retitle is refused as a conflict by the ordinary path.
   */
  readonly signedOuts?: number;
  /** Names a reference by its component's title; `null` until the components have been read. */
  readonly names?: Names;
  readonly components?: ComponentChoices;
  readonly onReloadComponents?: () => void;
  /** The node a link names, and which arrival of it this is: each arrival is taken to the node. */
  readonly linked?: { readonly node: string; readonly arrival: number } | null;
  /** A node's shareable address (STR-044), shown for the selected node. */
  readonly linkOf?: (node: string) => string;
  /** Told whenever the author chooses a node, so the page's address can follow. */
  readonly onSelected?: (node: string) => void;
}

/**
 * What the panel knows of any occurrence's contributions: nothing. It shows section numbers alone, and
 * a section number never depends on what an occurrence holds, so knowing nothing costs it nothing -
 * and the panel reads no component's content to show one.
 */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

const PAGE_BREAKS = [
  { value: 'none', label: 'Wherever it falls' },
  { value: 'page', label: 'A new page' },
  { value: 'recto', label: 'A new right-hand page' },
] as const;

/** The three matters a top-level node may be in, in the order a publication prints them (STR-064). */
const MATTERS = [
  { value: 'front', label: 'Front matter' },
  { value: 'body', label: 'Body' },
  { value: 'appendix', label: 'Appendix' },
] as const;

/** Said where a key move is refused, in the words of the rule that refused it. */
const TOP_LEVEL_ONLY = 'Front matter and appendices stay at the top level.';
const FRONT_FIRST = 'Front matter comes before the rest of the outline.';

/**
 * The keymap, said once beside the tree and tied to it by `aria-describedby`. A Mac keyboard's delete
 * key is Backspace, which the tree leaves alone, so it says where removing is on one.
 */
const KEYS =
  'Move between items with the arrow keys. Move the selected item with Alt and the arrow keys ' +
  '(Option on a Mac), add a section after it with Enter, remove it with Delete, and undo with ' +
  'Ctrl+Z (Cmd+Z on a Mac). On a Mac keyboard, remove it with the Remove button.';

function isPageBreak(value: string): value is OutlineViewNode['pageBreak'] {
  return PAGE_BREAKS.some((each) => each.value === value);
}

function isMatter(value: string): value is OutlineViewNode['matter'] {
  return MATTERS.some((each) => each.value === value);
}

/** The nearest ancestor of a node that is not numbered, which takes its number away (decision D). */
function unnumberedAncestor(
  nodes: readonly OutlineViewNode[],
  id: string,
): OutlineViewNode | undefined {
  let parent = placeOf(nodes, id)?.parent ?? null;
  while (parent !== null) {
    if (!parent.numbered) return parent;
    parent = placeOf(nodes, parent.id)?.parent ?? null;
  }
  return undefined;
}

/** Inputs that take no typing, and so have no undo of their own for Ctrl+Z to reach. */
const UNTYPED_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/**
 * Whether a key event came from somewhere text is typed, whose own undo Ctrl+Z is. A checkbox or a
 * select has none: there the key is the panel's, or the act just made from it could not be undone
 * from where the focus still is.
 */
function inTextField(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !UNTYPED_INPUTS.has(target.type)) ||
    // A section's title field is an editor of its own since equations 3, with its own undo.
    (target instanceof HTMLElement && target.closest('[contenteditable="true"]') !== null)
  );
}

/**
 * The document's outline as a tree (structure.md, "Accessibility"): `role="tree"` of `role="treeitem"`
 * nodes, **one tab stop** with the arrow keys moving between nodes, and the enumerated keymap STR-006
 * asks for - `Alt+Up` and `Alt+Down` among siblings, `Alt+Left` and `Alt+Right` to promote and demote,
 * `Enter` to insert a sibling, `Delete` for a node and its subtree, `Ctrl+Z` to undo. The pointer does
 * the same through drag and drop, and both compute their positions in `tree.ts`, so they cannot read
 * the service's move convention two ways.
 *
 * Every act is one operation, sent through `onOperation`; this panel keeps no copy of the outline and
 * never changes one itself. What it shows is the outline the last operation returned (STR-034).
 */
export function OutlinePanel({
  outline,
  head = null,
  tab,
  root = null,
  scheme,
  editable,
  busy = false,
  onOperation,
  notice,
  onNotice = () => {},
  canUndo = false,
  onUndo,
  refusals = 0,
  signedOuts = 0,
  names = null,
  components = { state: 'loading' },
  onReloadComponents = () => {},
  linked = null,
  linkOf,
  onSelected = () => {},
}: OutlinePanelProps) {
  const prefix = useId();
  const nodes = outline.nodes;
  const [active, setActive] = useState<string | null>(null);
  // The node to put focus on once it is in the page. A moved node is a new element where it lands,
  // because it sits in a different list, so focus is asked for after the answer rather than kept.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: 'section' | 'component'; after: string | null }>();
  const [newTitle, setNewTitle] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Filled by each item's ref callback, never during render.
  const items = useRef(new Map<string, HTMLElement>());
  // The drag's own state waits a tick (see `onDragStart`); this is that tick, so a drag that ends first
  // can take it back.
  // Never cleared on unmount (issue #131). Under `<StrictMode>` React runs every effect's cleanup once
  // as a simulated unmount when the panel mounts, indistinguishable from a real one, and under load
  // it runs after a drag has already started - so a cleanup clearing this timer cancelled a live
  // drag. After a real unmount the timer's one act is a state update React ignores.
  const dragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Every retitle committed - Enter, or leaving the field, which may take the field away with it - is
  // held here, **one per section**, in the order of its latest commit (a Map keeps insertion order),
  // and sent once nothing else is in flight: so none is dropped because another act was in flight, and
  // none takes another section's place.
  const held = useRef(new Map<string, Held>());
  // A retitle sent from `held` and not yet answered: the next one waits for it.
  const sending = useRef(false);
  // Retitles committed and not yet answered, however far each has got.
  const outstanding = useRef(0);
  // Titles not saved whose fields have closed, named together once none is outstanding, so a later
  // retitle's answer cannot replace the sentence that names an earlier one.
  const lost = useRef<LostTitle[]>([]);
  // Titles given way to a refusal, named after the refusal's own sentence in the render that shows it.
  const dropped = useRef<string[]>([]);
  // The last sentence that named them, the refusal's sentence it was said after, and the titles it
  // named: titles a later render drops behind the same refusal join that one sentence.
  const named = useRef<{ said: string; after: string; titles: readonly string[] } | null>(null);
  // Moved whenever a retitle is committed or answered, so the render after it looks at `held` again.
  const [, setLooked] = useState(0);
  // The section whose title field is open, written by that field's own effect: a retitle that was not
  // saved after its field closed has nowhere left to keep its text, so the notice names it instead.
  const openField = useRef<string | null>(null);
  // The Equation dialog, open for a section's title field, or closed (equations 3, ruling R3). Held
  // here rather than in the field because the panel is what it makes inert, and the focus can only go
  // back once the panel is no longer inert, which is this render's to say.
  const [equating, setEquating] = useState<EquationRequest | null>(null);
  // What had the focus as it opened - the title field, or the button beside it - to give it back to.
  const equationOpener = useRef<HTMLElement | null>(null);
  const askEquation = (request: EquationRequest) => {
    equationOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEquating(request);
  };
  useEffect(() => {
    if (equating !== null) return;
    const back = equationOpener.current;
    equationOpener.current = null;
    back?.focus();
  }, [equating]);
  // The node a link took the reader to, marked until they choose another (STR-045's panel half).
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // The sections the reader has collapsed: how the outline is shown to them, never part of the
  // document, so nothing is sent and nothing is remembered past the page.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // The arrival of a link already taken to its node: under `<StrictMode>` the effect below runs twice
  // on mount, and a ref survives the simulated unmount between, so one arrival is taken once.
  const taken = useRef<number | null>(null);
  useEffect(() => {
    if (linked === null || taken.current === linked.arrival) return;
    taken.current = linked.arrival;
    if (placeOf(nodes, linked.node)) {
      setActive(linked.node);
      setHighlighted(linked.node);
      // Focus, which in a browser scrolls the node into view: the reader asked to be taken here.
      setFocusTarget(linked.node);
    } else {
      onNotice('The linked part is not in this document.');
    }
  }, [linked, nodes, onNotice]);

  // The selected node, derived rather than stored: the one chosen if it is still in the outline, the
  // first node otherwise - so a node removed, or an outline somebody else changed, never leaves the
  // tree without its one tab stop.
  const current = active !== null && placeOf(nodes, active) ? active : (nodes[0]?.id ?? null);
  const selected = current === null ? undefined : placeOf(nodes, current)?.node;
  // The chosen node gone - removed by somebody else, or by an act this page answered - selection has
  // fallen back to the first node, so the choice is made that one and the address follows it there,
  // rather than naming a node the document no longer holds. A link that named nothing here chose
  // nothing, so it never reaches this, and the address keeps what the reader followed.
  useEffect(() => {
    if (active === null || placeOf(nodes, active)) return;
    const fallback = nodes[0]?.id ?? null;
    setActive(fallback);
    if (fallback !== null) onSelected(fallback);
  }, [active, nodes, onSelected]);
  const may = editable && !busy;
  // The one numbering function, over the outline this render shows: recomputed whenever the outline
  // is, so there is no number to fall behind it, and the same function the service numbers with, so
  // the two cannot disagree.
  const numbers = useMemo(
    () =>
      scheme === null
        ? new Map<string, string>()
        : sectionNumbers(number(conditions(resolve(outline, NOTHING_KNOWN)), scheme)),
    [outline, scheme],
  );

  useEffect(() => {
    if (focusTarget === null) return;
    const element = items.current.get(focusTarget);
    if (element) {
      element.focus();
      setFocusTarget(null);
    } else if (!placeOf(nodes, focusTarget)) {
      setFocusTarget(null);
    }
  }, [focusTarget, nodes]);

  const send = async (operation: OutlineOperation, focus: string | null) => {
    const after = await onOperation(operation);
    if (focus !== null) setFocusTarget(focus);
    return after;
  };

  // After every render. First, titles a refusal took are named after that refusal's own sentence,
  // which is the notice this render shows. Then, when nothing is in flight, the held retitles are
  // looked at in order: each is given way to, or sent - one at a time, from this render's outline and
  // `onOperation`, which is to say from the version the act before it made; the render after its
  // answer sends the next.
  useEffect(() => {
    if (dropped.current.length > 0) {
      // Still showing the sentence this effect said last: the refusal is the same one, so its titles
      // and these are named together, each once, rather than in a second sentence after the first.
      const same = named.current !== null && notice === named.current.said;
      const after = same ? named.current!.after : (notice ?? '');
      const titles = [...new Set([...(same ? named.current!.titles : []), ...dropped.current])];
      const said = [after, titlesNotSaved(titles)].filter(Boolean).join(' ');
      named.current = { said, after, titles };
      dropped.current = [];
      onNotice(said);
    }
    if (busy || sending.current) return;
    for (const [id, waiting] of held.current) {
      held.current.delete(id);
      const node = placeOf(nodes, id)?.node;
      // Behind a refusal - the same rule as a retitle refused itself: the field gives way to the
      // outline now shown, and the refusal's sentence stays, with the title named after it.
      if (refusals !== waiting.refusals || !editable || node?.type !== 'section') {
        waiting.resolve('refused');
        continue;
      }
      // Behind a sign-out it could only be refused the same way, so it is not sent.
      if (signedOuts !== waiting.signedOuts) {
        waiting.resolve('signedOut');
        continue;
      }
      if (canonicaliseTitle(node.title) === canonicaliseTitle(waiting.operation.title)) {
        waiting.resolve(outline);
        continue;
      }
      // Behind a failure it is sent: nothing was recorded, so no outline was shown that it could
      // overwrite - and if the failed act did record after all, it is refused as a conflict.
      sending.current = true;
      void onOperation(waiting.operation).then((answer) => {
        sending.current = false;
        waiting.resolve(answer);
        setLooked((count) => count + 1);
      });
      return;
    }
  });

  /**
   * A retitle, held and sent once nothing else is in flight. One that was not saved, and whose field
   * has since closed, is named in the notice once no other retitle is outstanding; one a refusal took
   * is named after the refusal's sentence - so no title is ever lost without a word.
   */
  const retitle = async (operation: RetitleOperation): Promise<RetitleAnswer> => {
    outstanding.current += 1;
    const answer = await new Promise<RetitleAnswer>((resolve) => {
      // A newer commit to the same section carries the later text, so the older is superseded, and
      // the newer goes to the back of the queue, in the order of its own commit.
      const waiting = held.current.get(operation.node);
      held.current.delete(operation.node);
      waiting?.resolve('superseded');
      held.current.set(operation.node, { operation, resolve, refusals, signedOuts });
      setLooked((count) => count + 1);
    });
    outstanding.current -= 1;
    const title = titleText(operation.title);
    if (answer === 'refused') {
      dropped.current.push(title);
      setLooked((count) => count + 1);
    } else if (
      (answer === 'unsent' || answer === 'signedOut') &&
      openField.current !== operation.node
    ) {
      lost.current.push({ title, signedOut: answer === 'signedOut' });
    }
    if (outstanding.current === 0 && lost.current.length > 0) {
      onNotice(lostTitles(lost.current));
      lost.current = [];
    }
    return answer;
  };

  /**
   * Collapses a section, or expands it. Collapsing one over the chosen node chooses the section
   * instead, so the choice is never something the reader cannot see.
   */
  const toggle = (id: string) => {
    const collapsing = !collapsed.has(id);
    setCollapsed((before) => {
      const after = new Set(before);
      if (collapsing) after.add(id);
      else after.delete(id);
      return after;
    });
    if (collapsing && current !== null && ancestorsOf(nodes, current).includes(id)) {
      choose(id, true);
    }
  };

  const choose = (id: string, focus: boolean) => {
    setActive(id);
    setHighlighted(null);
    onSelected(id);
    if (focus) items.current.get(id)?.focus();
  };

  const openAdding = (kind: 'section' | 'component') => {
    setAdding({ kind, after: current });
    setNewTitle('');
    setAttempted(false);
    setChosen('');
    setConfirming(null);
  };

  /** Where an insert goes: after the node it was asked from, or at the end of the document. */
  const insertAt = (after: string | null) => {
    const place = after === null ? undefined : placeOf(nodes, after);
    return place
      ? { parent: place.parent?.id ?? null, position: place.index + 1 }
      : { parent: null, position: nodes.length };
  };

  const insert = async (node: Extract<OutlineOperation, { operation: 'insert' }>['node']) => {
    if (!adding || !may) return;
    const before = new Set(visibleOrder(nodes));
    const after = await onOperation({ operation: 'insert', ...insertAt(adding.after), node });
    if (typeof after === 'string') return;
    // The node the service allocated is the one the answer has and the outline before did not.
    const added = visibleOrder(after.nodes).find((id) => !before.has(id));
    setAdding(undefined);
    if (added !== undefined) {
      setActive(added);
      setHighlighted(null);
      onSelected(added);
      setFocusTarget(added);
    }
  };

  const cancelAdding = () => {
    const back = adding?.after ?? current;
    setAdding(undefined);
    if (back !== null) setFocusTarget(back);
  };

  const remove = async (id: string) => {
    const place = placeOf(nodes, id);
    setConfirming(null);
    if (!place || !may) return;
    // Where selection goes once the node has: the sibling before it, its parent, or what follows.
    const neighbour =
      place.siblings[place.index - 1]?.id ??
      place.parent?.id ??
      place.siblings[place.index + 1]?.id ??
      null;
    const after = await onOperation({ operation: 'remove', node: id });
    const focus = typeof after === 'string' ? id : neighbour;
    if (focus !== null) {
      setActive(focus);
      setHighlighted(null);
      onSelected(focus);
      setFocusTarget(focus);
    }
  };

  // A node chosen or linked from elsewhere - a move, an insert, an undo, an address - that a
  // collapsed section is hiding opens the sections over it, so what is chosen is always in view.
  useEffect(() => {
    const over = [current, highlighted]
      .flatMap((id) => (id === null ? [] : ancestorsOf(nodes, id)))
      .filter((id) => collapsed.has(id));
    if (over.length === 0) return;
    setCollapsed((before) => new Set([...before].filter((id) => !over.includes(id))));
  }, [current, highlighted, nodes, collapsed]);

  const onTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (current === null || event.ctrlKey || event.metaKey) return;
    const order = visibleOrder(nodes, collapsed);
    const index = order.indexOf(current);
    const place = placeOf(nodes, current);
    if (event.altKey) {
      const direction = (
        {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'promote',
          ArrowRight: 'demote',
        } as const
      )[event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'];
      if (direction === undefined) return;
      // Always taken, so Alt+Left never reaches the browser as Back while the tree has focus.
      event.preventDefault();
      if (!may) return;
      const move = keyMove(nodes, current, direction);
      if (move !== null) void send(move, current);
      else if (leavesTheTopLevel(nodes, current, direction)) onNotice(TOP_LEVEL_ONLY);
      else if (breaksFrontFirst(nodes, current, direction)) onNotice(FRONT_FIRST);
      return;
    }
    switch (event.key) {
      case 'ArrowDown': {
        const next = order[index + 1];
        if (next !== undefined) choose(next, true);
        break;
      }
      case 'ArrowUp': {
        const previous = order[index - 1];
        if (previous !== undefined) choose(previous, true);
        break;
      }
      // WAI-ARIA's tree: Right expands a collapsed section and otherwise goes to its first child;
      // Left collapses an expanded one and otherwise goes to its parent.
      case 'ArrowRight': {
        const child = place?.node.children[0];
        if (child && collapsed.has(current)) toggle(current);
        else if (child) choose(child.id, true);
        break;
      }
      case 'ArrowLeft':
        if (place && place.node.children.length > 0 && !collapsed.has(current)) toggle(current);
        else if (place?.parent) choose(place.parent.id, true);
        break;
      case 'Home': {
        const first = order[0];
        if (first !== undefined) choose(first, true);
        break;
      }
      case 'End': {
        const last = order[order.length - 1];
        if (last !== undefined) choose(last, true);
        break;
      }
      case 'Enter':
        if (may) openAdding('section');
        break;
      case 'Delete':
        if (may) setConfirming(current);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const undoKey =
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'z';
    // In a text field Ctrl+Z is the field's own undo, of what is being typed, and it is left alone.
    if (!undoKey || inTextField(event)) return;
    event.preventDefault();
    if (!may || !canUndo || !onUndo) return;
    const focus = event.target instanceof HTMLElement ? event.target.dataset.node : undefined;
    void onUndo().then(() => {
      if (focus !== undefined) setFocusTarget(focus);
    });
  };

  const onTreeClick = (event: MouseEvent<HTMLUListElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const id = item?.dataset.node;
    if (id !== undefined) choose(id, false);
  };

  /** Where a pointer is over, read off the element it is over; the row itself means "into". */
  const dropTargetOf = (element: EventTarget): DropTarget | undefined => {
    if (!(element instanceof HTMLElement)) return undefined;
    const marked = element.closest<HTMLElement>('[data-drop]');
    const [kind, id] = (marked?.dataset.drop ?? '').split(':');
    if (id === undefined || id === '') return undefined;
    if (kind === 'before') return { kind: 'before', node: id };
    if (kind === 'into') return { kind: 'into', node: id };
    return undefined;
  };

  const dropOnto = (event: DragEvent, target: DropTarget | undefined) => {
    if (dragging === null || target === undefined) return;
    event.preventDefault();
    setDragging(null);
    if (!may) return;
    const move = dropMove(nodes, dragging, target);
    if (move !== null) void send(move, null);
  };

  const allowDrop = (event: DragEvent, target: DropTarget | undefined) => {
    if (dragging === null || target === undefined || !may) return;
    if (dropMove(nodes, dragging, target) === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  const renderNodes = (list: readonly OutlineViewNode[], level: number) =>
    list.map((node, index) => {
      const labelId = `${prefix}-${node.id}`;
      const numberId = `${labelId}-number`;
      const shown = numbers.get(node.id);
      return (
        <li
          key={node.id}
          role="treeitem"
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={index + 1}
          aria-selected={node.id === current}
          aria-expanded={node.children.length > 0 ? !collapsed.has(node.id) : undefined}
          aria-labelledby={labelId}
          // The number describes the item rather than naming it: a name is what typing a title finds
          // in a tree, and what every announcement says, and it stays put when a move renumbers it.
          aria-describedby={shown === undefined ? undefined : numberId}
          tabIndex={node.id === current ? 0 : -1}
          data-node={node.id}
          draggable={may}
          ref={(element) => {
            if (element) items.current.set(node.id, element);
            else items.current.delete(node.id);
          }}
        >
          {dragging !== null && (
            <div data-drop={`before:${node.id}`} aria-hidden="true" style={{ height: '0.5em' }} />
          )}
          {/* The row is its own element, indented by its depth, so its hover and its selection
              fill the pane's width at every level rather than stopping where a list's padding does. */}
          <div
            className={styles['row']}
            data-row
            style={{ paddingInlineStart: `${8 + (level - 1) * 18}px` }}
          >
            {node.type === 'section' ? (
              // Pressed with a pointer; the keyboard's way is Left and Right. Not a button: a tree
              // item's own row holds nothing else that takes the focus.
              <span
                className={styles['glyph']}
                data-kind="section"
                {...(node.children.length > 0
                  ? {
                      'data-toggle': true,
                      'data-collapsed': collapsed.has(node.id),
                      onClick: () => toggle(node.id),
                    }
                  : {})}
              >
                {node.children.length > 0 && <Icon name="Section" size={10} />}
              </span>
            ) : (
              <span className={styles['glyph']} data-kind={node.type}>
                <Icon name="Document" size={13} />
              </span>
            )}
            {shown !== undefined && (
              <>
                <span id={numberId} className={styles['number']}>
                  {shown}
                </span>{' '}
              </>
            )}
            <span id={labelId} className={styles['label']} data-drop={`into:${node.id}`}>
              {node.id === highlighted ? (
                <mark>{nodeLabel(node, names)}</mark>
              ) : (
                nodeLabel(node, names)
              )}
            </span>
          </div>
          {node.children.length > 0 && !collapsed.has(node.id) && (
            <ul role="group" className={styles['group']}>
              {renderNodes(node.children, level + 1)}
            </ul>
          )}
        </li>
      );
    });

  const endTarget: DropTarget = { kind: 'end', parent: null };

  return (
    // Two parts, in the order they always had: the outline itself, and what is said of the node
    // chosen in it. The document page lays them out in columns of their own (interface slice 8).
    <>
      <div data-panel="outline" onKeyDown={onPanelKeyDown} inert={equating !== null}>
        <div data-part="outline">
          {head}
          <div
            className={styles['panel']}
            {...(tab ? { role: 'tabpanel', id: tab.panel, 'aria-labelledby': tab.tab } : {})}
          >
            {editable && (
              <div role="toolbar" aria-label="Outline" className={styles['toolbar']}>
                {/* Nothing here is disabled while an act is in flight, because a control that is disabled
              under the focus drops it to the page body in a real browser: each waits instead, and
              Undo says it has nothing to undo through aria-disabled, where it can keep the focus. */}
                {/* Icons, each still named in words - by `aria-label` for a screen reader and by
                `title` for a pointer - so the words move rather than going (interface slice 15). */}
                <button
                  type="button"
                  className={styles['act']}
                  aria-label="Add section"
                  title="Add section"
                  onClick={() => !busy && openAdding('section')}
                >
                  <Icon name="Add section" />
                </button>
                <button
                  type="button"
                  className={styles['act']}
                  aria-label="Add component"
                  title="Add component"
                  onClick={() => !busy && openAdding('component')}
                >
                  <Icon name="Add component" />
                </button>
                <span className={styles['divider']} aria-hidden="true" />
                <button
                  type="button"
                  className={styles['act']}
                  aria-label="Undo"
                  title="Undo"
                  aria-disabled={!canUndo}
                  onClick={() => {
                    if (!busy && canUndo) void onUndo?.();
                  }}
                >
                  <Icon name="Undo" />
                </button>
                <span className={styles['overline']} aria-hidden="true">
                  Outline
                </span>
              </div>
            )}
            {editable && adding?.kind === 'section' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = newTitle.trim();
                  if (!hasText(text)) {
                    setAttempted(true);
                    return;
                  }
                  void insert({ type: 'section', title: sectionTitle(text) });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') cancelAdding();
                }}
              >
                <label>
                  New section title
                  {/* Focus goes where the author asked to type: they opened this form themselves. */}
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                  />
                </label>
                {/* Said about the field as it stands, so it goes the moment the field is fine. */}
                {attempted && !hasText(newTitle) && <p>A section needs a title.</p>}
                <button type="submit">Add</button>
                <button type="button" onClick={cancelAdding}>
                  Cancel
                </button>
              </form>
            )}
            {editable && adding?.kind === 'component' && (
              <ComponentChooser
                components={components}
                chosen={chosen}
                onChoose={setChosen}
                onAdd={(component) =>
                  void insert({ type: 'reference', component, mode: { kind: 'latest' } })
                }
                onCancel={cancelAdding}
                onReload={onReloadComponents}
              />
            )}
            {root}
            {/* Not shown, and still what the tree is described by: a screen reader hears how to move,
            and a pointer finds the acts by their tooltips (interface slice 15). */}
            <p id={`${prefix}-keys`} className={styles['hidden']}>
              {editable ? KEYS : 'Move between items with the arrow keys.'}
            </p>
            {nodes.length === 0 ? (
              <p>This document has no sections yet.</p>
            ) : (
              <ul
                role="tree"
                className={styles['tree']}
                aria-label="Outline"
                aria-describedby={`${prefix}-keys`}
                aria-busy={busy}
                onKeyDown={onTreeKeyDown}
                onClick={onTreeClick}
                onDragStart={(event) => {
                  const item = (event.target as HTMLElement).closest<HTMLElement>(
                    '[role="treeitem"]',
                  );
                  const id = item?.dataset.node;
                  if (!may || id === undefined) return;
                  // A tick later, not now: the drop places this renders change the page under the drag,
                  // and Chromium ends a drag whose source changes in the same task it started in.
                  clearTimeout(dragTimer.current);
                  dragTimer.current = setTimeout(() => setDragging(id), 0);
                  // Firefox starts no drag without data; the node's identifier is what is being moved.
                  event.dataTransfer?.setData('text/plain', id);
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => allowDrop(event, dropTargetOf(event.target))}
                onDrop={(event) => dropOnto(event, dropTargetOf(event.target))}
                onDragEnd={() => {
                  clearTimeout(dragTimer.current);
                  setDragging(null);
                }}
              >
                {renderNodes(nodes, 1)}
              </ul>
            )}
            {dragging !== null && (
              <p
                onDragOver={(event) => allowDrop(event, endTarget)}
                onDrop={(event) => dropOnto(event, endTarget)}
              >
                Move to the end of the document
              </p>
            )}
          </div>
        </div>
        <div data-part="details">
          {editable && selected && confirming === null && (
            <NodeDetails
              key={selected.id}
              node={selected}
              topLevel={placeOf(nodes, selected.id)?.parent === null}
              frontOffered={mayBeFront(nodes, selected.id)}
              frontAfter={frontAfter(nodes, selected.id)}
              unnumberedAbove={unnumberedAncestor(nodes, selected.id)}
              names={names}
              busy={busy}
              onOperation={(operation) => send(operation, null)}
              onRetitle={retitle}
              openField={openField}
              onNotice={onNotice}
              onRemove={() => setConfirming(selected.id)}
              language={outline.language}
              direction={outline.direction}
              onEquation={askEquation}
            />
          )}
          {editable && confirming !== null && (
            <ConfirmRemoval
              node={placeOf(nodes, confirming)?.node}
              names={names}
              onRemove={() => void remove(confirming)}
              onKeep={() => {
                setConfirming(null);
                setFocusTarget(confirming);
              }}
            />
          )}
          {selected && linkOf && confirming === null && (
            <NodeLink
              address={linkOf(selected.id)}
              name={nodeName(selected, names)}
              onNotice={onNotice}
            />
          )}
        </div>
      </div>
      {equating !== null &&
        // Beside the panel rather than inside it, because the panel is what it makes inert, and so that
        // a key pressed in it never reaches the panel's own undo.
        createPortal(
          <Suspense fallback={null}>
            <EquationDialog
              current={equating.current}
              // A title is one line: an equation stands in it inline, and a block has nowhere to go.
              blockPlaceable={false}
              // The document's language, which a section's title is written in: no section carries a
              // language of its own in the outline, so there is none to prefer to it.
              language={outline.language}
              onDone={(choice) => {
                const said = equating.place(choice);
                if (said === null) setEquating(null);
                return said;
              }}
              onCancel={() => setEquating(null)}
            />
          </Suspense>,
          document.body,
        )}
    </>
  );
}

/**
 * The selected node's shareable address (STR-044), for everybody who may read the document: in a field
 * that can be selected and copied by hand, and a button that copies it - the one way to share it from
 * the desktop app, which has no address bar.
 */
function NodeLink({
  address,
  name,
  onNotice,
}: {
  address: string;
  name: string;
  onNotice: (message: string | null) => void;
}) {
  return (
    <p>
      <label>
        Link to {name}
        <input readOnly value={address} onFocus={(event) => event.target.select()} />
      </label>{' '}
      <button
        type="button"
        onClick={() => {
          const copying = navigator.clipboard?.writeText(address);
          if (!copying) {
            onNotice('The link could not be copied. Select it and copy it instead.');
            return;
          }
          copying.then(
            () => onNotice(`Copied the link to ${name}.`),
            () => onNotice('The link could not be copied. Select it and copy it instead.'),
          );
        }}
      >
        Copy link
      </button>
    </p>
  );
}

function ComponentChooser({
  components,
  chosen,
  onChoose,
  onAdd,
  onCancel,
  onReload,
}: {
  components: ComponentChoices;
  chosen: string;
  onChoose: (id: string) => void;
  onAdd: (id: string) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  if (components.state === 'loading') return <p>Reading the components you may add...</p>;
  if (components.state === 'failed') {
    return components.signedOut ? (
      <p>You are signed out. Sign in again to add a component.</p>
    ) : (
      <>
        <p>The components you may add could not be loaded.</p>
        <button type="button" onClick={onReload}>
          Try again
        </button>
      </>
    );
  }
  const first = components.items[0];
  if (first === undefined) return <p>There are no components you may add.</p>;
  const value = components.items.some((each) => each.id === chosen) ? chosen : first.id;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <label>
        Component
        <select value={value} onChange={(event) => onChoose(event.target.value)}>
          {components.items.map((each) => (
            <option key={each.id} value={each.id}>
              {each.title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Add</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/**
 * A removal has no inverse (`tree.ts`, `inverseOf`), and it empties the undo stack, because every entry
 * beneath it was computed against an outline that still held what it took - so the question says both.
 */
const IRREVERSIBLE = 'This cannot be undone, and nothing before it can be undone afterwards.';

function ConfirmRemoval({
  node,
  names,
  onRemove,
  onKeep,
}: {
  node: OutlineViewNode | undefined;
  names: Names;
  onRemove: () => void;
  onKeep: () => void;
}) {
  if (!node) return null;
  const name = nodeName(node, names);
  return (
    <div
      role="group"
      aria-label="Confirm removal"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onKeep();
      }}
    >
      <p>
        {node.children.length > 0
          ? `Remove ${name} and everything beneath it? ${IRREVERSIBLE}`
          : `Remove ${name}? ${IRREVERSIBLE}`}
      </p>
      {/* Focus goes to the question the author has just asked to be put. */}
      <button type="button" autoFocus onClick={onRemove}>
        Remove
      </button>
      <button type="button" onClick={onKeep}>
        Keep
      </button>
    </div>
  );
}

/**
 * What a section title field shows and what the outline held when it last heard: the same
 * reconciliation `ComponentHeader` uses, by value and never by counting renders, so StrictMode's second
 * pass cannot eat a keystroke and an unrelated re-render cannot revert a field being typed.
 *
 * **Titles, compared by their canonical form** (equations 3, ruling R2): a title may hold an equation,
 * and its words are then only the equation's alternative, which two different equations can share -
 * so "the same title" is `canonicaliseTitle`'s answer, the form the outline's digest takes, and never
 * a comparison of words. `typed` is what the field's editor holds, mirrored as it changes; setting it
 * to anything else puts that into the editor.
 */
interface Field {
  readonly typed: Title;
  readonly inModel: Title;
  /**
   * The canonical form of every title this field has sent and not yet heard back about, oldest first.
   * A second commit can be made while the first is still in flight, and either coming back is this
   * field's own.
   */
  readonly sent: readonly string[];
}

function NodeDetails({
  node,
  topLevel,
  frontOffered,
  frontAfter,
  unnumberedAbove,
  names,
  busy,
  onOperation,
  onRetitle,
  openField,
  onNotice,
  onRemove,
  language,
  direction,
  onEquation,
}: {
  node: OutlineViewNode;
  /** Whether the node is at the top level, the only place `matter` may be set (STR-016). */
  topLevel: boolean;
  /** Whether **Front matter** is one of the node's choices: what `mayBeFront` says (STR-064). */
  frontOffered: boolean;
  /**
   * The front node after this one, beneath which its matter cannot change at all: what `frontAfter`
   * says (STR-064). Only a front node ever has one.
   */
  frontAfter: OutlineViewNode | undefined;
  /** The nearest ancestor not numbered, beneath which this node takes no number whatever it says. */
  unnumberedAbove: OutlineViewNode | undefined;
  names: Names;
  busy: boolean;
  onOperation: (operation: OutlineOperation) => Promise<Answered>;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
  onRemove: () => void;
  /** The document's language and direction, which a section's title is written in. */
  language: string;
  direction: 'ltr' | 'rtl';
  /** Opens the Equation dialog for the title field (equations 3, ruling R3). */
  onEquation: (request: EquationRequest) => void;
}) {
  const hintId = useId();
  const matterHintId = useId();
  // Ticked, and still without a number: said beside the box, so the tick does not look ignored.
  const hint =
    node.numbered && unnumberedAbove !== undefined
      ? `Not numbered while ${nodeName(unnumberedAbove, names)} is not.`
      : null;
  // Front matter with front matter after it: every other matter would strand that one after this
  // one, which the outline's parse refuses, so there is nothing this select can be given. Said
  // beside it and the select disabled, the shape the Numbered box's hint follows, rather than a
  // select of one option, which reads as a control that has broken.
  const matterHint =
    frontAfter === undefined
      ? null
      : `Front matter comes first, so this cannot leave while ${nodeName(frontAfter, names)} is front matter.`;
  return (
    <div>
      {node.type === 'section' && (
        <TitleField
          node={node}
          onRetitle={onRetitle}
          openField={openField}
          onNotice={onNotice}
          language={language}
          direction={direction}
          onEquation={onEquation}
        />
      )}
      <label>
        Starts on
        <select
          value={node.pageBreak}
          onChange={(event) => {
            // Left enabled while an act is in flight, so it keeps the focus; a choice made then is
            // not sent, and the select, being controlled, goes on showing what the node holds.
            const pageBreak = event.target.value;
            if (busy || !isPageBreak(pageBreak) || pageBreak === node.pageBreak) return;
            void onOperation({ operation: 'set', node: node.id, pageBreak });
          }}
        >
          {PAGE_BREAKS.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      {/* Controlled, and left enabled while an act is in flight, as the select above is: a change
          made then is not sent, and the box goes on showing what the node holds. Each sends the one
          switch it is, and never `values`, which must stay empty. */}
      <label>
        <input
          type="checkbox"
          checked={node.numbered}
          aria-describedby={hint === null ? undefined : hintId}
          onChange={(event) => {
            if (busy) return;
            void onOperation({ operation: 'set', node: node.id, numbered: event.target.checked });
          }}
        />
        Numbered
      </label>
      {hint !== null && <span id={hintId}>{hint}</span>}
      {/* Offered at the top level alone: below it a node's matter is its top-level ancestor's, and
          the outline's parse refuses one set anywhere else. **Front matter** is left out where the
          parse would refuse it, so only what can be chosen is offered - a node already in front
          matter keeps it whatever `mayBeFront` says, or the select would show a value it has no
          option for. Where no matter at all can be chosen the select is disabled with its reason
          beside it, since the parse would refuse every other one. Left enabled while an act is in
          flight, as the select above is. */}
      {topLevel && (
        <>
          <label>
            Matter
            <select
              value={node.matter}
              disabled={matterHint !== null}
              aria-describedby={matterHint === null ? undefined : matterHintId}
              onChange={(event) => {
                const matter = event.target.value;
                if (busy || !isMatter(matter) || matter === node.matter) return;
                void onOperation({ operation: 'set', node: node.id, matter });
              }}
            >
              {MATTERS.filter(
                (each) => each.value !== 'front' || frontOffered || node.matter === 'front',
              ).map((each) => (
                <option key={each.value} value={each.value}>
                  {each.label}
                </option>
              ))}
            </select>
          </label>
          {matterHint !== null && <span id={matterHintId}>{matterHint}</span>}
        </>
      )}
      <button type="button" onClick={() => !busy && onRemove()}>
        {node.type === 'section' ? 'Remove section' : 'Remove component'}
      </button>
    </div>
  );
}

/** `sent` with the first occurrence of `key` taken out: the one commit that will not come back. */
function withoutFirst(sent: readonly string[], key: string): readonly string[] {
  const at = sent.indexOf(key);
  return at < 0 ? sent : [...sent.slice(0, at), ...sent.slice(at + 1)];
}

/**
 * Why a title is not changed here, in the words of what it holds that the field cannot keep: a
 * cross-reference, a footnote, formatting, or - an image, a variable - anything else.
 */
function heldBack(title: Title): string {
  if (title.some((run) => run.type === 'crossReference')) {
    return 'This title holds a cross-reference, so it is not changed here.';
  }
  if (title.some((run) => run.type === 'footnote')) {
    return 'This title holds a footnote, so it is not changed here.';
  }
  if (title.some((run) => run.type === 'text' && run.marks.length > 0)) {
    return 'This title has formatting this field cannot keep, so it is not changed here.';
  }
  return 'This title holds something this field cannot keep, so it is not changed here.';
}

/** The words a title's text runs hold, joined: what the store's `hasText` asks of a title. */
const wordsOf = (title: Title) =>
  title.map((run) => (run.type === 'text' ? run.value : '')).join('');

/**
 * **A section's title field** (equations 3, rulings R1 to R3): the title editor from
 * `packages/editor`, one line of words and inline equations, for a title holding only those; a title
 * holding a mark or a cross-reference keeps a read-only field and a sentence saying what it holds,
 * because an edit here would quietly drop it.
 *
 * The retitle state machine is the one a plain text field had, by canonical title rather than by
 * text: what was typed, what the outline held when the field last heard, and what it has sent - so a
 * retitle in flight, a refusal, an undo and another author's title behave as they always did, an
 * equation included. **Equation** beside it, and `Mod-Shift-E` or `Enter` on an equation in it, open
 * the Equation dialog for the title; placing one commits the title as it then stands.
 */
function TitleField({
  node,
  onRetitle,
  openField,
  onNotice,
  language,
  direction,
  onEquation,
}: {
  node: SectionViewNode;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
  language: string;
  direction: 'ltr' | 'rtl';
  onEquation: (request: EquationRequest) => void;
}) {
  // Says which section's field is open, for as long as it is: written in an effect, never in render.
  useEffect(() => {
    openField.current = node.id;
    return () => {
      if (openField.current === node.id) openField.current = null;
    };
  }, [openField, node.id]);

  const editable = titleToEditor(node.title) !== null;
  const inModel = canonicaliseTitle(node.title);
  const [field, setField] = useState<Field>({ typed: node.title, inModel: node.title, sent: [] });

  // State derived from a prop, adjusted during render the way React documents it: a second render
  // pass reads what the first set, and the comparison is by value, so it settles at once. Nothing
  // happens unless the outline's title differs from what the field last heard, so a re-render for
  // any other reason - another act answered while the author is typing here - leaves the field alone.
  // When it does differ, any of the field's own retitles coming back keeps what has been typed since
  // (and the ones sent after it are still to come); anything else - an undo, somebody else's title -
  // gives way to the outline.
  if (inModel !== canonicaliseTitle(field.inModel)) {
    const at = field.sent.indexOf(inModel);
    setField(
      at >= 0
        ? { typed: field.typed, inModel: node.title, sent: field.sent.slice(at + 1) }
        : { typed: node.title, inModel: node.title, sent: [] },
    );
  }

  const place = useRef<HTMLDivElement | null>(null);
  const editor = useRef<TitleEditor | null>(null);
  // The field is asking for its dialog: the focus leaving it for the dialog is not the author leaving
  // the title, so it commits nothing until the dialog places an equation or is closed.
  const asking = useRef(false);
  // Read by the editor's keys, which are bound once as it mounts: always this render's.
  const typed = useRef(field.typed);
  typed.current = field.typed;
  const commitNow = useRef(() => {});
  const promptNow = useRef(() => {});

  // The editor, mounted into its place as the field appears and destroyed as it goes: a layout effect,
  // so the field is there in the same commit as the details around it, as a text input was.
  useLayoutEffect(() => {
    const host = place.current;
    if (!editable || host === null) return undefined;
    const mounted = mountTitleEditor(host, {
      title: typed.current,
      label: 'Title',
      language,
      direction,
      onChange: (title) => setField((previous) => ({ ...previous, typed: title })),
      onCommit: () => commitNow.current(),
      onPromptEquation: () => promptNow.current(),
    });
    editor.current = mounted;
    return () => {
      editor.current = null;
      mounted.destroy();
    };
  }, [editable, language, direction]);

  // The field given way to the outline, or put back after a refusal: what it now says it holds is put
  // into the editor. Typing reaches here too, and changes nothing, because the editor already holds it.
  useLayoutEffect(() => {
    const mounted = editor.current;
    if (mounted === null) return;
    if (canonicaliseTitle(mounted.read()) !== canonicaliseTitle(field.typed)) {
      mounted.replace(field.typed);
    }
  }, [field.typed]);

  if (!editable) {
    return (
      <>
        <label>
          Title
          <input value={titleText(node.title)} disabled />
        </label>
        <p>{heldBack(node.title)}</p>
      </>
    );
  }

  // Committed whether or not another act is in flight: `onRetitle` holds it until that act is
  // answered, so nothing typed is dropped because the author pressed Enter, or left, too soon. Read
  // from the editor rather than from `typed`, which an equation placed a moment ago has not reached.
  const commit = () => {
    const title = trimTitle(editor.current?.read() ?? field.typed);
    // The store's own rule (`hasText`), asked here so the field refuses exactly what the store would.
    if (!hasText(wordsOf(title))) {
      if (title.some((run) => run.type === 'equation')) {
        // An equation is not a title on its own - a title also names its section wherever a name
        // must be words - but it is the author's, so it is kept for them to write words beside.
        onNotice("A section's title needs words as well as an equation.");
        return;
      }
      // Nothing was sent, so the outline never changed and the comparison above never resyncs this
      // field by itself: it is put back here, or it would sit empty beside a tree showing the title.
      onNotice('A section needs a title.');
      setField({ typed: node.title, inModel: node.title, sent: [] });
      return;
    }
    const key = canonicaliseTitle(title);
    // Nothing new: the outline holds it, or it is the title this field sent last and is still waiting
    // on - the blur that follows an Enter - so it is not committed a second time.
    if (key === inModel || key === field.sent[field.sent.length - 1]) return;
    setField((previous) => ({ ...previous, sent: [...previous.sent, key] }));
    void onRetitle({ operation: 'retitle', node: node.id, title }).then((answer) => {
      if (answer === 'refused') {
        // The page now shows an outline other than the one this title was typed against, and has
        // said so. The field gives way to it, rather than holding the refused title for the next
        // blur to send again as an act nobody chose a second time.
        setField((previous) => ({
          typed: previous.inModel,
          inModel: previous.inModel,
          sent: [],
        }));
      } else if (answer === 'unsent' || answer === 'signedOut' || answer === 'superseded') {
        // Nothing changed and nothing was recorded - or a later commit took its place - so it will
        // not come back: the title stays, and after a failure the author's next Enter or blur is the
        // retry the page asks for.
        setField((previous) => ({ ...previous, sent: withoutFirst(previous.sent, key) }));
      }
    });
  };
  commitNow.current = commit;

  // The dialog for the title: on the equation selected whole in it, or for a new one at the caret.
  // Placing it commits the title as it then stands, which is the one act the author asked for.
  const openEquation = () => {
    const mounted = editor.current;
    if (mounted === null) return;
    asking.current = true;
    const current = mounted.equationAt();
    onEquation({
      current,
      place: (choice) => {
        const into = editor.current;
        if (into === null) {
          return 'This title can no longer be changed here, so the equation was not placed.';
        }
        const placed =
          current === null ? into.insertEquation(choice) : into.changeEquation(current.pos, choice);
        if (!placed) {
          return current === null
            ? 'An equation cannot be placed where the cursor is.'
            : 'That equation is not there any more.';
        }
        asking.current = false;
        // This render's commit, not the one the dialog was opened from: an answer to an earlier
        // retitle may have arrived while the dialog stood, and what was sent is read from the latest.
        commitNow.current();
        return null;
      },
    });
  };
  promptNow.current = openEquation;

  // The field and its button are one place to the author: the focus moving between them is not
  // leaving the title, and leaving both is, as leaving a text input was. The focus leaving for the
  // title's own dialog is not either: placing an equation commits, and cancelling comes back here.
  return (
    <div
      className={styles['title']}
      onFocus={() => {
        asking.current = false;
      }}
      onBlur={(event) => {
        if (asking.current || event.currentTarget.contains(event.relatedTarget)) return;
        commit();
      }}
    >
      <span className={styles['titleLabel']} aria-hidden="true">
        Title
      </span>
      <div ref={place} className={styles['titleField']} />
      <button
        type="button"
        aria-haspopup="dialog"
        // The caret stays in the title, where the equation goes, as a toolbar's button leaves it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={openEquation}
      >
        Equation
      </button>
    </div>
  );
}
