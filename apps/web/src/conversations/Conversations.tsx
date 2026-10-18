import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { AssistantPanel } from '../structure/AssistantPanel.js';
import { documentLink } from '../structure/links.js';
import styles from '../structure/DocumentList.module.css';

type Client = ReturnType<typeof createApiClient>;

/** Where the conversations page lives (the G5 plan, G5-A). */
export const CONVERSATIONS = '#/conversations';

/**
 * **Conversations** (generation.md, "The conversation"; the G5 plan, G5-A and G5-D): your
 * conversations on no document, held here with what each reads; and those on a document, each a link
 * to its document's Assistant tab, where it goes on.
 */
export function Conversations({ client }: { readonly client: Client }) {
  const [onDocuments, setOnDocuments] = useState<
    readonly { id: string; title: string; document: string }[]
  >([]);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/conversations', { params: { query: {} } })
      .then(({ data }) => {
        if (!current || !data) return;
        setOnDocuments(
          data.items.flatMap((each) =>
            each.document === null
              ? []
              : [{ id: each.id, title: each.title, document: each.document }],
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <section aria-labelledby="conversations-heading">
      <h1 id="conversations-heading">Conversations</h1>
      <p className={styles['summary']}>
        Talk with a model about anything, in your own words. It reads only what you may read, and
        nothing it proposes changes a part until you accept it. Nobody else sees your conversations.
      </p>
      <AssistantPanel client={client} document={null} component={null} onCite={() => {}} />
      {onDocuments.length > 0 && (
        <section aria-labelledby="on-documents-heading">
          <h2 id="on-documents-heading">On documents</h2>
          <ul>
            {onDocuments.map((each) => (
              <li key={each.id}>
                <a href={documentLink(each.document)}>{each.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
