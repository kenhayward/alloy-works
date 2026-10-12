import type { createApiClient } from '@alloy-works/api-client';
import {
  layoutWordsSchema,
  numberingSchemeSchema,
  parseContentDocument,
  readOutlineView,
  walkOutline,
  type NumberingScheme,
  type OutlineView,
  type ThreadAnchor,
} from '@alloy-works/domain';
import { TEXT_CLASS } from '@alloy-works/editor';
import { useEffect, useMemo, useRef, useState } from 'react';

import { anchorFromSelection, type Placed } from '../review/anchoring.js';
import {
  anchorWords,
  ThreadsPanel,
  type ReviewTarget,
  type ThreadSummary,
} from '../review/ThreadsPanel.js';

import { Chip } from '../parts/Chip.js';
import { bindingStatesIn, type BindingState } from './bindingContexts.js';
import styles from './BaselinePage.module.css';
import { DocumentText } from './DocumentText.js';
import { documentLink } from './links.js';
import type { Names } from './tree.js';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly name: string;
  readonly madeBy: string;
  readonly madeAt: string;
  readonly digest: string;
  readonly superseded: boolean;
  readonly version: string;
  readonly outline: OutlineView;
  readonly scheme: NumberingScheme | null;
  readonly words: { readonly above: string; readonly below: string } | null;
  readonly texts: ReadonlyMap<string, unknown>;
  readonly names: Names;
  readonly resolved: ReadonlyMap<string, string>;
  readonly bindings: readonly BindingState[] | null;
  /** The document version pinned, by its identifier. */
  readonly versionId: string;
  /** Each occurrence's component and pinned version, and whether the reader may comment on it. */
  readonly pinned: ReadonlyMap<
    string,
    { readonly component: string; readonly version: string; readonly mayComment: boolean }
  >;
  readonly mayComment: boolean;
  readonly mayReview: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The view read and checked, as the document page checks its own; undefined where it does not read. */
function shownIn(data: unknown, document: string): Shown | undefined {
  if (!isRecord(data) || !isRecord(data.baseline) || !isRecord(data.version)) return undefined;
  const { baseline, version, layout } = data;
  if (typeof version.id !== 'string' || typeof version.number !== 'string') return undefined;
  const read = readOutlineView(data.outline, { artifact: document, version: version.id });
  if (!read.ok) return undefined;
  const scheme = isRecord(layout) ? numberingSchemeSchema.safeParse(layout.scheme) : undefined;
  const words = isRecord(layout) ? layoutWordsSchema.safeParse(layout.words) : undefined;
  const texts = new Map<string, unknown>();
  const names = new Map<string, string>();
  const resolved = new Map<string, string>();
  const pinned = new Map<string, { component: string; version: string; mayComment: boolean }>();
  for (const each of Array.isArray(data.texts) ? data.texts : []) {
    if (!isRecord(each) || typeof each.node !== 'string' || !isRecord(each.version)) continue;
    texts.set(each.node, each.content);
    if (typeof each.component === 'string' && typeof each.version.id === 'string') {
      pinned.set(each.node, {
        component: each.component,
        version: each.version.id,
        mayComment: each.mayComment === true,
      });
    }
    if (typeof each.component === 'string' && typeof each.title === 'string') {
      names.set(each.component, each.title);
    }
    if (typeof each.version.number === 'string') resolved.set(each.node, each.version.number);
  }
  return {
    name: String(baseline.name),
    madeBy:
      isRecord(baseline.madeBy) && typeof baseline.madeBy.name === 'string'
        ? baseline.madeBy.name
        : 'Somebody',
    madeAt: String(baseline.madeAt),
    digest: String(baseline.digest),
    superseded: baseline.superseded !== null,
    version: version.number,
    outline: read.outline,
    scheme: scheme?.success ? scheme.data : null,
    words:
      words?.success && words.data.above !== undefined && words.data.below !== undefined
        ? { above: words.data.above, below: words.data.below }
        : null,
    texts,
    names,
    resolved,
    bindings: bindingStatesIn({ bindings: data.bindings }) ?? null,
    versionId: version.id,
    pinned,
    mayComment: data.mayComment === true,
    mayReview: data.mayReview === true,
  };
}

