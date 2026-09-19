import type { createApiClient, paths } from '@alloy-works/api-client';
import {
  conditions,
  defaultNumberingScheme,
  number,
  readOutlineView,
  resolve,
  sectionNumbers,
  walkOutline,
  type Contribution,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { everyPage } from '../paging.js';
import { FOLLOW_MS, Publishing } from '../publishing/Publishing.js';
import { GeneratedLists, type Known } from './GeneratedLists.js';
import { nodeLink } from './links.js';
import {
  OutlinePanel,
  type Answered,
  type ComponentChoice,
  type ComponentChoices,
} from './OutlinePanel.js';
import { inverseOf, nodeName, placeOf, visibleOrder, type Names } from './tree.js';

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
}

type Read = Opened | 'unreadable' | undefined;

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
  const { id, space, version, outline, mayEdit, mayPublish } = data;
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
  return {
    id,
    space: { id: space.id, name: space.name },
    version: { id: version.id, number: version.number },
    outline: read.outline,
    mayEdit,
    mayPublish,
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
function placeInOutline(outline: OutlineView, node: string, names: Names): string {
  // Collected rather than assigned from the callback, which TypeScript's narrowing cannot follow.
  const held: OutlineViewNode[] = [];
  walkOutline(outline.nodes, (each) => {
    if (each.id === node) held.push(each);
  });
  const [found] = held;
  if (found === undefined) return 'A part no longer in this document';
  const numbers = sectionNumbers(
    number(conditions(resolve(outline, NOTHING_KNOWN)), defaultNumberingScheme),
  );
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
        return operation.matter === 'appendix'
          ? `${nodeName(node, names)} is now an appendix.`
          : `${nodeName(node, names)} is no longer an appendix.`;
      }
      return `Changed ${nodeName(node, names)}.`;
    }
    case 'remove': {
      const node = placeOf(before.nodes, operation.node)?.node;
      return node ? `Removed ${nodeName(node, names)}.` : 'Removed.';
    }
  }
}

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
export function DocumentPage({
  client,
  id,
  linked = null,
  onArriveAgain,
  followMs = FOLLOW_MS,
}: DocumentPageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [undo, setUndo] = useState<readonly OutlineOperation[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  /** Shows a document, and remembers it as the latest one the page holds (written only here). */
  const show = useCallback((document: Opened) => {
    latest.current = document;
    setLoaded({ state: 'open', document });
  }, []);

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

  if (loaded.state === 'loading') return <p>Opening...</p>;
  if (loaded.state === 'missing') return <p>There is nothing here, or nothing you may read.</p>;
  if (loaded.state === 'failed') {
    if (loaded.signedOut) return <p>You are signed out. Sign in again to open this document.</p>;
    return (
      <>
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
      </>
    );
  }
  if (loaded.state === 'unreadable') return <p>This document could not be read.</p>;

  const { document } = loaded;
  return (
    <article aria-labelledby="document-title">
      <header>
        <h2 id="document-title">{document.outline.title}</h2>
        <p>
          Version {document.version.number} in {document.space.name}
        </p>
      </header>
      {!document.mayEdit && !withdrawn && <p>You may read this document but not change it.</p>}
      <OutlinePanel
        outline={document.outline}
        editable={document.mayEdit}
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
        onSelected={(node) => {
          // The address follows what is chosen, without a history entry per arrow key and without a
          // `hashchange`, so a reload or a copy of the address comes back to it.
          window.history.replaceState(window.history.state, '', nodeLink(document.id, node));
        }}
      />
      <GeneratedLists
        document={document.id}
        outline={document.outline}
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
        placeOf={(node) => placeInOutline(document.outline, node, names)}
        followMs={followMs}
      />
    </article>
  );
}
