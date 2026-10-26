import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import styles from './Delete.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export type Deletable = 'component' | 'document';

/** A reason a deletion is refused, as the service lists it (the DL plan, DL-C). */
export interface DeletionRefusal {
  readonly code: string;
  readonly named?: readonly { readonly id: string; readonly title: string }[] | undefined;
  readonly unreadable?: boolean | undefined;
  readonly holder?: { readonly name: string | null } | undefined;
  /** locked: the caller holds it, from this window or another. */
  readonly yours?: boolean | undefined;
  /** kept: when the longest retention keep passes. */
  readonly until?: string | undefined;
}

/** What deleting it leaves, kept (LIF-024, VER-048). */
export interface Remains {
  readonly versions: number;
  readonly iterations: number;
  readonly threads: number;
  readonly suggestions: number;
  readonly rounds: number;
  readonly events: number;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A list in words: a, b and c. */
const listed = (parts: readonly string[]) =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : words('lifecycle.and', { value1: parts.slice(0, -1).join(', '), value2: parts.at(-1) });

/**
 * What stays, in words: every count but an empty one, versions and events always. Unsaved changes
 * still expire by their window (VER-003), deleted or not.
 */
export function remainsWords(remains: Remains): string {
  const parts = [
    counted(remains.versions, 'version', 'versions'),
    ...(remains.threads > 0 ? [counted(remains.threads, 'thread', 'threads')] : []),
    ...(remains.suggestions > 0 ? [counted(remains.suggestions, 'suggestion', 'suggestions')] : []),
    ...(remains.rounds > 0
      ? [counted(remains.rounds, words('lifecycle.review-round'), words('lifecycle.review-rounds'))]
      : []),
    counted(remains.events, words('lifecycle.audit-event'), words('lifecycle.audit-events')),
  ];
  const kept = words('lifecycle.nothing-is-removed-its-are', { value1: listed(parts) });
  if (remains.iterations === 0) return kept;
  const expiring = words('lifecycle.its-unsaved-changes-still-expire', {
    count: remains.iterations,
  });
  return `${kept} ${expiring}`;
}

/**
 * Why it may not be deleted, in words: each dependant named that may be read, and of any other only
 * that there is one, never how many (SCH-032).
 */
export function deletionRefusalWords(refusal: DeletionRefusal): string {
  const names = (refusal.named ?? []).map((each) => each.title || words('lifecycle.untitled'));
  const of = (one: string, many: string, unseen: string) => {
    if (names.length === 0) return words('lifecycle.something-you-may-not-read', { unseen });
    const named = `${names.length === 1 ? one : many}: ${listed(names)}.`;
    return refusal.unreadable === true
      ? words('lifecycle.something-you-may-not-read-2', { named })
      : named;
  };
  switch (refusal.code) {
    case 'baselined':
      return of(
        words('lifecycle.a-baseline-pins-it'),
        words('lifecycle.baselines-pin-it'),
        words('lifecycle.pins-it'),
      );
    case 'published':
      return of(
        words('lifecycle.a-publication-placed-it'),
        words('lifecycle.publications-placed-it'),
        words('lifecycle.placed-it'),
      );
    case 'publishing':
      return of(
        words('lifecycle.a-publication-waiting-to-be'),
        words('lifecycle.publications-waiting-to-be-made'),
        words('lifecycle.is-waiting-to-be-made'),
      );
    case 'referenced':
      return of(
        words('lifecycle.a-document-references-it'),
        words('lifecycle.documents-reference-it'),
        words('lifecycle.references-it'),
      );
    case 'in_review':
      return of(
        words('lifecycle.a-review-round-is-open'),
        words('lifecycle.review-rounds-are-open-on'),
        words('lifecycle.is-reviewing-it'),
      );
    case 'held':
      return words('lifecycle.a-legal-hold-is-on');
    case 'kept':
      return refusal.until === undefined
        ? words('lifecycle.a-retention-keep-holds-it')
        : words('lifecycle.a-retention-keep-holds-it-2', {
            value1: day.format(new Date(refusal.until)),
          });
    case 'locked':
      return refusal.yours === true
        ? words('lifecycle.you-are-editing-it-choose')
        : words('lifecycle.is-editing-it', { value1: refusal.holder?.name ?? 'Somebody' });
    default:
      return words('lifecycle.something-depends-on-it');
  }
}

type Shown =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'read';
      readonly remains: Remains;
      readonly refusals: readonly DeletionRefusal[];
    };