/**
 * The document as one of its baselines holds it (STR-047; the BL plan, BL-I), at
 * `#/documents/{id}/baselines/{baseline}` and at a node beneath it: read-only, from the pinned view
 * alone - its outline numbered by the pinned layout, each component's text at its pin, each value
 * from the dataset version pinned - so "section 4.2 as approved" stays what was approved however the
 * document has moved on. A component the reader may not read is withheld, as in the document itself.
 */
export function BaselinePage({
  client,
  document,
  baseline,
  node,
}: {
  client: Client;
  document: string;
  baseline: string;
  node: string | null;
}) {
  const [shown, setShown] = useState<Shown | 'missing' | 'failed' | null>(null);
  // Review over the pinned text (the RR plan, RR-G; COL-031): threads on what the baseline pins.
  const [reviewing, setReviewing] = useState(false);
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [proposed, setProposed] = useState<{ node: string; anchor: ThreadAnchor } | null>(null);
  const textColumn = useRef<HTMLDivElement>(null);
  const textsNow = typeof shown === 'object' && shown !== null ? shown.texts : null;
  // What the reader selects in a pinned component's text offers a thread on that span.
  useEffect(() => {
    if (!reviewing || textsNow === null) {
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
      const at = host?.closest<HTMLElement>('[data-node]')?.dataset.node;
      const content = at === undefined ? undefined : textsNow.get(at);
      if (!host || at === undefined || content === undefined) return setProposed(null);
      let anchor: ThreadAnchor | null;
      try {
        anchor = anchorFromSelection(selection, host, parseContentDocument(content));
      } catch {
        anchor = null;
      }
      setProposed(anchor === null ? null : { node: at, anchor });
    };
    page.addEventListener('selectionchange', choose);
    return () => page.removeEventListener('selectionchange', choose);
  }, [reviewing, textsNow]);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/baselines/{id}/view', { params: { path: { id: baseline } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (response.status === 404) setShown('missing');
        else setShown(shownIn(data, document) ?? 'failed');
      })
      .catch(() => current && setShown('failed'));
    return () => {
      current = false;
    };
  }, [client, baseline, document]);

  // Taken to the node its address names, once the text is drawn.
  useEffect(() => {
    if (node === null || typeof shown !== 'object' || shown === null) return;
    window.document.querySelector(`[data-node="${node}"]`)?.scrollIntoView?.({ block: 'start' });
  }, [node, shown]);

  const when = useMemo(
    () =>
      typeof shown === 'object' && shown !== null
        ? new Date(shown.madeAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
        : '',
    [shown],
  );

  if (shown === null) return <p className={styles['note']}>Opening...</p>;
  if (shown === 'missing') return <p className={styles['note']}>There is no such baseline.</p>;
  if (shown === 'failed') return <p className={styles['note']}>The baseline could not be read.</p>;
  const placeOf = (at: string) => nodeTitle(shown, at);
  // What a thread may be started on here: the selected span, each pinned component the reader may
  // comment on, and each section where they may comment on the document - each at its pinned version.
  const targets: ReviewTarget[] = [];
  if (reviewing) {
    const chosen = proposed === null ? undefined : shown.pinned.get(proposed.node);
    if (proposed !== null && chosen?.mayComment === true) {
      targets.push({
        key: 'selection',
        label:
          proposed.anchor.kind === 'cell'
            ? `The table cell in ${placeOf(proposed.node)}`
            : `The selected text ${anchorWords(proposed.anchor)}`,
        on: { kind: 'component', id: chosen.component },
        version: chosen.version,
        anchor: proposed.anchor,
      });
    }
    walkOutline(shown.outline.nodes, (each) => {
      const pin = shown.pinned.get(each.id);
      if (pin !== undefined) {
        if (!pin.mayComment) return;
        targets.push({
          key: `component:${each.id}`,
          label: `The whole of ${placeOf(each.id)}`,
          on: { kind: 'component', id: pin.component },
          version: pin.version,
          anchor: { kind: 'component' },
        });
      } else if (shown.mayComment && each.type !== 'reference') {
        targets.push({
          key: `node:${each.id}`,
          label: `The section ${placeOf(each.id)}`,
          on: { kind: 'document', id: document },
          version: shown.versionId,
          anchor: { kind: 'node', node: each.id },
        });
      }
    });
  }
  const threadMarks = new Map<string, Placed[]>();
  const threadCounts = new Map<string, number>();
  for (const thread of reviewing ? threads : []) {
    const nodes =
      thread.on.kind === 'document'
        ? thread.anchor.kind === 'node'
          ? [thread.anchor.node]
          : []
        : (thread.places ?? []).filter((each) => !each.orphaned).map((each) => each.node);
    for (const at of nodes) {
      if (thread.anchor.kind === 'span' || thread.anchor.kind === 'cell') {
        threadMarks.set(at, [
          ...(threadMarks.get(at) ?? []),
          { thread: thread.id, anchor: thread.anchor },
        ]);
      } else {
        threadCounts.set(at, (threadCounts.get(at) ?? 0) + 1);
      }
    }
  }
  return (
    <article className={styles['page']} aria-labelledby="baseline-heading">
      <header className={styles['head']}>
        <p>
          <a href={documentLink(document)}>Open the document as it is now</a>
        </p>
        <h1 id="baseline-heading" className={styles['title']}>
          {shown.name}
        </h1>
        <div className={styles['facts']}>
          <Chip>{`Version ${shown.version}`}</Chip>
          <Chip tone={shown.superseded ? 'warn' : 'neutral'}>
            {shown.superseded ? 'Superseded' : 'Current'}
          </Chip>
          <span className={styles['note']}>{`Made by ${shown.madeBy} on ${when}`}</span>
        </div>
        <p className={styles['note']}>
          The document as this baseline holds it. Nothing here changes as the document does.
        </p>
        <p className={styles['digest']}>{`Digest ${shown.digest}`}</p>
        {shown.mayReview && (
          <div role="group" aria-label="Mode">
            <button type="button" aria-pressed={!reviewing} onClick={() => setReviewing(false)}>
              Reading
            </button>{' '}
            <button type="button" aria-pressed={reviewing} onClick={() => setReviewing(true)}>
              Review
            </button>
          </div>
        )}
      </header>
      <div className={reviewing ? styles['reviewing'] : undefined}>
        <div ref={textColumn}>
          <DocumentText
            outline={shown.outline}
            scheme={shown.scheme}
            words={shown.words}
            names={shown.names}
            texts={shown.texts}
            marked={node}
            resolved={shown.resolved}
            bindingStates={shown.bindings}
            {...(reviewing ? { threadMarks, threadCounts } : {})}
          />
        </div>
        {reviewing && (
          <section aria-label="Threads on this baseline" className={styles['threads']}>
            <p className={styles['note']}>
              Comments here are on the text this baseline pins. A suggestion is made on the document
              as it is now.
            </p>
            <ThreadsPanel
              client={client}
              document={document}
              baseline={baseline}
              targets={targets}
              people={[]}
              mayAnswer={(on) =>
                on.kind === 'document'
                  ? shown.mayComment
                  : [...shown.pinned.values()].some(
                      (pin) => pin.component === on.id && pin.mayComment,
                    )
              }
              placeOf={(thread) => {
                const at =
                  thread.anchor.kind === 'node' ? thread.anchor.node : thread.places?.[0]?.node;
                return at === undefined ? 'This document' : placeOf(at);
              }}
              onThreads={setThreads}
            />
          </section>
        )}
      </div>
    </article>
  );
}

/** A node by its title in the pinned outline, or its identifier where it has none to show. */
function nodeTitle(shown: Shown, at: string): string {
  let title = at;
  walkOutline(shown.outline.nodes, (each) => {
    if (each.id !== at) return;
    const own = (each as { readonly title?: unknown }).title;
    if (typeof own === 'string' && own !== '') title = own;
    else if (each.type === 'reference' && each.component !== null) {
      title = shown.names?.get(each.component) ?? title;
    }
  });
  return title;
}
