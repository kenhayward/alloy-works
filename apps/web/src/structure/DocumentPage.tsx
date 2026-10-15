import type { FieldView } from '@alloy-works/api-client';
import { TemplateLine, templateIn, type TemplateInfo } from './TemplateLine.js';
import { DatesButton, DatesChips, datesIn, type Dates } from '../lifecycle/Dates.js';
import type { createApiClient, paths } from '@alloy-works/api-client';
import {
  conditions,
  incomingReferences,
  layoutWordsSchema,
  number,
  numberingSchemeSchema,
  parseContentDocument,
  readContent,
  readOutlineView,
  resolve,
  sectionNumbers,
  walkOutline,
  cellRevisable,
  formatsFor,
  type BlockNode,
  type BoundTableNode,
  type ColumnType,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
  type TemplateParameter,
  type ThreadAnchor,
} from '@alloy-works/domain';
import { TEXT_CLASS } from '@alloy-works/editor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { ArchiveButton } from '../lifecycle/Archive.js';
import {
  readStanding,
  standingIn,
  RevisionChip,
  TransitionButtons,
  type Standing,
} from '../lifecycle/Workflow.js';
import { StateLozenge } from '../states/Lozenge.js';
import { DeleteButton } from '../lifecycle/Delete.js';
import { PlaceHoldButton } from '../lifecycle/Hold.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { PanelTabs } from '../parts/PanelTabs.js';
import { PreviewButton, PreviewPane, PreviewSaid, usePreview } from '../publishing/Preview.js';
import { FOLLOW_MS, Publishing } from '../publishing/Publishing.js';
import { DocumentVersions } from './DocumentVersions.js';
import { Icon } from '../editor/Icon.js';
import { IdleBand } from '../editor/IdleBand.js';
import { InPlaceBand } from '../editor/InPlaceBand.js';
import { keep, kept, PaneSeparator, PaneToggle, usePaneWidth } from '../layouts/PaneWidth.js';
import { StatusBar, StatusTools, usePageShown, useStatus } from '../shell/Status.js';
import styles from './DocumentPage.module.css';
import { ComponentEditor } from '../editor/ComponentEditor.js';
import { ProvenancePanel } from '../data/ProvenancePanel.js';
import { bindingStatesIn, holdsBinding, tableKey, type BindingState } from './bindingContexts.js';
import { useRevisionAsk } from './RevisionAsk.js';
import { RevisionDialog, type Revising } from './RevisionDialog.js';
import { said } from '../data/ProvenancePanel.js';
import { boundTablesByKey, type TableRows } from './tableRows.js';
import { followPending, WAITING_ON_IMAGES } from './pendingResult.js';
import { settleBinding, type SettleAct } from './settleBinding.js';
import { useOwnViewAsk } from './OwnViewAsk.js';
import { DocumentText, type Editable, type Place } from './DocumentText.js';
import { dataState } from './dataStates.js';
import type { NodeMarks } from './OutlinePanel.js';
import { useLiveDocument, type LiveDocument } from './live.js';
import { PeopleHere } from './PeopleHere.js';
import type { FollowOptions } from '@alloy-works/api-client';
import { GeneratedLists, type Known } from './GeneratedLists.js';
import { baselineLink, documentAccessLink, nodeLink } from './links.js';
import { BaselinesTab } from './BaselinesTab.js';
import { anchorFromSelection, type Placed } from '../review/anchoring.js';
import { RoundsPanel } from '../review/RoundsPanel.js';
import { SuggestionsPanel } from '../review/SuggestionsPanel.js';
import {
  anchorWords,
  ThreadsPanel,
  type ReviewTarget,
  type ThreadSummary,
} from '../review/ThreadsPanel.js';
import { DataTab } from './DataTab.js';
import {
  OutlineRail,
  OutlineTabs,
  offeredTabs,
  shownTab,
  tabIds,
  useOutlineTab,
} from './OutlineTabs.js';
import {
  OutlinePanel,
  type Answered,
  type ComponentChoice,
  type ComponentChoices,
} from './OutlinePanel.js';
import { inverseOf, nodeName, placeOf, visibleOrder, type Names } from './tree.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { HeldFields, type SaveAnswer } from '../metadata/HeldFields.js';
import { documentOffer, ParametersPanel, type ParametersSaved } from './ParametersPanel.js';
import type { ParameterValue } from './ParameterInput.js';
import { byName } from '../metadata/people.js';
import { UnheldFaces, useReachableDesk, ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider, usePresentation } from '../theme/presentation.js';
import {
  holdInPlace,
  LINK_WAITS_MS,
  pageSettled,
  useReadingPosition,
  watchReader,
} from './position.js';
import type { Choosing, OfferedVersion } from './VersionChoice.js';
import type { VersionNamed } from './NewerVersion.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The operation as the generated client spells it. It is the same schema as the domain's
 * `OutlineOperation` - the contract imports `outlineOperationSchema` rather than restating it - but
 * zod's inferred type and the OpenAPI document's rendering of it spell a mark differently, so the one
 * is handed to the other through this name rather than widened by hand.
 */
type WireOperation =
  paths['/v1/documents/{id}/outline']['post']['requestBody']['content']['application/json']['operation'];

/** A document as `DocumentView` answers it, every member checked and the outline parsed. */
interface Opened {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly outline: OutlineView;
  readonly mayEdit: boolean;
  readonly mayPublish: boolean;
  /** Whether the reader may start and answer threads on the document itself (COL-012). */
  readonly mayComment: boolean;
  /** Whether Review is offered on the document: `comment` or `suggest` on it (IAM-081). */
  readonly mayReview: boolean;
  /** Archived: out of ordinary listings and search, still read and published (lifecycle.md). */
  readonly archived: boolean;
  /** Whether the reader may archive and unarchive it. */
  readonly mayRetire: boolean;
  /** Its workflow state and the transitions the reader may take (WF-G); null from a view before it. */
  readonly standing: Standing | null;
  /** Under a legal hold, told only to whoever may retire it or administer the environment. */
  readonly onHold: boolean;
  /** Its effective and review-by dates (WF5-H); null from a view before them. */
  readonly dates: Dates | null;
  /** Whether the reader may place a legal hold: an environment administrator. */
  readonly mayHold: boolean;
  /**
   * The scheme of the layout version this document would be published under, parsed once per view:
   * what the page numbers with (STR-036), so nothing it shows is a number a publish could not print.
   * `null` where the view carried no layout, or one whose scheme the domain refuses.
   */
  readonly scheme: NumberingScheme | null;
  /**
   * What a relative cross-reference prints for above and below, in the layout's own words
   * (cross-references 2, ruling R9), so a reference shown here is what a publish would print. `null`
   * where the view carried no layout, one whose words the domain refuses, or one that gives neither -
   * the editor falls back to the English literal, as `printed` does without this.
   */
  readonly words: { readonly above: string; readonly below: string } | null;
  /**
   * The formats that layout makes, which a publish may ask for (Word 1, ruling R14): the PDF alone
   * where the view names none, as a view from before Word did not.
   */
  readonly formats: readonly string[];
  /**
   * The fields its template applies to it and to each of its sections, the schemas behind them, and
   * its own values (definitions.md, "A document's and a section's"): none for a blank document.
   */
  readonly fields: {
    readonly document: readonly FieldView[];
    readonly section: readonly FieldView[];
  };
  readonly schemas: readonly { readonly id: string; readonly name: string }[];
  readonly values: Readonly<Record<string, unknown>>;
  /** Its parameters' values, by name (templates.md, "Recorded on the document"): none for most. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Whether it was made from a template the reader may read, whose parameters it may then hold. */
  readonly templated: boolean;
  /** The template it was made from, with what it requires and the departures from it (WF6-A). */
  readonly template: TemplateInfo | null;
}

type Read = Opened | 'unreadable' | undefined;

/** A view's list of fields, as the service draws them: trusted in shape, as `FieldsForm` reads it. */
const fieldsIn = (value: unknown): readonly FieldView[] =>
  Array.isArray(value) ? (value.filter(isRecord) as unknown as FieldView[]) : [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The client's bodies are `any`, so a `DocumentView` is checked member by member rather than trusted
 * (pre-flight C13), and its outline goes through the domain's own parse. `undefined` is a body that is
 * not a document at all; `'unreadable'` is one whose outline this renderer cannot read.
 */
function documentIn(data: unknown): Read {
  if (!isRecord(data)) return undefined;
  const {
    id,
    space,
    version,
    outline,
    mayEdit,
    mayPublish,
    mayComment,
    mayReview,
    archived,
    mayRetire,
    onHold,
    mayHold,
    layout,
    fields,
    schemas,
    values,
    parameters,
    template,
  } = data;
  if (typeof id !== 'string' || typeof mayEdit !== 'boolean' || typeof mayPublish !== 'boolean') {
    return undefined;
  }
  if (!isRecord(space) || typeof space.id !== 'string' || typeof space.name !== 'string') {
    return undefined;
  }
  if (!isRecord(version) || typeof version.id !== 'string' || typeof version.number !== 'string') {
    return undefined;
  }
  const read = readOutlineView(outline, { artifact: id, version: version.id });
  if (!read.ok) return 'unreadable';
  // The layout's scheme, checked rather than trusted like every other member. A view that carries
  // none, or one the domain refuses, numbers nothing at all: falling back to the product's default
  // would show the author numbers no publish under this layout could produce.
  const scheme = isRecord(layout) ? numberingSchemeSchema.safeParse(layout.scheme) : undefined;
  // The layout's own words, read the same way (ruling R9): both above and below, or neither, is
  // `layoutWordsSchema`'s to enforce, so what falls out of a failed parse is null rather than one
  // word alone.
  const words = isRecord(layout) ? layoutWordsSchema.safeParse(layout.words) : undefined;
  const relativeWords =
    words?.success && words.data.above !== undefined && words.data.below !== undefined
      ? { above: words.data.above, below: words.data.below }
      : null;
  return {
    id,
    space: { id: space.id, name: space.name },
    version: { id: version.id, number: version.number },
    outline: read.outline,
    mayEdit,
    mayPublish,
    // Absent from a view before Review, which offered none (the TH plan, Task 3).
    mayComment: mayComment === true,
    mayReview: mayReview === true,
    archived: archived === true,
    mayRetire: mayRetire === true,
    standing: standingIn(data) ?? null,
    onHold: onHold === true,
    dates: datesIn(data) ?? null,
    mayHold: mayHold === true,
    scheme: scheme?.success ? scheme.data : null,
    words: relativeWords,
    formats:
      isRecord(layout) && Array.isArray(layout.formats)
        ? layout.formats.filter((format): format is string => typeof format === 'string')
        : ['pdf'],
    fields: {
      document: isRecord(fields) ? fieldsIn(fields.document) : [],
      section: isRecord(fields) ? fieldsIn(fields.section) : [],
    },
    schemas: Array.isArray(schemas)
      ? schemas.filter(
          (each): each is { id: string; name: string } =>
            isRecord(each) && typeof each.id === 'string' && typeof each.name === 'string',
        )
      : [],
    values: isRecord(values) ? values : {},
    parameters: isRecord(parameters) ? parameters : {},
    templated: isRecord(template),
    template: templateIn(template),
  };
}

const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

/**
 * Where a node is, in words a failure can be read by: its section number, if it has one, and its
 * name - a section's title, or for a reference its component's, and **A component** wherever the
 * reader may not read it. Section numbers depend on the outline alone, so none is withheld; the node
 * is looked for in the outline the page holds, so nothing of a component the service withheld can be
 * named. A node the outline no longer holds is said to be gone.
 */
function placeInOutline(
  outline: OutlineView,
  node: string,
  names: Names,
  scheme: NumberingScheme | null,
): string {
  // Collected rather than assigned from the callback, which TypeScript's narrowing cannot follow.
  const held: OutlineViewNode[] = [];
  walkOutline(outline.nodes, (each) => {
    if (each.id === node) held.push(each);
  });
  const [found] = held;
  if (found === undefined) return 'A part no longer in this document';
  if (scheme === null) return nodeName(found, names);
  const numbers = sectionNumbers(number(conditions(resolve(outline, NOTHING_KNOWN)), scheme));
  const numbered = numbers.get(node);
  return numbered === undefined ? nodeName(found, names) : `${numbered} ${nodeName(found, names)}`;
}

/**
 * What each occurrence contributes, from a `ContributionsView` checked member by member: an occurrence
 * whose version is null, or names a version the answer does not hold, is left out - not known, so
 * every number it could have moved is withheld rather than guessed. `undefined` is a body that is not
 * one at all.
 */
function contributionsIn(data: unknown): ReadonlyMap<string, readonly Contribution[]> | undefined {
  if (!isRecord(data) || !Array.isArray(data.occurrences) || !Array.isArray(data.versions)) {
    return undefined;
  }
  const versions = new Map<string, Contribution[]>();
  for (const version of data.versions as unknown[]) {
    if (!isRecord(version) || typeof version.id !== 'string') return undefined;
    if (!Array.isArray(version.contributions)) return undefined;
    const list: Contribution[] = [];
    for (const each of version.contributions as unknown[]) {
      if (
        !isRecord(each) ||
        typeof each.block !== 'string' ||
        typeof each.sequence !== 'string' ||
        typeof each.numbered !== 'boolean'
      ) {
        return undefined;
      }
      list.push({
        block: each.block,
        sequence: each.sequence,
        numbered: each.numbered,
        ...(typeof each.caption === 'string' ? { caption: each.caption } : {}),
      });
    }
    versions.set(version.id, list);
  }
  const known = new Map<string, readonly Contribution[]>();
  for (const occurrence of data.occurrences as unknown[]) {
    if (!isRecord(occurrence) || typeof occurrence.node !== 'string') return undefined;
    const list = typeof occurrence.version === 'string' ? versions.get(occurrence.version) : null;
    if (list) known.set(occurrence.node, list);
  }
  return known;
}

/** The components a listing held, each checked rather than trusted: the client's bodies are `any`. */
function componentsIn(items: readonly unknown[]): ComponentChoice[] {
  return items.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return [];
    const { state } = item;
    return [
      {
        id: item.id,
        title: item.title,
        ...(isRecord(state) && typeof state.key === 'string' && typeof state.name === 'string'
          ? { state: { key: state.key, name: state.name } }
          : {}),
      },
    ];
  });
}