/**
 * Asks before a component or a document is deleted (the DL plan, DL-H): what deleting it leaves, and
 * every reason it may not be, read when it opens; **Delete** only where nothing refuses it.
 */
export function DeleteDialog({
  client,
  kind,
  id,
  title,
  onDeleted,
  onClose,
}: {
  client: Client;
  kind: Deletable;
  id: string;
  title: string;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<Shown>({ state: 'loading' });
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const params = { params: { path: { id } } };

  useEffect(() => {
    let current = true;
    const path = { params: { path: { id } } };
    const asked =
      kind === 'component'
        ? client.GET('/v1/components/{id}/deletion', path)
        : client.GET('/v1/documents/{id}/deletion', path);
    asked
      .then(({ data }) => {
        if (!current) return;
        setShown(
          data
            ? { state: 'read', remains: data.remains, refusals: data.refusals }
            : { state: 'failed' },
        );
      })
      .catch(() => current && setShown({ state: 'failed' }));
    return () => {
      current = false;
    };
  }, [client, kind, id]);

  const remove = async () => {
    setBusy(true);
    const answer = await (
      kind === 'component'
        ? client.POST('/v1/components/{id}/delete', params)
        : client.POST('/v1/documents/{id}/delete', params)
    ).catch(() => undefined);
    if (answer?.data) {
      onDeleted();
      return;
    }
    const refusals = (answer?.error as { refusals?: DeletionRefusal[] } | undefined)?.refusals;
    if (refusals && shown.state === 'read') setShown({ ...shown, refusals });
    else setSaid(words('lifecycle.could-not-be-deleted-try', { title }));
    setBusy(false);
  };

  return (
    <Modal labelledBy="delete-heading" size="dialog" onClose={onClose}>
      <div className={styles['deleting']}>
        <h2 id="delete-heading">{words('lifecycle.delete', { title })}</h2>
        {shown.state === 'loading' && <p>{words('lifecycle.reading-what-depends-on-it')}</p>}
        {shown.state === 'failed' && <p>{words('lifecycle.what-depends-on-it-could')}</p>}
        {shown.state === 'read' && (
          <>
            <p>{remainsWords(shown.remains)}</p>
            {shown.refusals.length > 0 && (
              <>
                <p>{words('lifecycle.it-cannot-be-deleted-while')}</p>
                <ul className={styles['reasons']}>
                  {shown.refusals.map((refusal) => (
                    <li key={refusal.code}>{deletionRefusalWords(refusal)}</li>
                  ))}
                </ul>
                <p className={styles['quiet']}>{words('lifecycle.archive-it-instead-to-take')}</p>
              </>
            )}
          </>
        )}
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('lifecycle.cancel')}
          </button>
          {shown.state === 'read' && shown.refusals.length === 0 && (
            <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
              {words('lifecycle.delete-2')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * **Delete**, offered on a component's or a document's own page only to whoever its view says may
 * retire it, beside Archive (DL-H); the route decides again.
 */
export function DeleteButton({
  client,
  kind,
  id,
  title,
  mayRetire,
  onDeleted,
  className,
}: {
  client: Client;
  kind: Deletable;
  id: string;
  title: string;
  mayRetire: boolean;
  onDeleted: () => void;
  className?: string | undefined;
}) {
  const [asking, setAsking] = useState(false);
  if (!mayRetire) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {words('lifecycle.delete-2')}
      </button>
      {asking && (
        <DeleteDialog
          client={client}
          kind={kind}
          id={id}
          title={title}
          onClose={() => setAsking(false)}
          onDeleted={() => {
            setAsking(false);
            onDeleted();
          }}
        />
      )}
    </>
  );
}
