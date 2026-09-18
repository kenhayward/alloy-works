import type {
  OutlineDocument,
  OutlineNode,
  OutlineOperation,
  SectionNode,
} from '@alloy-works/domain';

/**
 * The outline panel's arithmetic, kept apart from React so it can be tested without rendering
 * anything. Every function here is pure and answers `null` rather than an operation the service would
 * refuse or one that would put a node back where it already is.
 *
 * **One convention for every position this file computes**, and it is the domain's
 * (`packages/domain/src/structure/operations.ts`, `move`): a move's `position` counts the new parent's
 * children once the moving node has already left them. Moving the first of three siblings to
 * position 2 therefore lands it last. The keymap and the pointer both come through here, so they
 * cannot read it two ways; `tree.test.ts` pins it against the domain's own operation.
 */

export type MoveOperation = Extract<OutlineOperation, { operation: 'move' }>;
type SetOperation = Extract<OutlineOperation, { operation: 'set' }>;
/** A title as an operation carries it, and as a node holds it. */
type Title = Extract<OutlineOperation, { operation: 'retitle' }>['title'];
type InlineTitle = SectionNode['title'];

/** Where a node sits: its parent (`null` for the document itself), its siblings and its index. */
export interface Place {
  readonly node: OutlineNode;
  readonly parent: OutlineNode | null;
  readonly siblings: readonly OutlineNode[];
  readonly index: number;
}

export function placeOf(
  nodes: readonly OutlineNode[],
  id: string,
  parent: OutlineNode | null = null,
): Place | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) return { node, parent, siblings: nodes, index };
    const found = placeOf(node.children, id, node);
    if (found) return found;
  }
  return undefined;
}

/** Every node, depth first, in document order: the order the arrow keys walk. */
export function visibleOrder(nodes: readonly OutlineNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...visibleOrder(node.children)]);
}

function contains(node: OutlineNode, id: string): boolean {
  return node.id === id || node.children.some((child) => contains(child, id));
}

/**
 * A move, unless it would leave the node exactly where it is. `parent` and `position` are already in
 * the domain's post-removal convention.
 */
function moveOrNothing(from: Place, parent: string | null, position: number): MoveOperation | null {
  if ((from.parent?.id ?? null) === parent && from.index === position) return null;
  return { operation: 'move', node: from.node.id, parent, position };
}

/**
 * The keymap's four moves (structure.md, "Accessibility"): Alt+Up and Alt+Down among siblings,
 * Alt+Left to become the next sibling of its parent, Alt+Right to become the last child of the sibling
 * before it. `null` where the key has nowhere to go - the first sibling moving up, a top-level node
 * promoted - so nothing is sent that could only be refused.
 */
export function keyMove(
  nodes: readonly OutlineNode[],
  id: string,
  direction: 'up' | 'down' | 'promote' | 'demote',
): MoveOperation | null {
  const from = placeOf(nodes, id);
  if (!from) return null;
  const parent = from.parent?.id ?? null;
  switch (direction) {
    case 'up':
      return from.index === 0 ? null : moveOrNothing(from, parent, from.index - 1);
    case 'down':
      // Post-removal: the sibling that was after it is now at `index`, so `index + 1` is after that.
      return from.index === from.siblings.length - 1
        ? null
        : moveOrNothing(from, parent, from.index + 1);
    case 'promote': {
      if (from.parent === null) return null;
      const above = placeOf(nodes, from.parent.id);
      if (!above) return null;
      // The grandparent's children do not include the moving node, so no adjustment is due.
      return moveOrNothing(from, above.parent?.id ?? null, above.index + 1);
    }
    case 'demote': {
      const before = from.siblings[from.index - 1];
      if (!before) return null;
      return moveOrNothing(from, before.id, before.children.length);
    }
  }
}

/**
 * Where the pointer let go: before a node (among that node's siblings), onto a node (as its last
 * child), or at the end of a parent's children (`null` for the top level).
 */
export type DropTarget =
  | { readonly kind: 'before'; readonly node: string }
  | { readonly kind: 'into'; readonly node: string }
  | { readonly kind: 'end'; readonly parent: string | null };

export function dropMove(
  nodes: readonly OutlineNode[],
  dragged: string,
  target: DropTarget,
): MoveOperation | null {
  const from = placeOf(nodes, dragged);
  if (!from) return null;
  const fromParent = from.parent?.id ?? null;
  // How many of `parent`'s children the move counts among, once the dragged node has left them.
  const remaining = (parent: string | null, children: readonly OutlineNode[]) =>
    children.length - (fromParent === parent ? 1 : 0);

  switch (target.kind) {
    case 'before': {
      const at = placeOf(nodes, target.node);
      if (!at || contains(from.node, target.node)) return null;
      const parent = at.parent?.id ?? null;
      const position = fromParent === parent && from.index < at.index ? at.index - 1 : at.index;
      return moveOrNothing(from, parent, position);
    }
    case 'into': {
      const at = placeOf(nodes, target.node);
      if (!at || contains(from.node, target.node)) return null;
      return moveOrNothing(from, at.node.id, remaining(at.node.id, at.node.children));
    }
    case 'end': {
      if (target.parent !== null && contains(from.node, target.parent)) return null;
      const children =
        target.parent === null ? nodes : placeOf(nodes, target.parent)?.node.children;
      if (!children) return null;
      return moveOrNothing(from, target.parent, remaining(target.parent, children));
    }
  }
}

