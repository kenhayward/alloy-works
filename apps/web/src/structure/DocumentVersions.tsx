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
import type { ListedVersion } from '../editor/VersionList.js';
import { changeCounts } from '../editor/versionDays.js';
import { VersionTimeline } from '../editor/VersionTimeline.js';
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

/** Two of its versions compared (the plan, D8): its outline, then its values and parameters. */
interface Compared {
  readonly title: string;
  readonly structure: readonly UnitChange[];
  readonly texts: {
    readonly older: ReadonlyMap<string, UnitText>;
    readonly newer: ReadonlyMap<string, UnitText>;
    readonly names: ReadonlyMap<string, string>;
  };
  readonly values: readonly string[];
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
  const [compared, setCompared] = useState<Compared | 'failed' | null>(null);
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
    setCompared(null);
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

  const compare = async (from: ListedVersion, to: ListedVersion) => {
    const ask = (asked.current += 1);
    setRestoring(null);
    const answer = await client
      .GET('/v1/documents/{id}/comparison', {
        params: { path: { id }, query: { from: from.id, to: to.id } },
      })
      .catch(() => undefined);
    if (ask !== asked.current) return;
    const data = answer?.data;
    if (!data) return setCompared('failed');
    const texts = (outline: unknown, side: string) => {
      const view = readOutlineView(outline, { artifact: id, version: side });
      return view.ok ? outlineTexts(view.outline) : new Map<string, UnitText>();
    };
    const said = (value: unknown) =>
      value === undefined
        ? words('document.empty-value')
        : Array.isArray(value)
          ? value.map(String).join(', ')
          : String(value);
    setCompared({
      title: words('editor.changes-from-to', { number: data.from.number, number2: data.to.number }),
      structure: data.structure as readonly UnitChange[],
      texts: {
        older: texts(data.older, data.from.id),
        newer: texts(data.newer, data.to.id),
        names: new Map(
          [...data.titles.older, ...data.titles.newer].map((each) => [each.node, each.title]),
        ),
      },
      values: [
        ...data.values.map((each) =>
          words('document.value-changed', {
            name: each.name ?? words('editor.a-field-no-longer-held'),
            older: said(each.older),
            newer: said(each.newer),
          }),
        ),
        ...data.parameters.map((each) =>
          words('document.value-changed', {
            name: each.name,
            older: said(each.older),
            newer: said(each.newer),
          }),
        ),
      ],
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
      <VersionTimeline
        client={client}
        id={id}
        of="document"
        read={read}
        changesFrom={async (older, newer) => {
          const answer = await client
            .GET('/v1/documents/{id}/comparison', {
              params: { path: { id }, query: { from: older.id, to: newer.id } },
            })
            .catch(() => undefined);
          if (!answer?.data) return null;
          const counted = changeCounts(answer.data.structure as readonly UnitChange[]);
          // A value or a parameter changed is a change, though the outline's are counted by unit.
          return {
            ...counted,
            changed: counted.changed + answer.data.values.length + answer.data.parameters.length,
          };
        }}
        onCompare={(version, latest) => void compare(version, latest)}
        {...(mayEdit ? { onRestore: (version: ListedVersion) => void preview(version) } : {})}
      />
      <details className={styles['decided']}>
        <summary>{words('editor.who-decided-what')}</summary>
        <ApprovalsList client={client} kind="document" id={id} key={latest} />
      </details>
      {compared === 'failed' && (
        <p className={styles['muted']}>{words('editor.the-comparison-could-not-be')}</p>
      )}
      {compared !== null && compared !== 'failed' && (
        <section aria-label={compared.title} className={styles['compared']}>
          <h3 className={styles['heading']}>{compared.title}</h3>
          <Redline changes={compared.structure} texts={compared.texts} label={compared.title} />
          {compared.values.length > 0 && (
            <ul aria-label={words('document.values-changed')} className={styles['carried']}>
              {compared.values.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
          )}
        </section>
      )}
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