/**
 * Why an act does not apply, in the service's words when it gave some: `outline_invalid` carries a
 * `reason` that is one of the domain's own fixed sentences, never an exception's text (task 4), so it
 * is safe to show. Any other 400 - `invalid_request` - is a body this page should never have sent,
 * which the author cannot correct and trying again cannot fix.
 */
function doesNotApply(refusal: unknown): string {
  // A section's value refused (definitions.md): the service's own sentence says which kind of thing
  // did not fit, and is one of its fixed messages, never an exception's text.
  if (
    isRecord(refusal) &&
    (refusal.code === 'values_invalid' || refusal.code === 'values_unresolved') &&
    typeof refusal.message === 'string'
  ) {
    return refusal.message;
  }
  if (!isRecord(refusal) || refusal.code !== 'outline_invalid') {
    return 'The change could not be made.';
  }
  const { reason } = refusal;
  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 200) {
    return 'That change does not apply to the outline as it stands.';
  }
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  /** Deleted, answered 410 to a reader, or just now by its deleter (the DL plan, DL-B). */
  | { readonly state: 'deleted' }
  | { readonly state: 'failed'; readonly signedOut: boolean }
  | { readonly state: 'unreadable' }
  | { readonly state: 'open'; readonly document: Opened };

const SOMEBODY_ELSE = 'Somebody else changed this document. This is how it stands now.';

const STARTS = {
  none: 'no longer starts on a new page',
  page: 'now starts on a new page',
  recto: 'now starts on a new right-hand page',
} as const;

/** What a node's matter is now, said after its name. */
const MATTERS = {
  front: 'is now front matter',
  body: 'is now in the body',
  appendix: 'is now an appendix',
} as const;

/**
 * What an act did, said once it is done, from the outline the service returned: where a moved node
 * landed, what was added or renamed. The panel announces it through its status region.
 */
function announce(
  operation: OutlineOperation,
  before: OutlineView,
  after: OutlineView,
  names: Names,
): string {
  switch (operation.operation) {
    case 'move': {
      const place = placeOf(after.nodes, operation.node);
      const was = placeOf(before.nodes, operation.node);
      if (!place) return 'Moved.';
      const name = nodeName(place.node, names);
      const previous = place.siblings[place.index - 1];
      const beside = previous ? `, after ${nodeName(previous, names)}` : '';
      const sameParent = (was?.parent?.id ?? null) === (place.parent?.id ?? null);
      if (place.parent !== null) {
        const parent = nodeName(place.parent, names);
        if (sameParent) {
          return previous
            ? `Moved ${name} after ${nodeName(previous, names)}.`
            : `Moved ${name} to the start of ${parent}.`;
        }
        return `Moved ${name} under ${parent}${beside}.`;
      }
      if (!previous) return `Moved ${name} to the start of the document.`;
      return sameParent
        ? `Moved ${name} after ${nodeName(previous, names)}.`
        : `Moved ${name} to the top level${beside}.`;
    }
    case 'insert': {
      const held = new Set(visibleOrder(before.nodes));
      const added = visibleOrder(after.nodes).find((id) => !held.has(id));
      const node = added === undefined ? undefined : placeOf(after.nodes, added)?.node;
      return node ? `Added ${nodeName(node, names)}.` : 'Added.';
    }
    case 'retitle': {
      const was = placeOf(before.nodes, operation.node)?.node;
      const now = placeOf(after.nodes, operation.node)?.node;
      return was && now
        ? `Renamed ${nodeName(was, names)} to ${nodeName(now, names)}.`
        : 'Renamed.';
    }
    case 'set': {
      const node = placeOf(after.nodes, operation.node)?.node;
      if (!node) return 'Changed.';
      if (operation.pageBreak !== undefined) {
        return `${nodeName(node, names)} ${STARTS[operation.pageBreak]}.`;
      }
      if (operation.numbered !== undefined) {
        return `${nodeName(node, names)} is ${operation.numbered ? 'now' : 'no longer'} numbered.`;
      }
      if (operation.matter !== undefined) {
        return `${nodeName(node, names)} ${MATTERS[operation.matter]}.`;
      }
      if (operation.mode?.kind === 'latest') {
        return `${nodeName(node, names)} now shows its latest version.`;
      }
      if (operation.mode?.kind === 'pinned') {
        return `${nodeName(node, names)} is now pinned to a version.`;
      }
      if (operation.mode?.kind === 'approved') {
        return `${nodeName(node, names)} now shows its latest approved revision.`;
      }
      return `Changed ${nodeName(node, names)}.`;
    }
    case 'remove': {
      const node = placeOf(before.nodes, operation.node)?.node;
      return node ? `Removed ${nodeName(node, names)}.` : 'Removed.';
    }
  }
}

/** The outline pane of layout C: 300px, dragged between 220 and 520, remembered by this browser. */
const OUTLINE_PANE = { storageKey: 'aw.outline.width', min: 220, max: 520, initial: 300 };
/** The panels beside the text: dragged as the outline is, and whether they are hidden to a rail. */
const DOCK_PANE = { storageKey: 'aw.document.panels', min: 280, max: 640, initial: 320 };
/** The same pane while it offers the Table tab: wider, and its width remembered apart (ADR-0052). */
const TABLE_PANE = { storageKey: 'aw.document.table', min: 360, max: 720, initial: 440 };

export interface DocumentPageProps {
  readonly client: Client;
  readonly id: string;
  /**
   * The node the address names, and which arrival of an address this is: a link followed a second
   * time to the same node is a new arrival, and is taken to it again.
   */
  readonly linked?: { readonly node: string; readonly arrival: number } | null;
  /** A link to the address already shown was followed, which no `hashchange` announces. */
  readonly onArriveAgain?: () => void;
  /**
   * The panel the address names (`#/documents/{id}/publishing`; the HM plan, HM-G), and which arrival
   * of it this is: each opens the pane at it, without remembering either as the reader's choice. A
   * failed request of the reader's it names is shown there.
   */
  readonly atPanel?: {
    readonly panel: 'publishing' | 'threads';
    readonly arrival: number;
    readonly request?: string | null;
    /** The thread the threads panel opens, in Review (`#/documents/{id}/review/threads/{thread}`). */
    readonly thread?: string;
  } | null;
  /** How long a publish waits before it is first asked about: given in tests, which need not wait. */
  readonly followMs?: number;
  /** The reader, for a component edited in place; without one, the text is read only. */
  readonly principalId?: string;
  /** Follows the document's stream: given in tests. */
  readonly follow?: (options: FollowOptions) => () => void;
}

/**
 * One document, open: its title, its version and space, and its outline in the panel.
 *
 * **It holds the outline the last operation returned, and an undo stack of inverse operations** (the
 * plan's decision 6): one entry per act (STR-008), each the one operation that takes it back, computed
 * from the outline before the act and the one that came back. It sends one operation at a time, and
 * the panel waits while one is in flight - the same `useRef` guard `NewComponent` uses, checked before
 * any await, so a second key that lands before React re-renders sends nothing.
 *
 * **A precondition refusal clears the stack** (STR-059, structure.md "Editing the outline"). The
 * refusal carries the outline as it now stands; the page shows that and says somebody else changed
 * it, and every entry on the stack was computed against an outline that no longer exists - undoing
 * one onto theirs is the silent overwrite STR-059 forbids. An act that changes nothing (decision K)
 * is neither a refusal nor an entry: the page says nothing and pushes nothing.
 */
const BOUNDARIES_KEY = 'alloy-works.boundaries';

/** The document view's three modes (document-view.md, "Modes"; CNT-155). */
type Mode = 'reading' | 'review' | 'authoring';

/** The panels beside the text, named in words (ADR-0046, decision 6; the LG plan, LG6c). */
const DOCK_PANELS = [
  // While a component open in place holds a table (ADR-0052).
  { key: 'table', label: 'Table' },
  { key: 'part', label: 'Part' },
  { key: 'document', label: 'Document' },
  { key: 'lists', label: 'Lists' },
  // A document's versions and their restore (the RS plan, RS-H); before Publishing, which End reaches.
  { key: 'versions', label: 'Versions' },
  { key: 'publishing', label: 'Publishing' },
  // In Review (the TH plan, Task 3; the SG plan, Task 3).
  { key: 'threads', label: 'Threads' },
  { key: 'suggestions', label: 'Suggestions' },
  // In Review (the RR plan, Task 4).
  { key: 'rounds', label: 'Rounds' },
] as const;

type DockPanel = (typeof DOCK_PANELS)[number]['key'];

const dockIds = (key: string) => ({ tab: `document-tab-${key}`, panel: `document-panel-${key}` });

/** The panel chosen last, remembered by this browser as the panes' widths are. */
export const DOCK_KEY = 'aw.document.dock';

const keptDock = (): DockPanel =>
  DOCK_PANELS.find((each) => each.key === kept(DOCK_KEY))?.key ?? 'part';

const MODES: readonly { readonly mode: Mode; readonly name: string }[] = [
  { mode: 'reading', name: 'Reading' },
  { mode: 'review', name: 'Review' },
  { mode: 'authoring', name: 'Authoring' },
];

const MODE_KEY = 'alloy-works.mode';

/** The mode this reader last chose; Authoring, where it is offered, the first time (DV-E). */
function keptMode(): Mode {
  try {
    const kept = window.localStorage.getItem(MODE_KEY);
    return kept === 'reading' || kept === 'review' ? kept : 'authoring';
  } catch {
    return 'authoring';
  }
}

/** Whether this reader last chose to see every component's boundaries. */
function keptBoundaries(): boolean {
  try {
    return window.localStorage.getItem(BOUNDARIES_KEY) === 'shown';
  } catch {
    return false;
  }
}

/** Tells the page once the theme's presentation is in, or refused: a linked node is held until then. */
function Presented({ onSettled }: { onSettled: () => void }) {
  const presentation = usePresentation();
  const settled = presentation !== null && presentation.state !== 'loading';
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);
  return null;
}

