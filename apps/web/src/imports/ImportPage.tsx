import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Import.module.css';

type Client = ReturnType<typeof createApiClient>;

type Reason =
  | {
      readonly rule: 'heading' | 'beforeFirstComponent';
      readonly style?: string;
      readonly text?: string;
    }
  | { readonly rule: 'beforeFirstHeading' };

interface Part {
  readonly id: string;
  readonly kind: 'section' | 'component';
  readonly title: string;
  readonly parent: string | null;
  readonly reason: Reason;
  readonly flags: readonly ('empty' | 'refused')[];
  readonly blocks: number;
  readonly source: string;
}

interface Entry {
  readonly action: string;
  readonly subject: string;
  readonly message: string;
  readonly detail?: string;
  readonly count?: number;
  readonly part: number | null;
}

interface View {
  readonly id: string;
  readonly fileName: string;
  readonly state: 'awaiting' | 'reading' | 'proposed' | 'accepted' | 'abandoned' | 'failed';
  readonly failure: string | null;
  readonly document: string | null;
  readonly sweepsAt: string | null;
  readonly levels: { readonly section: number; readonly component: number };
  readonly title: string | null;
  readonly parts: readonly Part[];
  readonly report: readonly Entry[];
}

const STATES: Readonly<Record<View['state'], string>> = {
  awaiting: 'Waiting for its file.',
  reading: 'Reading the file.',
  proposed: 'Proposed. Review the outline, then accept it or abandon it.',
  accepted: 'Accepted into a document.',
  abandoned: 'Abandoned. Nothing of it was kept.',
  failed: 'Failed. Nothing of it was kept.',
};

/** Why it failed, in words the importer can act on (IMP-042). */
const FAILURES: Readonly<Record<string, string>> = {
  file_unreadable: 'The file could not be read: it is damaged, or not what its name says.',
  file_unsafe: 'The file holds something an import never reads, so it was not read at all.',
  file_too_large: 'The file is larger, or takes longer to read, than an import allows.',
  file_missing: 'The file was not there to read.',
  reading_failed: 'Reading the file failed. Try importing it again.',
};

/** What the import does not read yet, by kind, in words (IMP-007). */
const KINDS: Readonly<Record<string, string>> = {
  footnote: 'Footnotes',
  endnote: 'Endnotes',
  image: 'Images',
  equation: 'Equations',
  trackedChange: 'Tracked changes, each read as if rejected',
  comment: 'Comments',
  field: 'Fields, each kept as the text it showed',
  internalLink: 'Links within the document, each kept as its text',
  pageBreak: 'Page breaks',
  numberFormat: 'List numbering in a format other than numbers, letters or roman numerals',
  embeddedObject: 'Embedded objects',
};

/** Why a part starts where it does (IMP-004), as its reviewer reads it. */
function reasonOf(part: Part): string {
  const reason = part.reason;
  if (reason.rule === 'beforeFirstHeading') return 'What stands before the first heading.';
  const heading = `${reason.style ?? 'A heading'} “${reason.text ?? part.title}”`;
  return reason.rule === 'heading'
    ? `${heading} starts this ${part.kind}.`
    : `What stands under ${heading} before its first lower heading.`;
}

const entryWords = (entry: Entry) => {
  const what =
    entry.subject === 'notYetRead' && entry.detail
      ? `${KINDS[entry.detail] ?? entry.detail}: `
      : '';
  const times = entry.count !== undefined && entry.count > 1 ? ` (${entry.count})` : '';
  return `${what}${entry.message}${times}`;
};

/** A file's name, its last dot on, left off. */
const stem = (name: string) => name.replace(/\.[^.]*$/, '').trim() || name;

const WAIT_MS = 1000;

/**
 * **An import's page** (the IM plan, IMa): its state while the worker reads it; the outline it proposes,
 * read only, each part with its reason; the report of what was left out or not read yet; its levels;
 * and Accept or Abandon. Editing the proposal is IMb's.
 */
