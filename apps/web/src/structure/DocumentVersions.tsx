import type { createApiClient } from '@alloy-works/api-client';
import { outlineTexts, readOutlineView, type UnitChange, type UnitText } from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import { Redline } from '../compare/Redline.js';
import {
  documentRestoreWords,
  restoreAnswerText,
  type RestoreAnswer,
  type RestoreRefusal,
} from '../editor/restoreWords.js';
import { VersionList, type ListedVersion } from '../editor/VersionList.js';
import { ApprovalsList } from '../lifecycle/Approvals.js';
import styles from '../editor/VersionList.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * A document's restore previewed (VER-035): the outline's changes from the latest the preview was
 * made against, which the write names (the RS final review), and refusals.
 */
interface Restoring {
  readonly version: ListedVersion;
  readonly preview:
    | {
        readonly latest: { readonly id: string; readonly number: string };
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
  readonly answer: RestoreAnswer;
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
  latest,
  onRestored,
}: {
  client: Client;
  id: string;
  mayEdit: boolean;
  /** The version the page shows: the list is read again when another is made, as by an outline act. */
  latest?: string;
  /** Told once a version is restored, so the page shows the new latest. */
  onRestored?: () => void;
}) {
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const [read, setRead] = useState(0);
  // The preview last asked for: an answer to an earlier one, arriving later, is not shown.
  const asked = useRef(0);
  // A restore sent and not yet answered: a second press sends nothing.
  const sending = useRef(false);
  const shown = useRef(latest);
  useEffect(() => {
    if (shown.current === latest) return;
    shown.current = latest;
    setRead((count) => count + 1);
  }, [latest]);

  const preview = async (version: ListedVersion) => {
    const ask = (asked.current += 1);
    setRestoring({ version, preview: 'reading', answer: null });
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
      preview: data
        ? {
            latest: data.latest,
            structure: data.structure as readonly UnitChange[],
            texts: {
              older: texts(data.older, data.latest.id),
              newer: texts(data.newer, data.from.id),
              // Each side's own: a unit the restore removes is the latest's, any other the restored
              // side's, as the redline draws it.
              names: new Map(
                [...data.titles.older, ...data.titles.newer].map((each) => [each.node, each.title]),
              ),
            },
            refusals: data.refusals,
          }
        : 'failed',
      answer: null,
    });
  };

  const restore = async (now: Restoring) => {
    if (sending.current || typeof now.preview !== 'object') return;
    sending.current = true;
    setRestoring({ ...now, answer: 'sending' });
    const answer = await client
      .POST('/v1/documents/{id}/versions/{version}/restore', {
        params: { path: { id, version: now.version.id } },
        body: { latest: now.preview.latest.id },
      })
      .catch(() => undefined)
      .finally(() => (sending.current = false));
    const restored = answer?.data?.version.number;
    const refusal = answer?.error as RestoreRefusal | undefined;
    setRestoring({
      ...now,
      answer:
        restored !== undefined
          ? { restored }
          : { refused: documentRestoreWords(refusal ?? { code: 'failed' }) },
    });
    // Restored, or the latest moved on since the preview: the list is read again either way.
    if (restored !== undefined || refusal?.code === 'version_precondition') {
      setRead((count) => count + 1);
    }
    if (restored !== undefined) onRestored?.();
  };

  const label = restoring && words('document.restore', { number: restoring.version.number });
  return (
    <div className={styles['panel']}>
      <VersionList
        client={client}
        id={id}
        of="document"
        read={read}
        opens
        {...(mayEdit ? { onRestore: (version: ListedVersion) => void preview(version) } : {})}
      />
      <ApprovalsList client={client} kind="document" id={id} key={latest} />
      {restoring && label && (
        <section aria-label={label} className={styles['compared']}>
          <h3 className={styles['heading']}>{label}</h3>
          {restoring.preview === 'failed' && (
            <p className={styles['muted']}>{words('document.what-restoring-it-would-make')}</p>
          )}
          {typeof restoring.preview === 'object' && (
            <>
              <p className={styles['muted']}>
                {words('document.a-new-version-after-with', {
                  number: restoring.preview.latest.number,
                  number2: restoring.version.number,
                  number3: restoring.version.number,
                })}
              </p>
              <Redline
                changes={restoring.preview.structure}
                texts={restoring.preview.texts}
                label={words('document.what-restoring-would-change', {
                  number: restoring.version.number,
                })}
              />
              {restoring.preview.refusals.map((refusal) => (
                <p
                  key={`${refusal.code} ${refusal.reason ?? ''} ${refusal.node ?? ''}`}
                  className={styles['muted']}
                >
                  {documentRestoreWords(refusal)}
                </p>
              ))}
              {(restoring.answer === null || restoring.answer === 'sending') &&
                restoring.preview.refusals.length === 0 && (
                  <button
                    type="button"
                    disabled={restoring.answer === 'sending'}
                    onClick={() => void restore(restoring)}
                  >
                    {words('document.restore-this-version')}
                  </button>
                )}
            </>
          )}
          {/* There from the start, so what the restore answers is announced. */}
          <p role="status">{restoreAnswerText(restoring.answer)}</p>
        </section>
      )}
    </div>
  );
}
