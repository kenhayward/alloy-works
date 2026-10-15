import type { createApiClient } from '@alloy-works/api-client';
import {
  outlineTexts,
  readOutlineView,
  unitTexts,
  type ContentDocument,
  type UnitChange,
  type UnitText,
} from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import { baselineLink, documentLink } from '../structure/links.js';
import styles from './BaselineComparisonPage.module.css';
import { Redline, redlineHtml, saveHtml } from './Redline.js';

type Client = ReturnType<typeof createApiClient>;

/** What made a difference, in words (VER-031, VER-045). */
const DOCUMENT_CAUSES = {
  layout: 'the layout changed',
  theme: 'the theme changed',
  template: 'the template changed',
  definition: 'the definitions it is checked against changed',
  parameters: 'its parameters changed',
} as const;
const NODE_CAUSES = {
  edited: 'Edited',
  data: 'Its data changed',
  definition: 'A definition it was written against changed',
  // REU-014: the document's own difference, never a fork of the component.
  overridden: 'Overridden in this document',
} as const;

interface Printed {
  readonly document: readonly (keyof typeof DOCUMENT_CAUSES)[];
  readonly nodes: readonly {
    readonly node: string;
    readonly title: string;
    readonly causes: readonly (keyof typeof NODE_CAUSES)[];
    readonly values: readonly {
      readonly binding: string;
      readonly older: string | null;
      readonly newer: string | null;
    }[];
  }[];
}

interface Shown {
  readonly title: string;
  readonly structure: readonly UnitChange[];
  readonly outlines: {
    readonly older: ReadonlyMap<string, UnitText>;
    readonly newer: ReadonlyMap<string, UnitText>;
  };
  readonly titles: ReadonlyMap<string, string>;
  readonly components: readonly {
    readonly node: string;
    readonly title: string;
    readonly heading: string;
    readonly changes: readonly UnitChange[];
    readonly older: ContentDocument;
    readonly newer: ContentDocument;
  }[];
}

type Side = {
  baseline: { name: string } | null;
  version: { id: string; number: string };
  outline: unknown;
};

const sideName = (side: Side) =>
  side.baseline === null ? `the document now (${side.version.number})` : side.baseline.name;

/**
 * Two baselines of a document compared, or one with the document now (VER-024, VER-025, VER-030):
 * the outline's changes, then each component whose version differs, each as a redline, at
 * `#/documents/{id}/baselines/{baseline}/compare/{with}`; and the whole exported as one HTML file.
 * The service has withheld what the reader may not read, so the page and the export hold none of it.
 */
