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
  | { readonly rule: 'beforeFirstHeading' }
  | { readonly rule: 'split' };

type Flag =
  | 'empty'
  | 'refused'
  | 'changeClamped'
  | 'commentClamped'
  | 'notYetRead'
  | 'leftOut'
  | 'keptDifferently';

interface Part {
  readonly id: string;
  readonly kind: 'section' | 'component';
  readonly title: string;
  readonly parent: string | null;
  readonly reason: Reason;
  readonly flags: readonly Flag[];
  readonly blocks: number;
  readonly source: string;
}

/** One part as its own route answers it (IMP-028), with what its Word authors made (IMc). */
interface Detail extends Omit<Part, 'blocks'> {
  readonly blocks: readonly {
    readonly id?: string;
    readonly type: string;
    readonly text: string;
  }[];
  readonly suggestions?: readonly {
    readonly author: string;
    readonly blocks: number;
    readonly text: string;
  }[];
  readonly threads?: readonly {
    readonly author: string;
    readonly text: string;
    readonly quote: string | null;
    readonly clamped: boolean;
    readonly replies: readonly { readonly author: string; readonly text: string }[];
  }[];
  readonly references?: readonly string[];
  readonly place: number;
  readonly of: number;
  readonly previous: string | null;
  readonly next: string | null;
}

interface Entry {
  readonly action: string;
  readonly subject: string;
  readonly message: string;
  readonly detail?: string;
  readonly count?: number;
  readonly part: number | null;
}

type Counts = Readonly<Record<'unchanged' | 'edited' | 'merged' | 'split' | 'renamed', number>>;

type Policy = 'map' | 'keep' | 'discard';

interface Identity {
  readonly name: string;
  readonly email: string | null;
  readonly carries: readonly ('changes' | 'comments' | 'creator' | 'lastModifiedBy')[];
  readonly match: 'email' | 'name' | 'none';
  readonly member: string | null;
  readonly memberName: string | null;
  readonly confirmed: boolean;
}

interface Outside {
  readonly key: string;
  readonly field: string;
  readonly text: string;
  readonly resolved: 'retargeted' | 'text' | null;
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
  readonly revision: number;
  readonly place: string | null;
  readonly accepted: Counts | null;
  readonly report: readonly Entry[];
  readonly references: readonly Outside[];
  readonly identities: readonly Identity[];
  readonly policy: Policy;
  readonly policyApplied: boolean;
}

type Edit =
  | { edit: 'move'; part: string; to: 'previous' | 'next'; blocks: number }
  | { edit: 'split'; part: string; at: number; title: string }
  | { edit: 'merge'; part: string }
  | { edit: 'rename'; part: string; title: string }
  | { edit: 'kind'; part: string; kind: 'section' | 'component' }
  | {
      edit: 'reference';
      reference: string;
      to: { kind: 'block'; block: string } | { kind: 'text' };
    }
  | { edit: 'identity'; identity: string; member: string | null };

/** What a name in the file is the name of, in words. */
const CARRIES: Readonly<Record<Identity['carries'][number], string>> = {
  changes: 'tracked changes',
  comments: 'comments',
  creator: 'the file’s author',
  lastModifiedBy: 'who last saved it',
};

/** What each policy does with the names, said before acceptance and after (IMP-010, IMP-011). */
const POLICIES: Readonly<Record<Policy, { readonly will: string; readonly did: string }>> = {
  map: {
    will: 'When it is accepted, names will be matched to members, as attribution.',
    did: 'Names were matched to members, as attribution, when it was accepted.',
  },
  keep: {
    will: 'When it is accepted, names will be kept as text.',
    did: 'Names were kept as text when it was accepted.',
  },
  discard: {
    will: 'When it is accepted, the names will be discarded.',
    did: 'The names were discarded when it was accepted.',
  },
};

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

/** What a part is flagged for (IMP-029): said of it, and offered as a filter. */
const FLAGS: Readonly<Record<Flag, { readonly said: string; readonly filter: string }>> = {
  empty: { said: 'Nothing stands under it.', filter: 'Nothing under it' },
  refused: { said: 'What it held could not be kept; see the report.', filter: 'Could not be kept' },
  changeClamped: {
    said: 'A tracked change kept here ran on past it; it stays here.',
    filter: 'A change cut short',
  },
  commentClamped: {
    said: 'A comment here ran on past where it starts; it is anchored where it starts.',
    filter: 'A comment cut short',
  },
  notYetRead: { said: 'It held something the import does not read yet.', filter: 'Not read yet' },
  leftOut: { said: 'Something in it was left out; see the report.', filter: 'Something left out' },
  keptDifferently: {
    said: 'Something in it was kept differently; see the report.',
    filter: 'Kept differently',
  },
};

