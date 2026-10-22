import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { flagSaid } from '../bibliography/entries.js';
import { entryLink } from '../bibliography/links.js';
import { Notice } from '../states/Notice.js';

type Client = ReturnType<typeof createApiClient>;

interface Flagged {
  readonly flag: 'retracted' | 'corrected';
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
        <p>The flagged sources could not be read.</p>
      </Notice>
    );
  }
  if (items.length === 0) return <p>No cited source is retracted or corrected.</p>;
  return (
    <ul aria-label="Flagged sources">
      {items.map((each, at) => {
        const named = each.entry && [each.entry.key, each.entry.title].filter(Boolean).join(', ');
        return (
          <li key={each.entry?.id ?? `unread-${at}`}>
            {`${flagSaid(each.flag, true)}: `}
            {each.entry ? (
              <a href={entryLink(each.entry.id)}>{named}</a>
            ) : (
              'a source you may not read'
            )}
            {each.components.length > 0 && (
              <>
                {'. Cited in '}
                {each.components.map((component, index) => (
                  <span key={component.id}>
                    {index > 0 && ', '}
                    <a href={`#/components/${component.id}`}>{component.title}</a>
                  </span>
                ))}
                .
              </>
            )}
            {each.unreadable && ' Cited in components you may not read.'}
          </li>
        );
      })}
    </ul>
  );
}
