import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Import.module.css';
import { fileTypeOf } from './ImportFile.js';
import { IMPORT_HELP, keptBy } from './ImportHelp.js';
import { formats, words as say, wordsWith } from '../words/words.js';

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
  /** In an import again, what it is to what the earlier import made (IMP-036). */
  readonly again?: Again | null;
}

interface Again {
  readonly status: 'unchanged' | 'changed' | 'new';
  readonly component: string | null;
  readonly componentTitle: string | null;
  readonly by: 'provenance' | 'heading' | 'position' | 'importer' | null;
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
  /** Against its component as it is now, in an import again. */
  readonly diff?:
    readonly { readonly change: 'same' | 'added' | 'removed'; readonly text: string }[] | null;
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
  readonly fileType?: 'docx' | 'markdown' | 'html';
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
  readonly kind?: 'first' | 'again';
  readonly earlier?: string | null;
  readonly recognised?: Recognised | null;
  readonly earlierMade?: readonly Made[];
  readonly gone?: readonly Made[];
  readonly outcome?: Outcome | null;
}

/** An accepted import in the space holding the same file (IMP-036). */
interface Recognised {
  readonly import: string;
  readonly match: 'hash' | 'name';
  readonly fileName: string;
  readonly importerName: string | null;
  readonly at: string;
  readonly document: string;
  readonly documentTitle: string | null;
}

interface Made {
  readonly component: string;
  readonly title: string | null;
}