/** How the parts accepted compare with the proposal as read (IMP-031). */
const COUNTED: readonly (readonly [keyof Counts, string])[] = [
  ['unchanged', 'accepted unchanged'],
  ['edited', 'edited'],
  ['merged', 'merged'],
  ['split', 'split'],
  ['renamed', 'renamed'],
];

/** Why a part starts where it does (IMP-004), as its reviewer reads it. */
function reasonOf(part: Pick<Part, 'reason' | 'title' | 'kind'>): string {
  const reason = part.reason;
  if (reason.rule === 'beforeFirstHeading') return 'What stands before the first heading.';
  if (reason.rule === 'split') return 'You split it here.';
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

/** A title for what a split makes: the first line of the block it starts at. */
const splitTitle = (text: string, fallback: string) =>
  text.split('\n')[0]!.trim().slice(0, 80) || fallback;

const WAIT_MS = 1000;

/**
 * **An import's page** (the IM plan, IMa and IMb): its state while the worker reads it; the outline
 * it proposes, searched and filtered (IMP-029); one part at a time beside the text it came from, with
 * next and previous (IMP-028), and its edits (IMP-002, IMP-041); the report; its levels; Accept or
 * Abandon; and, once accepted, how much was accepted unchanged (IMP-031).
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
  const [current, setCurrent] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rename, setRename] = useState('');
  const [query, setQuery] = useState('');
  const [flag, setFlag] = useState<Flag | ''>('');
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const [pointing, setPointing] = useState<Readonly<Record<string, string>>>({});

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

  // The part shown: the one chosen, else where its importer was, else the first; gone, the first.
  const proposal = typeof view === 'object' && view?.state === 'proposed' ? view : null;
  const showing =
    proposal === null
      ? null
      : ([current, proposal.place, proposal.parts[0]?.id].find(
          (each) => each != null && proposal.parts.some((part) => part.id === each),
        ) ?? null);
  const revision = proposal?.revision;
  useEffect(() => {
    if (showing === null) return undefined;
    let live = true;
    void client
      .GET('/v1/imports/{id}/parts/{part}', { params: { path: { id, part: showing } } })
      .then((read) => {
        if (!live || !read.data) return;
        const found = read.data as Detail;
        setDetail(found);
        setRename(found.title);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, id, showing, revision]);

  const go = (part: string) => {
    setCurrent(part);
    // Kept on the import, so returning from anywhere lands here (IMP-029); losing it loses nothing.
    void client
      .PUT('/v1/imports/{id}/place', { params: { path: { id } }, body: { part } })
      .catch(() => undefined);
  };

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
        const error = answer.error as { code?: string; message?: string } | undefined;
        if (error?.code === 'import_changed') void load();
        setNotice(
          error?.code === 'not_found'
            ? 'Only the person who imported it may do that.'
            : error?.code === 'import_levels_invalid'
              ? 'A component’s heading level must be below a section’s.'
              : (error?.code === 'import_edit_refused' ||
                    error?.code === 'import_changed' ||
                    error?.code === 'import_references_unresolved') &&
                  error.message
                ? error.message
                : 'That could not be done. Try again.',
        );
      }
    } catch {
      setNotice('That could not be done. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const edit = (change: Edit) => {
    if (!proposal) return;
    void act(() =>
      client.POST('/v1/imports/{id}/edits', {
        params: { path: { id } },
        body: { revision: proposal.revision, edit: change },
      }),
    );
  };

  const find = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim() === '' && flag === '') {
      setMatches(null);
      return;
    }
    try {
      const found = await client.GET('/v1/imports/{id}/parts', {
        params: {
          path: { id },
          query: {
            ...(query.trim() === '' ? {} : { q: query.trim() }),
            ...(flag === '' ? {} : { flag }),
          },
        },
      });
      if (found.data) setMatches(new Set(found.data.parts));
    } catch {
      setNotice('The parts could not be searched. Try again.');
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

  const listed = (part: Part) => matches === null || matches.has(part.id);
  const top = view.parts.filter((part) => part.parent === null);
  const under = (section: string) => view.parts.filter((part) => part.parent === section);
  const partItem = (part: Part) => {
    const children = part.kind === 'section' ? under(part.id) : [];
    if (!listed(part) && !children.some(listed)) return null;
    return (
      <li key={part.id} className={styles['part']}>
        {listed(part) && (
          <>
            <button
              type="button"
              className={styles['title']}
              aria-current={part.id === showing ? 'true' : undefined}
              onClick={() => go(part.id)}
            >
              {`${part.kind === 'section' ? 'Section' : 'Component'}: ${part.title}`}
            </button>
            {part.flags.map((each) => (
              <span key={each} className={styles['muted']}>
                {FLAGS[each].said}
              </span>
            ))}
          </>
        )}
        {children.length > 0 && <ol>{children.map(partItem)}</ol>}
      </li>
    );
  };

  const shown = detail !== null && detail.id === showing ? detail : null;
  const outsideIn = (shown?.references ?? []).flatMap((key) => {
    const found = view.references.find((each) => each.key === key);
    return found ? [found] : [];
  });
  const structure = shown && shown.kind === 'component' && (
    <>
      {(shown.suggestions ?? []).length > 0 && (
        <>
          <h3>Its tracked changes</h3>
          <ul aria-label="Suggestions it will make">
            {shown.suggestions!.map((each) => (
              <li key={each.author}>
                {`${each.author} (from Word), ${each.blocks} ${each.blocks === 1 ? 'block' : 'blocks'}: ${each.text}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {(shown.threads ?? []).length > 0 && (
        <>
          <h3>Its comments</h3>
          <ul aria-label="Threads it will make">
            {shown.threads!.map((each, index) => (
              <li key={index}>
                {`${each.author} (from Word)${each.quote === null ? '' : ` on “${each.quote}”`}: ${each.text}`}
                {each.clamped && (
                  <span className={styles['muted']}>
                    {' '}
                    It ran on, and is anchored where it starts.
                  </span>
                )}
                {each.replies.length > 0 && (
                  <ul>
                    {each.replies.map((reply, at) => (
                      <li key={at}>{`${reply.author} (from Word): ${reply.text}`}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {outsideIn.length > 0 && (
        <>
          <h3>Its references outside the import</h3>
          {outsideIn.map((reference) => (
            <form
              key={reference.key}
              className={styles['actions']}
              onSubmit={(event) => {
                event.preventDefault();
                const block = pointing[reference.key] ?? shown.blocks[0]?.id;
                if (block !== undefined) {
                  edit({
                    edit: 'reference',
                    reference: reference.key,
                    to: { kind: 'block', block },
                  });
                }
              }}
            >
              <label>
                {`Point “${reference.text}” at`}
                <select
                  value={pointing[reference.key] ?? shown.blocks[0]?.id ?? ''}
                  onChange={(event) =>
                    setPointing((was) => ({ ...was, [reference.key]: event.target.value }))
                  }
                >
                  {shown.blocks.map((block, index) =>
                    block.id === undefined ? null : (
                      <option key={block.id} value={block.id}>
                        {`Block ${index + 1}: ${block.text.slice(0, 60)}`}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                Point it there
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  edit({ edit: 'reference', reference: reference.key, to: { kind: 'text' } })
                }
              >
                {`Make “${reference.text}” plain text`}
              </button>
            </form>
          ))}
        </>
      )}
    </>
  );
  const partPanel = shown && (
    <section
      aria-label={`Part ${shown.place + 1} of ${shown.of}: ${shown.title}`}
      className={styles['review']}
    >
      <h2>{`${shown.kind === 'section' ? 'Section' : 'Component'}: ${shown.title}`}</h2>
      <p className={styles['muted']}>{reasonOf(shown)}</p>
      {shown.flags.map((each) => (
        <p key={each} className={styles['muted']}>
          {FLAGS[each].said}
        </p>
      ))}
      <div className={styles['beside']}>
        <div>
          <h3>What it holds</h3>
          {shown.kind === 'section' ? (
            <p className={styles['muted']}>A section holds components, not blocks.</p>
          ) : (
            <ol aria-label="What it holds" className={styles['blocks']}>
              {shown.blocks.map((block, index) => (
                <li key={index}>
                  <p className={styles['source']}>{block.text}</p>
                  {index > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        edit({
                          edit: 'split',
                          part: shown.id,
                          at: index,
                          title: splitTitle(block.text, shown.title),
                        })
                      }
                    >
                      {`Split before block ${index + 1}`}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3 id="import-part-source">From the file</h3>
          <p aria-labelledby="import-part-source" role="group" className={styles['source']}>
            {shown.source}
          </p>
        </div>
      </div>
      {structure}
      <form
        className={styles['actions']}
        onSubmit={(event) => {
          event.preventDefault();
          edit({ edit: 'rename', part: shown.id, title: rename });
        }}
      >
        <label>
          Part title
          <input value={rename} onChange={(event) => setRename(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || rename.trim() === ''}>
          Rename
        </button>
      </form>
      <div className={styles['actions']}>
        {shown.kind === 'component' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => edit({ edit: 'move', part: shown.id, to: 'previous', blocks: 1 })}
            >
              Move its first block to the part before
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => edit({ edit: 'move', part: shown.id, to: 'next', blocks: 1 })}
            >
              Move its last block to the part after
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => edit({ edit: 'merge', part: shown.id })}
        >
          Merge with the next part
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            edit({
              edit: 'kind',
              part: shown.id,
              kind: shown.kind === 'section' ? 'component' : 'section',
            })
          }
        >
          {shown.kind === 'section' ? 'Make it a component' : 'Make it a section'}
        </button>
      </div>
      <div className={styles['actions']}>
        <button
          type="button"
          disabled={shown.previous === null}
          onClick={() => shown.previous !== null && go(shown.previous)}
        >
          Previous part
        </button>
        <button
          type="button"
          disabled={shown.next === null}
          onClick={() => shown.next !== null && go(shown.next)}
        >
          Next part
        </button>
      </div>
    </section>
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
      {view.state === 'accepted' && view.accepted !== null && (
        <ul aria-label="What was accepted">
          {COUNTED.map(([key, words]) => (
            <li key={key}>
              {`${view.accepted![key]} ${view.accepted![key] === 1 ? 'part' : 'parts'} ${words}`}
            </li>
          ))}
        </ul>
      )}

      {view.state === 'proposed' && (
        <>
          <h2>Proposed outline</h2>
          <form className={styles['actions']} role="search" onSubmit={(event) => void find(event)}>
            <label>
              Search parts
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              Show
              <select value={flag} onChange={(event) => setFlag(event.target.value as Flag | '')}>
                <option value="">Every part</option>
                {(Object.keys(FLAGS) as Flag[]).map((each) => (
                  <option key={each} value={each}>
                    {FLAGS[each].filter}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Find</button>
          </form>
          {matches !== null && (
            <p className={styles['muted']}>
              {`${matches.size} of ${view.parts.length} parts found.`}{' '}
              <button
                type="button"
                onClick={() => {
                  setMatches(null);
                  setQuery('');
                  setFlag('');
                }}
              >
                Show every part
              </button>
            </p>
          )}
          {top.length === 0 ? (
            <p className={styles['muted']}>Nothing was read from the file.</p>
          ) : (
            <ol className={styles['outline']} aria-label="Proposed outline">
              {top.map(partItem)}
            </ol>
          )}
          {partPanel}
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

      {view.state === 'proposed' && view.references.length > 0 && (
        <>
          <h2>References outside the import</h2>
          <p className={styles['muted']}>
            Each must be pointed at a block of the import, or made the text it showed, before the
            import can be accepted.
          </p>
          <ul aria-label="References outside the import">
            {view.references.map((each) => (
              <li key={each.key}>
                {`“${each.text}”: ${
                  each.resolved === 'retargeted'
                    ? 'pointed at a block'
                    : each.resolved === 'text'
                      ? 'made plain text'
                      : 'not resolved yet'
                }`}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.identities.length > 0 && (
        <>
          <h2>Names the file carries</h2>
          <p>{POLICIES[view.policy][view.policyApplied ? 'did' : 'will']}</p>
          <p className={styles['muted']}>
            What the import makes is made by whoever accepts it, and never made by them: a name is
            recorded beside it, with the member it matches.
          </p>
          <ul aria-label="Names the file carries">
            {view.identities.map((each) => (
              <li key={each.name}>
                {`${each.name}${each.email === null ? '' : ` (${each.email})`}, ${each.carries
                  .map((role) => CARRIES[role])
                  .join(', ')}: ${
                  view.policy !== 'map' || each.match === 'none' || each.memberName === null
                    ? view.policy === 'discard'
                      ? 'discarded'
                      : 'kept as text'
                    : each.match === 'email'
                      ? `matched to ${each.memberName} by email`
                      : each.confirmed
                        ? `matched to ${each.memberName} by name, confirmed`
                        : `may be ${each.memberName}, by name`
                }`}
                {view.state === 'proposed' &&
                  view.policy === 'map' &&
                  each.match === 'name' &&
                  each.member !== null && (
                    <>
                      {' '}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          edit({
                            edit: 'identity',
                            identity: each.name,
                            member: each.confirmed ? null : each.member,
                          })
                        }
                      >
                        {each.confirmed
                          ? `Withdraw ${each.name} as ${each.memberName ?? ''}`
                          : `Confirm ${each.name} is ${each.memberName ?? ''}`}
                      </button>
                    </>
                  )}
              </li>
            ))}
          </ul>
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
