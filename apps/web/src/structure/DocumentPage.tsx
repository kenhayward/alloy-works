import type { FieldView } from '@alloy-works/api-client';
import type { createApiClient, paths } from '@alloy-works/api-client';
import {
  conditions,
  layoutWordsSchema,
  number,
  numberingSchemeSchema,
  readOutlineView,
  resolve,
  sectionNumbers,
  walkOutline,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { everyPage } from '../paging.js';
import { PreviewPane, usePreview } from '../publishing/Preview.js';
import { FOLLOW_MS, Publishing } from '../publishing/Publishing.js';
import { Icon } from '../editor/Icon.js';
import { PaneSeparator, usePaneWidth } from '../layouts/PaneWidth.js';
import { StatusBar, useStatus } from '../shell/Status.js';
import styles from './DocumentPage.module.css';
import { ComponentEditor } from '../editor/ComponentEditor.js';
import { DocumentText, type Editable, type Place } from './DocumentText.js';
import { GeneratedLists, type Known } from './GeneratedLists.js';
import { documentAccessLink, nodeLink } from './links.js';
import { OutlineRail, OutlineTabs, tabIds, useOutlineTab } from './OutlineTabs.js';
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
import { byName } from '../metadata/people.js';
import { UnheldFaces, ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider } from '../theme/presentation.js';
import { useReadingPosition } from './position.js';
import type { Choosing, OfferedVersion } from './VersionChoice.js';

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
  const { id, space, version, outline, mayEdit, mayPublish, layout, fields, schemas, values } =
    data;
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
    return [{ id: item.id, title: item.title }];
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
  /** How long a publish waits before it is first asked about: given in tests, which need not wait. */
  readonly followMs?: number;
  /** The reader, for a component edited in place; without one, the text is read only. */
  readonly principalId?: string;
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

/** The document view's two modes (document-view.md, "Modes"); review is T3's. */
type Mode = 'reading' | 'authoring';

const MODES: readonly { readonly mode: Mode; readonly name: string }[] = [
  { mode: 'reading', name: 'Reading' },
  { mode: 'authoring', name: 'Authoring' },
];

const MODE_KEY = 'alloy-works.mode';

/** The mode this reader last chose; Authoring, where it is offered, the first time (DV-E). */
function keptMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'reading' ? 'reading' : 'authoring';
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

export function DocumentPage({
  client,
  id,
  linked = null,
  onArriveAgain,
  followMs = FOLLOW_MS,
  principalId,
}: DocumentPageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const outlinePane = usePaneWidth(OUTLINE_PANE);
  // Each occurrence's content, by node, from one call for the whole document (interface slice 9),
  // read again for every version the page shows and whenever a component edited in place closes.
  const [texts, setTexts] = useState<ReadonlyMap<string, unknown>>(new Map());
  // Whether the reader may edit each occurrence's component now, and who holds it (CNT-074).
  const [editable, setEditable] = useState<ReadonlyMap<string, Editable>>(new Map());
  // The number of the version each occurrence resolves to, by node (CNT-162), from the same answer.
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(new Map());
  const [textsAttempt, setTextsAttempt] = useState(0);
  // The version whose texts have been answered, or refused: until then the text is its headings alone,
  // and a node gone to now would be pushed down the page by every component above it as it fills in.
  const [textsRead, setTextsRead] = useState<string | null>(null);
  // The one occurrence whose component is open in place: one editor, and so one lock, at a time.
  const [editing, setEditing] = useState<string | null>(null);
  const shownVersion = loaded.state === 'open' ? loaded.document.version.id : null;
  useEffect(() => {
    if (shownVersion === null) return undefined;
    let current = true;
    client
      .GET('/v1/documents/{id}/texts', { params: { path: { id } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) {
          setTextsRead(shownVersion);
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
              { mayEdit: occurrence.mayEdit, lock: occurrence.lock },
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
        setResolved(numberOf);
        setTextsRead(shownVersion);
      })
      // The text is the reading view beside the outline: where it cannot be read, the cards show
      // their titles alone, which is what they showed before it existed.
      .catch(() => {
        if (current) setTextsRead(shownVersion);
      });
    return () => {
      current = false;
    };
  }, [client, id, shownVersion, textsAttempt]);
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
  useEffect(() => {
    if (status === null || contextKey === null) return undefined;
    status.describe(contextKey.split('\n'));
    return () => status.describe(null);
  }, [status, contextKey]);
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
    [...opened.fields.document, ...opened.fields.section].some((each) => each.dataType === 'user');
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

  /** Shows a document, and remembers it as the latest one the page holds (written only here). */
  const show = useCallback((document: Opened) => {
    latest.current = document;
    setLoaded({ state: 'open', document });
  }, []);

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
  // Reading or Authoring (document-view.md, "Modes"; CNT-154): the reader's choice, kept in the browser,
  // Authoring the first time; which of them is on offer is decided below, from what they may do.
  const [chosenMode, setChosenMode] = useState<Mode>(keptMode);
  // Where the reader is in the text, and the node a link took them to (document-view.md, "Navigation";
  // STR-035, STR-045): the one the outline marks as the current location, and the one the text marks
  // until another is chosen.
  const textColumn = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    // Gone to once the text is whole, so the components above it have taken their room (issue #336).
    if (arriving.current === null || textsRead !== shownVersion) return;
    const element = textColumn.current?.querySelector(`[data-node="${arriving.current}"]`);
    if (!element) return;
    arriving.current = null;
    element.scrollIntoView?.({ block: 'start' });
  });
  const chooseMode = (mode: Mode) => {
    setChosenMode(mode);
    // Reading offers no editor, so one open in place closes as the page drops to it.
    if (mode === 'reading') setEditing(null);
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Storage refused: the choice holds for this page and is not kept.
    }
  };
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
  const ids = tabIds(tab);
  return (
    // Set in the theme and layout this document publishes under, its own and its components' text alike
    // (themes.md, "The theme in the editor", ET-A).
    <PresentationProvider client={client} document={document.id}>
      {/* Named by its title and the mode it is in, so a screen reader arriving hears which (CNT-154). */}
      <article aria-labelledby="document-title document-mode" className={styles['page']}>
        <span id="document-mode" hidden>
          {authoring ? 'in Authoring' : 'in Reading'}
        </span>
        {!document.mayEdit && !withdrawn && <p>You may read this document but not change it.</p>}
        {/* The mode the page is in, and the switch between the two where Authoring is offered. */}
        {mayAuthor ? (
          <div role="radiogroup" aria-label="Mode" className={styles['mode']}>
            {MODES.map(({ mode, name }) => (
              <label key={mode}>
                <input
                  type="radio"
                  name={`mode-${document.id}`}
                  checked={(authoring ? 'authoring' : 'reading') === mode}
                  onChange={() => chooseMode(mode)}
                />{' '}
                {name}
              </label>
            ))}
          </div>
        ) : (
          <p className={styles['mode']}>Reading</p>
        )}
        {/* Access to the document, offered to whoever may administer it (access.md, GP-E). */}
        <ManageAccessLink
          client={client}
          target={`artifact:${document.id}`}
          href={documentAccessLink(document.id)}
        />
        <ZoomControl />
        <label>
          <input
            type="checkbox"
            checked={boundaries}
            onChange={(event) => showBoundaries(event.target.checked)}
          />{' '}
          Show boundaries
        </label>
        <UnheldFaces />
        {document.scheme === null && <p>This document's numbering could not be read.</p>}
        <div
          className={styles['layout']}
          data-collapsed={outlinePane.collapsed}
          // A preview takes a column of its own beside the text, which narrows to make room for it.
          data-previewing={preview.pane !== null}
          style={{ '--outline-width': `${outlinePane.width}px` } as React.CSSProperties}
        >
          {outlinePane.collapsed && <OutlineRail pane={outlinePane} chosen={tab} />}
          <OutlinePanel
            outline={document.outline}
            head={
              // Hidden to the rail, the pane keeps its tree in the page but not a second toggle.
              outlinePane.collapsed ? null : (
                <OutlineTabs pane={outlinePane} chosen={tab} onChoose={chooseTab} />
              )
            }
            tab={ids}
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
            components={components}
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
              // And the text goes to it (STR-035); a link's mark stays only on what it marked.
              textColumn.current
                ?.querySelector(`[data-node="${node}"]`)
                ?.scrollIntoView?.({ block: 'start' });
              if (node !== marked) setMarked(null);
            }}
          />
          {!outlinePane.collapsed && (
            <div className={styles['separator']}>
              <PaneSeparator label="outline" pane={outlinePane} />
            </div>
          )}
          <div ref={textColumn} className={styles['text']}>
            <DocumentText
              outline={document.outline}
              scheme={document.scheme}
              words={document.words}
              names={names}
              texts={texts}
              editable={editable}
              // What each occurrence holds, as the lists beside it number it: what a reference in the
              // text, and in the editor opened in place, is numbered from (cross-references 1). The
              // editor takes its context through its place, and is told again as this is read again.
              {...(known.state === 'loaded' ? { contributions: known.contributions } : {})}
              editing={editing}
              boundaries={boundaries}
              marked={marked}
              resolved={resolved}
              // The version is chosen from the label in Authoring, by whoever may restructure the
              // document (DV-F); anywhere else the label says it and offers nothing.
              {...(document.mayEdit && authoring ? { choosing } : {})}
              {...(principalId === undefined || !authoring
                ? {}
                : {
                    onEdit: (node: string | null) => {
                      setEditing(node);
                      // Closing reads the text again, so the card shows what was saved.
                      if (node === null) setTextsAttempt((count) => count + 1);
                    },
                    editor: (component: string, place: Place) => (
                      <ComponentEditor
                        key={component}
                        componentId={component}
                        client={client}
                        principalId={principalId}
                        {...place}
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
          <div className={styles['side']}>
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
            <GeneratedLists
              document={document.id}
              outline={document.outline}
              scheme={document.scheme}
              known={known}
              names={names}
              onRetry={() => setKnownAttempt((count) => count + 1)}
              onArriveAgain={onArriveAgain}
            />
            <Publishing
              client={client}
              document={document.id}
              version={document.version.id}
              mayPublish={document.mayPublish}
              placeOf={(node) => placeInOutline(document.outline, node, names, document.scheme)}
              followMs={followMs}
              formats={document.formats}
              preview={preview}
            />
          </div>
        </div>
        {status === null && <StatusBar notice={notice} context={context} />}
      </article>
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
