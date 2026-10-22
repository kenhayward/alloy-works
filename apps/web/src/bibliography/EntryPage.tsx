import type { createApiClient } from '@alloy-works/api-client';
import { obtainedFrom, referenceSource } from '@alloy-works/domain';
import { useEffect, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { Notice } from '../states/Notice.js';
import { BIBLIOGRAPHY } from './links.js';
import { authorsFull, authorsLines, authorsTyped, TYPES, yearOf, type Csl } from './shape.js';

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
  readonly outcome: 'current' | 'changed' | 'gone' | 'retracted' | 'corrected';
  readonly differs: readonly string[];
  readonly notice: {
    readonly kind: 'retraction' | 'correction';
    readonly identifier?: string;
    readonly date?: string;
  } | null;
}

/** What each outcome says (the XR plan, XR-F). */
const OUTCOMES: Readonly<Record<Status['outcome'], string>> = {
  current: 'Current: the source holds it as this entry does.',
  changed: 'Changed at the source.',
  gone: 'The source no longer holds it.',
  retracted: 'Retracted by its source',
  corrected: 'Corrected by its source',
};

/** The status of an entry obtained from a source, and Check now (the XR plan, XR-E, XR-F). */
function EntrySource({
  client,
  id,
  source,
  status,
  onChecked,
}: {
  readonly client: Client;
  readonly id: string;
  readonly source: string;
  readonly status: Status | null;
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
        (error as { message?: string } | undefined)?.message ?? 'The entry could not be checked.',
      );
    }
  };
  const flagged = status?.outcome === 'retracted' || status?.outcome === 'corrected';
  const notice = status?.notice;
  return (
    <section aria-label="Its source">
      <h2>Its source</h2>
      {status === null ? (
        <p>{`Not yet checked against ${source}.`}</p>
      ) : (
        <>
          <p role={flagged ? 'alert' : undefined}>
            {flagged
              ? `${OUTCOMES[status.outcome]}${
                  notice?.identifier === undefined && notice?.date === undefined
                    ? '.'
                    : `: ${[notice?.identifier, notice?.date].filter(Boolean).join(', ')}.`
                }`
              : OUTCOMES[status.outcome]}
          </p>
          {status.differs.length > 0 && (
            <p>{`The source now holds otherwise: ${status.differs.join(', ')}.`}</p>
          )}
          <p>
            Checked <time dateTime={status.checkedAt}>{status.checkedAt.slice(0, 10)}</time>.
          </p>
        </>
      )}
      <p>
        <button type="button" disabled={checking} onClick={() => void check()}>
          Check now
        </button>
      </p>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </section>
  );
}

const FORMATS = [
  { value: 'csl-json', label: 'CSL-JSON', extension: 'json', type: 'application/json' },
  { value: 'bibtex', label: 'BibTeX', extension: 'bib', type: 'application/x-bibtex' },
  { value: 'ris', label: 'RIS', extension: 'ris', type: 'application/x-research-info-systems' },
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
        <p>The entry could not be loaded.</p>
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
        (error as { message?: string } | undefined)?.message ?? 'The entry could not be changed.',
      );
      return;
    }
    setShown({ ...shown, archived: data.archived });
  };

  /** The entry alone in the format chosen, saved as a file named by its key (LIB-009). */
  const exportAs = async () => {
    setProblem(null);
    const { data } = await client.GET('/v1/spaces/{space}/bibliography-entries/export', {
      params: { path: { space: shown.space.id }, query: { format, ids: id } },
    });
    if (!data) {
      setProblem('The entry could not be exported.');
      return;
    }
    const chosen = FORMATS.find((each) => each.value === format)!;
    saveText(`${shown.entry.key}.${chosen.extension}`, data.text, chosen.type);
  };

  return (
    <article aria-labelledby="entry-heading">
      <p>
        <a href={BIBLIOGRAPHY}>Bibliography</a>
      </p>
      <h1 id="entry-heading">{shown.entry.key}</h1>
      <dl>
        <dt>Authors</dt>
        <dd>{authorsFull(csl)}</dd>
        <dt>Title</dt>
        <dd>{csl.title ?? ''}</dd>
        <dt>Year</dt>
        <dd>{yearOf(csl)}</dd>
        <dt>Type</dt>
        <dd>{TYPES.find((each) => each.value === csl.type)?.label ?? csl.type}</dd>
        {csl.DOI !== undefined && (
          <>
            <dt>DOI</dt>
            <dd>{csl.DOI}</dd>
          </>
        )}
        {shown.entry.obtained !== undefined && (
          <>
            <dt>Obtained</dt>
            <dd>
              {shown.entry.obtained.from},{' '}
              <time dateTime={shown.entry.obtained.at}>{shown.entry.obtained.at.slice(0, 10)}</time>
            </dd>
          </>
        )}
        {shown.entry.checkedAt !== undefined && (
          <>
            <dt>Last checked</dt>
            <dd>
              <time dateTime={shown.entry.checkedAt}>{shown.entry.checkedAt.slice(0, 10)}</time>
            </dd>
          </>
        )}
        <dt>Space</dt>
        <dd>{shown.space.name}</dd>
        <dt>Version</dt>
        <dd>{shown.version.number}</dd>
      </dl>
      {shown.archived && <p>This entry is archived.</p>}
      <p>
        {shown.mayEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}{' '}
        <label>
          Export as{' '}
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
          Export
        </button>
      </p>
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
          source={referenceSource(from.source)?.name ?? from.source}
          status={shown.status ?? null}
          onChecked={(status) => setShown({ ...shown, status })}
        />
      )}
      {uses !== null && (
        <section aria-label="Cited in">
          <h2>Cited in</h2>
          {!cited && <p>Nothing cites this entry.</p>}
          {uses.components.named.length > 0 && (
            <ul>
              {uses.components.named.map((each) => (
                <li key={each.id}>
                  <a href={`#/components/${each.id}`}>{each.title}</a>
                </li>
              ))}
            </ul>
          )}
          {uses.baselines.named.length > 0 && (
            <ul aria-label="Baselines">
              {uses.baselines.named.map((each) => (
                <li key={each.id}>Baseline {each.name}</li>
              ))}
            </ul>
          )}
          {(uses.components.unreadable || uses.baselines.unreadable) && (
            <p>Cited in more you may not read.</p>
          )}
        </section>
      )}
      {shown.mayRetire && (
        <p>
          {shown.archived ? (
            <button type="button" onClick={() => void archive(false)}>
              Unarchive
            </button>
          ) : (
            <button type="button" disabled={cited} onClick={() => void archive(true)}>
              Archive
            </button>
          )}
          {!shown.archived && cited && ' A cited entry is kept, so it cannot be archived.'}
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
            : 'The entry could not be changed.',
        );
        return;
      }
      onSaved(data as unknown as Shown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Edit entry" onSubmit={(event) => void submit(event)}>
      <label>
        Type{' '}
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {TYPES.some((each) => each.value === csl.type) ? null : (
            <option value={csl.type}>{csl.type}</option>
          )}
          {TYPES.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title <input value={title} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Authors, one a line, family name first{' '}
        <textarea value={authors} onChange={(event) => setAuthors(event.target.value)} />
      </label>
      <label>
        Year{' '}
        <input value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} />
      </label>
      <label>
        DOI <input value={doi} onChange={(event) => setDoi(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
        Save version
      </button>{' '}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </form>
  );
}
