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

export interface OutlinePanelProps {
  readonly outline: OutlineDocument;
  /** Whether the caller may restructure the outline at all; a reader is offered nothing to change. */
  readonly editable: boolean;
  /** An operation is in flight: everything that would send another waits for it. */
  readonly busy?: boolean;
  /**
   * Sends one structural act, answering the outline the service returned, or `null` when nothing was
   * applied. The page owns what happens next - the version, the undo stack, what is announced.
   */
  readonly onOperation: (operation: OutlineOperation) => Promise<OutlineDocument | null>;
  /** The one status sentence, announced through the panel's `role="status"` region. */
  readonly notice: string | null;
  /** Says something through that same region: a field refused before anything was sent. */
  readonly onNotice?: (message: string | null) => void;
  readonly canUndo?: boolean;
  readonly onUndo?: () => Promise<OutlineDocument | null>;
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
    if (after === null) return;
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
    const focus = after === null ? id : neighbour;
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
          <button type="button" disabled={busy} onClick={() => openAdding('section')}>
            Add section
          </button>
          <button type="button" disabled={busy} onClick={() => openAdding('component')}>
            Add component
          </button>
          <button type="button" disabled={busy || !canUndo} onClick={() => void onUndo?.()}>
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
              readOnly={busy}
              onChange={(event) => setNewTitle(event.target.value)}
            />
          </label>
          {/* Said about the field as it stands, so it goes the moment the field is fine. */}
          {attempted && newTitle.trim() === '' && <p>A section needs a title.</p>}
          <button type="submit" disabled={busy}>
            Add
          </button>
          <button type="button" onClick={cancelAdding}>
            Cancel
          </button>
        </form>
      )}
      {editable && adding?.kind === 'component' && (
        <ComponentChooser
          components={components}
          chosen={chosen}
          busy={busy}
          onChoose={setChosen}
          onAdd={(component) =>
            void insert({ type: 'reference', component, mode: { kind: 'latest' } })
          }
          onCancel={cancelAdding}
          onReload={onReloadComponents}
        />
      )}
      {nodes.length === 0 ? (
        <p>This document has no sections yet.</p>
      ) : (
        <ul
          role="tree"
          aria-label="Outline"
          onKeyDown={onTreeKeyDown}
          onClick={onTreeClick}
          onDragStart={(event) => {
            const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
            const id = item?.dataset.node;
            if (!may || id === undefined) return;
            setDragging(id);
            // Firefox starts no drag without data; the node's identifier is what is being moved.
            event.dataTransfer?.setData('text/plain', id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => allowDrop(event, dropTargetOf(event.target))}
          onDrop={(event) => dropOnto(event, dropTargetOf(event.target))}
          onDragEnd={() => setDragging(null)}
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
          onNotice={onNotice}
          onRemove={() => setConfirming(selected.id)}
        />
      )}
      {editable && confirming !== null && (
        <ConfirmRemoval
          node={placeOf(nodes, confirming)?.node}
          names={names}
          busy={busy}
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
  busy,
  onChoose,
  onAdd,
  onCancel,
  onReload,
}: {
  components: ComponentChoices;
  chosen: string;
  busy: boolean;
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
      <button type="submit" disabled={busy}>
        Add
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function ConfirmRemoval({
  node,
  names,
  busy,
  onRemove,
  onKeep,
}: {
  node: OutlineNode | undefined;
  names: Names;
  busy: boolean;
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
          ? `Remove ${name} and everything beneath it? This cannot be undone.`
          : `Remove ${name}? This cannot be undone.`}
      </p>
      {/* Focus goes to the question the author has just asked to be put. */}
      <button type="button" autoFocus disabled={busy} onClick={onRemove}>
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
}

function NodeDetails({
  node,
  busy,
  onOperation,
  onNotice,
  onRemove,
}: {
  node: OutlineNode;
  busy: boolean;
  onOperation: (operation: OutlineOperation) => Promise<OutlineDocument | null>;
  onNotice: (message: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      {node.type === 'section' && (
        <TitleField node={node} busy={busy} onOperation={onOperation} onNotice={onNotice} />
      )}
      <label>
        Starts on
        <select
          value={node.pageBreak}
          disabled={busy}
          onChange={(event) => {
            const pageBreak = event.target.value;
            if (!isPageBreak(pageBreak) || pageBreak === node.pageBreak) return;
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
      <button type="button" disabled={busy} onClick={onRemove}>
        {node.type === 'section' ? 'Remove section' : 'Remove component'}
      </button>
    </div>
  );
}

function TitleField({
  node,
  busy,
  onOperation,
  onNotice,
}: {
  node: SectionNode;
  busy: boolean;
  onOperation: (operation: OutlineOperation) => Promise<OutlineDocument | null>;
  onNotice: (message: string | null) => void;
}) {
  const plain = plainTitle(node.title);
  const inModel = plain ?? titleText(node.title);
  const [field, setField] = useState<Field>({ typed: inModel, inModel });

  // State derived from a prop, adjusted during render the way React documents it: a second render
  // pass reads what the first set, and the comparison is by value, so it settles at once. The field
  // gives way only when the outline's title differs from what it last heard - an undo, a refusal
  // carrying somebody else's outline, its own retitle coming back - and never because the page
  // re-rendered for some other reason while the author was typing.
  if (inModel !== field.inModel) setField({ typed: inModel, inModel });

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

  const commit = () => {
    if (busy) return;
    const text = field.typed.trim();
    if (text === '') {
      // Nothing was sent, so the outline never changed and the comparison above never resyncs this
      // field by itself: it is put back here, or it would sit empty beside a tree showing the title.
      onNotice('A section needs a title.');
      setField({ typed: inModel, inModel });
      return;
    }
    if (text === inModel) return;
    void onOperation({ operation: 'retitle', node: node.id, title: sectionTitle(text) });
  };

  return (
    <label>
      Title
      <input
        value={field.typed}
        readOnly={busy}
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
