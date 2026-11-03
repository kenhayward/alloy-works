import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Report {
  readonly added: Readonly<Record<string, number>>;
  readonly already: Readonly<Record<string, number>>;
  readonly skipped: Readonly<Record<string, number>>;
  readonly conflictCount: number;
}
const sum = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((total, rows) => total + rows, 0);
const reportWords = (report: Report) =>
  words('admin.restore-part-counts', {
    added: sum(report.added),
    already: sum(report.already),
    conflicts: report.conflictCount,
    skipped: sum(report.skipped),
  });

interface Plan {
  readonly would?: Report;
  readonly tables: Readonly<Record<string, number>>;
  readonly missingObjects: readonly string[];
  readonly secrets: readonly { readonly reference: string; readonly kind: string }[];
  readonly issuers: readonly { readonly issuer: string; readonly people: number }[];
  readonly groups: number;
  readonly externals: number;
  readonly serviceIdentities: number;
}
interface Restoration {
  readonly id: string;
  readonly state: string;
  readonly plan: Plan | null;
  readonly refusal: { readonly code: string; readonly message: string } | null;
  readonly report: Report | null;
  readonly providers: readonly string[];
}
interface Review {
  readonly restoredAt: string | null;
  readonly underReview: boolean;
  readonly datesPast: number;
  readonly reviewDatesPast: number;
}

const BUSY = new Set(['checking', 'applying']);
const KEEP = '';

/**
 * Administration's Restore (IMP-039; the EI plan, EIc): an archive sent, what it would do said, every
 * sign-in provider and secret answered for, and then all of it or nothing. A restored environment holds
 * its dates and reminders until someone has looked at what falls due.
 */
