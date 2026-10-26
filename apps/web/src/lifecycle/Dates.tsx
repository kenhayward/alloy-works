import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import styles from './Hold.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A component's or document's dates, as its view gives them (workflow.md, Dates; WF5-H). */
export interface Dates {
  readonly effectiveAt: string | null;
  readonly reviewBy: string | null;
  readonly owner: { readonly id: string; readonly name: string | null } | null;
  readonly pastReview: boolean;
  readonly effectiveFrom: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** A view's `dates`, read defensively: undefined from a view before them (WF5-H). */
export function datesIn(data: unknown): Dates | undefined {
  if (!isRecord(data) || !isRecord(data.dates)) return undefined;
  const { dates } = data;
  const owner = isRecord(dates.owner) && typeof dates.owner.id === 'string' ? dates.owner : null;
  return {
    effectiveAt: text(dates.effectiveAt),
    reviewBy: text(dates.reviewBy),
    owner: owner === null ? null : { id: owner.id as string, name: text(owner.name) },
    pastReview: dates.pastReview === true,
    effectiveFrom: text(dates.effectiveFrom),
  };
}

/** An instant as a day, in the reader's own zone (LIF-062). */
const dayOfInstant = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** A calendar day as itself, whatever the reader's zone. */
const dayOfDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * What a header says of its dates (LIF-015, LIF-016, LIF-018): when a revision approved from now takes
 * effect, the review-by day and its owner, **Past review** once that day has passed, and when its
 * latest revision takes effect where it waits to. Nothing where none are set.
 */
export function DatesChips({ dates }: { dates: Dates | undefined }) {
  if (!dates) return null;
  return (
    <>
      {dates.effectiveAt !== null && (
        <Chip>{words('lifecycle.effective', { value1: dayOfInstant(dates.effectiveAt) })}</Chip>
      )}
      {dates.reviewBy !== null && (
        <Chip>
          {words('lifecycle.review-by', {
            value1: dayOfDate(dates.reviewBy),
            value2: dates.owner?.name ? `, ${dates.owner.name}` : '',
          })}
        </Chip>
      )}
      {dates.pastReview && <Chip tone="warn">{words('lifecycle.past-review')}</Chip>}
      {dates.effectiveFrom !== null && (
        <Chip tone="info">
          {words('lifecycle.its-latest-revision-takes-effect', {
            value1: dayOfInstant(dates.effectiveFrom),
          })}
        </Chip>
      )}
    </>
  );
}

/** The reader's offset from UTC at a local time, in minutes, written `+01:00`. */
const offsetOf = (local: Date) => {
  const minutes = -local.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const whole = Math.abs(minutes);
  return `${sign}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * **Dates**, offered to whoever may edit it (WF5-A): a dialog setting when a revision approved from
 * now takes effect, in the setter's own time and zone (LIF-062), the review-by day, and its owner, one
 * of the environment's people; saved as one act, a refusal said in the service's words.
 */
export function DatesButton({
  client,
  kind,
  id,
  title,
  dates,
  onSaved,
  className,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  dates: Dates;
  onSaved: (dates: Dates) => void;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {words('lifecycle.dates')}
      </button>
      {open && (
        <DatesDialog
          client={client}
          kind={kind}
          id={id}
          title={title}
          dates={dates}
          onClose={() => setOpen(false)}
          onSaved={(now) => {
            setOpen(false);
            onSaved(now);
          }}
        />
      )}
    </>
  );
}

function DatesDialog({
  client,
  kind,
  id,
  title,
  dates,
  onClose,
  onSaved,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  dates: Dates;
  onClose: () => void;
  onSaved: (dates: Dates) => void;
}) {
  const headingId = useId();
  // The effective time as it was set, in the setter's own local time: its ISO's first 16 characters.
  const [effective, setEffective] = useState(dates.effectiveAt?.slice(0, 16) ?? '');
  const [reviewBy, setReviewBy] = useState(dates.reviewBy ?? '');
  const [owner, setOwner] = useState(dates.owner?.id ?? '');
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/people', { params: { query: { limit: '100' } } })
      .then(({ data }) => {
        if (current && data) setPeople(data.items);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const effectiveAt = effective === '' ? null : `${effective}:00${offsetOf(new Date(effective))}`;
    const body = { effectiveAt, reviewBy: reviewBy === '' ? null : reviewBy, owner: owner || null };
    const options = { params: { path: { id } }, body };
    const { data, error } = await (
      kind === 'component'
        ? client.PUT('/v1/components/{id}/dates', options)
        : client.PUT('/v1/documents/{id}/dates', options)
    ).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onSaved(data);
    else setSaid(refusal(error, words('lifecycle.the-dates-could-not-be')));
  };

  // The owner as set stays offered where the first page of people does not hold them.
  const offered =
    dates.owner && !people.some((each) => each.id === dates.owner!.id)
      ? [{ id: dates.owner.id, name: dates.owner.name ?? words('lifecycle.the-owner') }, ...people]
      : people;

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={headingId}>{words('lifecycle.dates-of', { title })}</h2>
        <label>
          {words('lifecycle.effective-from')}
          <input
            type="datetime-local"
            value={effective}
            onChange={(event) => setEffective(event.target.value)}
          />
        </label>
        <p className={styles['muted']}>{words('lifecycle.a-revision-approved-before-then')}</p>
        <label>
          {words('lifecycle.review-by-2')}
          <input
            type="date"
            value={reviewBy}
            onChange={(event) => setReviewBy(event.target.value)}
          />
        </label>
        <label>
          {words('lifecycle.review-owner')}
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">{words('lifecycle.nobody')}</option>
            {offered.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('lifecycle.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('lifecycle.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