interface Outcome {
  readonly suggested: readonly { readonly component: string }[];
  readonly made: readonly { readonly component: string; readonly placed: boolean }[];
  readonly gone: readonly { readonly component: string; readonly flagged: boolean }[];
  readonly skipped: readonly {
    readonly component: string;
    readonly reason: 'suggest' | 'limit' | 'empty' | 'resolved' | 'gone';
  }[];
  readonly unchanged: number;
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
  | { edit: 'identity'; identity: string; member: string | null }
  | { edit: 'match'; part: string; component: string | null };

/** What a name in the file is the name of, in words. */
const CARRIES: Readonly<Record<Identity['carries'][number], string>> = {
  get changes() {
    return say('imports.tracked-changes');
  },
  comments: 'comments',
  get creator() {
    return say('imports.the-file-s-author');
  },
  get lastModifiedBy() {
    return say('imports.who-last-saved-it');
  },
};

/** What each policy does with the names, said before acceptance and after (IMP-010, IMP-011). */
const POLICIES: Readonly<Record<Policy, { readonly will: string; readonly did: string }>> = {
  map: {
    get will() {
      return say('imports.when-it-is-accepted-names');
    },
    get did() {
      return say('imports.names-were-matched-to-members');
    },
  },
  keep: {
    get will() {
      return say('imports.when-it-is-accepted-names-2');
    },
    get did() {
      return say('imports.names-were-kept-as-text');
    },
  },
  discard: {
    get will() {
      return say('imports.when-it-is-accepted-the');
    },
    get did() {
      return say('imports.the-names-were-discarded-when');
    },
  },
};

const STATES: Readonly<Record<View['state'], string>> = {
  get awaiting() {
    return say('imports.waiting-for-its-file');
  },
  get reading() {
    return say('imports.reading-the-file');
  },
  get proposed() {
    return say('imports.proposed-review-the-outline-then');
  },
  get accepted() {
    return say('imports.accepted-into-a-document');
  },
  get abandoned() {
    return say('imports.abandoned-nothing-of-it-was');
  },
  get failed() {
    return say('imports.failed-nothing-of-it-was');
  },
};

/** Why it failed, in words the importer can act on (IMP-042). */
const FAILURES: Readonly<Record<string, string>> = {
  get file_unreadable() {
    return say('imports.the-file-could-not-be-3');
  },
  get file_unsafe() {
    return say('imports.the-file-holds-something-an');
  },
  get file_too_large() {
    return say('imports.the-file-is-larger-or');
  },
  get file_missing() {
    return say('imports.the-file-was-not-there');
  },
  get reading_failed() {
    return say('imports.reading-the-file-failed-try');
  },
};

/** What the import does not read yet, by kind, in words (IMP-007). */
const KINDS: Readonly<Record<string, string>> = {
  get footnote() {
    return say('imports.footnotes');
  },
  get endnote() {
    return say('imports.endnotes');
  },
  get image() {
    return say('imports.images');
  },
  get equation() {
    return say('imports.equations');
  },
  get trackedChange() {
    return say('imports.tracked-changes-each-read-as');
  },
  get comment() {
    return say('imports.comments');
  },
  get field() {
    return say('imports.fields-each-kept-as-the');
  },
  get internalLink() {
    return say('imports.links-within-the-document-each');
  },
  get pageBreak() {
    return say('imports.page-breaks');
  },
  get numberFormat() {
    return say('imports.list-numbering-in-a-format');
  },
  get embeddedObject() {
    return say('imports.embedded-objects');
  },
};

/** What a part is flagged for (IMP-029): said of it, and offered as a filter. */
const FLAGS: Readonly<Record<Flag, { readonly said: string; readonly filter: string }>> = {
  empty: {
    get said() {
      return say('imports.nothing-stands-under-it');
    },
    get filter() {
      return say('imports.nothing-under-it');
    },
  },
  refused: {
    get said() {
      return say('imports.what-it-held-could-not');
    },
    get filter() {
      return say('imports.could-not-be-kept');
    },
  },
  changeClamped: {
    get said() {
      return say('imports.a-tracked-change-kept-here');
    },
    get filter() {
      return say('imports.a-change-cut-short');
    },
  },
  commentClamped: {
    get said() {
      return say('imports.a-comment-here-ran-on');
    },
    get filter() {
      return say('imports.a-comment-cut-short');
    },
  },
  notYetRead: {
    get said() {
      return say('imports.it-held-something-the-import');
    },
    get filter() {
      return say('imports.not-read-yet');
    },
  },
  leftOut: {
    get said() {
      return say('imports.something-in-it-was-left');
    },
    get filter() {
      return say('imports.something-left-out');
    },
  },
  keptDifferently: {
    get said() {
      return say('imports.something-in-it-was-kept');
    },
    get filter() {
      return say('imports.kept-differently');
    },
  },
};

/** How the parts accepted compare with the proposal as read (IMP-031). */
const COUNTED: readonly (keyof Counts)[] = ['unchanged', 'edited', 'merged', 'split', 'renamed'];

/** Why a part starts where it does (IMP-004), as its reviewer reads it. */
function reasonOf(part: Pick<Part, 'reason' | 'title' | 'kind'>): string {
  const reason = part.reason;
  if (reason.rule === 'beforeFirstHeading') return say('imports.what-stands-before-the-first');
  if (reason.rule === 'split') return say('imports.you-split-it-here');
  const heading = `${reason.style ?? say('imports.a-heading')} “${reason.text ?? part.title}”`;
  return reason.rule === 'heading'
    ? say('imports.starts-this', { heading, kind: part.kind })
    : say('imports.what-stands-under-before-its', { heading });
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

/** A part of an import again, said in the outline and its panel (IMP-036). */
const againWords = (again: Again, document: string) =>
  again.status === 'new'
    ? say('imports.new-made-and-placed-in', { document })
    : again.status === 'changed'
      ? say('imports.changed-suggested-on-when-accepted', {
          value1: again.componentTitle ?? 'its component',
        })
      : say('imports.unchanged-from', { value1: again.componentTitle ?? 'its component' });

/** Why a changed component was not suggested on. */
const SKIPPED: Readonly<Record<Outcome['skipped'][number]['reason'], string>> = {
  get suggest() {
    return say('imports.you-may-not-suggest-on');
  },
  get limit() {
    return say('imports.you-have-20-suggestions-pending');
  },
  get empty() {
    return say('imports.the-suggestion-would-change-nothing');
  },
  get resolved() {
    return say('imports.the-same-suggestion-was-made');
  },
  get gone() {
    return say('imports.it-was-deleted-or-archived');
  },
};

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
  const [matching, setMatching] = useState<string>('');

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
        setMatching(found.again?.component ?? '');
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
            ? say('imports.only-the-person-who-imported')
            : error?.code === 'import_levels_invalid'
              ? say('imports.a-component-s-heading-level')
              : (error?.code === 'import_edit_refused' ||
                    error?.code === 'import_changed' ||
                    error?.code === 'import_references_unresolved' ||
                    error?.code === 'import_not_permitted' ||
                    error?.code === 'import_earlier_missing' ||
                    error?.code === 'import_earlier_invalid') &&
                  error.message
                ? error.message
                : say('imports.that-could-not-be-done'),
        );
      }
    } catch {
      setNotice(say('imports.that-could-not-be-done'));
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
      setNotice(say('imports.the-parts-could-not-be'));
    }
  };

  if (view === null) return <Waiting>{say('imports.opening-the-import')}</Waiting>;
  if (view === 'missing')
    return <Notice tone="refused">{say('imports.there-is-no-such-import')}</Notice>;
  if (view === 'failed') {
    return (
      <Notice tone="failed">
        {say('imports.the-import-could-not-be')}{' '}
        <button type="button" onClick={() => void load()}>
          {say('imports.try-again')}
        </button>
      </Notice>
    );
  }

  const updating = view.kind === 'again';
  const documentName =
    view.recognised?.documentTitle ?? say('imports.the-document-the-earlier-import');
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
              {`${part.kind === 'section' ? say('imports.section') : say('imports.component')}: ${part.title}`}
            </button>
            {part.flags.map((each) => (
              <span key={each} className={styles['muted']}>
                {FLAGS[each].said}
              </span>
            ))}
            {part.again && (
              <span className={styles['muted']}>{againWords(part.again, documentName)}</span>
            )}
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
          <h3>{say('imports.its-tracked-changes')}</h3>
          <ul aria-label={say('imports.suggestions-it-will-make')}>
            {shown.suggestions!.map((each) => (
              <li key={each.author}>
                {say('imports.from-word', {
                  author: each.author,
                  blocks: each.blocks,
                  value3: each.blocks === 1 ? 'block' : 'blocks',
                  text: each.text,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {(shown.threads ?? []).length > 0 && (
        <>
          <h3>{say('imports.its-comments')}</h3>
          <ul aria-label={say('imports.threads-it-will-make')}>
            {shown.threads!.map((each, index) => (
              <li key={index}>
                {say('imports.from-word-2', {
                  author: each.author,
                  value2: each.quote === null ? '' : ` on “${each.quote}”`,
                  text: each.text,
                })}
                {each.clamped && (
                  <span className={styles['muted']}> {say('imports.it-ran-on-and-is')}</span>
                )}
                {each.replies.length > 0 && (
                  <ul>
                    {each.replies.map((reply, at) => (
                      <li key={at}>
                        {say('imports.from-word-3', { author: reply.author, text: reply.text })}
                      </li>
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
          <h3>{say('imports.its-references-outside-the-import')}</h3>
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
                {say('imports.point-at', { text: reference.text })}
                <select
                  value={pointing[reference.key] ?? shown.blocks[0]?.id ?? ''}
                  onChange={(event) =>
                    setPointing((was) => ({ ...was, [reference.key]: event.target.value }))
                  }
                >
                  {shown.blocks.map((block, index) =>
                    block.id === undefined ? null : (
                      <option key={block.id} value={block.id}>
                        {say('imports.block', {
                          value1: index + 1,
                          value2: block.text.slice(0, 60),
                        })}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                {say('imports.point-it-there')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  edit({ edit: 'reference', reference: reference.key, to: { kind: 'text' } })
                }
              >
                {say('imports.make-plain-text', { text: reference.text })}
              </button>
            </form>
          ))}
        </>
      )}
    </>
  );
  const againTitle = shown?.again?.componentTitle ?? say('imports.its-component');
  const againPanel = shown?.again && (
    <>
      <p>{againWords(shown.again, documentName)}</p>
      {shown.diff && (
        <>
          <h3>{say('imports.what-changed-against-as-it', { againTitle })}</h3>
          <ol
            aria-label={say('imports.what-changed-against-as-it', { againTitle })}
            className={styles['blocks']}
          >
            {shown.diff.map((line, index) => (
              <li key={index} className={styles['source']}>
                {line.change === 'removed' ? (
                  <del>{line.text}</del>
                ) : line.change === 'added' ? (
                  <ins>{line.text}</ins>
                ) : (
                  <span>{line.text}</span>
                )}
              </li>
            ))}
          </ol>
          <p className={styles['muted']}>{say('imports.struck-through-is-in-the')}</p>
        </>
      )}
      <form
        className={styles['actions']}
        onSubmit={(event) => {
          event.preventDefault();
          if (matching !== '') edit({ edit: 'match', part: shown.id, component: matching });
        }}
      >
        <label>
          {say('imports.matched-to')}
          <select value={matching} onChange={(event) => setMatching(event.target.value)}>
            <option value="">{say('imports.nothing-a-new-component')}</option>
            {(view.earlierMade ?? []).map((each) => (
              <option key={each.component} value={each.component}>
                {each.title ?? say('imports.a-component-you-may-not')}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || matching === ''}>
          {say('imports.match-it')}
        </button>
        <button
          type="button"
          disabled={busy || shown.again.component === null}
          onClick={() => edit({ edit: 'match', part: shown.id, component: null })}
        >
          {say('imports.mark-it-new')}
        </button>
      </form>
    </>
  );
  const partPanel = shown && (
    <section
      aria-label={say('imports.part-of', {
        value1: shown.place + 1,
        of: shown.of,
        title: shown.title,
      })}
      className={styles['review']}
    >
      <h2>{`${shown.kind === 'section' ? say('imports.section') : say('imports.component')}: ${shown.title}`}</h2>
      <p className={styles['muted']}>{reasonOf(shown)}</p>
      {shown.flags.map((each) => (
        <p key={each} className={styles['muted']}>
          {FLAGS[each].said}
        </p>
      ))}
      <div className={styles['beside']}>
        <div>
          <h3>{say('imports.what-it-holds')}</h3>
          {shown.kind === 'section' ? (
            <p className={styles['muted']}>{say('imports.a-section-holds-components-not')}</p>
          ) : (
            <ol aria-label={say('imports.what-it-holds')} className={styles['blocks']}>
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
                      {say('imports.split-before-block', { value1: index + 1 })}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3 id="import-part-source">{say('imports.from-the-file')}</h3>
          <p aria-labelledby="import-part-source" role="group" className={styles['source']}>
            {shown.source}
          </p>
        </div>
      </div>
      {structure}
      {againPanel}
      <form
        className={styles['actions']}
        onSubmit={(event) => {
          event.preventDefault();
          edit({ edit: 'rename', part: shown.id, title: rename });
        }}
      >
        <label>
          {say('imports.part-title')}
          <input value={rename} onChange={(event) => setRename(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || rename.trim() === ''}>
          {say('imports.rename')}
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
              {say('imports.move-its-first-block-to')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => edit({ edit: 'move', part: shown.id, to: 'next', blocks: 1 })}
            >
              {say('imports.move-its-last-block-to')}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => edit({ edit: 'merge', part: shown.id })}
        >
          {say('imports.merge-with-the-next-part')}
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
          {shown.kind === 'section'
            ? say('imports.make-it-a-component')
            : say('imports.make-it-a-section')}
        </button>
      </div>
      <div className={styles['actions']}>
        <button
          type="button"
          disabled={shown.previous === null}
          onClick={() => shown.previous !== null && go(shown.previous)}
        >
          {say('imports.previous-part')}
        </button>
        <button
          type="button"
          disabled={shown.next === null}
          onClick={() => shown.next !== null && go(shown.next)}
        >
          {say('imports.next-part')}
        </button>
      </div>
    </section>
  );

  const accept = (event: FormEvent) => {
    event.preventDefault();
    void act(
      () =>
        client.POST('/v1/imports/{id}/accept', {
          params: { path: { id } },
          body: { revision: view.revision, title },
        }),
      (data) => {
        window.location.hash = `#/documents/${(data as { document: string }).document}`;
      },
    );
  };

  return (
    <section aria-labelledby="import-page-heading" className={styles['page']}>
      <h1 id="import-page-heading">{say('imports.import-of', { fileName: view.fileName })}</h1>
      <p role="status">{STATES[view.state]}</p>
      <section aria-label={say('imports.what-an-import-keeps')}>
        <p className={styles['muted']}>
          {keptBy(view.fileType ?? fileTypeOf(view.fileName))}{' '}
          <a href={IMPORT_HELP}>{say('imports.what-arrives-and-what-does')}</a>
        </p>
      </section>
      {view.recognised && (
        <section aria-label={say('imports.imported-before')} className={styles['review']}>
          <h2>{say('imports.imported-before')}</h2>
          <p>
            {wordsWith(
              'imports.was-imported-into-this-space',
              {
                same: view.recognised.match === 'hash' ? 'yes' : 'no',
                file: view.recognised.fileName,
                who: view.recognised.importerName ?? say('imports.someone'),
                when: formats().date(new Date(view.recognised.at)),
              },
              {
                document: (
                  <a href={`#/documents/${view.recognised.document}`}>
                    {view.recognised.documentTitle ?? say('imports.a-document')}
                  </a>
                ),
              },
            )}
          </p>
          <p className={styles['muted']}>
            {updating
              ? say('imports.updating-what-it-made-each')
              : say('imports.importing-as-new-makes-a')}
          </p>
          <div className={styles['actions']}>
            <button
              type="button"
              aria-pressed={!updating}
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.PUT('/v1/imports/{id}/kind', {
                    params: { path: { id } },
                    body: { revision: view.revision, kind: 'first' },
                  }),
                )
              }
            >
              {say('imports.import-as-new')}
            </button>
            <button
              type="button"
              aria-pressed={updating}
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.PUT('/v1/imports/{id}/kind', {
                    params: { path: { id } },
                    body: {
                      revision: view.revision,
                      kind: 'again',
                      earlier: view.recognised!.import,
                    },
                  }),
                )
              }
            >
              {say('imports.update-what-it-made')}
            </button>
          </div>
        </section>
      )}
      {view.failure !== null && (
        <Notice tone="failed">{FAILURES[view.failure] ?? FAILURES['reading_failed']}</Notice>
      )}
      {(view.state === 'awaiting' || view.state === 'reading') && (
        <Waiting>{say('imports.reading-the-file-2')}</Waiting>
      )}
      {view.sweepsAt !== null && (
        <p className={styles['muted']}>
          {say('imports.abandoned-on-unless-it-is', {
            value1: new Date(view.sweepsAt).toLocaleDateString(),
          })}
        </p>
      )}
      {view.state === 'accepted' && view.document !== null && (
        <a href={`#/documents/${view.document}`}>{say('imports.open-the-document')}</a>
      )}
      {view.state === 'accepted' && view.outcome && (
        <ul aria-label={say('imports.what-the-update-did')}>
          <li>
            {say('imports.suggested-on-changed-unchanged', {
              length: view.outcome.suggested.length,
              value2: view.outcome.suggested.length === 1 ? 'component' : 'components',
              unchanged: view.outcome.unchanged,
            })}
          </li>
          <li>
            {say('imports.made-new-placed-in-the', {
              length: view.outcome.made.length,
              value2: view.outcome.made.length === 1 ? 'component' : 'components',
              length3: view.outcome.made.filter((each) => each.placed).length,
            })}
          </li>
          <li>
            {say('imports.kept-gone-from-the-file', {
              length: view.outcome.gone.length,
              length2: view.outcome.gone.filter((each) => each.flagged).length,
            })}
          </li>
          {view.outcome.skipped.map((each) => (
            <li key={each.component}>
              {say('imports.one-component-was-not-suggested', { value1: SKIPPED[each.reason] })}
            </li>
          ))}
        </ul>
      )}
      {view.state === 'accepted' && view.accepted !== null && (
        <ul aria-label={say('imports.what-was-accepted')}>
          {COUNTED.map((key) => (
            <li key={key}>{say('imports.counted', { count: view.accepted![key], how: key })}</li>
          ))}
        </ul>
      )}

      {view.state === 'proposed' && (
        <>
          <h2>{say('imports.proposed-outline')}</h2>
          <form className={styles['actions']} role="search" onSubmit={(event) => void find(event)}>
            <label>
              {say('imports.search-parts')}
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              {say('imports.show')}
              <select value={flag} onChange={(event) => setFlag(event.target.value as Flag | '')}>
                <option value="">{say('imports.every-part')}</option>
                {(Object.keys(FLAGS) as Flag[]).map((each) => (
                  <option key={each} value={each}>
                    {FLAGS[each].filter}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{say('imports.find')}</button>
          </form>
          {matches !== null && (
            <p className={styles['muted']}>
              {say('imports.of-parts-found', { size: matches.size, length: view.parts.length })}{' '}
              <button
                type="button"
                onClick={() => {
                  setMatches(null);
                  setQuery('');
                  setFlag('');
                }}
              >
                {say('imports.show-every-part')}
              </button>
            </p>
          )}
          {top.length === 0 ? (
            <p className={styles['muted']}>{say('imports.nothing-was-read-from-the')}</p>
          ) : (
            <ol className={styles['outline']} aria-label={say('imports.proposed-outline')}>
              {top.map(partItem)}
            </ol>
          )}
          {(view.gone ?? []).length > 0 && (
            <>
              <h2>{say('imports.gone-from-the-file')}</h2>
              <ul aria-label={say('imports.gone-from-the-file')}>
                {view.gone!.map((each) => (
                  <li key={each.component}>
                    {say('imports.kept-and-flagged-on-the', {
                      value1: each.title ?? 'A component you may not read',
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
          {partPanel}
          <form
            className={styles['actions']}
            onSubmit={(event) => {
              event.preventDefault();
              void act(() =>
                client.PUT('/v1/imports/{id}/levels', {
                  params: { path: { id } },
                  body: { revision: view.revision, ...levels },
                }),
              );
            }}
          >
            <label>
              {say('imports.sections-at-heading-level')}
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
              {say('imports.components-at-heading-level')}
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
              {say('imports.propose-again')}
            </button>
          </form>
        </>
      )}

      {view.state === 'proposed' && view.references.length > 0 && (
        <>
          <h2>{say('imports.references-outside-the-import')}</h2>
          <p className={styles['muted']}>{say('imports.each-must-be-pointed-at')}</p>
          <ul aria-label={say('imports.references-outside-the-import')}>
            {view.references.map((each) => (
              <li key={each.key}>
                {`“${each.text}”: ${
                  each.resolved === 'retargeted'
                    ? say('imports.pointed-at-a-block')
                    : each.resolved === 'text'
                      ? say('imports.made-plain-text')
                      : say('imports.not-resolved-yet')
                }`}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.identities.length > 0 && (
        <>
          <h2>{say('imports.names-the-file-carries')}</h2>
          <p>{POLICIES[view.policy][view.policyApplied ? 'did' : 'will']}</p>
          <p className={styles['muted']}>{say('imports.what-the-import-makes-is')}</p>
          <ul aria-label={say('imports.names-the-file-carries')}>
            {view.identities.map((each) => (
              <li key={each.name}>
                {`${each.name}${each.email === null ? '' : ` (${each.email})`}, ${each.carries
                  .map((role) => CARRIES[role])
                  .join(', ')}: ${
                  view.policy !== 'map' || each.match === 'none' || each.memberName === null
                    ? view.policy === 'discard'
                      ? 'discarded'
                      : say('imports.kept-as-text')
                    : each.match === 'email'
                      ? say('imports.matched-to-by-email', { memberName: each.memberName })
                      : each.confirmed
                        ? say('imports.matched-to-by-name-confirmed', {
                            memberName: each.memberName,
                          })
                        : say('imports.may-be-by-name', { memberName: each.memberName })
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
                          ? say('imports.withdraw-as', {
                              name: each.name,
                              value2: each.memberName ?? '',
                            })
                          : say('imports.confirm-is', {
                              name: each.name,
                              value2: each.memberName ?? '',
                            })}
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
          <h2>{say('imports.what-was-left-out-or')}</h2>
          <ul aria-label={say('imports.report')}>
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
          {updating ? (
            <p className={styles['muted']}>
              {say('imports.accepting-updates-no-new-document', { documentName })}
            </p>
          ) : (
            <label>
              {say('imports.document-title')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          )}
          <button
            type="submit"
            className="primary"
            disabled={busy || (!updating && title.trim() === '')}
          >
            {say('imports.accept')}
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
            {say('imports.abandon')}
          </button>
        </div>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
