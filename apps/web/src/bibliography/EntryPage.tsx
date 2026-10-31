import type { createApiClient } from '@alloy-works/api-client';
import { obtainedFrom, referenceSource } from '@alloy-works/domain';
import { useEffect, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { Notice } from '../states/Notice.js';
import { BIBLIOGRAPHY } from './links.js';
import { authorsFull, authorsLines, authorsTyped, TYPES, yearOf, type Csl } from './shape.js';
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly entry: {
    readonly key: string;
    readonly csl: Csl;
    readonly obtained?: { readonly from: string; readonly at: string };
    readonly checkedAt?: string;
  };
  readonly archived: boolean;
  readonly mayEdit: boolean;
  readonly mayRetire: boolean;
  /** Its status from its last check against its source (XRb); null where never checked. */
  readonly status?: Status | null;
}

interface Status {
  readonly checkedAt: string;
  readonly outcome: 'current' | 'changed' | 'gone' | 'retracted' | 'superseded' | 'corrected';
  readonly differs: readonly string[];
  readonly notice: {
    readonly kind: 'retraction' | 'supersession' | 'correction';
    readonly identifier?: string;
    readonly date?: string;
  } | null;
}

/** What each outcome says (the XR plan, XR-F). */
const OUTCOMES: Readonly<Record<Status['outcome'], string>> = {
  get current() {
    return words('bibliography.current-the-source-holds-it');
  },
  get changed() {
    return words('bibliography.changed-at-the-source');
  },
  get gone() {
    return words('bibliography.the-source-no-longer-holds');
  },
  get retracted() {
    return words('bibliography.retracted-by-its-source');
  },
  get superseded() {
    return words('bibliography.superseded-by-its-source');
  },
  get corrected() {
    return words('bibliography.corrected-by-its-source');
  },
};

/**
 * The status of an entry obtained from a source, and Check now to an editor of it (the XR plan, XR-E,
 * XR-F).
 */
