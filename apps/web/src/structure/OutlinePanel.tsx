import type { FieldView } from '@alloy-works/api-client';
import {
  canonicaliseTitle,
  conditions,
  conditionsSelect,
  hasText,
  mayBeFront,
  number,
  resolve,
  sectionNumbers,
  walkOutline,
  type Contribution,
  type IncomingReference,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
  type SectionViewNode,
} from '@alloy-works/domain';
import { type EquationAt, type EquationChoice } from '@alloy-works/editor';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePageLayer } from '../shell/Status.js';

// The title field's editor, and the equations in it, drawn as the component editor draws them.
import '@alloy-works/editor/style.css';

import { Icon } from '../editor/Icon.js';
import { Toolbar } from '../parts/Toolbar.js';
import styles from './OutlinePanel.module.css';
import { revealInPane } from './reveal.js';

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
  visibleOrder,
  ancestorsOf,
  type DropTarget,
  type Names,
} from './tree.js';
import { StateLozenge } from '../states/Lozenge.js';
import { formats, words as say } from '../words/words.js';
import { inlineKey } from '../parts/inline.js';
import {
  ConfirmRemoval,
  holdsRequired,
  PartPanel,
  PartReadOnly,
  placedBy,
  ReferencedBy,
  type PartFacts,
} from './PartPanel.js';
import { numberedOn, whereItSits } from './partSummary.js';

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
export interface EquationRequest {
  readonly current: EquationAt | null;
  readonly place: (choice: EquationChoice) => string | null;
  /**
   * The dialog has closed, placed or cancelled or withdrawn: the field takes the focus back, answering
   * whether it could. It always does while it is there, whatever opened the dialog - the button, the
   * keyboard, or a tree item the focus stayed on when the button was clicked - because leaving the
   * field is what retries a title that came back unsent (the final review, M1).
   */
  readonly back: () => boolean;
}

/** Said after whatever the page says, when a title gives way under its own Equation dialog. */
const TITLE_CHANGED = (): string => say('document.the-title-changed-while-the');

/** A component the panel can add a reference to: what `GET /v1/components` lists. */
export interface ComponentChoice {
  readonly id: string;
  readonly title: string;
  /** Its workflow state now, where the listing carries one (WF-G). */
  readonly state?: { readonly key: string; readonly name: string } | undefined;
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

export type RetitleOperation = Extract<OutlineOperation, { operation: 'retitle' }>;
/** A title as a node holds it. */
export type Title = SectionViewNode['title'];

/** A retitle's answer, or word that a newer commit to the same section took its place. */
export type RetitleAnswer = Answered | 'superseded';

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
  return formats().list(titles);
}

/** Said after a refusal's own sentence, naming each title it took. */
function titlesNotSaved(titles: readonly string[]): string {
  return titles.length === 1
    ? say('document.your-title-was-not-saved', { value1: listed(titles) })
    : say('document.your-titles-were-not-saved', { value1: listed(titles) });
}

/** Names every title not saved after its field closed, once none is outstanding. */
function lostTitles(lost: readonly LostTitle[]): string {
  const titles = lost.map((each) => each.title);
  const said = { titles: listed(titles), count: titles.length };
  return lost.some((each) => each.signedOut)
    ? say('document.titles-not-saved-signed-out', said)
    : say('document.titles-not-saved-try-again', said);
}

/** What a node's row says beside its title (STR-038). */
export interface NodeMarks {
  /** Somebody else holds its component, by name. */
  readonly heldBy?: string | null;
  readonly brokenReferences?: number;
  readonly failedValues?: number;
}

/** A condition axis as the page names it: its key, its name and its values' labels (the R12 plan). */
export interface NamedAxis {
  readonly key: string;
  readonly name: string;
  readonly values: readonly { readonly key: string; readonly label: string }[];
}

/**
 * What a node's conditions keep it for, in words (REU-026; the R12 plan): each axis by its name and
 * the values by their labels, keys where the axes are not read; and, where this document's own profile
 * does not select it, that it is left out. Null where it carries none.
 */
