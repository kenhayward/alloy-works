import type { createApiClient } from '@alloy-works/api-client';
import { outlineTexts, readOutlineView, type UnitChange, type UnitText } from '@alloy-works/domain';
import { useRef, useState } from 'react';

import { Redline } from '../compare/Redline.js';
import { documentRestoreWords, type RestoreRefusal } from '../editor/restoreWords.js';
import { VersionList, type ListedVersion } from '../editor/VersionList.js';
import styles from '../editor/VersionList.module.css';

type Client = ReturnType<typeof createApiClient>;

/** A document's restore previewed (VER-035): the outline's changes from the latest, and refusals. */
interface Restoring {
  readonly version: ListedVersion;
  readonly latest: ListedVersion;
  readonly preview:
    | {
        readonly structure: readonly UnitChange[];
        readonly texts: {
          readonly older: ReadonlyMap<string, UnitText>;
          readonly newer: ReadonlyMap<string, UnitText>;
          readonly names: ReadonlyMap<string, string>;
        };
        readonly refusals: readonly RestoreRefusal[];
      }
    | 'reading'
    | 'failed';
  readonly answer: { readonly restored: string } | { readonly refused: string } | null;
}

/**
 * A document's Versions panel (the RS plan, RS-H): each version, who made it and when, and what it
 * was restored from; for an author who may edit, **Restore** on each earlier version, with what it
 * would change in the outline from the latest and any refusal, then **Restore this version**.
 */
export function DocumentVersions({
  client,
  id,
  mayEdit,
  onRestored,
}: {
  client: Client;
  id: string;
  mayEdit: boolean;
  /** Told once a version is restored, so the page shows the new latest. */
  onRestored?: () => void;
}) {
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const [read, setRead] = useState(0);
  // The preview last asked for: an answer to an earlier one, arriving later, is not shown.
  const asked = useRef(0);

  const preview = async (version: ListedVersion, latest: ListedVersion) => {
    const ask = (asked.current += 1);
    setRestoring({ version, latest, preview: 'reading', answer: null });
    const answer = await client
      .GET('/v1/documents/{id}/versions/{version}/restoration', {
        params: { path: { id, version: version.id } },
      })
      .catch(() => undefined);
    if (ask !== asked.current) return;
    const data = answer?.data;
    const texts = (outline: unknown, side: string) => {
      const view = readOutlineView(outline, { artifact: id, version: side });
      return view.ok ? outlineTexts(view.outline) : new Map<string, UnitText>();
    };
    setRestoring({
      version,
      latest,
      preview: data
        ? {
            structure: data.structure as readonly UnitChange[],
            texts: {
              older: texts(data.older, data.latest.id),
              newer: texts(data.newer, data.from.id),
              names: new Map(data.titles.map((each) => [each.node, each.title])),
            },
            refusals: data.refusals,
          }
        : 'failed',
      answer: null,
    });
  };

  const restore = async (now: Restoring) => {
    const answer = await client
      .POST('/v1/documents/{id}/versions/{version}/restore', {
        params: { path: { id, version: now.version.id } },
        body: { latest: now.latest.id },
      })
      .catch(() => undefined);
    const restored = answer?.data?.version.number;
    const refusal = answer?.error as RestoreRefusal | undefined;
    setRestoring({
      ...now,
      answer:
        restored !== undefined
          ? { restored }
          : { refused: documentRestoreWords(refusal ?? { code: 'failed' }) },
    });
    if (restored === undefined) return;
    setRead((count) => count + 1);
    onRestored?.();
  };

  const label = restoring && `Restore ${restoring.version.number}`;
  return (
    <div className={styles['panel']}>
      <VersionList
        client={client}
        id={id}
        of="document"
        read={read}
        {...(mayEdit
          ? {
              onRestore: (version: ListedVersion, latest: ListedVersion) =>
                void preview(version, latest),
            }
          : {})}
      />
      {restoring && label && (
        <section aria-label={label} className={styles['compared']}>
          <h3 className={styles['heading']}>{label}</h3>
          {restoring.preview === 'failed' && (
            <p className={styles['muted']}>What restoring it would make could not be read.</p>
          )}
          {typeof restoring.preview === 'object' && (
            <>
              <p className={styles['muted']}>
                {`A new version after ${restoring.latest.number}, with the outline ${restoring.version.number} had. Its parameters stay as they are now, and ${restoring.version.number} itself stays as it is.`}
              </p>
              <Redline
                changes={restoring.preview.structure}
                texts={restoring.preview.texts}
                label={`What restoring ${restoring.version.number} would change`}
              />
              {restoring.preview.refusals.map((refusal) => (
                <p key={`${refusal.code} ${refusal.reason ?? ''}`} className={styles['muted']}>
                  {documentRestoreWords(refusal)}
                </p>
              ))}
              {restoring.answer === null && restoring.preview.refusals.length === 0 && (
                <button type="button" onClick={() => void restore(restoring)}>
                  Restore this version
                </button>
              )}
              {restoring.answer !== null && (
                <p role="status">
                  {'restored' in restoring.answer
                    ? `Restored as version ${restoring.answer.restored}.`
                    : restoring.answer.refused}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
