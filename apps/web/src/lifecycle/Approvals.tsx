import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import type { Movable } from './Workflow.js';
import styles from './Hold.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Decided {
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | null;
  readonly by: string;
  readonly at: string;
}

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Who approved or rejected it at its gates, when, and a rejection's reason, newest first (LIF-008,
 * LIF-051; the WF2 plan, WF2-L): nothing where nobody has decided.
 */
export function ApprovalsList({ client, kind, id }: { client: Client; kind: Movable; id: string }) {
  const [decided, setDecided] = useState<readonly Decided[]>([]);

  useEffect(() => {
    let current = true;
    const params = { params: { path: { id } } };
    void (
      kind === 'component'
        ? client.GET('/v1/components/{id}/approvals', params)
        : kind === 'document'
          ? client.GET('/v1/documents/{id}/approvals', params)
          : client.GET('/v1/query-definitions/{id}/approvals', params)
    )
      .then(({ data }) => {
        if (!current || !data) return;
        setDecided(
          data.approvals.map((each) => ({
            decision: each.decision,
            reason: each.reason,
            by: each.by.name ?? words('lifecycle.someone'),
            at: each.at,
          })),
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, kind, id]);

  if (decided.length === 0) return null;
  return (
    <ul aria-label={words('lifecycle.approvals')} className={styles['approvals']}>
      {decided.map((each, index) => (
        <li key={index}>
          {`${each.by} ${each.decision === 'approved' ? 'approved' : words('lifecycle.returned-it')}, ${when.format(new Date(each.at))}${each.reason === null ? '' : `: ${each.reason}`}`}
        </li>
      ))}
    </ul>
  );
}
