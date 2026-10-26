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
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A bound value as printed: the data's own, or nothing. */
const Value = ({ value }: { value: string | null }) =>
  value === null ? <>{words('compare.nothing')}</> : <span data-content>{value}</span>;

/** What made a difference, in words (VER-031, VER-045). */
const DOCUMENT_CAUSES = {
  get layout() {
    return words('compare.the-layout-changed');
  },
  get theme() {
    return words('compare.the-theme-changed');
  },
  get template() {
    return words('compare.the-template-changed');
  },
  get definition() {
    return words('compare.the-definitions-it-is-checked');
  },
  get parameters() {
    return words('compare.its-parameters-changed');
  },
} as const;
const NODE_CAUSES = {
  get edited() {
    return words('compare.edited');
  },
  get data() {
    return words('compare.its-data-changed');
  },
  get definition() {
    return words('compare.a-definition-it-was-written');
  },
  // REU-014: the document's own difference, never a fork of the component.
  get overridden() {
    return words('compare.overridden-in-this-document');
  },
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
    /** Whether the title is the component's own, not the interface's word for one. */
    readonly titled: boolean;
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
  side.baseline === null
    ? words('compare.the-document-now', { number: side.version.number })
    : side.baseline.name;

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
          title: words('compare.compared-with', {
            older: sideName(data.older),
            newer: sideName(data.newer),
          }),
          structure: data.structure as readonly UnitChange[],
          outlines: { older: outline(data.older), newer: outline(data.newer) },
          titles,
          components: data.components.map((each) => ({
            node: each.node,
            title: titles.get(each.node) ?? words('compare.a-component'),
            titled: titles.has(each.node),
            heading: words('compare.to', { from: each.from.number, to: each.to.number }),
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

  if (shown === null) return <p className={styles['note']}>{words('compare.comparing')}</p>;
  if (shown === 'missing')
    return <p className={styles['note']}>{words('compare.there-is-no-such-comparison')}</p>;
  if (shown === 'failed')
    return <p className={styles['note']}>{words('compare.the-comparison-could-not-be')}</p>;
  return (
    <article className={styles['page']} aria-labelledby="comparison-heading">
      <header className={styles['head']}>
        <p>
          <a href={baselineLink(document, baseline)}>{words('compare.back-to-the-baseline')}</a>
          {' · '}
          <a href={documentLink(document)}>{words('compare.open-the-document')}</a>
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
          {words('compare.export')}
        </button>
      </header>
      <div ref={drawn} className={styles['body']}>
        <section aria-labelledby="comparison-structure">
          <h2 id="comparison-structure" className={styles['section']}>
            {words('compare.structure')}
          </h2>
          <Redline
            changes={shown.structure}
            texts={{ ...shown.outlines, names: shown.titles }}
            label={words('compare.changes-to-the-structure')}
          />
        </section>
        <section aria-labelledby="comparison-content">
          <h2 id="comparison-content" className={styles['section']}>
            {words('compare.content')}
          </h2>
          {shown.components.length === 0 && (
            <p className={styles['note']}>{words('compare.no-component-you-may-read')}</p>
          )}
          {shown.components.map((each) => (
            <section key={each.node} aria-label={each.title} className={styles['component']}>
              <h3 className={styles['component-title']}>
                {each.titled ? <span data-content>{each.title}</span> : each.title}{' '}
                <span className={styles['note']}>{each.heading}</span>
              </h3>
              <Redline
                changes={each.changes}
                texts={{ older: unitTexts(each.older), newer: unitTexts(each.newer) }}
                label={words('compare.changes-to', { title: each.title })}
              />
            </section>
          ))}
        </section>
        <section aria-labelledby="comparison-printed">
          <h2 id="comparison-printed" className={styles['section']}>
            {words('compare.published-output')}
          </h2>
          {printed === null && (
            <p className={styles['note']}>{words('compare.comparing-what-each-would-print')}</p>
          )}
          {printed === 'failed' && (
            <p className={styles['note']}>{words('compare.what-each-would-print-could')}</p>
          )}
          {printed !== null && printed !== 'failed' && (
            <>
              <p className={styles['note']}>
                {printed.document.length === 0
                  ? words('compare.the-layout-theme-template-and')
                  : words('compare.for-the-whole-document', {
                      causes: formats().list(
                        printed.document.map((cause) => DOCUMENT_CAUSES[cause]),
                      ),
                    })}
              </p>
              {printed.nodes.length === 0 && (
                <p className={styles['note']}>{words('compare.every-component-you-may-read')}</p>
              )}
              <ul
                className={styles['printed']}
                aria-label={words('compare.what-prints-differently')}
              >
                {printed.nodes.map((each) => (
                  <li key={each.node}>
                    {wordsWith(
                      'compare.prints-differently-because',
                      {
                        causes: formats().list(
                          each.causes.map((cause) => NODE_CAUSES[cause]),
                          { type: 'unit', style: 'short' },
                        ),
                      },
                      {
                        title: each.title ? (
                          <strong data-content>{each.title}</strong>
                        ) : (
                          <strong>{words('compare.a-component')}</strong>
                        ),
                      },
                    )}
                    {each.values.length > 0 && (
                      <ul>
                        {each.values.map((value) => (
                          <li key={value.binding}>
                            {wordsWith(
                              'compare.value-was-now',
                              {},
                              {
                                binding: <span data-content>{value.binding}</span>,
                                older: (
                                  <del>
                                    <span className={styles['hidden']}>
                                      {words('compare.was')}
                                    </span>
                                    <Value value={value.older} />
                                  </del>
                                ),
                                newer: (
                                  <ins>
                                    <span className={styles['hidden']}>
                                      {words('compare.now')}
                                    </span>
                                    <Value value={value.newer} />
                                  </ins>
                                ),
                              },
                            )}
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