export function conditionsWords(
  conditions: OutlineViewNode['conditions'],
  axes: readonly NamedAxis[],
  standing: Standing | undefined,
): string | null {
  const nameOf = (key: string) => axes.find((one) => one.key === key)?.name ?? key;
  const after =
    standing === undefined
      ? ''
      : standing === 'left'
        ? say('document.left-out-by-this-document')
        : say('document.needs-a-value-for-in', {
            value1: standing.unset.map(nameOf).join(' and '),
          });
  if (conditions === undefined)
    return after === '' ? null : after[0]!.toUpperCase() + after.slice(1);
  const said = conditions
    .map((each) => {
      const axis = axes.find((one) => one.key === each.axis);
      const values = each.values.map(
        (value) => axis?.values.find((one) => one.key === value)?.label ?? value,
      );
      return `${axis?.name ?? each.axis}: ${values.join(', ')}`;
    })
    .join('; ');
  return say('document.kept-for', { said, value2: after === '' ? '' : `; ${after}` });
}

/**
 * What this document's own profile does with a node (REU-024, REU-053; the R12 final review): leaves
 * it out, where a value it takes on an axis is not one the node is kept for, or where an axis it does
 * not set is accepted as leaving it out - and so everything under it; or needs a value on the axes it
 * does not set, where that is not accepted, which a publish refuses until it has one.
 */
type Standing = 'left' | { readonly unset: readonly string[] };

function standingsBy(
  nodes: readonly OutlineViewNode[],
  profile: OutlineView['profile'],
): ReadonlyMap<string, Standing> {
  const found = new Map<string, Standing>();
  const values = profile?.values ?? {};
  const walk = (list: readonly OutlineViewNode[], out: boolean) => {
    for (const node of list) {
      let here: Standing | undefined = out ? 'left' : undefined;
      if (!out && node.conditions !== undefined) {
        const unset: string[] = [];
        const chosen = conditionsSelect(node.conditions, values, (axis) => unset.push(axis));
        const otherwise = node.conditions.some(
          (each) =>
            Object.hasOwn(values, each.axis) &&
            !each.values.some((value) => values[each.axis]!.includes(value)),
        );
        if (!chosen) {
          here =
            otherwise || unset.length === 0 || profile?.excludeUnset === true
              ? 'left'
              : { unset: [...new Set(unset)] };
        }
      }
      if (here !== undefined) found.set(node.id, here);
      walk(node.children, here === 'left');
    }
  };
  walk(nodes, false);
  return found;
}

/** A node's marks in words, each a phrase; none where nothing matters. */
export function marksWords(marks: NodeMarks | undefined): string[] {
  if (marks === undefined) return [];
  const words: string[] = [];
  if (marks.heldBy !== undefined)
    words.push(say('document.held-by', { value1: marks.heldBy ?? 'somebody else' }));
  const broken = marks.brokenReferences ?? 0;
  if (broken > 0) words.push(say('document.broken-references', { count: broken }));
  const failed = marks.failedValues ?? 0;
  if (failed > 0) words.push(say('document.failed-values', { count: failed }));
  return words;
}