export function ImportPage({
  client,
  id,
  wait = WAIT_MS,
}: {
  client: Client;
  id: string;
  wait?: number;
}) {
  const [view, setView] = useState<View | 'missing' | 'failed' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [levels, setLevels] = useState({ section: 1, component: 2 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const read = await client.GET('/v1/imports/{id}', { params: { path: { id } } });
      if (read.data) {
        const found = read.data as View;
        setView(found);
        setLevels(found.levels);
        setTitle((held) => held || found.title || stem(found.fileName));
      } else setView(read.response.status === 404 ? 'missing' : 'failed');
    } catch {
      setView('failed');
    }
  }, [client, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Followed while the worker reads it.
  const reading =
    view !== null && typeof view === 'object' && ['awaiting', 'reading'].includes(view.state);
  useEffect(() => {
    if (!reading) return undefined;
    const timer = setTimeout(() => void load(), wait);
    return () => clearTimeout(timer);
  }, [reading, view, load, wait]);

  const act = async (
    work: () => Promise<{ data?: unknown; error?: unknown }>,
    done?: (data: unknown) => void,
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const answer = await work();
      if (answer.data) {
        if (done) done(answer.data);
        else setView((answer.data as { import?: View }).import ?? (answer.data as View));
      } else {
        const code = (answer.error as { code?: string } | undefined)?.code;
        setNotice(
          code === 'not_found'
            ? 'Only the person who imported it may do that.'
            : code === 'import_levels_invalid'
              ? 'A component’s heading level must be below a section’s.'
              : 'That could not be done. Try again.',
        );
      }
    } catch {
      setNotice('That could not be done. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (view === null) return <Waiting>Opening the import</Waiting>;
  if (view === 'missing')
    return <Notice tone="refused">There is no such import, or it is not yours to see.</Notice>;
  if (view === 'failed') {
    return (
      <Notice tone="failed">
        The import could not be opened.{' '}
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </Notice>
    );
  }

  const top = view.parts.filter((part) => part.parent === null);
  const under = (section: string) => view.parts.filter((part) => part.parent === section);
  const partItem = (part: Part) => (
    <li key={part.id} className={styles['part']}>
      <span className={styles['title']}>
        {`${part.kind === 'section' ? 'Section' : 'Component'}: ${part.title}`}
      </span>
      <span className={styles['muted']}>{reasonOf(part)}</span>
      {part.flags.includes('empty') && (
        <span className={styles['muted']}>Nothing stands under it.</span>
      )}
      {part.flags.includes('refused') && (
        <span className={styles['muted']}>What it held could not be kept; see the report.</span>
      )}
      {part.kind === 'section' ? (
        under(part.id).length > 0 && <ol>{under(part.id).map(partItem)}</ol>
      ) : (
        <details>
          <summary>{`Its text (${part.blocks} ${part.blocks === 1 ? 'block' : 'blocks'})`}</summary>
          <p className={styles['source']}>{part.source}</p>
        </details>
      )}
    </li>
  );

  const accept = (event: FormEvent) => {
    event.preventDefault();
    void act(
      () => client.POST('/v1/imports/{id}/accept', { params: { path: { id } }, body: { title } }),
      (data) => {
        window.location.hash = `#/documents/${(data as { document: string }).document}`;
      },
    );
  };

  return (
    <section aria-labelledby="import-page-heading" className={styles['page']}>
      <h1 id="import-page-heading">{`Import of ${view.fileName}`}</h1>
      <p role="status">{STATES[view.state]}</p>
      {view.failure !== null && (
        <Notice tone="failed">{FAILURES[view.failure] ?? FAILURES['reading_failed']}</Notice>
      )}
      {(view.state === 'awaiting' || view.state === 'reading') && (
        <Waiting>Reading the file</Waiting>
      )}
      {view.sweepsAt !== null && (
        <p className={styles['muted']}>
          {`Abandoned on ${new Date(view.sweepsAt).toLocaleDateString()} unless it is accepted or changed before then.`}
        </p>
      )}
      {view.state === 'accepted' && view.document !== null && (
        <a href={`#/documents/${view.document}`}>Open the document</a>
      )}

      {view.state === 'proposed' && (
        <>
          <h2>Proposed outline</h2>
          {top.length === 0 ? (
            <p className={styles['muted']}>Nothing was read from the file.</p>
          ) : (
            <ol className={styles['outline']} aria-label="Proposed outline">
              {top.map(partItem)}
            </ol>
          )}
          <form
            className={styles['actions']}
            onSubmit={(event) => {
              event.preventDefault();
              void act(() =>
                client.PUT('/v1/imports/{id}/levels', { params: { path: { id } }, body: levels }),
              );
            }}
          >
            <label>
              Sections at heading level
              <select
                value={levels.section}
                onChange={(event) => setLevels({ ...levels, section: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Components at heading level
              <select
                value={levels.component}
                onChange={(event) =>
                  setLevels({ ...levels, component: Number(event.target.value) })
                }
              >
                {[2, 3, 4, 5, 6, 7, 8, 9].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              Propose again
            </button>
          </form>
        </>
      )}

      {view.report.length > 0 && (
        <>
          <h2>What was left out or kept differently</h2>
          <ul aria-label="Report">
            {view.report.map((entry, index) => (
              <li key={index}>
                {entry.part !== null && view.parts[entry.part] !== undefined
                  ? `${view.parts[entry.part]!.title}: ${entryWords(entry)}`
                  : entryWords(entry)}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.state === 'proposed' && (
        <form className={styles['actions']} onSubmit={accept}>
          <label>
            Document title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
            Accept
          </button>
        </form>
      )}
      {['awaiting', 'reading', 'proposed'].includes(view.state) && (
        <div className={styles['actions']}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(() => client.POST('/v1/imports/{id}/abandon', { params: { path: { id } } }))
            }
          >
            Abandon
          </button>
        </div>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
