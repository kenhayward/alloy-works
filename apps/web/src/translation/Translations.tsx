import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { lineAddress } from '../lifecycle/Lines.js';
import styles from '../lifecycle/Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly id: string;
  readonly number: string;
}

/** A translation as `GET .../translations` lists it (the TR plan, TR-E). */
interface TranslationNow {
  readonly line: string;
  readonly language: string;
  readonly head: Shown | null;
  readonly translates: Shown | null;
  readonly status: { readonly status: string; readonly retranslate?: boolean };
}

interface TranslationsNow {
  readonly source: { readonly language: string; readonly latest: Shown; readonly from?: Shown };
  readonly translations: readonly TranslationNow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** On a language line, the source version its view names (TR-C): what a cut says it translates. */
export function sourceOf(view: unknown): string | undefined {
  return isRecord(view) && isRecord(view.source) && typeof view.source.id === 'string'
    ? view.source.id
    : undefined;
}

/** A translation as a document's reference row says it (LOC-016; TR-M). */
export interface TranslationSaid {
  readonly language: string;
  readonly status: string;
  readonly retranslate?: boolean;
}

/** A status in words (LOC-030, LOC-015). */
export function statusWords(status: TranslationNow['status']): string {
  switch (status.status) {
    case 'untranslated':
      return 'Untranslated';
    case 'translated':
      return 'Translated';
    case 'outOfDate':
      return status.retranslate === false
        ? 'Out of date, no retranslation needed'
        : 'Out of date, needs retranslating';
    case 'machineDrafted':
      return 'Machine drafted';
    case 'inTranslation':
      return 'In translation';
    default:
      return status.status;
  }
}

/**
 * **Translations** (LOC-007, LOC-016; the TR plan, TR-J): a component's translations, each with its
 * status and a way to open it; to whoever may edit, **Begin a translation** and, for the source's
 * latest version, whether it needs retranslating (LOC-031). On a language line, the source's blocks
 * changed since its translation (LOC-040) and **Mark current**.
 */
export function TranslationsButton({
  client,
  componentId,
  line,
  mayEdit,
  translatable,
  onGo,
  className,
}: {
  client: Client;
  componentId: string;
  /** The language line read, or undefined on the main line. */
  line: string | undefined;
  mayEdit: boolean;
  /** Whether the source has a designated revision to begin a translation from. */
  translatable: boolean;
  onGo: (address: string) => void;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Translations
      </button>
      {open && (
        <TranslationsDialog
          client={client}
          componentId={componentId}
          line={line}
          mayEdit={mayEdit}
          translatable={translatable}
          onClose={() => setOpen(false)}
          onGo={(address) => {
            setOpen(false);
            onGo(address);
          }}
        />
      )}
    </>
  );
}

function TranslationsDialog({
  client,
  componentId,
  line,
  mayEdit,
  translatable,
  onClose,
  onGo,
}: {
  client: Client;
  componentId: string;
  line: string | undefined;
  mayEdit: boolean;
  translatable: boolean;
  onClose: () => void;
  onGo: (address: string) => void;
}) {
  const headingId = useId();
  const [now, setNow] = useState<TranslationsNow | 'unread' | null>(null);
  const [language, setLanguage] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const { data } = await client
      .GET('/v1/components/{id}/translations', { params: { path: { id: componentId } } })
      .catch(() => ({ data: undefined }));
    setNow(data ? (data as TranslationsNow) : 'unread');
  }, [client, componentId]);

  useEffect(() => {
    void read();
  }, [read]);

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (language.trim() === '') {
      setSaid('A translation needs a language, such as fr-FR.');
      return;
    }
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/components/{id}/translations', {
        params: { path: { id: componentId } },
        body: { language: language.trim() },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onGo(lineAddress(componentId, data.line));
    else setSaid(refusal(error, 'The translation could not be begun.'));
  };

  const declare = async (version: string, retranslate: boolean) => {
    setBusy(true);
    const { data, error } = await client
      .PUT('/v1/components/{id}/versions/{version}/retranslate', {
        params: { path: { id: componentId, version } },
        body: { retranslate },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      setSaid(
        retranslate
          ? 'Its translations need retranslating for this version.'
          : 'This version needs no retranslation.',
      );
      await read();
    } else setSaid(refusal(error, 'That could not be declared.'));
  };

  const here =
    now !== null && now !== 'unread'
      ? now.translations.find((each) => each.line === line)
      : undefined;

  return (
    <Modal labelledBy={headingId} size="standard" onClose={onClose}>
      <div className={styles['form']}>
        <h2 id={headingId}>Translations</h2>
        {now === null && <p className={styles['muted']}>Reading its translations…</p>}
        {now === 'unread' && <p role="alert">Its translations could not be read.</p>}
        {now !== null && now !== 'unread' && (
          <>
            <p className={styles['muted']}>
              {`The source is in ${now.source.language}, at version ${now.source.latest.number}.`}
            </p>
            {now.translations.length === 0 ? (
              <p>Not translated into any language yet.</p>
            ) : (
              <ul aria-label="Translations">
                {now.translations.map((each) => (
                  <li key={each.line}>
                    <a
                      href={lineAddress(componentId, each.line)}
                      onClick={(event) => {
                        event.preventDefault();
                        onGo(lineAddress(componentId, each.line));
                      }}
                    >
                      {each.language}
                    </a>
                    {`: ${statusWords(each.status)}`}
                    {each.translates !== null && `, translates ${each.translates.number}`}
                  </li>
                ))}
              </ul>
            )}
            {here && (
              <SourceChanges
                client={client}
                componentId={componentId}
                translation={here}
                latest={now.source.from ?? now.source.latest}
                mayEdit={mayEdit}
                onMarked={() => void read()}
              />
            )}
            {line === undefined && mayEdit && (
              <p>
                {`Does version ${now.source.latest.number} need retranslating? `}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declare(now.source.latest.id, true)}
                >
                  Needs retranslating
                </button>{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declare(now.source.latest.id, false)}
                >
                  No retranslation needed
                </button>
              </p>
            )}
            {line === undefined && mayEdit && translatable && (
              <form onSubmit={(event) => void begin(event)}>
                <label>
                  Language
                  <input
                    value={language}
                    maxLength={35}
                    placeholder="fr-FR"
                    onChange={(event) => setLanguage(event.target.value)}
                  />
                </label>{' '}
                <button type="submit" disabled={busy}>
                  Begin a translation
                </button>
              </form>
            )}
            {line === undefined && mayEdit && !translatable && (
              <p className={styles['muted']}>
                A translation begins from an approved revision: approve this component first.
              </p>
            )}
          </>
        )}
        {said !== '' && <p role="status">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface Changes {
  readonly translates: Shown;
  readonly current: Shown;
  readonly changes: readonly {
    readonly block: string;
    readonly change: string;
    readonly words: string;
  }[];
}

const CHANGE_WORDS: Record<string, string> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
};

/** What changed in the source since this translation (LOC-040), and **Mark current**. */
function SourceChanges({
  client,
  componentId,
  translation,
  latest,
  mayEdit,
  onMarked,
}: {
  client: Client;
  componentId: string;
  translation: TranslationNow;
  latest: Shown;
  mayEdit: boolean;
  onMarked: () => void;
}) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [said, setSaid] = useState('');
  const stale = translation.status.status === 'outOfDate';

  useEffect(() => {
    if (!stale) return undefined;
    let current = true;
    void client
      .GET('/v1/components/{id}/translations/{line}/source-changes', {
        params: { path: { id: componentId, line: translation.line } },
      })
      .then(({ data }) => {
        if (current && data) setChanges(data as Changes);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, componentId, translation.line, stale]);

  const mark = async () => {
    const { data, error } = await client
      .POST('/v1/components/{id}/translations/{line}/current', {
        params: { path: { id: componentId, line: translation.line } },
        body: { translates: latest.id },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      setSaid('Marked current with the source.');
      onMarked();
    } else setSaid(refusal(error, 'It could not be marked current.'));
  };

  if (!stale) return null;
  return (
    <section aria-label="Source changes">
      <h3>{`Changed in the source since ${translation.translates?.number ?? 'it was translated'}`}</h3>
      {changes === null ? (
        <p className={styles['muted']}>Reading what changed…</p>
      ) : (
        <ul>
          {changes.changes.map((each) => (
            <li key={each.block}>
              {`${CHANGE_WORDS[each.change] ?? each.change}: `}
              <q>{each.words}</q>
            </li>
          ))}
        </ul>
      )}
      {mayEdit && translation.head !== null && (
        <button type="button" onClick={() => void mark()}>
          Mark current
        </button>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}
