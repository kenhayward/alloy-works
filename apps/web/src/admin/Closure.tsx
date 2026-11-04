import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import styles from './Closure.module.css';
import { TenantExport } from './TenantExport.js';
import { Holds } from './Holds.js';
import { words, type WordKey } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface View {
  readonly state: string;
  readonly name: string;
  readonly graceEndsAt: string | null;
  readonly closedBy: string | null;
  readonly holds: number;
  readonly graceDays: number;
  readonly deletionDays: number;
  readonly effects: Readonly<Record<string, string>>;
  readonly mayCancel: boolean;
}

interface WholeExport {
  readonly id: string;
  readonly scope: string;
  readonly state: string;
  readonly finishedAt: string | null;
}

const RECENT_MS = 24 * 3_600_000;

const saidFor = (error: unknown) => {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === 'reauthentication_required') return words('admin.closure-sign-in-again');
  if (code === 'close_needs_export') return words('admin.closure-needs-export');
  if (code === 'closure_name_mismatch') return words('admin.closure-wrong-name');
  if (code === 'closure_export_unanswered') return words('admin.closure-unanswered');
  if (code === 'closure_begun_by_operator') return words('admin.closure-operator');
  return words('admin.closure-could-not');
};

/**
 * Administration's way to close the environment (ADM-029, ADM-030): what it would stop, the export
 * offered first, and the name typed. Says nothing to anyone who may not close it.
 */
export function CloseEnvironment({ client }: { client: Client }): React.ReactNode {
  const [view, setView] = useState<View | null>(null);
  const [exports, setExports] = useState<readonly WholeExport[]>([]);
  const [choice, setChoice] = useState<'export' | 'declined' | ''>('');
  const [name, setName] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const [closure, listed] = await Promise.all([
      client.GET('/v1/closure'),
      client.GET('/v1/exports', { params: { query: {} } }),
    ]);
    if (closure.data) setView(closure.data as View);
    if (listed.data) setExports(listed.data.items as readonly WholeExport[]);
  }, [client]);

  useEffect(() => {
    void read().catch(() => undefined);
  }, [read]);

  if (view === null) return null;

  const recent = exports.find(
    (each) =>
      each.scope === 'tenant' &&
      each.state === 'done' &&
      each.finishedAt !== null &&
      Date.now() - new Date(each.finishedAt).getTime() < RECENT_MS,
  );

  const close = async () => {
    setBusy(true);
    setSaid('');
    try {
      const { data, error } = await client.POST('/v1/closure', {
        body:
          choice === 'export' && recent
            ? { name, export: recent.id }
            : { name, declined: true as const },
      });
      if (!data) {
        setSaid(saidFor(error));
        return;
      }
      // Nothing else answers now, so the page that says so takes over.
      window.location.reload();
    } catch {
      setSaid(words('admin.closure-could-not'));
    } finally {
      setBusy(false);
    }
  };

  const answered = choice === 'declined' || (choice === 'export' && recent !== undefined);

  return (
    <section aria-labelledby="closing-heading" className={styles['close']}>
      <h3 id="closing-heading">{words('admin.closure-heading')}</h3>
      <p>
        {words('admin.closure-explains', { grace: view.graceDays, deletion: view.deletionDays })}
      </p>
      <h4>{words('admin.closure-effects-heading')}</h4>
      <ul>
        {Object.keys(view.effects).map((capability) => (
          <li key={capability}>{words(`admin.closure-effect-${capability}` as WordKey)}</li>
        ))}
      </ul>
      {view.holds > 0 && (
        <p role="note">{words('admin.closure-holds-keep', { holds: view.holds })}</p>
      )}
      <fieldset>
        <legend>{words('admin.closure-export-legend')}</legend>
        <label className={styles['choice']}>
          <input
            type="radio"
            name="closure-export"
            checked={choice === 'export'}
            disabled={recent === undefined}
            onChange={() => setChoice('export')}
          />
          {recent === undefined
            ? words('admin.closure-export-none')
            : words('admin.closure-export-taken')}
        </label>
        <label className={styles['choice']}>
          <input
            type="radio"
            name="closure-export"
            checked={choice === 'declined'}
            onChange={() => setChoice('declined')}
          />
          {words('admin.closure-export-declined')}
        </label>
      </fieldset>
      <label className={styles['typed']}>
        {words('admin.closure-type-name', { name: view.name })}
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={busy || !answered || name !== view.name}
        onClick={() => void close()}
      >
        {words('admin.closure-close')}
      </button>
      {said !== '' && <p role="alert">{said}</p>}
    </section>
  );
}

/**
 * All a closing or retained environment shows those it still lets in (TL-A): where it stands, the way
 * to give it up, the export and the holds. Everything else refuses.
 */
export function ClosingEnvironment({ client }: { client: Client }): React.JSX.Element {
  const [view, setView] = useState<View | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client
      .GET('/v1/closure')
      .then(({ data }) => {
        if (data) setView(data as View);
      })
      .catch(() => setSaid(words('admin.closure-could-not')));
  }, [client]);

  const cancel = async () => {
    setBusy(true);
    setSaid('');
    try {
      const { data, error } = await client.DELETE('/v1/closure');
      if (data) window.location.reload();
      else setSaid(saidFor(error));
    } catch {
      setSaid(words('admin.closure-could-not'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles['page']} data-app-region>
      <h1>
        {view?.state === 'retained'
          ? words('environment.retained-title')
          : words('environment.closing-title')}
      </h1>
      {view && view.state === 'closing' && view.graceEndsAt !== null && (
        <p>
          {words('environment.closing-body', {
            date: new Date(view.graceEndsAt).toLocaleDateString(),
          })}
        </p>
      )}
      {view?.state === 'retained' && (
        <p>{words('environment.retained-body', { holds: view.holds })}</p>
      )}
      {view?.mayCancel && (
        <button type="button" disabled={busy} onClick={() => void cancel()}>
          {words('environment.closing-cancel')}
        </button>
      )}
      {view?.closedBy === 'operator' && <p>{words('admin.closure-operator')}</p>}
      {said !== '' && <p role="alert">{said}</p>}
      <section aria-labelledby="closing-export" className={styles['part']}>
        <h2 id="closing-export">{words('environment.closing-export')}</h2>
        <TenantExport client={client} />
      </section>
      <section aria-labelledby="closing-holds" className={styles['part']}>
        <h2 id="closing-holds">{words('environment.closing-holds')}</h2>
        <Holds client={client} />
      </section>
    </main>
  );
}