function EntrySource({
  client,
  id,
  source,
  status,
  mayCheck,
  onChecked,
}: {
  readonly client: Client;
  readonly id: string;
  readonly source: string;
  readonly status: Status | null;
  readonly mayCheck: boolean;
  readonly onChecked: (status: Status) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const check = async () => {
    setChecking(true);
    setProblem(null);
    const { data, error } = await client.POST('/v1/bibliography-entries/{id}/check', {
      params: { path: { id } },
    });
    setChecking(false);
    if (data) onChecked(data as Status);
    else {
      setProblem(
        (error as { message?: string } | undefined)?.message ??
          words('bibliography.the-entry-could-not-be-2'),
      );
    }
  };
  const flagged =
    status?.outcome === 'retracted' ||
    status?.outcome === 'superseded' ||
    status?.outcome === 'corrected';
  const notice = status?.notice;
  return (
    <section aria-label={words('bibliography.its-source')}>
      <h2>{words('bibliography.its-source')}</h2>
      {status === null ? (
        <p>{words('bibliography.not-yet-checked-against', { source })}</p>
      ) : (
        <>
          <p role={flagged ? 'alert' : undefined}>
            {flagged
              ? words('bibliography.status-flagged', {
                  outcome: status.outcome,
                  noted:
                    notice?.identifier === undefined && notice?.date === undefined ? 'no' : 'yes',
                  // The notice's identifier and date, as its source gives them.
                  notice: formats().list(
                    [notice?.identifier, notice?.date].filter(
                      (each): each is string => each !== undefined && each !== '',
                    ),
                    { type: 'unit', style: 'short' },
                  ),
                })
              : OUTCOMES[status.outcome]}
          </p>
          {status.differs.length > 0 && (
            <p>
              {words('bibliography.the-source-now-holds-otherwise', {
                fields: formats().list(status.differs, { type: 'unit', style: 'short' }),
              })}
            </p>
          )}
          <p>
            {wordsWith(
              'bibliography.checked-on',
              {},
              {
                when: <time dateTime={status.checkedAt}>{status.checkedAt.slice(0, 10)}</time>,
              },
            )}
          </p>
        </>
      )}
      {mayCheck && (
        <p>
          <button type="button" disabled={checking} onClick={() => void check()}>
            {words('bibliography.check-now')}
          </button>
        </p>
      )}
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </section>
  );
}

const FORMATS = [
  {
    value: 'csl-json',
    get label() {
      return words('bibliography.csl-json');
    },
    extension: 'json',
    type: 'application/json',
  },
  {
    value: 'bibtex',
    get label() {
      return words('bibliography.bibtex');
    },
    extension: 'bib',
    type: 'application/x-bibtex',
  },
  {
    value: 'ris',
    get label() {
      return words('bibliography.ris');
    },
    extension: 'ris',
    type: 'application/x-research-info-systems',
  },
] as const;

/** Saves `text` as a file without navigating the page, as a download never does. */
function saveText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface Uses {
  readonly components: {
    readonly named: readonly { readonly id: string; readonly title: string }[];
    readonly unreadable: boolean;
  };
  readonly baselines: {
    readonly named: readonly {
      readonly id: string;
      readonly name: string;
      readonly document: string;
    }[];
    readonly unreadable: boolean;
  };
}

/**
 * A bibliography entry's page (citations.md, "The entry"): its key, authors, title and year, where it
 * was obtained and when checked (LIB-011), and where it is cited; archived only while nothing cites
 * it (citations.md, "Kept while cited").
 */
export function EntryPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [uses, setUses] = useState<Uses | null>(null);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [format, setFormat] = useState<(typeof FORMATS)[number]['value']>('csl-json');
  // What the last export's format did not carry of the entry (PUB-055); null where it carried all.
  const [notCarried, setNotCarried] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await client.GET('/v1/bibliography-entries/{id}', {
        params: { path: { id } },
      });
      if (!live) return;
      if (!data) {
        setFailed(true);
        return;
      }
      setShown(data as unknown as Shown);
      const used = await client.GET('/v1/bibliography-entries/{id}/uses', {
        params: { path: { id } },
      });
      if (live && used.data) setUses(used.data);
    })();
    return () => {
      live = false;
    };
  }, [client, id]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>{words('bibliography.the-entry-could-not-be-3')}</p>
      </Notice>
    );
  }
  if (shown === null) return null;
  const { csl } = shown.entry;
  // An entry obtained from a reference source can be checked against it (XR-E).
  const from = shown.entry.obtained && obtainedFrom(shown.entry.obtained.from);
  const cited =
    uses !== null &&
    (uses.components.named.length > 0 ||
      uses.baselines.named.length > 0 ||
      uses.components.unreadable ||
      uses.baselines.unreadable);

  const archive = async (archived: boolean) => {
    setProblem(null);
    const path = archived
      ? '/v1/bibliography-entries/{id}/archive'
      : '/v1/bibliography-entries/{id}/unarchive';
    const { data, error } = await client.POST(path, { params: { path: { id } } });
    if (!data) {
      setProblem(
        (error as { message?: string } | undefined)?.message ??
          words('bibliography.the-entry-could-not-be-4'),
      );
      return;
    }
    setShown({ ...shown, archived: data.archived });
  };

  /** The entry alone in the format chosen, saved as a file named by its key (LIB-009). */
  const exportAs = async () => {
    setProblem(null);
    setNotCarried(null);
    const { data } = await client.GET('/v1/spaces/{space}/bibliography-entries/export', {
      params: { path: { space: shown.space.id }, query: { format, ids: id } },
    });
    if (!data) {
      setProblem(words('bibliography.the-entry-could-not-be-5'));
      return;
    }
    const chosen = FORMATS.find((each) => each.value === format)!;
    saveText(`${shown.entry.key}.${chosen.extension}`, data.text, chosen.type);
    const lost = data.notCarried.flatMap((each) => each.variables);
    if (lost.length > 0) {
      setNotCarried(
        words('bibliography.did-not-carry', {
          format: chosen.label,
          variables: formats().list(lost),
        }),
      );
    }
  };

  return (
    <article aria-labelledby="entry-heading">
      <p>
        <a href={BIBLIOGRAPHY}>{words('bibliography.bibliography')}</a>
      </p>
      <h1 id="entry-heading" data-content>
        {shown.entry.key}
      </h1>
      <dl>
        <dt>{words('bibliography.authors')}</dt>
        <dd data-content>{authorsFull(csl)}</dd>
        <dt>{words('bibliography.title')}</dt>
        <dd data-content>{csl.title ?? ''}</dd>
        <dt>{words('bibliography.year')}</dt>
        <dd data-content>{yearOf(csl)}</dd>
        <dt>{words('bibliography.type')}</dt>
        {TYPES.some((each) => each.value === csl.type) ? (
          <dd>{TYPES.find((each) => each.value === csl.type)!.label}</dd>
        ) : (
          <dd data-content>{csl.type}</dd>
        )}
        {csl.DOI !== undefined && (
          <>
            <dt>{words('bibliography.doi')}</dt>
            <dd data-content>{csl.DOI}</dd>
          </>
        )}
        {shown.entry.obtained !== undefined && (
          <>
            <dt>{words('bibliography.obtained')}</dt>
            {/* Where from, as the source names it, and when. */}
            <dd data-content>
              {shown.entry.obtained.from},{' '}
              <time dateTime={shown.entry.obtained.at}>{shown.entry.obtained.at.slice(0, 10)}</time>
            </dd>
          </>
        )}
        {shown.entry.checkedAt !== undefined && (
          <>
            <dt>{words('bibliography.last-checked')}</dt>
            <dd>
              <time dateTime={shown.entry.checkedAt}>{shown.entry.checkedAt.slice(0, 10)}</time>
            </dd>
          </>
        )}
        <dt>{words('bibliography.space')}</dt>
        <dd data-content>{shown.space.name}</dd>
        <dt>{words('bibliography.version')}</dt>
        <dd>{shown.version.number}</dd>
      </dl>
      {shown.archived && <p>{words('bibliography.this-entry-is-archived')}</p>}
      <p>
        {shown.mayEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)}>
            {words('bibliography.edit')}
          </button>
        )}{' '}
        <label>
          {words('bibliography.export-as')}{' '}
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            {FORMATS.map((each) => (
              <option key={each.value} value={each.value}>
                {each.label}
              </option>
            ))}
          </select>
        </label>{' '}
        <button type="button" onClick={() => void exportAs()}>
          {words('bibliography.export')}
        </button>
      </p>
      {notCarried !== null && <p role="status">{notCarried}</p>}
      {editing && (
        <EditEntry
          client={client}
          shown={shown}
          onSaved={(next) => {
            setShown(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {from !== undefined && (
        <EntrySource
          client={client}
          id={id}
          source={
            referenceSource(from.source)?.name ?? words('bibliography.its-reference-extension')
          }
          status={shown.status ?? null}
          mayCheck={shown.mayEdit}
          onChecked={(status) => setShown({ ...shown, status })}
        />
      )}
      {uses !== null && (
        <section aria-label={words('bibliography.cited-in')}>
          <h2>{words('bibliography.cited-in')}</h2>
          {!cited && <p>{words('bibliography.nothing-cites-this-entry')}</p>}
          {uses.components.named.length > 0 && (
            <ul>
              {uses.components.named.map((each) => (
                <li key={each.id}>
                  <a href={`#/components/${each.id}`} data-content>
                    {each.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {uses.baselines.named.length > 0 && (
            <ul aria-label={words('bibliography.baselines')}>
              {uses.baselines.named.map((each) => (
                <li key={each.id}>{words('bibliography.baseline-named', { name: each.name })}</li>
              ))}
            </ul>
          )}
          {(uses.components.unreadable || uses.baselines.unreadable) && (
            <p>{words('bibliography.cited-in-more-you-may')}</p>
          )}
        </section>
      )}
      {shown.mayRetire && (
        <p>
          {shown.archived ? (
            <button type="button" onClick={() => void archive(false)}>
              {words('bibliography.unarchive')}
            </button>
          ) : (
            <button type="button" disabled={cited} onClick={() => void archive(true)}>
              {words('bibliography.archive')}
            </button>
          )}
          {!shown.archived && cited && words('bibliography.a-cited-entry-is-kept')}
        </p>
      )}
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </article>
  );
}

/**
 * An entry's next version, by hand (citations.md, "The entry"): its type, title, authors, year and
 * DOI, every other variable it holds kept as it is, and never its key, which is fixed (LIB-046).
 */
function EditEntry({
  client,
  shown,
  onSaved,
  onCancel,
}: {
  readonly client: Client;
  readonly shown: Shown;
  readonly onSaved: (next: Shown) => void;
  readonly onCancel: () => void;
}) {
  const { csl } = shown.entry;
  const [type, setType] = useState(csl.type);
  const [title, setTitle] = useState(csl.title ?? '');
  const [authors, setAuthors] = useState(authorsLines(csl));
  const [year, setYear] = useState(yearOf(csl));
  const [doi, setDoi] = useState(csl.DOI ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // What is left as it was is kept as it was: a body's name stays a body's, a full date a date.
    const rest: Record<string, unknown> = { ...csl };
    for (const variable of ['author', 'issued', 'DOI']) delete rest[variable];
    const author = authors === authorsLines(csl) ? csl.author : authorsTyped(authors);
    const issued =
      year.trim() === yearOf(csl)
        ? csl.issued
        : /^\d{1,4}$/.test(year.trim())
          ? { 'date-parts': [[Number(year.trim())]] }
          : undefined;
    const next = {
      ...rest,
      type,
      title: title.trim(),
      ...(author !== undefined && author.length > 0 ? { author } : {}),
      ...(issued === undefined ? {} : { issued }),
      ...(doi.trim() === '' ? {} : { DOI: doi.trim() }),
    };
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/bibliography-entries/{id}/versions', {
        params: { path: { id: shown.id } },
        body: {
          openedFrom: shown.version.id,
          entry: {
            csl: next as never,
            ...(shown.entry.obtained === undefined ? {} : { obtained: shown.entry.obtained }),
            ...(shown.entry.checkedAt === undefined ? {} : { checkedAt: shown.entry.checkedAt }),
          },
        },
      });
      if (!data) {
        setProblem(
          isRecord(error) && typeof error.message === 'string'
            ? error.message
            : words('bibliography.the-entry-could-not-be-4'),
        );
        return;
      }
      onSaved(data as unknown as Shown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label={words('bibliography.edit-entry')} onSubmit={(event) => void submit(event)}>
      <label>
        {words('bibliography.type')}{' '}
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {TYPES.some((each) => each.value === csl.type) ? null : (
            <option value={csl.type} data-content>
              {csl.type}
            </option>
          )}
          {TYPES.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {words('bibliography.title-2')}
        <input value={title} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {words('bibliography.authors-one-a-line-family')}{' '}
        <textarea value={authors} onChange={(event) => setAuthors(event.target.value)} />
      </label>
      <label>
        {words('bibliography.year')}{' '}
        <input value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} />
      </label>
      <label>
        {words('bibliography.doi')}{' '}
        <input value={doi} onChange={(event) => setDoi(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
        {words('bibliography.save-version')}
      </button>{' '}
      <button type="button" onClick={onCancel}>
        {words('bibliography.cancel')}
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </form>
  );
}
