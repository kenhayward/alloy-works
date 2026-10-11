import type { createApiClient } from '@alloy-works/api-client';
import {
  layoutWordsSchema,
  numberingSchemeSchema,
  readOutlineView,
  type NumberingScheme,
  type OutlineView,
} from '@alloy-works/domain';
import { useEffect, useMemo, useState } from 'react';

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
  for (const each of Array.isArray(data.texts) ? data.texts : []) {
    if (!isRecord(each) || typeof each.node !== 'string' || !isRecord(each.version)) continue;
    texts.set(each.node, each.content);
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
      </header>
      <DocumentText
        outline={shown.outline}
        scheme={shown.scheme}
        words={shown.words}
        names={shown.names}
        texts={shown.texts}
        marked={node}
        resolved={shown.resolved}
        bindingStates={shown.bindings}
      />
    </article>
  );
}
