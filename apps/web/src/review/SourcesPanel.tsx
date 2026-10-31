import type { createApiClient } from '@alloy-works/api-client';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import { entryLink } from '../bibliography/links.js';
import { Notice } from '../states/Notice.js';
import { formats, words, wordsWith } from '../words/words.js';

/** Elements listed as the person's language lists things, each element where its item stands. */
function listOf(elements: readonly ReactNode[]): ReactNode[] {
  return formats()
    .list(
      elements.map((_, i) => `\u{E010}${i}\u{E011}`),
      { type: 'unit' },
    )
    .split(/\u{E010}(\d+)\u{E011}/u)
    .map((part, i) =>
      i % 2 === 0 ? part : <Fragment key={`item-${part}`}>{elements[Number(part)]}</Fragment>,
    );
}

type Client = ReturnType<typeof createApiClient>;

interface Flagged {
  readonly flag: 'retracted' | 'superseded' | 'corrected';
  readonly entry: {
    readonly id: string;
    readonly key: string;
    readonly title: string | null;
  } | null;
  readonly components: readonly { readonly id: string; readonly title: string }[];
  readonly unreadable: boolean;
}

/**
 * The Sources panel in Review (the XR plan, XR-G): each cited source its source says is retracted or
 * corrected, and the components citing it. A source the reader may not read is its flag alone. Read
 * when the panel is first shown.
 */
export function SourcesPanel({
  client,
  document,
  active,
}: {
  readonly client: Client;
  readonly document: string;
  readonly active: boolean;
}) {
  const [items, setItems] = useState<readonly Flagged[] | 'failed' | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void client
      .GET('/v1/documents/{id}/flagged-sources', { params: { path: { id: document } } })
      .then(({ data }) => {
        if (live) setItems(data ? data.items : 'failed');
      })
      .catch(() => {
        if (live) setItems('failed');
      });
    return () => {
      live = false;
    };
  }, [client, document, active]);

  if (items === null) return null;
  if (items === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('review.the-flagged-sources-could-not')}</p>
      </Notice>
    );
  }
  if (items.length === 0) return <p>{words('review.no-cited-source-is-retracted')}</p>;
  return (
    <ul aria-label={words('review.flagged-sources')}>
      {items.map((each, at) => (
        <li key={each.entry?.id ?? `unread-${at}`}>
          {wordsWith(
            'review.flagged-source',
            {
              flag: each.flag,
              readable: each.entry ? 'yes' : 'no',
              cited: each.components.length > 0 ? 'yes' : 'no',
              unreadable: each.unreadable ? 'yes' : 'no',
            },
            {
              source: each.entry && (
                <a href={entryLink(each.entry.id)} data-content>
                  {formats().list(
                    [each.entry.key, each.entry.title].filter((part): part is string =>
                      Boolean(part),
                    ),
                    { type: 'unit' },
                  )}
                </a>
              ),
              components: listOf(
                each.components.map((component) => (
                  <a key={component.id} href={`#/components/${component.id}`} data-content>
                    {component.title}
                  </a>
                )),
              ),
            },
          )}
        </li>
      ))}
    </ul>
  );
}
