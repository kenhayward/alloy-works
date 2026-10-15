import type { createApiClient } from '@alloy-works/api-client';
import { unitTexts, type ContentDocument, type UnitChange } from '@alloy-works/domain';
import { useState } from 'react';

import { Redline } from '../compare/Redline.js';
import styles from './NewerVersion.module.css';

type Client = ReturnType<typeof createApiClient>;

/** A version by its id and number. */
export interface VersionNamed {
  readonly id: string;
  readonly number: string;
}

type Shown =
  | null
  | 'reading'
  | 'failed'
  | {
      readonly changes: readonly UnitChange[];
      readonly older: ContentDocument;
      readonly newer: ContentDocument;
    };

/**
 * A reference pinned below a newer version the reader may read (CNT-181; document-view.md,
 * "Versions"): it says so, naming both, and offers the component's comparison (CNT-111) between them,
 * asked for only when the reader asks.
 */
export function NewerVersion({
  client,
  component,
  pinned,
  newer,
  said,
}: {
  client: Client;
  component: string;
  pinned: VersionNamed;
  newer: VersionNamed;
  /** What it says in place of a pin's sentence: a revision approved since the last publication (LIF-041). */
  said?: string | undefined;
}) {
  const [shown, setShown] = useState<Shown>(null);
  const compare = async () => {
    setShown('reading');
    const answer = await client
      .GET('/v1/components/{id}/comparison', {
        params: { path: { id: component }, query: { from: pinned.id, to: newer.id } },
      })
      .catch(() => undefined);
    const data = answer?.data;
    setShown(
      data
        ? {
            changes: data.changes as readonly UnitChange[],
            older: data.older as unknown as ContentDocument,
            newer: data.newer as unknown as ContentDocument,
          }
        : 'failed',
    );
  };
  return (
    <>
      <p className={styles['newer']}>
        <span>
          {said ?? `Version ${newer.number} is newer than the ${pinned.number} pinned here.`}
        </span>
        {shown === null || shown === 'failed' ? (
          <button type="button" onClick={() => void compare()}>
            {`Compare ${pinned.number} with ${newer.number}`}
          </button>
        ) : (
          <button type="button" onClick={() => setShown(null)}>
            Hide the comparison
          </button>
        )}
      </p>
      {shown === 'failed' && (
        <p role="alert" className={styles['newer']}>
          The comparison could not be read.
        </p>
      )}
      {shown !== null && shown !== 'failed' && shown !== 'reading' && (
        <div className={styles['comparison']}>
          <Redline
            changes={shown.changes}
            texts={{ older: unitTexts(shown.older), newer: unitTexts(shown.newer) }}
            label={`Changes from ${pinned.number} to ${newer.number}`}
          />
        </div>
      )}
    </>
  );
}