/** No bound table's rows read yet. */
const NO_ROWS: ReadonlyMap<string, TableRows> = new Map();
export function DocumentPage({
  client,
  id,
  linked = null,
  onArriveAgain,
  atPanel = null,
  followMs = FOLLOW_MS,
  principalId,
  follow,
}: DocumentPageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const outlinePane = usePaneWidth(OUTLINE_PANE);
  // The panels beside the text, hidden to a rail as the outline is, remembered as it is.
  const dockPane = usePaneWidth(DOCK_PANE);
  const tablePane = usePaneWidth(TABLE_PANE);
  // Where the Part panel stands: in that pane, once it is drawn.
  const [detailsHost, setDetailsHost] = useState<HTMLDivElement | null>(null);
  // Each occurrence's content, by node, from one call for the whole document (interface slice 9),
  // read again for every version the page shows and whenever a component edited in place closes.
  const [texts, setTexts] = useState<ReadonlyMap<string, unknown>>(new Map());
  // Whether the reader may edit each occurrence's component now, and who holds it (CNT-074).
  const [editable, setEditable] = useState<ReadonlyMap<string, Editable>>(new Map());
  // The number of the version each occurrence resolves to, by node (CNT-162), from the same answer.
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(new Map());
  const [revisionByNode, setRevisionByNode] = useState<ReadonlyMap<string, number>>(new Map());
  const [pastReviewNodes, setPastReviewNodes] = useState<ReadonlySet<string>>(new Set());
  const [textsAttempt, setTextsAttempt] = useState(0);
  // The version whose texts have been answered, or refused: until then the text is its headings alone,
  // and a node gone to now would be pushed down the page by every component above it as it fills in.
  const [textsRead, setTextsRead] = useState<string | null>(null);
  // Whether the texts were ever answered, and whether the last read of them failed: what the page says
  // refers to a node is known only from an answer (STR-074), never from a refusal or a wait given up.
  const [textsKnown, setTextsKnown] = useState<'checking' | 'known' | 'unknown'>('checking');
  // The one occurrence whose component is open in place: one editor, and so one lock, at a time.
  const [editing, setEditing] = useState<string | null>(null);
  // Reading, Review or Authoring (document-view.md, "Modes"; CNT-154, CNT-155): the reader's choice,
  // kept in the browser, Authoring the first time; which of them is on offer is decided below, from
  // what they may do.
  const [chosenMode, setChosenMode] = useState<Mode>(keptMode);
  // In Review: the occurrence a suggestion is being drafted in (the SG plan, SG-J), one at a time,
  // and how often the suggestions panel has been asked to read again.
  const [drafting, setDrafting] = useState<string | null>(null);
  const [suggestionsRead, setSuggestionsRead] = useState(0);
  // In Review: the threads the panel lists, and what the reader's selection offers a thread on.
  const [threadList, setThreadList] = useState<readonly ThreadSummary[]>([]);
  const [proposed, setProposed] = useState<{
    readonly node: string;
    readonly anchor: ThreadAnchor;
  } | null>(null);
  // The version each occurrence resolves to, by node: what a thread on its text is started against.
  const [occurrenceVersions, setOccurrenceVersions] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  // Each reference pinned below a newer version the reader may read, by node (CNT-181), from the same
  // answer: no request of its own.
  const [newerByNode, setNewerByNode] = useState<
    ReadonlyMap<
      string,
      { readonly pinned: VersionNamed; readonly newer: VersionNamed; readonly said?: string }
    >
  >(new Map());
  // The band a component open in place keeps its toolbar in (ADR-0056).
  const [band, setBand] = useState<HTMLElement | null>(null);
  const shownVersion = loaded.state === 'open' ? loaded.document.version.id : null;
  // Each occurrence's component, by node, for what the stream says of components (the PL plan, PL2).
  const componentOfNode = useMemo(() => {
    const found = new Map<string, string>();
    if (loaded.state !== 'open') return found;
    walkOutline(loaded.document.outline.nodes, (node) => {
      if (node.type === 'reference' && node.component !== null) found.set(node.id, node.component);
    });
    return found;
  }, [loaded]);
  // The document as it happens: who holds each component, who else is here (COL-001 to COL-007).
  const live = useLiveDocument({
    client,
    document: loaded.state === 'open' ? loaded.document.id : null,
    principalId,
    component: editing === null ? null : (componentOfNode.get(editing) ?? null),
    mode: editing !== null ? 'author' : chosenMode === 'review' ? 'review' : 'read',
    ...(follow === undefined ? {} : { follow }),
  });
  // What the page read of each component's lock, overtaken by what the stream has said since.
  const editableNow = useMemo(() => {
    const merged = new Map(editable);
    for (const [node, state] of editable) {
      const component = componentOfNode.get(node);
      const heard = component === undefined ? undefined : live.locks.get(component);
      if (heard === undefined) continue;
      merged.set(node, {
        ...state,
        lock:
          heard.holder === null || heard.expectedRelease === null
            ? null
            : {
                holder: { name: heard.holder.name },
                expectedRelease: heard.expectedRelease,
                yours: heard.holder.id === principalId,
              },
      });
    }
    return merged;
  }, [editable, componentOfNode, live.locks, principalId]);
  // How many broken references each occurrence's text drew (STR-038), as its card reports.
  const [brokenByNode, setBrokenByNode] = useState<ReadonlyMap<string, number>>(new Map());
  const onBroken = useCallback((node: string, count: number) => {
    setBrokenByNode((was) => (was.get(node) === count ? was : new Map(was).set(node, count)));
  }, []);
  // Who is in each component, for its card (COL-001).
  const presentIn = useMemo(() => {
    const found = new Map<string, LiveDocument['people'][number][]>();
    for (const person of live.people) {
      if (person.component === null) continue;
      found.set(person.component, [...(found.get(person.component) ?? []), person]);
    }
    return found;
  }, [live.people]);
  useEffect(() => {
    if (shownVersion === null) return undefined;
    let current = true;
    client
      .GET('/v1/documents/{id}/texts', { params: { path: { id } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) {
          setTextsRead(shownVersion);
          setTextsKnown((was) => (was === 'known' ? was : 'unknown'));
          return;
        }
        const contents = new Map(data.versions.map((version) => [version.id, version.content]));
        // Checked rather than trusted: the client's bodies are `any` underneath their types.
        const numbers = new Map(
          data.versions.flatMap((version) =>
            typeof version.number === 'string' ? [[version.id, version.number] as const] : [],
          ),
        );
        const byNode = new Map<string, unknown>();
        const numberOf = new Map<string, string>();
        setEditable(
          new Map(
            data.occurrences.map((occurrence) => [
              occurrence.node,
              {
                mayEdit: occurrence.mayEdit,
                mayComment: occurrence.mayComment === true,
                maySuggest: occurrence.maySuggest === true,
                pendingSuggestions: occurrence.pendingSuggestions ?? 0,
                lock: occurrence.lock,
              },
            ]),
          ),
        );
        for (const occurrence of data.occurrences) {
          if (occurrence.version === null) continue;
          const content = contents.get(occurrence.version);
          if (content !== undefined) byNode.set(occurrence.node, content);
          const number = numbers.get(occurrence.version);
          if (number !== undefined) numberOf.set(occurrence.node, number);
        }
        setTexts(byNode);
        setOccurrenceVersions(
          new Map(
            data.occurrences.flatMap((occurrence) =>
              occurrence.version === null ? [] : [[occurrence.node, occurrence.version] as const],
            ),
          ),
        );
        setResolved(numberOf);
        // Which references' components are past review (LIF-018; WF5-H).
        setPastReviewNodes(
          new Set(
            data.occurrences.flatMap((occurrence) =>
              occurrence.pastReview === true ? [occurrence.node] : [],
            ),
          ),
        );
        // Which revision each reference tracking the latest approved one shows (CNT-163).
        setRevisionByNode(
          new Map(
            data.occurrences.flatMap((occurrence) =>
              occurrence.revision === undefined
                ? []
                : [[occurrence.node, occurrence.revision] as const],
            ),
          ),
        );
        setNewerByNode(
          new Map(
            data.occurrences.flatMap((occurrence) => {
              const pinned = occurrence.version;
              const number = pinned === null ? undefined : numbers.get(pinned);
              if (pinned === null || number === undefined) return [];
              // A newer revision approved than the last publication carried (LIF-041; WF4-E): the
              // published one compared with the one it shows now.
              if (occurrence.moved !== undefined && occurrence.revision !== undefined) {
                return [
                  [
                    occurrence.node,
                    {
                      pinned: { id: occurrence.moved.id, number: occurrence.moved.number },
                      newer: { id: pinned, number },
                      said: `Revision ${occurrence.revision} is approved since the last publication, which carried ${occurrence.moved.number}.`,
                    },
                  ] as const,
                ];
              }
              return occurrence.newer === undefined
                ? []
                : [
                    [
                      occurrence.node,
                      {
                        pinned: { id: pinned, number },
                        newer: { id: occurrence.newer.id, number: occurrence.newer.number },
                      },
                    ] as const,
                  ];
            }),
          ),
        );
        setTextsRead(shownVersion);
        setTextsKnown('known');
      })
      // The text is the reading view beside the outline: where it cannot be read, the cards show
      // their titles alone, which is what they showed before it existed.
      .catch(() => {
        if (!current) return;
        setTextsRead(shownVersion);
        setTextsKnown((was) => (was === 'known' ? was : 'unknown'));
      });
    return () => {
      current = false;
    };
  }, [client, id, shownVersion, textsAttempt]);
  // A texts request that never answers must not keep a link from its node: a few seconds after the
  // version opens, the text is taken as whole as it will be (issue #336).
  useEffect(() => {
    if (shownVersion === null) return undefined;
    const givenUp = setTimeout(() => setTextsRead(shownVersion), LINK_WAITS_MS);
    return () => clearTimeout(givenUp);
  }, [shownVersion]);
  // What the document holds for each binding its texts hold (the B1 plan, B1-N): read with the texts,
  // and again whenever they are read again - after an editor's Done, a version cut, an outline act -
  // and only where a text holds a binding. A failed read shows no values, and says nothing.
  const [bindingStates, setBindingStates] = useState<readonly BindingState[] | null>(null);
  // Each text the page holds, read once whenever the texts are.
  const parsedTexts = useMemo(() => {
    const occurrences = new Map<string, readonly BlockNode[]>();
    for (const [node, content] of texts) {
      const read = readContent(content, { artifact: node, version: '' });
      if (read.ok) occurrences.set(node, read.document.content);
    }
    return occurrences;
  }, [texts]);
  // What in this document refers to each node (STR-074), from the last texts answered, against the
  // outline as it stands: texts are keyed by node, and an outline act changes none, so a removal
  // straight after one is still warned of. Never claimed from a refusal (`textsKnown`). A text not
  // given is never counted (SCH-032).
  const outlineShown = loaded.state === 'open' ? loaded.document.outline : null;
  const referencesTo = useMemo(
    () =>
      textsKnown !== 'known'
        ? textsKnown
        : outlineShown === null
          ? undefined
          : incomingReferences({ outline: outlineShown, occurrences: parsedTexts }),
    [outlineShown, parsedTexts, textsKnown],
  );
  // What matters about each node to an author (STR-038): who else holds its component, as the stream
  // says; the broken references its text drew; the values its bindings failed to hold.
  const outlineMarks = useMemo(() => {
    const marks = new Map<string, NodeMarks>();
    const mark = (node: string, more: NodeMarks) =>
      marks.set(node, { ...(marks.get(node) ?? {}), ...more });
    for (const [node, component] of componentOfNode) {
      const lock = live.locks.get(component);
      if (lock?.holder && lock.holder.id !== principalId) mark(node, { heldBy: lock.holder.name });
    }
    for (const [node, count] of brokenByNode)
      if (count > 0) mark(node, { brokenReferences: count });
    const failed = new Map<string, number>();
    for (const view of bindingStates ?? []) {
      if (dataState(view, false) === 'failed')
        failed.set(view.node, (failed.get(view.node) ?? 0) + 1);
    }
    for (const [node, count] of failed) mark(node, { failedValues: count });
    return marks;
  }, [componentOfNode, live.locks, principalId, brokenByNode, bindingStates]);
  const holdsBindings = useMemo(() => [...texts.values()].some(holdsBinding), [texts]);
  // The editing session of the editor open in place once it has placed or changed a binding, whose
  // bindings the view is read with until it closes (B2-C), and a count read again by.
  const [bindingSession, setBindingSession] = useState<string | null>(null);
  // The editor open in place's last acknowledged save (the TB2 final review): its bound tables' rows
  // are read with its session whenever one is open, and asked again after each save.
  const [editorSaved, setEditorSaved] = useState<{
    readonly session: string;
    readonly sequence: number;
  } | null>(null);
  // DAT-091's warning, asked before a binding placed or resolved here holds one's own view (D7-H).
  const { ask: askOwnView, prompt: ownViewPrompt } = useOwnViewAsk();
  const { ask: askRevision, prompt: revisionPrompt } = useRevisionAsk();
  // A value being revised by hand, or its revision withdrawn, in the dialog over the page (RV-I).
  const [revising, setRevising] = useState<Revising | null>(null);
  const [bindingsRead, setBindingsRead] = useState(0);
  // The bound tables the editor open in place holds, which no save may have reached (TB2-H), and every
  // bound table by its node and binding: the Data tab's to check, and the text's to lay out.
  const [editingTables, setEditingTables] = useState<{
    readonly node: string;
    readonly tables: readonly BoundTableNode[];
  } | null>(null);
  const boundTables = useMemo(() => boundTablesByKey(texts, editingTables), [texts, editingTables]);
  // The rows the text has read for its bound tables, which the Data tab fails a note by (TB3.3).
  const [tableRows, setTableRows] = useState<ReadonlyMap<string, TableRows>>(NO_ROWS);
  // The template's declarations the Parameters panel read, by document, for the Value dialog (TP2-F).
  const [declared, setDeclared] = useState<{
    readonly document: string;
    readonly declarations: readonly TemplateParameter[] | null;
  } | null>(null);
  useEffect(() => {
    if (!holdsBindings && bindingSession === null) {
      setBindingStates(null);
      return undefined;
    }
    let current = true;
    client
      .GET('/v1/documents/{id}/bindings', {
        params: {
          path: { id },
          query: bindingSession === null ? {} : { session: bindingSession },
        },
      })
      .then(({ data }) => {
        if (current) setBindingStates(bindingStatesIn(data) ?? null);
      })
      .catch(() => {
        if (current) setBindingStates(null);
      });
    return () => {
      current = false;
    };
  }, [client, id, texts, holdsBindings, bindingSession, bindingsRead]);
  // The check this page makes (B4-F; BI-I): once, after the view first answers, where some binding is
  // checked and this reader may check it, and again on Check now; each binding it failed for kept, in
  // the product's words, for the page's life, since a failed check records nothing (DAT-086).
  const [checkFailures, setCheckFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const [checking, setChecking] = useState(false);
  const checkedOnOpen = useRef(false);
  const checkNow = useCallback(() => {
    setChecking(true);
    void client
      .POST('/v1/documents/{id}/bindings/check', { params: { path: { id } }, body: {} })
      .then(async ({ data }) => {
        if (!data) return;
        const failed = new Map<string, string>();
        // A different result holding images is recorded once every one is admitted (the D8 plan,
        // D8-F): each followed, as an upload is, and taken as the check's own result for it.
        const results: { node: string; binding: string; outcome: string; failure?: unknown }[] = [
          ...data.results,
        ];
        const pending = data.results.filter((each) => each.outcome === 'pending');
        if (pending.length > 0) setNotice(WAITING_ON_IMAGES);
        for (const each of pending) {
          const followed = await followPending(client, each.pending);
          const at = results.indexOf(each);
          results[at] =
            'sentence' in followed
              ? { ...each, outcome: 'failed', failure: { message: followed.sentence } }
              : (followed.done as (typeof results)[number]);
        }
        if (pending.length > 0) {
          setNotice((held) => (held === WAITING_ON_IMAGES ? null : held));
        }
        for (const each of results) {
          if (each.outcome !== 'failed') continue;
          const said = (each.failure as { message?: unknown }).message;
          failed.set(
            `${each.node} ${each.binding}`,
            typeof said === 'string' ? said : 'The value could not be checked.',
          );
        }
        setCheckFailures(failed);
        if (failed.size > 0) {
          setNotice(
            failed.size === 1
              ? 'A value could not be checked. See the Data tab.'
              : `${failed.size} values could not be checked. See the Data tab.`,
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setChecking(false);
        setBindingsRead((count) => count + 1);
      });
  }, [client, id]);
  useEffect(() => {
    if (bindingStates === null || checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    if (bindingStates.some((each) => each.binding.mode === 'checked' && each.mayCheck)) checkNow();
  }, [bindingStates, checkNow]);
  /**
   * Opens the revision dialog on a value, or a bound table's cells (RV-I, RV-J): a table's cells may be
   * revised in a value column it shows - never its key, a group's column or subtotal, or the column it
   * is turned by.
   */
  const openRevising = (node: string, binding: string, act: 'revise' | 'withdraw') => {
    const state = bindingStates?.find((each) => each.node === node && each.binding.id === binding);
    if (state?.held == null) return;
    const table = boundTables.get(tableKey(node, binding));
    const columns =
      table === undefined
        ? []
        : table.columns.flatMap((shown) => {
            const declared = state.held!.provenance.columns.find(
              (each) => each.name === shown.column,
            );
            return declared === undefined ||
              !cellRevisable(table, state.held!.key ?? [], shown.column) ||
              (declared.type as { base?: string }).base === 'image'
              ? []
              : [{ name: shown.column, type: declared.type as ColumnType }];
          });
    setRevising({ node, state, act, columns });
  };
  /**
   * A binding the editor in place placed, changed, or asked to keep or resolve (B2-C, B2-H): resolved
   * or kept from its session, said where it was left holding nothing, and the view read again.
   */
  const onBindingSettle = (
    node: string,
    binding: string,
    session: string | null,
    act: SettleAct,
  ) => {
    if (session !== null) setBindingSession(session);
    // The product's formats in the ask's words: the theme's are the presentation's, below the page.
    const formats = formatsFor(
      null,
      loaded.state === 'open' ? loaded.document.outline.language : null,
    );
    void settleBinding(client, id, node, binding, session, act, {
      onWaiting: setNotice,
      ask: askOwnView,
      decide: (current, named) =>
        askRevision({
          standing: (current.revisions ?? []).filter((each) => each.stands),
          queried: said(current.held?.taken ?? null, formats, current.binding),
          next: null,
          act: named,
        }),
    })
      // What it says replaces the waiting it said meanwhile, which goes once nothing is to be said.
      .then((said) => setNotice((held) => said ?? (held === WAITING_ON_IMAGES ? null : held)))
      .catch(() => undefined)
      .finally(() => setBindingsRead((count) => count + 1));
  };
  // The value whose provenance is open over the page, and what opened it, to be given the focus back.
  // `last` is the view of it last read, kept while a re-read answers nothing for it or fails, so the
  // panel, and the focus in it, stay where they are.
  const [provenance, setProvenance] = useState<{
    readonly node: string;
    readonly binding: string;
    readonly opener: HTMLElement | null;
    readonly last?: BindingState;
  } | null>(null);
  const closeProvenance = () => {
    const opened = provenance;
    // Closed at once, so the page behind it is no longer inert when the focus goes back.
    flushSync(() => setProvenance(null));
    if (opened === null) return;
    // The text may have been drawn again since: the value's button is then found where it stands.
    const back =
      opened.opener?.isConnected === true
        ? opened.opener
        : textColumn.current?.querySelector<HTMLElement>(
            `[data-node="${opened.node}"] [role="button"][data-binding="${opened.binding}"]`,
          );
    back?.focus();
  };
  const provenanceFound =
    provenance === null
      ? undefined
      : bindingStates?.find(
          (each) => each.node === provenance.node && each.binding.id === provenance.binding,
        );
  const provenanceState = provenanceFound?.held ? provenanceFound : provenance?.last;
  useEffect(() => {
    if (!provenanceFound?.held) return;
    setProvenance((open) =>
      open !== null &&
      open.last !== provenanceFound &&
      open.node === provenanceFound.node &&
      open.binding === provenanceFound.binding.id
        ? { ...open, last: provenanceFound }
        : open,
    );
  }, [provenanceFound]);
  // Who holds what changes while the page is in another window's shadow: returning to it hears it.
  useEffect(() => {
    const again = () => setTextsAttempt((attempt) => attempt + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  const [attempt, setAttempt] = useState(0);
  const [undo, setUndo] = useState<readonly OutlineOperation[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, chooseTab] = useOutlineTab(OUTLINE_PANE.storageKey);
  // The notice and what the document holds go to the application's status bar, its one live region
  // (interface slice 15); a page rendered on its own, outside the shell, draws the bar itself.
  const status = useStatus();
  useEffect(() => {
    status?.say(notice);
  }, [status, notice]);
  useEffect(() => () => status?.say(null), [status]);
  const shownDocument = loaded.state === 'open' ? loaded.document : null;
  const context = shownDocument === null ? null : aboutDocument(shownDocument);
  const contextKey = context?.join('\n') ?? null;
  // Said only while this page is the one shown: a page left for another stays mounted, hidden.
  const pageShown = usePageShown();
  useEffect(() => {
    if (status === null || contextKey === null || !pageShown) return undefined;
    status.describe(contextKey.split('\n'));
    return () => status.describe(null);
  }, [status, contextKey, pageShown]);
  const pending = useRef(false);
  // The document as the page last received it - written where an answer arrives, never during render.
  const latest = useRef<Opened | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  // Counted so the panel can tell a held retitle how the act it waited on was answered.
  const [refusals, setRefusals] = useState(0);
  const [signedOuts, setSignedOuts] = useState(0);
  const [components, setComponents] = useState<ComponentChoices>({ state: 'loading' });
  const [componentsAttempt, setComponentsAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/documents/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (!current) return;
        const read = documentIn(data);
        if (read === 'unreadable') setLoaded({ state: 'unreadable' });
        else if (read !== undefined) {
          latest.current = read;
          setLoaded({ state: 'open', document: read });
        }
        // Only a 404 means missing or unreadable, which the service answers alike: signed out, a
        // server error or no answer is not the document's absence.
        else if (response.status === 404) setLoaded({ state: 'missing' });
        else if (response.status === 410) setLoaded({ state: 'deleted' });
        else setLoaded({ state: 'failed', signedOut: response.status === 401 });
      })
      .catch(() => {
        if (current) setLoaded({ state: 'failed', signedOut: false });
      });
    return () => {
      current = false;
    };
  }, [client, id, attempt]);

  // Every component the caller may read, read to its end by the shared `everyPage`: what **Add
  // component** offers, and what names a reference - one that is not among them is one the caller may
  // not read. A listing cut short, by a missing, malformed or repeated cursor, is a failure rather than
  // a shorter answer, or a readable component past the cut would be named as one the caller may not
  // read.
  useEffect(() => {
    let current = true;
    setComponents({ state: 'loading' });
    everyPage((cursor) =>
      client.GET('/v1/components', { params: { query: cursor === undefined ? {} : { cursor } } }),
    )
      .then((answer) => {
        if (!current) return;
        if ('status' in answer) {
          setComponents({ state: 'failed', signedOut: answer.status === 401 });
          return;
        }
        setComponents({ state: 'loaded', items: componentsIn(answer.items) });
      })
      .catch(() => {
        if (current) setComponents({ state: 'failed', signedOut: false });
      });
    return () => {
      current = false;
    };
  }, [client, componentsAttempt]);

  // What each occurrence contributes, asked again whenever the version the page holds changes - an
  // act of the author's, a refusal carrying somebody else's - so a component's new head is heard about
  // no later than the next act. Until the answer arrives the page numbers with the last one, keyed by
  // occurrence, so a move renumbers at once; an occurrence it has not heard about is not known.
  const [known, setKnown] = useState<Known>({ state: 'loading' });
  const [knownAttempt, setKnownAttempt] = useState(0);
  const heldVersion = loaded.state === 'open' ? loaded.document.version.id : null;
  useEffect(() => {
    if (heldVersion === null) return;
    let current = true;
    client
      .GET('/v1/documents/{id}/contributions', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (!current) return;
        const read = contributionsIn(data);
        setKnown(
          read === undefined
            ? { state: 'failed', signedOut: response.status === 401 }
            : { state: 'loaded', contributions: read },
        );
      })
      .catch(() => {
        if (current) setKnown({ state: 'failed', signedOut: false });
      });
    return () => {
      current = false;
    };
  }, [client, id, heldVersion, knownAttempt]);

  const names: Names = useMemo(
    () =>
      components.state === 'loaded'
        ? new Map(components.items.map((each) => [each.id, each.title]))
        : null,
    [components],
  );

  const opened = loaded.state === 'open' ? loaded.document : null;
  // A preview of the version the page holds, asked for beside Publish and shown in a pane beside the
  // text (publishing.md, "Shown beside the text"; PV-G), which stays where it was, an editor open in
  // it included (CNT-150).
  const preview = usePreview({
    client,
    document: id,
    version: opened?.version ?? null,
    title: opened?.outline.title ?? '',
    followMs,
  });
  // Who a `user` field may name, read only where a field of the document or its sections is one.
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  const wantsPeople =
    opened !== null &&
    ([...opened.fields.document, ...opened.fields.section].some(
      (each) => each.dataType === 'user',
    ) ||
      chosenMode === 'review');
  useEffect(() => {
    if (!wantsPeople) return;
    let current = true;
    // Every page, then by name: the listing gives people in the order each first appeared.
    everyPage((cursor) =>
      client.GET('/v1/people', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((all) => {
        if (current && 'items' in all) setPeople(byName(all.items));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, wantsPeople]);

  /** Shows a document, and remembers it as the latest one the page holds (here, and restand's standing). */
  const show = useCallback((document: Opened) => {
    latest.current = document;
    outlineGeneration.current += 1;
    setLoaded({ state: 'open', document });
  }, []);

  // What Add component offers and the Part panel names, each state as its stream last said (WF-G).
  const componentsNow = useMemo<ComponentChoices>(
    () =>
      components.state === 'loaded' && live.states.size > 0
        ? {
            ...components,
            items: components.items.map((each) => {
              const heard = live.states.get(each.id);
              return heard === undefined ? each : { ...each, state: heard };
            }),
          }
        : components,
    [components, live.states],
  );
  // Its state read again, with what the reader may take from it, as its stream says it moved (WF-G).
  const restand = useCallback(() => {
    void readStanding(client, 'document', id).then((standing) => {
      // Only the standing: an outline read in flight still lands (the WF1 final review, finding 1).
      if (standing && latest.current?.id === id) {
        const document = { ...latest.current, standing };
        latest.current = document;
        setLoaded({ state: 'open', document });
      }
    });
  }, [client, id]);
  const heardState = live.states.get(id);
  useEffect(() => {
    if (heardState !== undefined) restand();
  }, [heardState, restand]);

  // Another person's change to the outline (STR-066; the PL plan, PL-J): read again as its stream
  // says, once no act of this page's own is in flight - one that is, answers with the outline as it
  // then stands, and the read waits for it. This page's own change comes back as the version it holds.
  const outlineBehind = useRef(false);
  // Counts each outline shown and each read begun: a read whose answer arrives after either is older
  // than what the page now holds, and is dropped (the PL final review, finding 3).
  const outlineGeneration = useRef(0);
  const readOutlineAgain = useCallback(async () => {
    if (pending.current) {
      outlineBehind.current = true;
      return;
    }
    outlineBehind.current = false;
    outlineGeneration.current += 1;
    const asked = outlineGeneration.current;
    try {
      const { data } = await client.GET('/v1/documents/{id}', { params: { path: { id } } });
      const read = documentIn(data);
      if (read === undefined || read === 'unreadable' || pending.current) return;
      if (outlineGeneration.current !== asked) return;
      if (latest.current !== null && read.version.id === latest.current.version.id) return;
      show(read);
    } catch {
      // The next change, or a reload, reads it again.
    }
  }, [client, id, show]);
  useEffect(() => {
    if (live.outlineChanges > 0) void readOutlineAgain();
  }, [live.outlineChanges, readOutlineAgain]);
  useEffect(() => {
    if (!busy && outlineBehind.current) void readOutlineAgain();
  }, [busy, readOutlineAgain]);

  /**
   * The document's own values, whole, as its next version with the outline unchanged
   * (definitions.md): one act at a time, as an outline act is, and told the same way when somebody
   * else moved first.
   */
  const saveValues = useCallback(
    async (next: Record<string, unknown>): Promise<SaveAnswer> => {
      if (pending.current || opened === null) return 'unsent';
      const before = latest.current ?? opened;
      pending.current = true;
      setBusy(true);
      try {
        const { data, error, response } = await client.PUT('/v1/documents/{id}/values', {
          params: { path: { id } },
          body: { openedFrom: before.version.id, values: next },
        });
        const after = documentIn(data);
        if (after !== undefined && after !== 'unreadable') {
          show(after);
          setNotice(null);
          return 'saved';
        }
        if (response.status === 409) {
          const refusal: unknown = error;
          const current = documentIn(isRecord(refusal) ? refusal.current : undefined);
          if (current !== undefined && current !== 'unreadable') show(current);
          else setAttempt((count) => count + 1);
          setNotice(SOMEBODY_ELSE);
          return 'refused';
        }
        if (response.status === 401) {
          setSignedOuts((count) => count + 1);
          setNotice('You are signed out. Sign in again to change this document.');
          return 'refused';
        }
        if (response.status === 400 || response.status === 403 || response.status === 404) {
          setNotice(
            isRecord(error) && typeof error.message === 'string'
              ? error.message
              : 'The fields could not be saved.',
          );
          return 'refused';
        }
        setNotice('The fields were not saved. Try again.');
        return 'unsent';
      } catch {
        setNotice('The fields were not saved. Try again.');
        return 'unsent';
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [client, id, opened, show],
  );

  /**
   * The document's parameters, whole, as its next version with the outline and values unchanged (the
   * TP1 plan, TP1-H): one act at a time through the same guard, the page then holding the version
   * the PUT answers, so the next act opens from it.
   */
  const saveParameters = useCallback(
    async (next: Record<string, ParameterValue>): Promise<ParametersSaved> => {
      if (pending.current || opened === null) return { answer: 'unsent' };
      const before = latest.current ?? opened;
      pending.current = true;
      setBusy(true);
      try {
        const { data, error, response } = await client.PUT('/v1/documents/{id}/parameters', {
          params: { path: { id } },
          body: { openedFrom: before.version.id, parameters: next },
        });
        const after = documentIn(data);
        if (after !== undefined && after !== 'unreadable') {
          show(after);
          setNotice(null);
          return { answer: 'saved' };
        }
        if (response.status === 409) {
          const refusal: unknown = error;
          const current = documentIn(isRecord(refusal) ? refusal.current : undefined);
          if (current !== undefined && current !== 'unreadable') show(current);
          else setAttempt((count) => count + 1);
          setNotice(SOMEBODY_ELSE);
          return { answer: 'refused' };
        }
        if (response.status === 401) {
          setSignedOuts((count) => count + 1);
          setNotice('You are signed out. Sign in again to change this document.');
          return { answer: 'refused' };
        }
        if (response.status === 400 || response.status === 403 || response.status === 404) {
          setNotice(
            isRecord(error) && typeof error.message === 'string'
              ? error.message
              : 'The parameters could not be saved.',
          );
          return { answer: 'refused', refusal: error };
        }
        setNotice('The parameters were not saved. Try again.');
        return { answer: 'unsent' };
      } catch {
        setNotice('The parameters were not saved. Try again.');
        return { answer: 'unsent' };
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [client, id, opened, show],
  );

  const apply = useCallback(
    async (operation: OutlineOperation, undoing: boolean): Promise<Answered> => {
      if (pending.current || opened === null) return 'unsent';
      // A belt over what the `busy` checks already close: every handler in the panel reads `busy`
      // from the same render as the outline it acts on, so no act from an older render should reach
      // here. Were one to - computed against an outline before the answer the page now holds - it
      // would be refused as a conflict with the author's own act, so it is not sent at all.
      if (opened.version.id !== latest.current?.version.id) return 'unsent';
      const before = opened;
      pending.current = true;
      setBusy(true);
      // An undo's entry, taken off the stack once it has been answered for good.
      const spend = () => setUndo((stack) => stack.slice(0, -1));
      // Refused: the page now shows an outline other than the one the act was made against.
      const refuse = (message: string): Answered => {
        setNotice(message);
        setRefusals((count) => count + 1);
        return 'refused';
      };
      // Not sent, or not recorded: nothing changed, so what the author made is kept to try again.
      const unsent = (message: string): Answered => {
        setNotice(message);
        return 'unsent';
      };
      const failed = () =>
        unsent(
          undoing
            ? 'The change was not undone. Try it again.'
            : 'The change was not saved. Try it again.',
        );
      try {
        const { data, error, response } = await client.POST('/v1/documents/{id}/outline', {
          params: { path: { id } },
          body: { openedFrom: before.version.id, operation: operation as unknown as WireOperation },
        });
        const after = documentIn(data);
        if (after !== undefined && after !== 'unreadable') {
          show(after);
          if (after.version.id === before.version.id) {
            // Decision K: put back where it was, so the chain keeps no row - not a refusal, and not
            // an act worth an undo entry. An undo answered this way is spent all the same.
            if (undoing) spend();
            setNotice(null);
            return after.outline;
          }
          const said = announce(operation, before.outline, after.outline, names);
          if (undoing) {
            spend();
            setNotice(`Undone. ${said}`);
          } else {
            const inverse = inverseOf(before.outline, after.outline, operation);
            // An act with no inverse - a removal - ends the stack: every entry under it was computed
            // against an outline that still held what the removal took.
            setUndo((stack) => (inverse === null ? [] : [...stack, inverse]));
            setNotice(said);
          }
          return after.outline;
        }
        if (after === 'unreadable') {
          // The act may well have been recorded, but what came back cannot be shown or acted on, so the
          // page says so in place of the outline rather than going on offering a stale one.
          setLoaded({ state: 'unreadable' });
          return 'refused';
        }
        switch (response.status) {
          case 409: {
            setUndo([]);
            const refusal: unknown = error;
            const current = documentIn(isRecord(refusal) ? refusal.current : undefined);
            if (current !== undefined && current !== 'unreadable') {
              show(current);
            } else {
              // A refusal that does not carry a readable outline still means ours is stale: read it.
              setAttempt((count) => count + 1);
            }
            return refuse(SOMEBODY_ELSE);
          }
          case 401:
            setSignedOuts((count) => count + 1);
            setNotice('You are signed out. Sign in again to change this document.');
            return 'signedOut';
          case 403:
            // Nothing more is offered that could only be refused again.
            show({ ...before, mayEdit: false });
            return refuse('You may not change this document.');
          case 404:
            // Not readable any more either, so the page stops saying it may be read.
            setWithdrawn(true);
            show({ ...before, mayEdit: false });
            return refuse('This document is no longer open to you.');
          case 400:
            if (undoing) {
              // Every entry beneath this one was computed for a state that will now never exist.
              setUndo([]);
              return refuse(
                isRecord(error) && error.code === 'outline_invalid'
                  ? 'That change cannot be undone any more.'
                  : 'The change could not be made.',
              );
            }
            return refuse(doesNotApply(error));
          default:
            return failed();
        }
      } catch {
        return failed();
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [client, id, names, opened, show],
  );

  // A component's versions, newest first, a page at a time (document-view.md, "Versions"): what a
  // reference's label offers it to be pinned to. Each checked rather than trusted; null where the page
  // could not be read, which the list says.
  const listVersions = useCallback(
    async (component: string, cursor: string | undefined) => {
      const { data } = await client.GET('/v1/components/{id}/versions', {
        params: { path: { id: component }, query: cursor === undefined ? {} : { cursor } },
      });
      if (!isRecord(data) || !Array.isArray(data.items)) return null;
      const items = (data.items as unknown[]).flatMap((each): OfferedVersion[] =>
        isRecord(each) &&
        typeof each.id === 'string' &&
        typeof each.number === 'string' &&
        typeof each.createdAt === 'string'
          ? [{ id: each.id, number: each.number, createdAt: each.createdAt }]
          : [],
      );
      return { items, next: typeof data.next === 'string' ? data.next : null };
    },
    [client],
  );
  // Choosing one is the outline's own act on the reference's mode (CNT-158), which the store checks
  // (CNT-160); the texts are read again for the version it makes, so the label then says what it is.
  const choosing: Choosing = useMemo(
    () => ({
      list: listVersions,
      choose: async (node, mode) => {
        const answer = await apply({ operation: 'set', node, mode }, false);
        return typeof answer !== 'string';
      },
    }),
    [listVersions, apply],
  );

  // Every component's edges and label, rather than on hover and focus (document-view.md, "Boundaries";
  // CNT-073): this reader's choice, kept in the browser as a convenience.
  const [boundaries, setBoundaries] = useState(keptBoundaries);
  const [dock, setDockState] = useState<DockPanel>(keptDock);
  const setDock = (next: DockPanel) => {
    setDockState(next);
    keep(DOCK_KEY, next);
  };
  // Whether the component open in place holds a table, and where its formatting is set (ADR-0052):
  // the Table tab is offered while it does, and chosen each time the cursor enters a table.
  const [heldTable, setHeldTable] = useState({ holds: false, entered: 0 });
  const [tableHost, setTableHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (heldTable.entered > 0) setDockState('table');
  }, [heldTable.entered]);
  // The panel an address names, opened once for each arrival of it (HM-G).
  const openedAt = useRef<number | null>(null);
  const { setCollapsed: setDockCollapsed } = dockPane;
  const panelNamed = atPanel?.panel ?? null;
  const panelArrival = atPanel?.arrival ?? null;
  useEffect(() => {
    if (panelNamed === null || openedAt.current === panelArrival) return;
    openedAt.current = panelArrival;
    // The threads are Review's (CNT-157): it is chosen for this page, not kept as the reader's choice.
    if (panelNamed === 'threads') setChosenMode('review');
    setDockState(panelNamed);
    setDockCollapsed(false, false);
  }, [panelNamed, panelArrival, setDockCollapsed]);
  // Where the reader is in the text, and the node a link took them to (document-view.md, "Navigation";
  // STR-035, STR-045): the one the outline marks as the current location, and the one the text marks
  // until another is chosen.
  const textColumn = useRef<HTMLDivElement>(null);
  // The desk the document's sheet stands on (ADR-0056), reached by the keyboard while it scrolls.
  useReachableDesk(textColumn);
  const [inView, setInView] = useState<string | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
  useReadingPosition(textColumn, setInView, loaded.state === 'open' ? loaded.document.id : null);
  // A link's node is gone to once its text is there: the text arrives after the outline, so the
  // arrival waits, and is taken once however often the page draws.
  const arriving = useRef<string | null>(null);
  const arrived = useRef<number | null>(null);
  useEffect(() => {
    if (linked === null || arrived.current === linked.arrival) return;
    arrived.current = linked.arrival;
    arriving.current = linked.node;
    setMarked(linked.node);
  }, [linked]);
  // Nor once they have done anything with the page themselves while it waited - a wheel, a key, a
  // press of the pointer, a scroll of their own however made: going then would pull them back from
  // where they took it (issues #336, #350). Taken before anything below can prevent it.
  const waiting = useRef<{ readonly stop: () => void } | null>(null);
  const stopWaiting = () => {
    waiting.current?.stop();
    waiting.current = null;
  };
  useEffect(() => {
    const node = arriving.current;
    if (node === null) return undefined;
    const watch = watchReader(
      () => textColumn.current?.querySelector(`[data-node="${node}"]`) ?? null,
      {
        reader: () => {
          arriving.current = null;
          stopWaiting();
        },
      },
    );
    waiting.current = watch;
    return () => watch.stop();
  }, [linked?.arrival]);
  // The theme's presentation in, or refused: told by the provider below, which the page renders.
  const [presented] = useState(() => {
    let told!: () => void;
    const promise = new Promise<void>((resolve) => (told = resolve));
    return { promise, told };
  });
  // And held there as what is above it settles - the theme and its faces, and a Fit zoom refitting
  // to a window resized - until the page has settled or the reader acts (issue #350): let go by the
  // reader, by another node chosen, and by the page going.
  const holding = useRef<(() => void) | null>(null);
  const letGo = () => {
    holding.current?.();
    holding.current = null;
  };
  useEffect(
    () => () => {
      stopWaiting();
      letGo();
    },
    [],
  );
  useEffect(() => {
    // Gone to once the text is whole, so the components above it have taken their room (issue #336).
    const column = textColumn.current;
    if (arriving.current === null || textsRead !== shownVersion || column === null) return;
    const node = arriving.current;
    const element = column.querySelector(`[data-node="${node}"]`);
    if (!element) return;
    arriving.current = null;
    stopWaiting();
    element.scrollIntoView?.({ block: 'start' });
    letGo();
    holding.current = holdInPlace(() => column.querySelector(`[data-node="${node}"]`), column, {
      settled: pageSettled(presented.promise),
    });
  });
  const chooseMode = (mode: Mode) => {
    setChosenMode(mode);
    // Reading and Review offer no editor, so one open in place closes as the page drops to either.
    if (mode !== 'authoring') setEditing(null);
    // Review's panel is the threads (CNT-157).
    if (mode === 'review') setDock('threads');
    else setDrafting(null);
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Storage refused: the choice holds for this page and is not kept.
    }
  };
  // In Review, what the reader selects in a component's text offers a thread on it (COL-012): a
  // span of one block, or a caret in a table's cell. A selection elsewhere - in the panel, typing the
  // comment - leaves what was offered as it was.
  useEffect(() => {
    if (chosenMode !== 'review') {
      setProposed(null);
      return undefined;
    }
    const page = textColumn.current?.ownerDocument;
    if (!page) return undefined;
    const choose = () => {
      const selection = page.getSelection();
      const column = textColumn.current;
      if (!selection || selection.rangeCount === 0 || !column) return;
      const start = selection.getRangeAt(0).startContainer;
      if (!column.contains(start)) return;
      const element = start instanceof Element ? start : start.parentElement;
      const host = element?.closest<HTMLElement>(`.${TEXT_CLASS}`);
      const node = host?.closest<HTMLElement>('[data-node]')?.dataset.node;
      const content = node === undefined ? undefined : texts.get(node);
      if (!host || node === undefined || content === undefined) return setProposed(null);
      let anchor: ThreadAnchor | null;
      try {
        anchor = anchorFromSelection(selection, host, parseContentDocument(content));
      } catch {
        anchor = null;
      }
      setProposed(anchor === null ? null : { node, anchor });
    };
    page.addEventListener('selectionchange', choose);
    return () => page.removeEventListener('selectionchange', choose);
  }, [chosenMode, texts]);
  const showBoundaries = (shown: boolean) => {
    setBoundaries(shown);
    try {
      if (shown) window.localStorage.setItem(BOUNDARIES_KEY, 'shown');
      else window.localStorage.removeItem(BOUNDARIES_KEY);
    } catch {
      // Storage refused: the choice holds for this page and is not kept.
    }
  };

  if (loaded.state === 'loading') return <Waiting>Opening...</Waiting>;
  // A document that did not open has no outline pane, and so no arrow back: each notice carries it.
  const back = (
    <p>
      <a href="#/documents">Back to documents</a>
    </p>
  );
  if (loaded.state === 'missing') {
    return (
      <Notice tone="refused">
        <p>There is nothing here, or nothing you may read.</p>
        {back}
      </Notice>
    );
  }
  if (loaded.state === 'deleted') {
    return (
      <Notice tone="refused">
        <p>This document has been deleted.</p>
        {back}
      </Notice>
    );
  }
  if (loaded.state === 'failed') {
    if (loaded.signedOut) {
      return (
        <Notice tone="signedOut">
          <p>You are signed out. Sign in again to open this document.</p>
          {back}
        </Notice>
      );
    }
    return (
      <Notice tone="failed">
        <p>The document could not be opened.</p>
        <button
          type="button"
          onClick={() => {
            setLoaded({ state: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
        {back}
      </Notice>
    );
  }
  if (loaded.state === 'unreadable') {
    return (
      <Notice tone="failed">
        <p>This document could not be read.</p>
        {back}
      </Notice>
    );
  }

  const { document } = loaded;
  // Authoring is offered where the reader may restructure the document or edit any component it places
  // (CNT-105): derived from the decisions the page is told, so a mode they cannot have is never shown.
  const mayAuthor = document.mayEdit || [...editable.values()].some((each) => each.mayEdit);
  const authoring = mayAuthor && chosenMode === 'authoring';
  // Review is offered where the reader may comment on or suggest to the document, or comment on any
  // component it places (IAM-081): the text as Reading shows it, and the threads beside it (CNT-157).
  const mayReview =
    document.mayReview || [...editable.values()].some((each) => each.mayComment === true);
  const reviewing = mayReview && chosenMode === 'review';
  const modeNow: Mode = authoring ? 'authoring' : reviewing ? 'review' : 'reading';
  const offered = MODES.filter(
    ({ mode }) =>
      mode === 'reading' || (mode === 'review' && mayReview) || (mode === 'authoring' && mayAuthor),
  );
  // What a thread may be started on here (COL-012): the selection's span or cell, each component the
  // reader may comment on as a whole, and each section where they may comment on the document.
  const place = (node: string) => placeInOutline(document.outline, node, names, document.scheme);
  const targets: ReviewTarget[] = [];
  if (reviewing) {
    const proposedComponent = proposed === null ? undefined : componentOfNode.get(proposed.node);
    const proposedVersion = proposed === null ? undefined : occurrenceVersions.get(proposed.node);
    if (
      proposed !== null &&
      proposedComponent !== undefined &&
      proposedVersion !== undefined &&
      editable.get(proposed.node)?.mayComment === true
    ) {
      targets.push({
        key: 'selection',
        label:
          proposed.anchor.kind === 'cell'
            ? `The table cell in ${place(proposed.node)}`
            : `The selected text ${anchorWords(proposed.anchor)}`,
        on: { kind: 'component', id: proposedComponent },
        version: proposedVersion,
        anchor: proposed.anchor,
      });
    }
    walkOutline(document.outline.nodes, (node) => {
      if (node.type === 'reference') {
        const version = occurrenceVersions.get(node.id);
        if (node.component === null || version === undefined) return;
        if (editable.get(node.id)?.mayComment !== true) return;
        targets.push({
          key: `component:${node.id}`,
          label: `The whole of ${place(node.id)}`,
          on: { kind: 'component', id: node.component },
          version,
          anchor: { kind: 'component' },
        });
      } else if (document.mayComment) {
        targets.push({
          key: `node:${node.id}`,
          label: `The section ${place(node.id)}`,
          on: { kind: 'document', id: document.id },
          version: document.version.id,
          anchor: { kind: 'node', node: node.id },
        });
      }
    });
  }
  // Where each thread stands in the text, and how many stand on a card or a section as a whole.
  const threadMarks = new Map<string, Placed[]>();
  const threadCounts = new Map<string, number>();
  if (reviewing) {
    for (const thread of threadList) {
      const nodes =
        thread.on.kind === 'document'
          ? thread.anchor.kind === 'node'
            ? [thread.anchor.node]
            : []
          : (thread.places ?? []).filter((each) => !each.orphaned).map((each) => each.node);
      for (const node of nodes) {
        if (thread.anchor.kind === 'span' || thread.anchor.kind === 'cell') {
          threadMarks.set(node, [
            ...(threadMarks.get(node) ?? []),
            { thread: thread.id, anchor: thread.anchor },
          ]);
        } else {
          threadCounts.set(node, (threadCounts.get(node) ?? 0) + 1);
        }
      }
    }
  }
  // In Review, the Data tab counts the values revised by hand, for a reviewer to look at (DAT-122,
  // RV-K).
  const revisedCount = (bindingStates ?? []).reduce(
    (count, each) => count + (each.revisions ?? []).filter((revision) => revision.stands).length,
    0,
  );
  const tabs = offeredTabs(holdsBindings).map((each) =>
    each.key === 'data' && reviewing && revisedCount > 0
      ? { ...each, label: `Data, ${revisedCount} revised by hand` }
      : each,
  );
  const shown = shownTab(tab, tabs);
  // What the Value dialog's From the document is offered (TP2-F): the declarations a reader of the
  // template is given; none held, why - values withheld with them, or no parameters at all.
  const holdsValues = Object.keys(document.parameters).length > 0;
  const documentParameters = documentOffer({
    shown: document.templated || holdsValues,
    read: declared?.document === document.id ? declared.declarations : undefined,
    holdsValues,
  });
  const ids = tabIds(shown);
  // The panels beside the text, named in words (the LG plan, LG6c): the document's own only where it
  // holds fields or parameters.
  const holdsOwn = document.fields.document.length > 0 || document.templated || holdsValues;
  const dockTabs = DOCK_PANELS.filter(
    (each) =>
      (each.key !== 'document' || holdsOwn) &&
      (each.key !== 'table' || heldTable.holds) &&
      ((each.key !== 'threads' && each.key !== 'suggestions' && each.key !== 'rounds') ||
        reviewing),
  );
  // A remembered Document panel on a document that has none shows the part instead.
  const shownDock: DockPanel = dockTabs.some((each) => each.key === dock) ? dock : 'part';
  return (
    // Set in the theme and layout this document publishes under, its own and its components' text alike
    // (themes.md, "The theme in the editor", ET-A).
    <PresentationProvider client={client} document={document.id}>
      <Presented onSettled={presented.told} />
      {/* Named by its title and the mode it is in, so a screen reader arriving hears which (CNT-154). */}
      <InPlaceBand.Provider value={band}>
        <article
          aria-labelledby="document-title document-mode"
          className={styles['page']}
          data-desk-page=""
        >
          <span id="document-mode" hidden>
            {`in ${MODES.find(({ mode }) => mode === modeNow)!.name}`}
          </span>
          {!document.mayEdit && !withdrawn && <p>You may read this document but not change it.</p>}
          {/* The document bar (ADR-0056): where it is, the mode as two segments, Preview, the zoom,
            Show boundaries and, at its end, access - one line on the chrome over the desk. */}
          <div className={styles['bar']}>
            <nav aria-label="Breadcrumb" className={styles['trail']}>
              <a href="#/documents">Documents</a>
              <span>{` / ${document.space.name}`}</span>
            </nav>
            <span className={styles['rule']} aria-hidden="true" />
            {offered.length > 1 ? (
              <div role="radiogroup" aria-label="Mode" className={styles['mode']}>
                {offered.map(({ mode, name }) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name={`mode-${document.id}`}
                      checked={modeNow === mode}
                      onChange={() => chooseMode(mode)}
                    />
                    <Icon name={name} size={14} />
                    {name}
                  </label>
                ))}
              </div>
            ) : (
              <p className={styles['modeShown']}>Reading</p>
            )}
            <PreviewButton preview={preview} />
            <button
              type="button"
              className={styles['toggle']}
              aria-pressed={boundaries}
              onClick={() => showBoundaries(!boundaries)}
            >
              <Icon name="Show boundaries" size={14} />
              Show boundaries
            </button>
            <PeopleHere people={live.people} connected={live.connected} />
            {document.standing && <StateLozenge state={document.standing.state} />}
            <RevisionChip revision={document.standing?.revision} />
            <DatesChips dates={document.dates ?? undefined} />
            {document.archived && <Chip>Archived</Chip>}
            {document.onHold && <Chip>On hold</Chip>}
            {/* Access to the document, offered to whoever may administer it (access.md, GP-E), and
              Archive or Unarchive to whoever may retire it (lifecycle.md). */}
            <span className={styles['access']}>
              {document.standing && (
                <TransitionButtons
                  client={client}
                  kind="document"
                  id={document.id}
                  title={document.outline.title}
                  standing={document.standing}
                  versionId={document.version.id}
                  className={styles['toggle']}
                  onMoved={(standing, said) => {
                    if (latest.current?.id === document.id) show({ ...latest.current, standing });
                    setNotice(said);
                  }}
                  onNotice={setNotice}
                  onStale={restand}
                />
              )}
              {/* Its dates, to whoever may edit it (the WF5 plan, WF5-A). */}
              {document.mayEdit && !document.archived && document.dates && (
                <DatesButton
                  client={client}
                  kind="document"
                  id={document.id}
                  title={document.outline.title}
                  dates={document.dates}
                  className={styles['toggle']}
                  onSaved={(dates) => {
                    if (latest.current?.id === document.id) show({ ...latest.current, dates });
                    setNotice('Its dates are saved.');
                  }}
                />
              )}
              <ArchiveButton
                client={client}
                kind="document"
                id={document.id}
                title={document.outline.title}
                archived={document.archived}
                mayRetire={document.mayRetire}
                className={styles['toggle']}
                onChanged={(archived, said) => {
                  if (latest.current?.id === document.id) show({ ...latest.current, archived });
                  setNotice(said);
                }}
              />
              <DeleteButton
                client={client}
                kind="document"
                id={document.id}
                title={document.outline.title}
                mayRetire={document.mayRetire}
                className={styles['toggle']}
                onDeleted={() => setLoaded({ state: 'deleted' })}
              />
              <PlaceHoldButton
                client={client}
                target={{ artifact: document.id }}
                title={document.outline.title}
                mayHold={document.mayHold}
                className={styles['toggle']}
                onPlaced={(said) => {
                  if (latest.current?.id === document.id) {
                    show({ ...latest.current, onHold: true });
                  }
                  setNotice(said);
                }}
              />
              <ManageAccessLink
                client={client}
                target={`artifact:${document.id}`}
                href={documentAccessLink(document.id)}
                icon={<Icon name="Manage access" size={14} />}
              />
            </span>
          </div>
          {/* Before the first save of an approved one, what a save does (WF-F). */}
          {authoring && document.mayEdit && document.standing?.state.approved && (
            <p className={styles['approvedNote']}>
              This is approved. Saving starts a new draft, and the approved version stays as it is.
            </p>
          )}
          {/* In Authoring, the band a component open in place keeps its strip, toolbar and second line
            in, on the chrome: there before one opens, so the sheet does not move when it does
            (ADR-0056, CNT-075), and kept in view as the text scrolls. */}
          {authoring && principalId !== undefined && (
            <div ref={setBand} className={styles['band']} data-inplace-band="">
              {editing === null && <IdleBand />}
            </div>
          )}
          {document.template && (
            <TemplateLine
              template={document.template}
              className={styles['approvedNote']}
              move={
                document.mayEdit && !document.archived
                  ? {
                      client,
                      document: document.id,
                      onMoved: () => {
                        setNotice('Moved to the template’s newest version.');
                        // Read again whole: its version, values and template are new.
                        setAttempt((count) => count + 1);
                      },
                    }
                  : undefined
              }
            />
          )}
          <PreviewSaid preview={preview} />
          <UnheldFaces />
          {document.scheme === null && <p>This document's numbering could not be read.</p>}
          <div
            className={styles['layout']}
            data-collapsed={outlinePane.collapsed}
            data-dock-collapsed={dockPane.collapsed}
            // A preview takes a column of its own beside the text, which narrows to make room for it.
            data-previewing={preview.pane !== null}
            style={
              {
                '--outline-width': `${outlinePane.width}px`,
                // While it offers a Table tab, the pane is wider, and stays so as the cursor moves.
                '--dock-panel': `${(heldTable.holds ? tablePane : dockPane).width}px`,
              } as React.CSSProperties
            }
          >
            {outlinePane.collapsed && <OutlineRail pane={outlinePane} chosen={shown} tabs={tabs} />}
            <OutlinePanel
              outline={document.outline}
              requiredSections={document.template?.required ?? []}
              marks={outlineMarks}
              {...(referencesTo === undefined ? {} : { referencesTo })}
              head={
                // Hidden to the rail, the pane keeps its tree in the page but not a second toggle.
                outlinePane.collapsed ? null : (
                  <OutlineTabs pane={outlinePane} chosen={shown} onChoose={chooseTab} tabs={tabs} />
                )
              }
              tab={ids}
              details={{
                id: dockIds('part').panel,
                labelledBy: dockIds('part').tab,
                hidden: shownDock !== 'part',
                host: detailsHost,
              }}
              {...(shown === 'baselines'
                ? {
                    instead: (
                      <BaselinesTab
                        client={client}
                        document={document.id}
                        version={document.version.id}
                        mayPublish={document.mayPublish}
                      />
                    ),
                  }
                : {})}
              {...(shown === 'data'
                ? {
                    instead: (
                      <DataTab
                        client={client}
                        document={document.id}
                        states={bindingStates ?? []}
                        checkFailures={checkFailures}
                        headingOf={(node) =>
                          placeInOutline(document.outline, node, names, document.scheme)
                        }
                        language={document.outline.language}
                        tables={boundTables}
                        rows={tableRows}
                        checking={checking}
                        onChanged={() => setBindingsRead((count) => count + 1)}
                        onCheckNow={checkNow}
                        onGoTo={(node, binding) => {
                          // The value in the text, scrolled to and given the focus where it is a button.
                          const found = textColumn.current?.querySelector<HTMLElement>(
                            `[data-node="${node}"] [data-binding="${binding}"]`,
                          );
                          found?.scrollIntoView?.({ block: 'center' });
                          found?.focus();
                        }}
                        onNotice={setNotice}
                      />
                    ),
                  }
                : {})}
              root={
                // The document itself, as the tree's root: its title - the page's heading - and its
                // version number. The space is said in the status bar.
                <div className={styles['root']}>
                  <span className={styles['folder']}>
                    <Icon name="Folder" size={14} />
                  </span>
                  <h2 id="document-title" className={styles['title']}>
                    {document.outline.title}
                  </h2>
                  <span className={styles['number']}>{document.version.number}</span>
                </div>
              }
              scheme={document.scheme}
              editable={document.mayEdit && authoring}
              sectionFields={document.fields.section}
              schemas={document.schemas}
              people={people}
              busy={busy}
              onOperation={(operation) => apply(operation, false)}
              notice={notice}
              onNotice={setNotice}
              canUndo={undo.length > 0}
              refusals={refusals}
              signedOuts={signedOuts}
              onUndo={async () => {
                const top = undo[undo.length - 1];
                return top === undefined ? 'unsent' : apply(top, true);
              }}
              names={names}
              components={componentsNow}
              onReloadComponents={() => setComponentsAttempt((count) => count + 1)}
              linked={linked}
              linkOf={(node) =>
                `${window.location.origin}${window.location.pathname}${nodeLink(document.id, node)}`
              }
              inView={inView}
              onSelected={(node) => {
                // The address follows what is chosen, without a history entry per arrow key and without a
                // `hashchange`, so a reload or a copy of the address comes back to it.
                window.history.replaceState(window.history.state, '', nodeLink(document.id, node));
                // A link still waiting for the texts, or holding its node, is the reader's no longer: they
                // chose elsewhere.
                arriving.current = null;
                stopWaiting();
                letGo();
                // And the text goes to it (STR-035); a link's mark stays only on what it marked.
                textColumn.current
                  ?.querySelector(`[data-node="${node}"]`)
                  ?.scrollIntoView?.({ block: 'start' });
                if (node !== marked) setMarked(null);
              }}
            />
            {/* The panels beside the text: one pane, standing beside the text as the page scrolls and
            hidden to a rail as the outline is; kept while hidden, so a panel keeps what it holds. Next after
            the outline in the page, its panels before its tabs, so the keyboard goes from the tree to the
            chosen part's settings. */}
            {dockPane.collapsed && (
              <div className={styles['dockRail']}>
                <OutlineRail
                  pane={dockPane}
                  chosen={shownDock}
                  tabs={dockTabs}
                  label="document panels"
                  edge="end"
                />
              </div>
            )}
            <aside
              className={styles['dock']}
              aria-label="Panels beside the text"
              hidden={dockPane.collapsed}
            >
              <div className={styles['dockBody']}>
                {/* A value's provenance, a modal over the page (the B1 plan, B1-M; DAT-041). */}
                {provenanceState?.held && (
                  <ProvenancePanel
                    client={client}
                    document={document.id}
                    language={document.outline.language}
                    state={provenanceState}
                    onClose={closeProvenance}
                  />
                )}
                {/* A table's formatting, which the editor open in place sets here (ADR-0052). */}
                <div
                  id={dockIds('table').panel}
                  role="tabpanel"
                  aria-labelledby={dockIds('table').tab}
                  hidden={shownDock !== 'table'}
                  className={styles['tableTab']}
                >
                  <div ref={setTableHost} />
                </div>
                {/* The Part panel, which the outline draws, stands here (`details.host`). */}
                <div ref={setDetailsHost} />
                <div className={styles['side']}>
                  <div
                    id={dockIds('document').panel}
                    role="tabpanel"
                    aria-labelledby={dockIds('document').tab}
                    hidden={shownDock !== 'document'}
                  >
                    {/* What the document's template asks of the document itself, filled in and checked as it
                    is typed, and saved a pause after (definitions.md, "Shown as they arise"). */}
                    {document.fields.document.length > 0 && (
                      <HeldFields
                        label="Fields of this document"
                        fields={document.fields.document}
                        schemas={document.schemas}
                        people={people}
                        stored={document.values}
                        readOnly={!document.mayEdit || !authoring}
                        onSave={saveValues}
                      />
                    )}
                    {/* What the document was made with, beside its fields (the TP1 plan, TP1-I). */}
                    {(document.templated || holdsValues) && (
                      <ParametersPanel
                        client={client}
                        document={document.id}
                        version={document.version.id}
                        values={document.parameters}
                        readOnly={!document.mayEdit || !authoring}
                        onSave={saveParameters}
                        onDeclarations={(read) =>
                          setDeclared({ document: document.id, declarations: read })
                        }
                      />
                    )}
                  </div>
                  <div
                    id={dockIds('lists').panel}
                    role="tabpanel"
                    aria-labelledby={dockIds('lists').tab}
                    hidden={shownDock !== 'lists'}
                  >
                    <GeneratedLists
                      document={document.id}
                      outline={document.outline}
                      scheme={document.scheme}
                      known={known}
                      names={names}
                      onRetry={() => setKnownAttempt((count) => count + 1)}
                      onArriveAgain={onArriveAgain}
                    />
                  </div>
                  {reviewing && (
                    <div
                      id={dockIds('suggestions').panel}
                      role="tabpanel"
                      aria-labelledby={dockIds('suggestions').tab}
                      hidden={shownDock !== 'suggestions'}
                    >
                      <SuggestionsPanel
                        client={client}
                        document={document.id}
                        principalId={principalId}
                        refresh={suggestionsRead}
                        mayResolve={(component) =>
                          [...componentOfNode].some(
                            ([node, of]) =>
                              of === component && editable.get(node)?.mayEdit === true,
                          )
                        }
                        placeOf={(component) => {
                          const node = [...componentOfNode].find(([, of]) => of === component)?.[0];
                          return node === undefined ? 'a component' : place(node);
                        }}
                        onChanged={() => setTextsAttempt((count) => count + 1)}
                      />
                    </div>
                  )}
                  {reviewing && (
                    <div
                      id={dockIds('rounds').panel}
                      role="tabpanel"
                      aria-labelledby={dockIds('rounds').tab}
                      hidden={shownDock !== 'rounds'}
                    >
                      <RoundsPanel
                        client={client}
                        document={document.id}
                        principalId={principalId}
                        mayOpen={document.mayEdit}
                        people={people}
                        sections={(() => {
                          const all: { id: string; label: string }[] = [];
                          walkOutline(document.outline.nodes, (node) =>
                            all.push({ id: node.id, label: place(node.id) }),
                          );
                          return all;
                        })()}
                        onOpenBaseline={(baseline) => {
                          window.location.hash = baselineLink(document.id, baseline);
                        }}
                      />
                    </div>
                  )}
                  {reviewing && (
                    <div
                      id={dockIds('threads').panel}
                      role="tabpanel"
                      aria-labelledby={dockIds('threads').tab}
                      hidden={shownDock !== 'threads'}
                    >
                      <ThreadsPanel
                        client={client}
                        document={document.id}
                        targets={targets}
                        people={people}
                        principalId={principalId}
                        mayAnswer={(on) =>
                          on.kind === 'document'
                            ? document.mayComment
                            : [...componentOfNode].some(
                                ([node, component]) =>
                                  component === on.id && editable.get(node)?.mayComment === true,
                              )
                        }
                        placeOf={(thread) => {
                          const node =
                            thread.anchor.kind === 'node'
                              ? thread.anchor.node
                              : thread.places?.[0]?.node;
                          if (node !== undefined) return place(node);
                          // Placed nowhere: a component it no longer holds, since deleted (COL-067).
                          return thread.on.kind === 'component'
                            ? 'A component no longer in this document'
                            : 'This document';
                        }}
                        onThreads={setThreadList}
                        opening={
                          atPanel?.panel === 'threads' && atPanel.thread !== undefined
                            ? { thread: atPanel.thread, arrival: atPanel.arrival }
                            : null
                        }
                        onGoTo={(thread) => {
                          const node =
                            thread.anchor.kind === 'node'
                              ? thread.anchor.node
                              : thread.places?.find((each) => !each.orphaned)?.node;
                          if (node === undefined) return;
                          setMarked(node);
                          textColumn.current
                            ?.querySelector(`[data-node="${node}"]`)
                            ?.scrollIntoView?.({ block: 'start' });
                        }}
                      />
                    </div>
                  )}
                  <div
                    id={dockIds('publishing').panel}
                    role="tabpanel"
                    aria-labelledby={dockIds('publishing').tab}
                    hidden={shownDock !== 'publishing'}
                  >
                    <Publishing
                      client={client}
                      document={document.id}
                      version={document.version.id}
                      mayPublish={document.mayPublish}
                      placeOf={(node) =>
                        placeInOutline(document.outline, node, names, document.scheme)
                      }
                      followMs={followMs}
                      formats={document.formats}
                      shown={atPanel?.request ?? null}
                    />
                  </div>
                  <div
                    id={dockIds('versions').panel}
                    role="tabpanel"
                    aria-labelledby={dockIds('versions').tab}
                    hidden={shownDock !== 'versions'}
                  >
                    {shownDock === 'versions' && (
                      <DocumentVersions
                        client={client}
                        id={document.id}
                        mayEdit={document.mayEdit}
                        latest={document.version.id}
                        onRestored={() => void readOutlineAgain()}
                      />
                    )}
                  </div>
                </div>
              </div>
              <div className={styles['dockStrip']}>
                <PanelTabs
                  label="Document panels"
                  tabs={dockTabs}
                  chosen={shownDock}
                  onChoose={(key) => setDock(key as DockPanel)}
                  ids={dockIds}
                />
                <span className={styles['dockSpacer']} />
                <PaneToggle label="document panels" pane={dockPane} edge="end" />
              </div>
            </aside>
            {!outlinePane.collapsed && (
              <div className={styles['separator']}>
                <PaneSeparator label="outline" pane={outlinePane} />
              </div>
            )}
            {!dockPane.collapsed && (
              <div className={styles['dockSeparator']}>
                <PaneSeparator
                  label="document panels"
                  pane={heldTable.holds ? tablePane : dockPane}
                  edge="end"
                />
              </div>
            )}
            <div ref={textColumn} className={`${styles['text']} aw-desk`}>
              <DocumentText
                outline={document.outline}
                scheme={document.scheme}
                words={document.words}
                names={names}
                texts={texts}
                editable={editableNow}
                present={presentIn}
                onBroken={onBroken}
                // What each occurrence holds, as the lists beside it number it: what a reference in the
                // text, and in the editor opened in place, is numbered from (cross-references 1). The
                // editor takes its context through its place, and is told again as this is read again.
                {...(known.state === 'loaded' ? { contributions: known.contributions } : {})}
                editing={reviewing ? drafting : editing}
                boundaries={boundaries}
                marked={marked}
                resolved={resolved}
                revisions={revisionByNode}
                pastReview={pastReviewNodes}
                newer={{ client, byNode: newerByNode }}
                // The version is chosen from the label in Authoring, by whoever may restructure the
                // document (DV-F); anywhere else the label says it and offers nothing.
                {...(document.mayEdit && authoring ? { choosing } : {})}
                bindingStates={bindingStates}
                boundTables={boundTables}
                {...(reviewing ? { threadMarks, threadCounts } : {})}
                {...(reviewing && principalId !== undefined
                  ? {
                      onSuggest: (node: string) => {
                        setDrafting(node);
                        setDock('suggestions');
                      },
                      editor: (component: string, place: Place) => (
                        <ComponentEditor
                          key={`draft:${component}`}
                          componentId={component}
                          client={client}
                          principalId={principalId}
                          {...(place.number === undefined ? {} : { number: place.number })}
                          referenceContext={place.referenceContext ?? null}
                          {...(place.bindingContext === undefined
                            ? {}
                            : { bindingContext: place.bindingContext })}
                          tableHost={tableHost}
                          onTable={setHeldTable}
                          draft={{
                            // An image is added to the component's space by whoever may add one
                            // there, which an author of the component may (SG-J).
                            mayUpload:
                              drafting !== null && editable.get(drafting)?.mayEdit === true,
                            onDiscard: () => setDrafting(null),
                            onSend: async (content, version) => {
                              const answer = await client.POST('/v1/components/{id}/suggestions', {
                                params: { path: { id: component } },
                                body: {
                                  version,
                                  content: content as unknown as Record<string, unknown>,
                                },
                              });
                              if (!answer.data) {
                                setNotice(
                                  (answer.error as { message?: string } | undefined)?.message ??
                                    'The suggestion could not be sent.',
                                );
                                return false;
                              }
                              // Announced naming where (CNT-137).
                              setNotice(
                                `Suggestion sent on ${drafting === null ? 'a component' : placeInOutline(document.outline, drafting, names, document.scheme)}.`,
                              );
                              setDrafting(null);
                              setSuggestionsRead((count) => count + 1);
                              setTextsAttempt((count) => count + 1);
                              return true;
                            },
                          }}
                        />
                      ),
                    }
                  : {})}
                rowsFrom={{
                  client,
                  document: document.id,
                  session: bindingSession ?? editorSaved?.session ?? null,
                  saved: editorSaved?.sequence ?? 0,
                }}
                onBoundTables={(node, tables) => setEditingTables({ node, tables })}
                onSaved={(session, sequence) => setEditorSaved({ session, sequence })}
                onTableRows={setTableRows}
                onProvenance={(node, binding, opener) => setProvenance({ node, binding, opener })}
                onBindingSettle={onBindingSettle}
                {...(document.mayEdit ? { onRevise: openRevising } : {})}
                {...(principalId === undefined || !authoring
                  ? {}
                  : {
                      onEdit: (node: string | null) => {
                        setEditing(node);
                        // Closing reads the text again, so the card shows what was saved, and its
                        // bindings from the version it cut.
                        if (node === null) {
                          setTextsAttempt((count) => count + 1);
                          setBindingSession(null);
                          setEditingTables(null);
                          setEditorSaved(null);
                        }
                      },
                      editor: (component: string, place: Place) => (
                        <ComponentEditor
                          key={component}
                          componentId={component}
                          client={client}
                          principalId={principalId}
                          {...place}
                          documentParameters={documentParameters}
                          tableHost={tableHost}
                          onTable={setHeldTable}
                        />
                      ),
                    })}
              />
            </div>
            <PreviewPane
              preview={preview}
              className={styles['preview']}
              placeOf={(node) => placeInOutline(document.outline, node, names, document.scheme)}
            />
          </div>
          {ownViewPrompt}
          {revisionPrompt}
          {revising !== null && (
            <RevisionDialog
              client={client}
              document={document.id}
              revising={revising}
              formats={formatsFor(null, document.outline.language)}
              onClose={() => setRevising(null)}
              onDone={(words) => {
                setRevising(null);
                setNotice(words);
                setBindingsRead((count) => count + 1);
              }}
            />
          )}
          {/* The zoom in the status bar (ADR-0056): the shell's, or the page's own where it has none. */}
          {status === null ? (
            <StatusBar notice={notice} context={context} tools={<ZoomControl />} />
          ) : (
            <StatusTools>
              <ZoomControl />
            </StatusTools>
          )}
        </article>
      </InPlaceBand.Provider>
    </PresentationProvider>
  );
}

/** How many sections and component references an outline holds, at every depth. */
function counted(nodes: readonly OutlineViewNode[]): { sections: number; components: number } {
  let sections = 0;
  let components = 0;
  const walk = (list: readonly OutlineViewNode[]) => {
    for (const node of list) {
      if (node.type === 'section') sections += 1;
      else components += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return { sections, components };
}

/** What the status bar says the document is: what it holds, and which version of it in which space. */
function aboutDocument(document: Opened): readonly string[] {
  const { sections, components } = counted(document.outline.nodes);
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return [
    `${plural(sections, 'section')}, ${plural(components, 'component')}`,
    `Version ${document.version.number} in ${document.space.name}`,
  ];
}