export interface OutlinePanelProps {
  readonly outline: OutlineView;
  /**
   * The keys of the sections and components the document's template requires: each removed only with
   * a reason (TPL-029, TPL-044).
   */
  readonly requiredSections?: readonly string[];
  /** The condition axes declared, which a node's conditions are named by; keys where none are read. */
  readonly conditionAxes?: readonly NamedAxis[];
  /** Opens the Condition dialog for a node; absent, its conditions are said and not changed here. */
  readonly onConditions?: (node: string) => void;
  /** What stands above the panel's content in its box: the pane's tab strip. */
  readonly head?: ReactNode;
  /** The tab and the panel it shows, by id, when the panel is one tab's (interface slice 15). */
  readonly tab?: { readonly tab: string; readonly panel: string };
  /** Another tab's content, shown in the panel in place of the outline (the Data tab, BI-H). */
  readonly instead?: ReactNode;
  /** What the pane's filter holds; every node where none. */
  readonly filter?: string;
  /**
   * The chosen part's settings as the Part panel beside the text (the LG plan, LG6c): its id, the tab
   * that names it, and whether another panel is shown in its place.
   */
  readonly details?: {
    readonly id: string;
    readonly labelledBy: string;
    readonly hidden: boolean;
    /**
     * Where the panel stands: the pane beside the text, which the page draws (the document panels
     * pane), or nowhere while that pane is hidden to its rail. Left out, it stands where it is drawn.
     */
    readonly host?: Element | null;
  };
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
  /**
   * The fields the document's template applies to each section, the schemas behind them, and who a
   * `user` field may name (definitions.md): a chosen section's are filled in beside its title.
   */
  readonly sectionFields?: readonly FieldView[];
  readonly schemas?: readonly { readonly id: string; readonly name: string }[];
  readonly people?: readonly { readonly id: string; readonly name: string }[];
  /** An operation is in flight: everything that would send another waits for it. */
  readonly busy?: boolean;
  /**
   * Sends one structural act, answering what it came to (`Answered`). The page owns what happens
   * next - the version, the undo stack, what is announced.
   */
  readonly onOperation: (operation: OutlineOperation) => Promise<Answered>;
  /** Place from a document, offered under the toolbar to whoever may edit (the R2 plan, R2-F). */
  readonly placeFrom?: ReactNode;
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
  /** The node last clicked in the text: chosen, with the focus and the text left where they are. */
  readonly pointed?: { readonly node: string; readonly arrival: number } | null;
  /** What the panel says of the version a reference resolves to, once the page has read it. */
  readonly versionOf?: (node: OutlineViewNode) => string | undefined;
  /** A node's shareable address (STR-044), shown for the selected node. */
  readonly linkOf?: (node: string) => string;
  /** Where a component the selected node places is used, as the page offers it (STR-075; R14-B). */
  readonly usedIn?: (component: ComponentChoice) => ReactNode;
  /** Told whenever the author chooses a node, so the page's address can follow. */
  readonly onSelected?: (node: string) => void;
  /**
   * The node the reader is at in the text (document-view.md, "Navigation"; STR-035): marked as the
   * current location and kept in view in the tree as they scroll.
   */
  readonly inView?: string | null;
  /**
   * What matters about each node to an author (STR-038): who else holds its component, and how many
   * broken references and failed values its text holds. None where nothing does.
   */
  readonly marks?: ReadonlyMap<string, NodeMarks>;
  /** Who holds each part, in words, for the Part panel. */
  readonly heldSaid?: ReadonlyMap<string, string>;
  /** What is true of a part and what may be done from here, for the Part panel (the EP plan, EP4). */
  readonly standing?: (node: OutlineViewNode) => ReactNode;
  /**
   * What in this document refers to a node or to anything in it, from outside it (STR-074): listed in
   * the Part panel, and named before the node is removed. `checking` until the page first knows, and
   * `unknown` where it could not: neither is said to be nothing. Absent, nothing is said at all.
   */
  readonly referencesTo?: ((node: string) => readonly IncomingReference[]) | 'checking' | 'unknown';
}

/**
 * What the panel knows of any occurrence's contributions: nothing. It shows section numbers alone, and
 * a section number never depends on what an occurrence holds, so knowing nothing costs it nothing -
 * and the panel reads no component's content to show one.
 */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

/** Said where a key move is refused, in the words of the rule that refused it. */
const TOP_LEVEL_ONLY = (): string => say('document.front-matter-and-appendices-stay');
const FRONT_FIRST = (): string => say('document.front-matter-comes-before-the');

/**
 * The keymap, said once beside the tree and tied to it by `aria-describedby`. A Mac keyboard's delete
 * key is Backspace, which the tree leaves alone, so it says where removing is on one.
 */
