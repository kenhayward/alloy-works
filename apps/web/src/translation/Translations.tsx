import { streamPost, type createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { lineAddress } from '../lifecycle/Lines.js';
import styles from '../lifecycle/Hold.module.css';
import { words, wordsWith } from '../words/words.js';

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
  /** Its machine draft waiting for a person with approve (XL-I), listed by a component's translations. */
  readonly machine?: {
    readonly version: Shown;
    readonly missedTerms: readonly { readonly term: string; readonly label: string }[];
  } | null;
}

/** How a draft's stream is read: `streamPost`, or a test's own. */
type Stream = (options: StreamPostOptions) => ReturnType<typeof streamPost>;

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
      return words('translation.untranslated');
    case 'translated':
      return words('translation.translated');
    case 'outOfDate':
      return status.retranslate === false
        ? words('translation.out-of-date-no-retranslation')
        : words('translation.out-of-date-needs-retranslating');
    case 'machineDrafted':
      return words('translation.machine-drafted');
    case 'inTranslation':
      return words('translation.in-translation');
    default:
      return status.status;
  }
}

/** Each language's status as its chip, out of date first (LOC-016; the TE plan, TE-B). */
export function TranslationChips({
  translations,
}: {
  readonly translations: readonly TranslationSaid[] | undefined;
}) {
  const ordered = [...(translations ?? [])].sort(
    (a, b) => Number(b.status === 'outOfDate') - Number(a.status === 'outOfDate'),
  );
  return ordered.map((each) => (
    <Chip key={each.language} {...(each.status === 'translated' ? {} : { tone: 'warn' as const })}>
      {`${each.language}: ${statusWords(each)}`}
    </Chip>
  ));
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
  stream = streamPost,
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
  stream?: Stream;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {words('translation.translations')}
      </button>
      {open && (
        <TranslationsDialog
          client={client}
          componentId={componentId}
          line={line}
          mayEdit={mayEdit}
          translatable={translatable}
          stream={stream}
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
  stream,
  onClose,
  onGo,
}: {
  client: Client;
  componentId: string;
  line: string | undefined;
  mayEdit: boolean;
  translatable: boolean;
  stream: Stream;
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
      setSaid(words('translation.a-translation-needs-a-language'));
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
    else setSaid(refusal(error, words('translation.the-translation-could-not-be')));
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
          ? words('translation.its-translations-need-retranslating-for')
          : words('translation.this-version-needs-no-retranslation'),
      );
      await read();
    } else setSaid(refusal(error, words('translation.that-could-not-be-declared')));
  };

  const here =
    now !== null && now !== 'unread'
      ? now.translations.find((each) => each.line === line)
      : undefined;

  return (
    <Modal labelledBy={headingId} size="standard" onClose={onClose}>
      <div className={styles['form']}>
        <h2 id={headingId}>{words('translation.translations')}</h2>
        {now === null && (
          <p className={styles['muted']}>{words('translation.reading-its-translations')}</p>
        )}
        {now === 'unread' && (
          <p role="alert">{words('translation.its-translations-could-not-be')}</p>
        )}
        {now !== null && now !== 'unread' && (
          <>
            <p className={styles['muted']}>
              {words('translation.the-source-is-in-at', {
                language: now.source.language,
                number: now.source.latest.number,
              })}
            </p>
            {now.translations.length === 0 ? (
              <p>{words('translation.not-translated-into-any-language')}</p>
            ) : (
              <ul aria-label={words('translation.translations')}>
                {now.translations.map((each) => (
                  <li key={each.line}>
                    {wordsWith(
                      each.translates === null
                        ? 'translation.line-status'
                        : 'translation.line-status-translates',
                      { status: statusWords(each.status), number: each.translates?.number ?? 0 },
                      {
                        language: (
                          <a
                            href={lineAddress(componentId, each.line)}
                            onClick={(event) => {
                              event.preventDefault();
                              onGo(lineAddress(componentId, each.line));
                            }}
                          >
                            {each.language}
                          </a>
                        ),
                      },
                    )}
                  </li>
                ))}
              </ul>
            )}
            {here && (
              <MachineDraft
                client={client}
                componentId={componentId}
                translation={here}
                mayEdit={mayEdit}
                stream={stream}
                onChanged={() => void read()}
              />
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
                {words('translation.does-version-need-retranslating', {
                  number: now.source.latest.number,
                })}{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declare(now.source.latest.id, true)}
                >
                  {words('translation.needs-retranslating')}
                </button>{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declare(now.source.latest.id, false)}
                >
                  {words('translation.no-retranslation-needed')}
                </button>
              </p>
            )}
            {line === undefined && mayEdit && translatable && (
              <form onSubmit={(event) => void begin(event)}>
                <label>
                  {words('translation.language')}
                  <input
                    value={language}
                    maxLength={35}
                    placeholder={words('translation.language-example')}
                    onChange={(event) => setLanguage(event.target.value)}
                  />
                </label>{' '}
                <button type="submit" disabled={busy}>
                  {words('translation.begin-a-translation')}
                </button>
              </form>
            )}
            {line === undefined && mayEdit && !translatable && (
              <p className={styles['muted']}>{words('translation.a-translation-begins-from-an')}</p>
            )}
          </>
        )}
        {said !== '' && <p role="status">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('translation.close')}
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
  get added() {
    return words('translation.added');
  },
  get changed() {
    return words('translation.changed');
  },
  get removed() {
    return words('translation.removed');
  },
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
      setSaid(words('translation.marked-current-with-the-source'));
      onMarked();
    } else setSaid(refusal(error, words('translation.it-could-not-be-marked')));
  };

  if (!stale) return null;
  return (
    <section aria-label={words('translation.source-changes')}>
      <h3>
        {words('translation.changed-in-the-source-since', {
          value1: translation.translates?.number ?? 'it was translated',
        })}
      </h3>
      {changes === null ? (
        <p className={styles['muted']}>{words('translation.reading-what-changed')}</p>
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
          {words('translation.mark-current')}
        </button>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}

/**
 * **Draft by machine** (LOC-023 to LOC-026; the XL plan, XL-H to XL-K): on a translation, to whoever
 * may edit, a draft by the environment's translate endpoint, cut on the line and marked; and, while a
 * draft waits, the terms it did not translate by their labels and **Accept the machine draft**, which
 * needs approve and lets it be published.
 */
function MachineDraft({
  client,
  componentId,
  translation,
  mayEdit,
  stream,
  onChanged,
}: {
  client: Client;
  componentId: string;
  translation: TranslationNow;
  mayEdit: boolean;
  stream: Stream;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const path = `/v1/components/${componentId}/translations/${translation.line}/machine-draft`;

  const draft = async () => {
    setBusy(true);
    setSaid(words('translation.drafting-by-machine'));
    let drafted: string | undefined;
    let failed: string | undefined;
    const outcome = await stream({
      url: path,
      body: {},
      onEvent: (name, data) => {
        const frame = data as Record<string, unknown>;
        if (name === 'drafted') {
          drafted = String((frame.version as { number?: unknown } | undefined)?.number ?? '');
        }
        if (name === 'failed')
          failed = String(frame.message ?? words('translation.the-draft-failed'));
      },
    });
    setBusy(false);
    if (outcome.kind === 'refused') {
      setSaid(refusal(outcome.body, words('translation.the-translation-could-not-be-2')));
    } else if (outcome.kind !== 'streamed' || failed !== undefined || drafted === undefined) {
      setSaid(failed ?? words('translation.the-translation-could-not-be-2'));
    } else {
      setSaid(words('translation.drafted-by-machine-as-it', { drafted }));
      onChanged();
    }
  };

  const accept = async () => {
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/components/{id}/translations/{line}/machine-draft/accept', {
        params: { path: { id: componentId, line: translation.line } },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      setSaid(words('translation.the-machine-draft-is-accepted'));
      onChanged();
    } else setSaid(refusal(error, words('translation.the-machine-draft-could-not')));
  };

  const machine = translation.machine ?? null;
  if (!mayEdit && machine === null) return null;
  return (
    <section aria-label={words('translation.machine-draft')}>
      {machine !== null && (
        <>
          <p>
            {words('translation.version-was-drafted-by-machine', {
              number: machine.version.number,
            })}
          </p>
          {machine.missedTerms.length > 0 && (
            <p>
              {words('translation.not-translated-by-their-labels', {
                value1: machine.missedTerms.map((each) => each.label).join(', '),
              })}
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => void accept()}>
            {words('translation.accept-the-machine-draft')}
          </button>{' '}
        </>
      )}
      {mayEdit && (
        <button type="button" disabled={busy} onClick={() => void draft()}>
          {words('translation.draft-by-machine')}
        </button>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}
