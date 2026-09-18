import type {
  OutlineDocument,
  OutlineNode,
  OutlineOperation,
  SectionNode,
} from '@alloy-works/domain';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import {
  dropMove,
  keyMove,
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
 * or unreadable), so whatever was being edited gives way to it; or `'unsent'`, where nothing changed
 * and nothing was recorded (signed out, a server error, no answer), so what was typed is kept for the
 * retry the page's notice asks for.
 */
export type Answered = OutlineDocument | 'refused' | 'unsent';

type RetitleOperation = Extract<OutlineOperation, { operation: 'retitle' }>;

export interface OutlinePanelProps {
  readonly outline: OutlineDocument;
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
  /** Names a reference by its component's title; `null` until the components have been read. */
  readonly names?: Names;
  readonly components?: ComponentChoices;
  readonly onReloadComponents?: () => void;
}

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

function isPageBreak(value: string): value is OutlineNode['pageBreak'] {
  return PAGE_BREAKS.some((each) => each.value === value);
}

/** Whether a key event came from somewhere text is typed, where the key is the field's own. */
function inField(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
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
  names = null,
  components = { state: 'loading' },
  onReloadComponents = () => {},
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
  const dragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(dragTimer.current), []);
  // A retitle committed while another act was in flight - Enter, or leaving the field, which may take
  // the field away with it - held here rather than dropped, and sent once that act is answered.
  const held = useRef<{
    readonly operation: RetitleOperation;
    readonly resolve: (answer: Answered) => void;
  } | null>(null);

  // The selected node, derived rather than stored: the one chosen if it is still in the outline, the
  // first node otherwise - so a node removed, or an outline somebody else changed, never leaves the
  // tree without its one tab stop.
  const current = active !== null && placeOf(nodes, active) ? active : (nodes[0]?.id ?? null);
  const selected = current === null ? undefined : placeOf(nodes, current)?.node;
  const may = editable && !busy;

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

  // After every render, so the one where `busy` clears sends what was held - from that render's
  // outline and `onOperation`, which is to say from the version the act in flight made.
  useEffect(() => {
    const waiting = held.current;
    if (busy || waiting === null) return;
    held.current = null;
    const node = placeOf(nodes, waiting.operation.node)?.node;
    if (!editable || node?.type !== 'section') {
      waiting.resolve('refused');
      return;
    }
    if (plainTitle(node.title) === titleText(waiting.operation.title)) {
      waiting.resolve(outline);
      return;
    }
    void onOperation(waiting.operation).then(waiting.resolve);
  });

  /** A retitle now, or once the act in flight is answered. */
  const retitle = (operation: RetitleOperation): Promise<Answered> => {
    if (!busy) return send(operation, null);
    return new Promise((resolve) => {
      // A newer commit from the same author supersedes one still waiting; the older one is kept by
      // its field, not refused.
      held.current?.resolve('unsent');
      held.current = { operation, resolve };
    });
  };

  const choose = (id: string, focus: boolean) => {
    setActive(id);
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
    if (!undoKey || inField(event)) return;
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

  const renderNodes = (list: readonly OutlineNode[], level: number) =>
    list.map((node, index) => {
      const labelId = `${prefix}-${node.id}`;
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
          <span id={labelId} data-drop={`into:${node.id}`}>
            {nodeLabel(node, names)}
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
            if (text === '') {
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
          {attempted && newTitle.trim() === '' && <p>A section needs a title.</p>}
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
          busy={busy}
          onOperation={(operation) => send(operation, null)}
          onRetitle={retitle}
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
      <p role="status">{notice}</p>
    </div>
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
  node: OutlineNode | undefined;
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
  /** The title this field last sent and has not yet heard back about, or `null`. */
  readonly sent: string | null;
}

function NodeDetails({
  node,
  busy,
  onOperation,
  onRetitle,
  onNotice,
  onRemove,
}: {
  node: OutlineNode;
  busy: boolean;
  onOperation: (operation: OutlineOperation) => Promise<Answered>;
  onRetitle: (operation: RetitleOperation) => Promise<Answered>;
  onNotice: (message: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      {node.type === 'section' && (
        <TitleField node={node} onRetitle={onRetitle} onNotice={onNotice} />
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
      <button type="button" onClick={() => !busy && onRemove()}>
        {node.type === 'section' ? 'Remove section' : 'Remove component'}
      </button>
    </div>
  );
}

function TitleField({
  node,
  onRetitle,
  onNotice,
}: {
  node: SectionNode;
  onRetitle: (operation: RetitleOperation) => Promise<Answered>;
  onNotice: (message: string | null) => void;
}) {
  const plain = plainTitle(node.title);
  const inModel = plain ?? titleText(node.title);
  const [field, setField] = useState<Field>({ typed: inModel, inModel, sent: null });

  // State derived from a prop, adjusted during render the way React documents it: a second render
  // pass reads what the first set, and the comparison is by value, so it settles at once. Nothing
  // happens unless the outline's title differs from what the field last heard, so a re-render for
  // any other reason - another act answered while the author is typing here - leaves the field alone.
  // When it does differ, the field's own retitle coming back keeps what has been typed since it was
  // sent; anything else - an undo, somebody else's title - gives way to the outline.
  if (inModel !== field.inModel) {
    setField(
      inModel === field.sent
        ? { typed: field.typed, inModel, sent: null }
        : { typed: inModel, inModel, sent: null },
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
    if (text === '') {
      // Nothing was sent, so the outline never changed and the comparison above never resyncs this
      // field by itself: it is put back here, or it would sit empty beside a tree showing the title.
      onNotice('A section needs a title.');
      setField({ typed: inModel, inModel, sent: null });
      return;
    }
    if (text === inModel) return;
    setField((previous) => ({ ...previous, sent: text }));
    void onRetitle({ operation: 'retitle', node: node.id, title: sectionTitle(text) }).then(
      (answer) => {
        if (answer === 'refused') {
          // The page now shows an outline other than the one this title was typed against, and has
          // said so. The field gives way to it, rather than holding the refused title for the next
          // blur to send again as an act nobody chose a second time.
          setField((previous) => ({
            typed: previous.inModel,
            inModel: previous.inModel,
            sent: null,
          }));
        } else if (answer === 'unsent') {
          // Nothing changed and nothing was recorded, and the page says to try again: the text stays,
          // and the author's next Enter or blur is that retry.
          setField((previous) => ({ ...previous, sent: null }));
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
