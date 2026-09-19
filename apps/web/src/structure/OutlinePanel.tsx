import {
  conditions,
  defaultNumberingScheme,
  hasText,
  number,
  resolve,
  sectionNumbers,
  type Contribution,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
  type SectionViewNode,
} from '@alloy-works/domain';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import {
  dropMove,
  keyMove,
  nestsAnAppendix,
  nodeLabel,
  nodeName,
  placeOf,
  plainTitle,
  sectionTitle,
  titleText,
  visibleOrder,
  type DropTarget,
  type Names,
} from './tree.js';

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
  /** Whether the caller may restructure the outline at all; a reader is offered nothing to change. */
  readonly editable: boolean;
  /** An operation is in flight: everything that would send another waits for it. */
  readonly busy?: boolean;
  /**
   * Sends one structural act, answering what it came to (`Answered`). The page owns what happens
   * next - the version, the undo stack, what is announced.
   */
  readonly onOperation: (operation: OutlineOperation) => Promise<Answered>;
  /** The one status sentence, announced through the panel's `role="status"` region. */
  readonly notice: string | null;
  /** Says something through that same region: a field refused before anything was sent. */
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
    (target instanceof HTMLInputElement && !UNTYPED_INPUTS.has(target.type))
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
  // The node a link took the reader to, marked until they choose another (STR-045's panel half).
  const [highlighted, setHighlighted] = useState<string | null>(null);
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
      sectionNumbers(number(conditions(resolve(outline, NOTHING_KNOWN)), defaultNumberingScheme)),
    [outline],
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
      if (plainTitle(node.title) === titleText(waiting.operation.title)) {
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

  const onTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (current === null || event.ctrlKey || event.metaKey) return;
    const order = visibleOrder(nodes);
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
      else if (nestsAnAppendix(nodes, current, direction)) {
        onNotice('An appendix stays at the top level.');
      }
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
      case 'ArrowRight': {
        const child = place?.node.children[0];
        if (child) choose(child.id, true);
        break;
      }
      case 'ArrowLeft':
        if (place?.parent) choose(place.parent.id, true);
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
          aria-expanded={node.children.length > 0 ? true : undefined}
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
          {shown !== undefined && (
            <>
              <span id={numberId}>{shown}</span>{' '}
            </>
          )}
          <span id={labelId} data-drop={`into:${node.id}`}>
            {node.id === highlighted ? (
              <mark>{nodeLabel(node, names)}</mark>
            ) : (
              nodeLabel(node, names)
            )}
          </span>
          {node.children.length > 0 && (
            <ul role="group">{renderNodes(node.children, level + 1)}</ul>
          )}
        </li>
      );
    });

  const endTarget: DropTarget = { kind: 'end', parent: null };

  return (
    <div onKeyDown={onPanelKeyDown}>
      {editable && (
        <div role="toolbar" aria-label="Outline">
          {/* Nothing here is disabled while an act is in flight, because a control that is disabled
              under the focus drops it to the page body in a real browser: each waits instead, and
              Undo says it has nothing to undo through aria-disabled, where it can keep the focus. */}
          <button type="button" onClick={() => !busy && openAdding('section')}>
            Add section
          </button>
          <button type="button" onClick={() => !busy && openAdding('component')}>
            Add component
          </button>
          <button
            type="button"
            aria-disabled={!canUndo}
            onClick={() => {
              if (!busy && canUndo) void onUndo?.();
            }}
          >
            Undo
          </button>
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
      <p id={`${prefix}-keys`}>{editable ? KEYS : 'Move between items with the arrow keys.'}</p>
      {nodes.length === 0 ? (
        <p>This document has no sections yet.</p>
      ) : (
        <ul
          role="tree"
          aria-label="Outline"
          aria-describedby={`${prefix}-keys`}
          aria-busy={busy}
          onKeyDown={onTreeKeyDown}
          onClick={onTreeClick}
          onDragStart={(event) => {
            const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
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
      {editable && selected && confirming === null && (
        <NodeDetails
          key={selected.id}
          node={selected}
          topLevel={placeOf(nodes, selected.id)?.parent === null}
          unnumberedAbove={unnumberedAncestor(nodes, selected.id)}
          names={names}
          busy={busy}
          onOperation={(operation) => send(operation, null)}
          onRetitle={retitle}
          openField={openField}
          onNotice={onNotice}
          onRemove={() => setConfirming(selected.id)}
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
      <p role="status">{notice}</p>
    </div>
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
 */
interface Field {
  readonly typed: string;
  readonly inModel: string;
  /**
   * Every title this field has sent and not yet heard back about, oldest first. A second commit can
   * be made while the first is still in flight, and either coming back is this field's own.
   */
  readonly sent: readonly string[];
}

function NodeDetails({
  node,
  topLevel,
  unnumberedAbove,
  names,
  busy,
  onOperation,
  onRetitle,
  openField,
  onNotice,
  onRemove,
}: {
  node: OutlineViewNode;
  /** Whether the node is at the top level, the only place `matter` may be set (STR-016). */
  topLevel: boolean;
  /** The nearest ancestor not numbered, beneath which this node takes no number whatever it says. */
  unnumberedAbove: OutlineViewNode | undefined;
  names: Names;
  busy: boolean;
  onOperation: (operation: OutlineOperation) => Promise<Answered>;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
  onRemove: () => void;
}) {
  const hintId = useId();
  // Ticked, and still without a number: said beside the box, so the tick does not look ignored.
  const hint =
    node.numbered && unnumberedAbove !== undefined
      ? `Not numbered while ${nodeName(unnumberedAbove, names)} is not.`
      : null;
  return (
    <div>
      {node.type === 'section' && (
        <TitleField node={node} onRetitle={onRetitle} openField={openField} onNotice={onNotice} />
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
          the outline's parse refuses one set anywhere else. */}
      {topLevel && (
        <label>
          <input
            type="checkbox"
            checked={node.matter === 'appendix'}
            onChange={(event) => {
              if (busy) return;
              const matter = event.target.checked ? 'appendix' : 'body';
              void onOperation({ operation: 'set', node: node.id, matter });
            }}
          />
          Appendix
        </label>
      )}
      <button type="button" onClick={() => !busy && onRemove()}>
        {node.type === 'section' ? 'Remove section' : 'Remove component'}
      </button>
    </div>
  );
}

/** `sent` with the first occurrence of `text` taken out: the one commit that will not come back. */
function withoutFirst(sent: readonly string[], text: string): readonly string[] {
  const at = sent.indexOf(text);
  return at < 0 ? sent : [...sent.slice(0, at), ...sent.slice(at + 1)];
}

function TitleField({
  node,
  onRetitle,
  openField,
  onNotice,
}: {
  node: SectionViewNode;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
}) {
  // Says which section's field is open, for as long as it is: written in an effect, never in render.
  useEffect(() => {
    openField.current = node.id;
    return () => {
      if (openField.current === node.id) openField.current = null;
    };
  }, [openField, node.id]);

  const plain = plainTitle(node.title);
  const inModel = plain ?? titleText(node.title);
  const [field, setField] = useState<Field>({ typed: inModel, inModel, sent: [] });

  // State derived from a prop, adjusted during render the way React documents it: a second render
  // pass reads what the first set, and the comparison is by value, so it settles at once. Nothing
  // happens unless the outline's title differs from what the field last heard, so a re-render for
  // any other reason - another act answered while the author is typing here - leaves the field alone.
  // When it does differ, any of the field's own retitles coming back keeps what has been typed since
  // (and the ones sent after it are still to come); anything else - an undo, somebody else's title -
  // gives way to the outline.
  if (inModel !== field.inModel) {
    const at = field.sent.indexOf(inModel);
    setField(
      at >= 0
        ? { typed: field.typed, inModel, sent: field.sent.slice(at + 1) }
        : { typed: inModel, inModel, sent: [] },
    );
  }

  if (plain === null) {
    return (
      <>
        <label>
          Title
          <input value={inModel} disabled />
        </label>
        <p>This title has formatting a plain field cannot keep, so it is not changed here.</p>
      </>
    );
  }

  // Committed whether or not another act is in flight: `onRetitle` holds it until that act is
  // answered, so nothing typed is dropped because the author pressed Enter, or left, too soon.
  const commit = () => {
    const text = field.typed.trim();
    // The store's own rule (`hasText`), asked here so the field refuses exactly what the store would.
    if (!hasText(text)) {
      // Nothing was sent, so the outline never changed and the comparison above never resyncs this
      // field by itself: it is put back here, or it would sit empty beside a tree showing the title.
      onNotice('A section needs a title.');
      setField({ typed: inModel, inModel, sent: [] });
      return;
    }
    // Nothing new: the outline holds it, or it is the text this field sent last and is still waiting
    // on - the blur that follows an Enter - so it is not committed a second time.
    if (text === inModel || text === field.sent[field.sent.length - 1]) return;
    setField((previous) => ({ ...previous, sent: [...previous.sent, text] }));
    void onRetitle({ operation: 'retitle', node: node.id, title: sectionTitle(text) }).then(
      (answer) => {
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
          // not come back: the text stays, and after a failure the author's next Enter or blur is the
          // retry the page asks for.
          setField((previous) => ({ ...previous, sent: withoutFirst(previous.sent, text) }));
        }
      },
    );
  };

  return (
    <label>
      Title
      <input
        value={field.typed}
        onChange={(event) => {
          const typed = event.target.value;
          setField((previous) => ({ ...previous, typed }));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </label>
  );
}