const KEYS = (): string => say('document.outline.keys');

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
  instead,
  details,
  filter,
  root = null,
  scheme,
  editable,
  busy = false,
  onOperation,
  placeFrom,
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
  usedIn,
  onSelected = () => {},
  inView = null,
  pointed = null,
  versionOf,
  marks,
  heldSaid,
  standing,
  referencesTo,
  sectionFields,
  schemas,
  people,
  requiredSections = [],
  conditionAxes = [],
  onConditions,
}: OutlinePanelProps) {
  const layer = usePageLayer();
  const prefix = useId();
  const nodes = outline.nodes;
  const standings = useMemo(() => standingsBy(nodes, outline.profile), [nodes, outline.profile]);
  const [active, setActive] = useState<string | null>(null);
  // The node to put focus on once it is in the page. A moved node is a new element where it lands,
  // because it sits in a different list, so focus is asked for after the answer rather than kept.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: 'section' | 'component'; after: string | null }>();
  const [newTitle, setNewTitle] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  // Asked for by the Delete key in the tree, whose row the focus goes back to; else, the red icon.
  const askedFromTree = useRef(true);
  const [dragging, setDragging] = useState<string | null>(null);
  // Filled by each item's ref callback, never during render.
  const items = useRef(new Map<string, HTMLElement>());
  // The outline's own scroller, beside the text rather than scrolled with it (issue #336).
  const pane = useRef<HTMLDivElement>(null);
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
  // The dialog's request, and what had the focus as it opened. The focus goes back to the title field
  // that asked, never simply to what had it: a tree item keeps the focus when **Equation** is clicked,
  // and a title placed from there, failing, would have no field to leave (the final review, M1). What
  // had it is only where the focus goes when the field is gone.
  const asked = useRef<{ request: EquationRequest; opener: HTMLElement | null } | null>(null);
  // Set when the field gave way under its dialog, and said after the notice of the render showing why.
  const withdrawn = useRef(false);
  const askEquation = (request: EquationRequest) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    asked.current = { request, opener: asked.current?.opener ?? opener };
    setEquating(request);
  };
  // The field's title changed from outside while its dialog stood - somebody else's title, a refusal,
  // the section gone - so the equation it was opened on, or the caret it would go at, is not the one
  // the author chose: the dialog closes, placing nothing (the final review, L1).
  const withdrawEquation = () => {
    withdrawn.current = true;
    setEquating(null);
  };
  useEffect(() => {
    if (equating !== null) return;
    const closed = asked.current;
    asked.current = null;
    if (closed === null || closed.request.back()) return;
    if (closed.opener?.isConnected) closed.opener.focus();
    else if (current !== null) items.current.get(current)?.focus();
    // Only the dialog closing moves the focus: `current` is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equating]);
  // The node the reader is at, kept in view in the tree as they scroll the text (STR-035) - by the
  // pane's own scroll, never the item's `scrollIntoView`, which would move the window and with it the
  // text, changing the node in view again: the loop that sprang the page back (issue #336). Its own
  // row, since a section's item holds its children too.
  useEffect(() => {
    const item = inView === null ? undefined : items.current.get(inView);
    if (!item || pane.current === null) return;
    revealInPane(pane.current, item.querySelector<HTMLElement>('[data-row]') ?? item);
  }, [inView]);
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
      onNotice(say('document.the-linked-part-is-not'));
    }
  }, [linked, nodes, onNotice]);

  // The part clicked in the text: the tree and the panel follow, and nothing takes the focus.
  const pointedTaken = useRef<number | null>(null);
  useEffect(() => {
    if (pointed === null || pointedTaken.current === pointed.arrival) return;
    pointedTaken.current = pointed.arrival;
    if (!placeOf(nodes, pointed.node)) return;
    setActive(pointed.node);
    setHighlighted(null);
    const item = items.current.get(pointed.node);
    if (item && pane.current !== null) {
      revealInPane(pane.current, item.querySelector<HTMLElement>('[data-row]') ?? item);
    }
  }, [pointed, nodes]);

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
        : sectionNumbers(
            number(
              conditions(resolve(outline, NOTHING_KNOWN), outline.profile?.values ?? {}),
              scheme,
            ),
          ),
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
    if (dropped.current.length > 0 || withdrawn.current) {
      // Still showing the sentence this effect said last: the refusal is the same one, so its titles
      // and these are named together, each once, rather than in a second sentence after the first.
      // A dialog withdrawn is said after the refusal's sentence too, as part of what the titles follow.
      const same = named.current !== null && notice === named.current.said;
      const after = [
        same ? named.current!.after : (notice ?? ''),
        withdrawn.current ? TITLE_CHANGED() : '',
      ]
        .filter(Boolean)
        .join(' ');
      const titles = [...new Set([...(same ? named.current!.titles : []), ...dropped.current])];
      const said = [after, titles.length > 0 ? titlesNotSaved(titles) : '']
        .filter(Boolean)
        .join(' ');
      named.current = { said, after, titles };
      dropped.current = [];
      withdrawn.current = false;
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

  /** Where a reference to the chosen node stands, chosen from the Part panel or the removal (STR-074). */
  const goTo = (id: string) => {
    setConfirming(null);
    setActive(id);
    setHighlighted(null);
    onSelected(id);
    setFocusTarget(id);
  };
  // Whether the outline holds an occurrence the reader may not read, whose text is never counted.
  let withheld = false;
  walkOutline(nodes, (node) => {
    if (node.type === 'reference' && node.component === null) withheld = true;
  });
  // A placed component's state, from the listing of what the reader may read: none for any other.
  const placedState = (node: OutlineViewNode) =>
    node.type === 'reference' && node.component !== null && components.state === 'loaded'
      ? components.items.find((each) => each.id === node.component)?.state
      : undefined;
  /** The number a part would take, were it and all above it numbered: the same function as `numbers`. */
  const numberIf = (id: string) =>
    scheme === null
      ? undefined
      : sectionNumbers(
          number(
            conditions(
              resolve(
                { ...outline, nodes: numberedOn(outline.nodes, id) } as typeof outline,
                NOTHING_KNOWN,
              ),
              outline.profile?.values ?? {},
            ),
            scheme,
          ),
        ).get(id);
  const factsOf = (node: OutlineViewNode): PartFacts => ({
    node,
    names,
    ...whereItSits(nodes, node.id),
    number: numbers.get(node.id),
    wouldBe:
      node.numbered && unnumberedAncestor(nodes, node.id) === undefined
        ? undefined
        : numberIf(node.id),
    state: placedState(node),
    heldSaid: heldSaid?.get(node.id),
    standing: standing?.(node),
    address: linkOf?.(node.id),
    references:
      referencesTo === undefined
        ? undefined
        : typeof referencesTo === 'function'
          ? referencesTo(node.id)
          : referencesTo,
    referencedBy: referring(node.id),
    placed:
      components.state === 'loaded'
        ? placedBy(node).flatMap((id) => components.items.filter((each) => each.id === id))
        : [],
    usedIn,
    fieldCount: sectionFields?.length ?? 0,
    version: versionOf?.(node),
  });
  const referring = (id: string) =>
    referencesTo !== undefined && (
      <ReferencedBy
        references={typeof referencesTo === 'function' ? referencesTo(id) : referencesTo}
        withheld={withheld}
        nameOf={(node) => {
          const found = placeOf(nodes, node)?.node;
          return found === undefined ? say('document.a-component-2') : nodeName(found, names);
        }}
        linkOf={linkOf}
        onGo={goTo}
      />
    );

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

  const remove = async (id: string, reason?: string) => {
    const place = placeOf(nodes, id);
    setConfirming(null);
    askedFromTree.current = true;
    if (!place || !may) return;
    // Where selection goes once the node has: the sibling before it, its parent, or what follows.
    const neighbour =
      place.siblings[place.index - 1]?.id ??
      place.parent?.id ??
      place.siblings[place.index + 1]?.id ??
      null;
    const after = await onOperation({
      operation: 'remove',
      node: id,
      ...(reason === undefined ? {} : { reason }),
    });
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
    // The node the focus stands on: a filter may have hidden the one chosen.
    const at = tabStop;
    if (at === null || event.ctrlKey || event.metaKey) return;
    const order = shownOrder();
    const index = order.indexOf(at);
    const place = placeOf(nodes, at);
    // Promote, demote, expand and collapse go with the interface's direction (UI-G).
    const key = inlineKey(event.key);
    if (event.altKey) {
      const direction = (
        {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'promote',
          ArrowRight: 'demote',
        } as const
      )[key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'];
      if (direction === undefined) return;
      // Always taken, so Alt+Left never reaches the browser as Back while the tree has focus.
      event.preventDefault();
      if (!may) return;
      const move = keyMove(nodes, at, direction);
      if (move !== null) void send(move, at);
      else if (leavesTheTopLevel(nodes, at, direction)) onNotice(TOP_LEVEL_ONLY());
      else if (breaksFrontFirst(nodes, at, direction)) onNotice(FRONT_FIRST());
      return;
    }
    switch (key) {
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
        const child = (place?.node.children as readonly OutlineViewNode[] | undefined)?.find(kept);
        if (child && collapsed.has(at)) toggle(at);
        else if (child) choose(child.id, true);
        break;
      }
      case 'ArrowLeft':
        if (place && place.node.children.length > 0 && !collapsed.has(at)) toggle(at);
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
        if (may) setConfirming(at);
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

  // What the pane's filter leaves: a node whose title holds it, and the way down to one.
  const kept = (node: OutlineViewNode): boolean =>
    filter === undefined ||
    filter.trim() === '' ||
    nodeName(node, names).toLowerCase().includes(filter.trim().toLowerCase()) ||
    ('children' in node && (node.children as readonly OutlineViewNode[]).some(kept));
  const shownOrder = () =>
    visibleOrder(nodes, collapsed).filter((id) => {
      const at = placeOf(nodes, id);
      return at !== undefined && kept(at.node as OutlineViewNode);
    });
  // The tree's one tab stop: the node chosen, or the first that shows where a filter hides that one.
  const tabStop: string | null =
    current !== null && shownOrder().includes(current) ? current : (shownOrder()[0] ?? null);
  const renderNodes = (all: readonly OutlineViewNode[], level: number, list = all.filter(kept)) =>
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
          aria-current={node.id === inView ? 'location' : undefined}
          aria-expanded={node.children.length > 0 ? !collapsed.has(node.id) : undefined}
          aria-labelledby={labelId}
          // The number describes the item rather than naming it: a name is what typing a title finds
          // in a tree, and what every announcement says, and it stays put when a move renumbers it.
          aria-describedby={
            [
              shown === undefined ? null : numberId,
              marksWords(marks?.get(node.id)).length > 0 ? `${labelId}-marks` : null,
              conditionsWords(node.conditions, conditionAxes, standings.get(node.id)) === null
                ? null
                : `${labelId}-conditions`,
            ]
              .filter((each) => each !== null)
              .join(' ') || undefined
          }
          tabIndex={node.id === tabStop ? 0 : -1}
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
            {marksWords(marks?.get(node.id)).length > 0 && (
              <span id={`${labelId}-marks`} className={styles['nodeMarks']}>
                {marks?.get(node.id)?.heldBy !== undefined && <Icon name="Lock held" size={11} />}{' '}
                {marksWords(marks?.get(node.id)).join('; ')}
              </span>
            )}
            {conditionsWords(node.conditions, conditionAxes, standings.get(node.id)) !== null && (
              <span id={`${labelId}-conditions`} className={styles['nodeMarks']}>
                {conditionsWords(node.conditions, conditionAxes, standings.get(node.id))}
              </span>
            )}
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

  /** The Part panel, in the pane beside the text where the page gives it one (its `host`). */
  const placed = (part: ReactNode) =>
    details?.host === undefined
      ? part
      : details.host === null
        ? null
        : createPortal(part, details.host);

  return (
    // Two parts, in the order they always had: the outline itself, and what is said of the node
    // chosen in it. The document page lays them out in columns of their own (interface slice 8).
    <>
      <div data-panel="outline" onKeyDown={onPanelKeyDown} inert={equating !== null}>
        <div data-part="outline">
          {head}
          <div
            ref={pane}
            className={styles['panel']}
            {...(tab ? { role: 'tabpanel', id: tab.panel, 'aria-labelledby': tab.tab } : {})}
          >
            {instead}
            {instead === undefined && editable && (
              <Toolbar label={say('document.outline')} className={styles['toolbar']}>
                {/* Nothing here is disabled while an act is in flight, because a control that is disabled
              under the focus drops it to the page body in a real browser: each waits instead, and
              Undo says it has nothing to undo through aria-disabled, where it can keep the focus. */}
                {/* Icons, each still named in words - by `aria-label` for a screen reader and by
                `title` for a pointer - so the words move rather than going (interface slice 15). */}
                <button
                  type="button"
                  className={styles['act']}
                  aria-label={say('document.add-section')}
                  title={say('document.add-section')}
                  onClick={() => !busy && openAdding('section')}
                >
                  <Icon name="Add section" />
                </button>
                <button
                  type="button"
                  className={styles['act']}
                  aria-label={say('document.add-component')}
                  title={say('document.add-component')}
                  onClick={() => !busy && openAdding('component')}
                >
                  <Icon name="Add component" />
                </button>
                <Toolbar.Divider className={styles['divider']} />
                <button
                  type="button"
                  className={styles['act']}
                  aria-label={say('document.undo')}
                  title={say('document.undo')}
                  aria-disabled={!canUndo}
                  onClick={() => {
                    if (!busy && canUndo) void onUndo?.();
                  }}
                >
                  <Icon name="Undo" />
                </button>
                <span className={styles['overline']} aria-hidden="true">
                  {say('document.outline')}
                </span>
              </Toolbar>
            )}
            {instead === undefined && editable && placeFrom}
            {instead === undefined && (
              <>
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
                      {say('document.new-section-title')}
                      {/* Focus goes where the author asked to type: they opened this form themselves. */}
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                      />
                    </label>
                    {/* Said about the field as it stands, so it goes the moment the field is fine. */}
                    {attempted && !hasText(newTitle) && (
                      <p>{say('document.a-section-needs-a-title')}</p>
                    )}
                    <button type="submit">{say('document.add-2')}</button>
                    <button type="button" onClick={cancelAdding}>
                      {say('document.cancel')}
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
                  {editable ? KEYS() : say('document.move-between-items-with-the')}
                </p>
                {nodes.length === 0 ? (
                  <p>{say('document.this-document-has-no-sections')}</p>
                ) : (
                  <ul
                    role="tree"
                    className={styles['tree']}
                    aria-label={say('document.outline')}
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
                    {say('document.move-to-the-end-of')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {placed(
          <div
            data-part="details"
            {...(details === undefined
              ? {}
              : {
                  id: details.id,
                  role: 'tabpanel',
                  'aria-labelledby': details.labelledBy,
                  hidden: details.hidden,
                })}
          >
            {editable && selected ? (
              <PartPanel
                key={selected.id}
                facts={factsOf(selected)}
                topLevel={placeOf(nodes, selected.id)?.parent === null}
                frontOffered={mayBeFront(nodes, selected.id)}
                frontAfter={frontAfter(nodes, selected.id)}
                unnumberedAbove={unnumberedAncestor(nodes, selected.id)}
                busy={busy}
                onOperation={(operation) => send(operation, null)}
                onRetitle={retitle}
                openField={openField}
                onNotice={onNotice}
                onRemove={() => {
                  askedFromTree.current = false;
                  setConfirming(selected.id);
                }}
                onGoTo={() => onSelected(selected.id)}
                conditionsSaid={conditionsWords(
                  selected.conditions,
                  conditionAxes,
                  standings.get(selected.id),
                )}
                onConditions={onConditions}
                language={outline.language}
                direction={outline.direction}
                onEquation={askEquation}
                onWithdrawEquation={withdrawEquation}
                sectionFields={sectionFields ?? []}
                schemas={schemas ?? []}
                people={people ?? []}
              />
            ) : (
              <PartReadOnly
                key={selected?.id ?? 'none'}
                facts={selected && factsOf(selected)}
                onGoTo={() => selected && onSelected(selected.id)}
                onNotice={onNotice}
              />
            )}
          </div>,
        )}
      </div>
      {editable &&
        confirming !== null &&
        createPortal(
          <ConfirmRemoval
            node={placeOf(nodes, confirming)?.node}
            names={names}
            referencedBy={
              referencesTo === undefined
                ? null
                : typeof referencesTo === 'function'
                  ? referencesTo(confirming).length > 0
                    ? { count: referencesTo(confirming).length, list: referring(confirming) }
                    : null
                  : referencesTo
            }
            needsReason={holdsRequired(placeOf(nodes, confirming)?.node, requiredSections)}
            onRemove={(reason) => void remove(confirming, reason)}
            onKeep={() => {
              setConfirming(null);
              if (askedFromTree.current) setFocusTarget(confirming);
              askedFromTree.current = true;
            }}
          />,
          document.body,
        )}
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
          layer,
        )}
    </>
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
  if (components.state === 'loading')
    return <p>{say('document.reading-the-components-you-may')}</p>;
  if (components.state === 'failed') {
    return components.signedOut ? (
      <p>{say('document.you-are-signed-out-sign-6')}</p>
    ) : (
      <>
        <p>{say('document.the-components-you-may-add')}</p>
        <button type="button" onClick={onReload}>
          {say('document.try-again')}
        </button>
      </>
    );
  }
  const first = components.items[0];
  if (first === undefined) return <p>{say('document.there-are-no-components-you')}</p>;
  const value = components.items.some((each) => each.id === chosen) ? chosen : first.id;
  const state = components.items.find((each) => each.id === value)?.state;
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
        {say('document.component')}
        <select value={value} onChange={(event) => onChoose(event.target.value)}>
          {components.items.map((each) => (
            <option key={each.id} value={each.id}>
              {each.title}
            </option>
          ))}
        </select>
      </label>
      {state && <StateLozenge size="small" state={state} />}
      <button type="submit">{say('document.add-2')}</button>
      <button type="button" onClick={onCancel}>
        {say('document.cancel')}
      </button>
    </form>
  );
}
