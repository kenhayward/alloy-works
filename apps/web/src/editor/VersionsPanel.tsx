import type { createApiClient } from '@alloy-works/api-client';
import {
  compareContent,
  unitTexts,
  type ContentDocument,
  type UnitChange,
} from '@alloy-works/domain';
import { useRef, useState } from 'react';

import { Redline, redlineHtml, saveHtml } from '../compare/Redline.js';
import type { Mine } from './ComponentEditor.js';
import { restoreRefusalWords, type RestoreRefusal } from './restoreWords.js';
import { VersionList, type ListedVersion } from './VersionList.js';
import styles from './VersionList.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly title: string;
  readonly changes: readonly UnitChange[];
  readonly older: ContentDocument;
  readonly newer: ContentDocument;
}

/** A restore previewed (VER-035): the version, the latest it follows, and what it would make. */
interface Restoring {
  readonly version: ListedVersion;
  readonly latest: ListedVersion;
  readonly preview:
    | {
        readonly notCarried: readonly { readonly name: string | null; readonly value: unknown }[];
        readonly refusals: readonly RestoreRefusal[];
      }
    | 'reading'
    | 'failed';
  /** What the write answered: the new version's number, or why it was refused. */
  readonly answer: { readonly restored: string } | { readonly refused: string } | null;
}

/** A value not carried, as the preview names it. */
const valueText = (value: unknown) =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(String).join(', ')
      : JSON.stringify(value);

/**
 * The Versions panel (CNT-111, CNT-112, CNT-113): each version, who cut it and when, with **Compare**
 * against the latest; and **My changes**, what this editor holds now against the version it opened,
 * compared in the browser (CP-E), so it needs no lock and lags no save. The redline beneath, and its
 * export. For an author who may edit, **Restore** on each earlier version (the RS plan, RS-H): what it
 * would change from the latest, the values not carried, any refusal, then **Restore this version**.
 */
export function VersionsPanel({
  client,
  id,
  mine,
  onRestored,
}: {
  client: Client;
  id: string;
  /** The version the editor opened and what it shows now, or null where nothing is open to compare. */
  mine?: () => Mine | null;
  /** Told once a version is restored, so the editor opens the new latest. */
  onRestored?: () => void;
}) {
  const [shown, setShown] = useState<Shown | 'failed' | 'nothing' | null>(null);
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const [read, setRead] = useState(0);
  const drawn = useRef<HTMLDivElement>(null);
  // The comparison last asked for: an answer to an earlier one, arriving later, is not shown.
  const asked = useRef(0);
  const mayRestore = mine?.()?.mayEdit === true;

  const compare = async (from: ListedVersion, to: ListedVersion, ask = (asked.current += 1)) => {
    const answer = await client
      .GET('/v1/components/{id}/comparison', {
        params: { path: { id }, query: { from: from.id, to: to.id } },
      })
      .catch(() => undefined);
    if (ask !== asked.current) return;
    const data = answer?.data;
    if (!data) return setShown('failed');
    setShown({
      title: `Changes from ${data.from.number} to ${data.to.number}`,
      changes: data.changes as readonly UnitChange[],
      older: data.older as unknown as ContentDocument,
      newer: data.newer as unknown as ContentDocument,
    });
  };

  /** The restore's preview, and the comparison from the latest to what it would bring back. */
  const previewRestore = async (version: ListedVersion, latest: ListedVersion) => {
    const ask = (asked.current += 1);
    setShown(null);
    setRestoring({ version, latest, preview: 'reading', answer: null });
    void compare(latest, version, ask);
    const answer = await client
      .GET('/v1/components/{id}/versions/{version}/restoration', {
        params: { path: { id, version: version.id } },
      })
      .catch(() => undefined);
    if (ask !== asked.current) return;
    const data = answer?.data;
    setRestoring({
      version,
      latest,
      preview: data ? { notCarried: data.notCarried, refusals: data.refusals } : 'failed',
      answer: null,
    });
  };

  const restore = async (now: Restoring) => {
    const answer = await client
      .POST('/v1/components/{id}/versions/{version}/restore', {
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
          : { refused: restoreRefusalWords(refusal ?? { code: 'failed' }) },
    });
    if (restored === undefined) return;
    setRead((count) => count + 1);
    onRestored?.();
  };

  const myChanges = () => {
    asked.current += 1;
    setRestoring(null);
    const pair = mine?.();
    if (!pair) return setShown('nothing');
    setShown({
      title: 'My changes',
      changes: compareContent(pair.older, pair.newer).changes,
      older: pair.older,
      newer: pair.newer,
    });
  };

  return (
    <div className={styles['panel']}>
      {mine && (
        <button type="button" onClick={myChanges}>
          My changes
        </button>
      )}
      <VersionList
        client={client}
        id={id}
        read={read}
        onCompare={(version, latest) => {
          setRestoring(null);
          void compare(version, latest);
        }}
        {...(mayRestore
          ? {
              onRestore: (version: ListedVersion, latest: ListedVersion) =>
                void previewRestore(version, latest),
            }
          : {})}
      />
      {restoring && (
        <section aria-label={`Restore ${restoring.version.number}`} className={styles['compared']}>
          <h3 className={styles['heading']}>{`Restore ${restoring.version.number}`}</h3>
          {restoring.preview === 'failed' && (
            <p className={styles['muted']}>What restoring it would make could not be read.</p>
          )}
          {typeof restoring.preview === 'object' && (
            <>
              <p className={styles['muted']}>
                {`A new version after ${restoring.latest.number}, holding what ${restoring.version.number} holds. ${restoring.version.number} itself stays as it is.`}
              </p>
              {restoring.preview.notCarried.length > 0 && (
                <>
                  <p className={styles['muted']}>
                    Not carried forward, because these fields are no longer the component&apos;s:
                  </p>
                  <ul aria-label="Values not carried" className={styles['carried']}>
                    {restoring.preview.notCarried.map((each, index) => (
                      <li
                        key={index}
                      >{`${each.name ?? 'A field no longer held'}: ${valueText(each.value)}`}</li>
                    ))}
                  </ul>
                </>
              )}
              {restoring.preview.refusals.map((refusal) => (
                <p key={refusal.code} className={styles['muted']}>
                  {restoreRefusalWords(refusal)}
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
      {shown === 'failed' && <p className={styles['muted']}>The comparison could not be read.</p>}
      {shown === 'nothing' && (
        <p className={styles['muted']}>Nothing is open for editing to compare yet.</p>
      )}
      {shown !== null && shown !== 'failed' && shown !== 'nothing' && (
        <section aria-label={shown.title} className={styles['compared']}>
          <h3 className={styles['heading']}>{shown.title}</h3>
          <div ref={drawn}>
            <Redline
              changes={shown.changes}
              texts={{ older: unitTexts(shown.older), newer: unitTexts(shown.newer) }}
              label={shown.title}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              drawn.current &&
              saveHtml(
                `${shown.newer.title} - ${shown.title}.html`,
                redlineHtml(`${shown.newer.title}: ${shown.title}`, drawn.current),
              )
            }
          >
            Export
          </button>
        </section>
      )}
    </div>
  );
}