export function Restore({ client, followMs = 2000 }: { client: Client; followMs?: number }) {
  const [current, setCurrent] = useState<Restoration | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [mapped, setMapped] = useState<Readonly<Record<string, string>>>({});
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const [listed, reviewed] = await Promise.all([
      client.GET('/v1/restorations'),
      client.GET('/v1/restore-review'),
    ]);
    setCurrent((listed.data?.items[0] as Restoration | undefined) ?? null);
    if (reviewed.data) setReview(reviewed.data);
  }, [client]);

  useEffect(() => {
    void read().catch(() => setSaid(words('admin.restore-unreachable')));
  }, [read]);

  const following = current !== null && BUSY.has(current.state);
  useEffect(() => {
    if (!following) return undefined;
    const timer = setTimeout(() => void read().catch(() => undefined), followMs);
    return () => clearTimeout(timer);
  }, [following, current, followMs, read]);

  /** Says what went wrong in the words a person can act on. */
  const refusedBy = (error: unknown) => {
    const code = (error as { code?: string } | undefined)?.code;
    setSaid(
      code === 'reauthentication_required'
        ? words('admin.restore-sign-in-again')
        : code === 'archive_too_large'
          ? words('admin.restore-too-large')
          : words('admin.restore-could-not'),
    );
  };

  const send = async (file: File) => {
    setBusy(true);
    setSaid('');
    try {
      const made = await client.POST('/v1/restorations');
      if (!made.data) return refusedBy(made.error);
      const sent = await client.PUT('/v1/restorations/{id}/archive', {
        params: { path: { id: made.data.id } },
        // The bytes as they are, never serialised as JSON (as an image's are).
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
        headers: { 'content-type': 'application/x-tar' },
      });
      if (!sent.data) return refusedBy(sent.error);
      await read();
    } catch {
      setSaid(words('admin.restore-could-not'));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (restoration: Restoration, plan: Plan) => {
    setBusy(true);
    setSaid('');
    try {
      const path = { params: { path: { id: restoration.id } } };
      const answered = await client.PUT('/v1/restorations/{id}/answers', {
        ...path,
        body: {
          issuers: Object.fromEntries(
            plan.issuers.map(({ issuer }) => [issuer, mapped[issuer] ? mapped[issuer] : null]),
          ),
          switchedOff: plan.secrets.map((each) => each.reference),
        },
      });
      if (!answered.data) return refusedBy(answered.error);
      const begun = await client.POST('/v1/restorations/{id}/apply', path);
      if (!begun.data) return refusedBy(begun.error);
      await read();
    } catch {
      setSaid(words('admin.restore-could-not'));
    } finally {
      setBusy(false);
    }
  };

  const endReview = async () => {
    setBusy(true);
    setSaid('');
    try {
      const ended = await client.POST('/v1/restore-review/end');
      if (!ended.data) return refusedBy(ended.error);
      setReview(ended.data);
    } catch {
      setSaid(words('admin.restore-could-not'));
    } finally {
      setBusy(false);
    }
  };

  const plan = current?.state === 'previewed' ? current.plan : null;
  const parts = useMemo(
    () => (plan ? Object.values(plan.tables).reduce((total, rows) => total + rows, 0) : 0),
    [plan],
  );

  return (
    <section aria-labelledby="restore-heading">
      <h3 id="restore-heading">{words('admin.restore-heading')}</h3>
      <p>{words('admin.restore-intro')}</p>

      {review?.underReview && (
        <div role="group" aria-label={words('admin.restore-review-heading')}>
          <h4>{words('admin.restore-review-heading')}</h4>
          <p>
            {words('admin.restore-review-body', {
              dates: review.datesPast,
              reviews: review.reviewDatesPast,
            })}
          </p>
          <button type="button" disabled={busy} onClick={() => void endReview()}>
            {words('admin.restore-review-end')}
          </button>
        </div>
      )}

      {!review?.restoredAt && !plan && !following && (
        <label className={styles['field']}>
          {words('admin.restore-choose')}
          <input
            type="file"
            accept=".tar,application/x-tar"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
            }}
          />
        </label>
      )}

      {current?.state === 'checking' && <p role="status">{words('admin.restore-checking')}</p>}
      {current?.state === 'applying' && <p role="status">{words('admin.restore-applying')}</p>}
      {current?.state === 'restored' && (
        <p role="status">
          {current.report ? reportWords(current.report) : words('admin.restore-done')}
        </p>
      )}
      {(current?.state === 'refused' || current?.state === 'failed') && current.refusal && (
        <p role="alert">{current.refusal.message}</p>
      )}

      {current && plan && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void apply(current, plan);
          }}
        >
          <h4>{words('admin.restore-plan-heading')}</h4>
          <p>
            {words('admin.restore-plan-counts', {
              rows: parts,
              tables: Object.keys(plan.tables).length,
              groups: plan.groups,
              externals: plan.externals,
              services: plan.serviceIdentities,
            })}
          </p>
          {plan.would && (
            <>
              <p>{reportWords(plan.would)}</p>
              <p>{words('admin.restore-part-waits')}</p>
            </>
          )}
          {plan.missingObjects.length > 0 && (
            <p role="alert">
              {words('admin.restore-missing', { count: plan.missingObjects.length })}
            </p>
          )}
          {plan.issuers.map(({ issuer, people }) => (
            <label key={issuer} className={styles['field']}>
              {words('admin.restore-issuer', { issuer, people })}
              <select
                value={mapped[issuer] ?? KEEP}
                onChange={(event) => setMapped((was) => ({ ...was, [issuer]: event.target.value }))}
              >
                <option value={KEEP}>{words('admin.restore-issuer-keep')}</option>
                {current.providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {plan.secrets.length > 0 && (
            <>
              <h4>{words('admin.restore-secrets-heading')}</h4>
              <ul>
                {plan.secrets.map((each) => (
                  <li key={each.reference}>{each.reference}</li>
                ))}
              </ul>
            </>
          )}
          <button type="submit" disabled={busy}>
            {plan.would ? words('admin.restore-apply-part') : words('admin.restore-apply')}
          </button>
        </form>
      )}

      {said && <p role="alert">{said}</p>}
    </section>
  );
}