export function BaselineComparisonPage({
  client,
  document,
  baseline,
  against,
}: {
  client: Client;
  document: string;
  baseline: string;
  /** A later baseline's identifier, or `now`. */
  against: string;
}) {
  const [shown, setShown] = useState<Shown | 'missing' | 'failed' | null>(null);
  // What each side would print, compared (VER-031): read beside the rest, and said apart.
  const [printed, setPrinted] = useState<Printed | 'failed' | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/baselines/{id}/comparison/resolved', {
        params: { path: { id: baseline }, query: { with: against } },
      })
      .then(({ data }) => current && setPrinted(data ?? 'failed'))
      .catch(() => current && setPrinted('failed'));
    return () => {
      current = false;
    };
  }, [client, baseline, against]);
  const drawn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/baselines/{id}/comparison', {
        params: { path: { id: baseline }, query: { with: against } },
      })
      .then(({ data, response }) => {
        if (!current) return;
        if (response.status === 404) return setShown('missing');
        if (!data) return setShown('failed');
        const outline = (side: Side) => {
          const read = readOutlineView(side.outline, {
            artifact: document,
            version: side.version.id,
          });
          return read.ok ? outlineTexts(read.outline) : new Map<string, UnitText>();
        };
        const titles = new Map(data.titles.map((each) => [each.node, each.title]));
        setShown({
          title: `${sideName(data.older)} compared with ${sideName(data.newer)}`,
          structure: data.structure as readonly UnitChange[],
          outlines: { older: outline(data.older), newer: outline(data.newer) },
          titles,
          components: data.components.map((each) => ({
            node: each.node,
            title: titles.get(each.node) ?? 'A component',
            heading: `${each.from.number} to ${each.to.number}`,
            changes: each.changes as readonly UnitChange[],
            older: each.older as unknown as ContentDocument,
            newer: each.newer as unknown as ContentDocument,
          })),
        });
      })
      .catch(() => current && setShown('failed'));
    return () => {
      current = false;
    };
  }, [client, document, baseline, against]);

  if (shown === null) return <p className={styles['note']}>Comparing...</p>;
  if (shown === 'missing') return <p className={styles['note']}>There is no such comparison.</p>;
  if (shown === 'failed')
    return <p className={styles['note']}>The comparison could not be read.</p>;
  return (
    <article className={styles['page']} aria-labelledby="comparison-heading">
      <header className={styles['head']}>
        <p>
          <a href={baselineLink(document, baseline)}>Back to the baseline</a>
          {' · '}
          <a href={documentLink(document)}>Open the document</a>
        </p>
        <h1 id="comparison-heading" className={styles['title']}>
          {shown.title}
        </h1>
        <button
          type="button"
          onClick={() =>
            drawn.current &&
            saveHtml(`${shown.title}.html`, redlineHtml(shown.title, drawn.current))
          }
        >
          Export
        </button>
      </header>
      <div ref={drawn} className={styles['body']}>
        <section aria-labelledby="comparison-structure">
          <h2 id="comparison-structure" className={styles['section']}>
            Structure
          </h2>
          <Redline
            changes={shown.structure}
            texts={{ ...shown.outlines, names: shown.titles }}
            label="Changes to the structure"
          />
        </section>
        <section aria-labelledby="comparison-content">
          <h2 id="comparison-content" className={styles['section']}>
            Content
          </h2>
          {shown.components.length === 0 && (
            <p className={styles['note']}>No component you may read changed.</p>
          )}
          {shown.components.map((each) => (
            <section key={each.node} aria-label={each.title} className={styles['component']}>
              <h3 className={styles['component-title']}>
                {each.title} <span className={styles['note']}>{each.heading}</span>
              </h3>
              <Redline
                changes={each.changes}
                texts={{ older: unitTexts(each.older), newer: unitTexts(each.newer) }}
                label={`Changes to ${each.title}`}
              />
            </section>
          ))}
        </section>
        <section aria-labelledby="comparison-printed">
          <h2 id="comparison-printed" className={styles['section']}>
            Published output
          </h2>
          {printed === null && <p className={styles['note']}>Comparing what each would print...</p>}
          {printed === 'failed' && (
            <p className={styles['note']}>What each would print could not be compared.</p>
          )}
          {printed !== null && printed !== 'failed' && (
            <>
              <p className={styles['note']}>
                {printed.document.length === 0
                  ? 'The layout, theme, template and definitions are the same on both sides.'
                  : `For the whole document, ${printed.document.map((cause) => DOCUMENT_CAUSES[cause]).join(', and ')}.`}
              </p>
              {printed.nodes.length === 0 && (
                <p className={styles['note']}>Every component you may read prints the same.</p>
              )}
              <ul className={styles['printed']} aria-label="What prints differently">
                {printed.nodes.map((each) => (
                  <li key={each.node}>
                    <strong>{each.title || 'A component'}</strong>
                    {': '}
                    {each.causes.map((cause) => NODE_CAUSES[cause]).join('; ')}
                    {each.values.length > 0 && (
                      <ul>
                        {each.values.map((value) => (
                          <li key={value.binding}>
                            {`${value.binding}: `}
                            <del>
                              <span className={styles['hidden']}>Was: </span>
                              {value.older ?? 'nothing'}
                            </del>
                            {' to '}
                            <ins>
                              <span className={styles['hidden']}>Now: </span>
                              {value.newer ?? 'nothing'}
                            </ins>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </article>
  );
}