function ids(nodes: readonly OutlineNode[]): Set<string> {
  return new Set(visibleOrder(nodes));
}

const SWITCHES = ['numbered', 'matter', 'pageBreak', 'mode', 'values'] as const;

/**
 * The one operation that takes an act back (the plan's decision 6: undo is an entry in the renderer,
 * because the inverse of an operation is another operation), computed from the outline before the
 * act and the outline the service returned after it.
 *
 * **A removal has none.** Its inverse would be an insert of the whole subtree under the identifiers it
 * had, and an insert takes one node and allocates a fresh identifier (STR-003: never reused) - so no
 * operation, and no sequence of them, restores what a removal took. The panel asks before it removes,
 * and says it cannot be undone.
 */
export function inverseOf(
  before: OutlineDocument,
  after: OutlineDocument,
  operation: OutlineOperation,
): OutlineOperation | null {
  switch (operation.operation) {
    case 'move': {
      const from = placeOf(before.nodes, operation.node);
      if (!from) return null;
      // The index it had among its old siblings is already post-removal from where it now is: taking
      // it out of its new place leaves the old parent's children exactly as they were without it.
      return {
        operation: 'move',
        node: operation.node,
        parent: from.parent?.id ?? null,
        position: from.index,
      };
    }
    case 'insert': {
      const held = ids(before.nodes);
      const added = visibleOrder(after.nodes).filter((id) => !held.has(id));
      const [id] = added;
      return added.length === 1 && id !== undefined ? { operation: 'remove', node: id } : null;
    }
    case 'retitle': {
      const node = placeOf(before.nodes, operation.node)?.node;
      if (node?.type !== 'section') return null;
      return { operation: 'retitle', node: node.id, title: [...node.title] };
    }
    case 'set': {
      const node = placeOf(before.nodes, operation.node)?.node;
      if (!node) return null;
      // Only the switches the act named, each back to what it was - built from entries, never a
      // member assigned by a key spelled out by hand. A mode is only ever set on a reference.
      const held: Partial<Record<(typeof SWITCHES)[number], unknown>> = {
        numbered: node.numbered,
        matter: node.matter,
        pageBreak: node.pageBreak,
        values: node.values,
        ...(node.type === 'reference' ? { mode: node.mode } : {}),
      };
      const previous = Object.fromEntries(
        SWITCHES.filter((key) => operation[key] !== undefined && key in held).map((key) => [
          key,
          held[key],
        ]),
      ) as Omit<SetOperation, 'operation' | 'node'>;
      return { operation: 'set', node: node.id, ...previous };
    }
    case 'remove':
      return null;
  }
}

/** A section title typed into a plain field (decision B): one run of unmarked text. */
export function sectionTitle(text: string): Title {
  return [{ type: 'text', value: text, marks: [] }];
}

/**
 * The title as plain text, or `null` when it holds anything a plain field would lose - a mark, an
 * equation - so the panel never retitles a section by quietly dropping what nothing here can show.
 */
export function plainTitle(title: InlineTitle): string | null {
  let text = '';
  for (const node of title) {
    if (node.type !== 'text' || node.marks.length > 0) return null;
    text += node.value;
  }
  return text;
}

/** The title's words, for a label, whatever else it carries. */
export function titleText(title: InlineTitle): string {
  return title.map((node) => (node.type === 'text' ? node.value : '')).join('');
}

/**
 * Component titles by identifier, from the components the caller may read - or `null` until they
 * have been read. A reference names its component and nothing else does, so this is how it is named.
 */
export type Names = ReadonlyMap<string, string> | null;

/** What a node is called in a sentence: a section's title, or the component a reference points at. */
export function nodeName(node: OutlineNode, names: Names): string {
  if (node.type === 'section') return titleText(node.title).trim() || 'Untitled section';
  // A readable component is in the listing, so one that is not, once it has been read, is one the
  // caller may not read; until then it is only "a component".
  if (names === null) return 'A component';
  return names.get(node.component) ?? 'A component you may not read';
}

const MODES = {
  latest: 'latest',
  pinned: 'pinned',
  // Decision G: there is no revision to resolve `approved` to yet, so it names no version at all.
  approved: 'waiting on revisions',
} as const;

const STARTS = {
  none: '',
  page: ', starts on a new page',
  recto: ', starts on a new right-hand page',
};

/** A tree item's own label: its name, how a reference resolves, and where it starts. */
export function nodeLabel(node: OutlineNode, names: Names): string {
  const mode = node.type === 'reference' ? `, ${MODES[node.mode.kind]}` : '';
  return `${nodeName(node, names)}${mode}${STARTS[node.pageBreak]}`;
}
