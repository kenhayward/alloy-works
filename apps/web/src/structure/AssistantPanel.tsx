import { streamPost, type createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { PENDING_ENTRY } from '@alloy-works/domain';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import styles from './AssistantPanel.module.css';
import { PersonalPrompts } from './PersonalPrompts.js';

type Client = ReturnType<typeof createApiClient>;

/** A step the assistant took: a tool it called, and what came back. */
interface Step {
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
  readonly ok?: boolean;
  readonly result?: string;
}

/** An edit the assistant proposed, and what its requester did with it. */
interface Proposal {
  readonly id: string;
  readonly number: number;
  /** The part edited; null for one proposed to be made (G5-E). */
  readonly component: string | null;
  /** Where and under what title a proposed part would be made. */
  readonly creates: { readonly title: string } | null;
  /** A citation of a source's work (XR-I): its entry found or made only as it is accepted. */
  readonly cites: Cites | null;
  readonly proposed: { readonly content?: readonly unknown[] };
  readonly state: 'open' | 'accepted' | 'kept' | 'discarded';
  readonly said?: string;
}

interface Cites {
  readonly source: string;
  readonly identifier: string;
  readonly title: string | null;
}

interface Citation {
  readonly component: string;
  readonly block: string;
}

interface Ended {
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly cost: string | null;
  readonly currency: string;
  readonly citations: readonly Citation[];
  readonly dropped: readonly Citation[];
  /** A prompt run's reply that could not be proposed, and why (G4-I). */
  readonly refused?: string;
}

const TOOL_WORDS: Readonly<Record<string, string>> = {
  read_outline: 'Read the outline',
  read_component: 'Read a part',
  search_document: 'Searched the document',
  read_values: 'Read the bound values',
  propose_edit: 'Proposed an edit',
  search_references: 'Searched a reference source',
  cite_reference: 'Proposed a citation',
  declined: 'Declined an instruction',
};

/**
 * A proposal's text, a block a line, as it would read: paragraphs and list items, a proposed
 * citation by its source's title.
 */
function proposedText(proposed: Proposal['proposed'], cites: Cites | null): string {
  const inline = (content: unknown): string =>
    Array.isArray(content)
      ? content
          .map((node) => {
            if (typeof node !== 'object' || node === null) return '';
            if ('value' in node) return String((node as { value: unknown }).value);
            const { type, entry } = node as { type?: unknown; entry?: unknown };
            if (type !== 'citation') return '';
            return entry === PENDING_ENTRY && cites !== null
              ? `[${cites.title ?? cites.identifier}]`
              : '[citation]';
          })
          .join('')
      : '';
  return (proposed.content ?? [])
    .map((block) => {
      const each = block as { type?: string; content?: unknown; items?: { content?: unknown[] }[] };
      if (each.type === 'paragraph') return inline(each.content);
      if (each.type === 'list') {
        return (each.items ?? [])
          .map((item) =>
            (item.content ?? [])
              .map((child) => `- ${inline((child as { content?: unknown }).content)}`)
              .join('\n'),
          )
          .join('\n');
      }
      return `[${each.type ?? 'block'}]`;
    })
    .join('\n\n');
}

/** A conversation of the person's on this document, as the panel lists it (G5-A). */
interface ConversationItem {
  readonly id: string;
  readonly title: string;
}

/** A turn of the open conversation, as the service keeps it. */
interface ConversationTurn {
  readonly run: string;
  readonly ask: string | null;
  readonly reply: string | null;
  readonly outcome: string;
}

/** A part the open conversation reads (G5-D). */
interface TrayItem {
  readonly component: string;
  readonly version: string | null;
  readonly readable: boolean;
}

/** An endpoint a turn may run on (G5-C). */
interface OfferedEndpoint {
  readonly id: string;
  readonly name: string;
  readonly boundary: string;
  readonly isDefault: boolean;
}

/** A refusal's words, or the fallback where it says none. */
const refusalWords = (error: unknown, fallback: string): string =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : fallback;

/** A prompt the document's library runs, as the panel offers it. */
interface RunnablePrompt {
  readonly id: string;
  readonly title: string;
}

const CITATION = /\[\[([0-9a-f-]{36})#([A-Za-z0-9_-]{1,64})\]\]/g;

/**
 * The document page's **Assistant** (generation.md, "The assistant"; the G2 plan, G2-K): ask about
 * the open document; the answer as it streams; what it did, each call and what came back; each
 * proposal with **Accept**, **Keep as suggestion** and **Discard**; the citations it kept as links;
 * and what the run cost; and the prompts the document's library runs on the part open. Nothing it
 * proposes changes the document until it is accepted.
 */
export function AssistantPanel({
  client,
  document,
  component,
  node = null,
  nameOf = () => undefined,
  onCite,
  stream = streamPost,
  origin = window.location.origin,
}: {
  client: Client;
  /** The document it is about, or null for conversations on none (the G5 plan, G5-D). */
  document: string | null;
  /** The component the author has open, if one is. */
  component: string | null;
  /** Its node in the outline: the part a prompt runs on (the G4 plan, G4-I). */
  node?: string | null;
  nameOf?: (component: string) => string | undefined;
  /** A kept citation followed: its component and block shown. */
  onCite: (component: string, block: string) => void;
  /** Given in tests. */
  stream?: (options: StreamPostOptions) => ReturnType<typeof streamPost>;
  origin?: string;
}) {
  const [ask, setAsk] = useState('');
  const [running, setRunning] = useState(false);
  const [endpoint, setEndpoint] = useState<{ name: string; boundary: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [steps, setSteps] = useState<readonly Step[]>([]);
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  // Instructions found in what it read and declined aloud, beside the turn (GC-E; GEN-021).
  const [notices, setNotices] = useState<readonly { where: string; instruction: string }[]>([]);
  const [ended, setEnded] = useState<Ended | null>(null);
  // A prompt run that reused the requester's own earlier one, and how to run it afresh (G6-E).
  const [reused, setReused] = useState<Record<string, unknown> | null>(null);
  useEffect(() => setReused(null), [node, document]);
  const [said, setSaid] = useState('');
  const [month, setMonth] = useState<string>('');
  const stop = useRef<AbortController | null>(null);
  const [prompts, setPrompts] = useState<readonly RunnablePrompt[]>([]);
  // This document's conversations of the person's, the one open and its turns (G5-A).
  const [conversations, setConversations] = useState<readonly ConversationItem[]>([]);
  const [conversation, setConversation] = useState<string | null>(null);
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  // The endpoints a turn may run on, and the one chosen (G5-C).
  const [endpoints, setEndpoints] = useState<readonly OfferedEndpoint[]>([]);
  const [chosen, setChosen] = useState('');
  // What the open conversation reads, as its person may now (G5-D), and parts found to add.
  const [tray, setTray] = useState<readonly TrayItem[]>([]);
  const [looking, setLooking] = useState('');
  const [found, setFound] = useState<readonly { id: string; title: string }[]>([]);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());

  const readTray = async (id: string) => {
    const { data } = await client.GET('/v1/conversations/{id}/context', {
      params: { path: { id } },
    });
    if (data) setTray(data.items);
  };

  const readConversations = async () => {
    const { data } = await client.GET('/v1/conversations', {
      params: { query: document === null ? {} : { document } },
    });
    // Without a document, those on none: a document's own are on its page.
    if (data) {
      setConversations(data.items.filter((each) => document !== null || each.document === null));
    }
  };

  const readTurns = async (id: string) => {
    const { data } = await client.GET('/v1/conversations/{id}', { params: { path: { id } } });
    if (data) setTurns(data.conversation.turns);
    await readTray(id);
  };

  useEffect(() => {
    void readConversations().catch(() => undefined);
    void client
      .GET('/v1/conversation-endpoints')
      .then(({ data }) => {
        if (!data) return;
        setEndpoints(data.items);
        setChosen(data.items.find((each) => each.isDefault)?.id ?? data.items[0]?.id ?? '');
      })
      .catch(() => undefined);
    // Read once a document; `readConversations` reads the props it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, document]);

  useEffect(() => () => stop.current?.abort(), []);

  // The prompts this document's library lists that run, each at its approved revision (G4-F); with a
  // part open, those that write its type alone (GEN-004).
  useEffect(() => {
    if (document === null) return undefined;
    let current = true;
    // Never the last part's while this one's are read, nor once they could not be.
    setPrompts([]);
    void client
      .GET('/v1/documents/{id}/prompts', {
        params: { path: { id: document }, query: node === null ? {} : { node } },
      })
      .then(({ data }) => {
        if (!current || !data) return;
        setPrompts(
          data.prompts.flatMap((each) =>
            each.state === 'approved' ? [{ id: each.id, title: each.prompt.title }] : [],
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, document, node]);

  const removePart = async (component: string) => {
    if (conversation === null) return;
    const { data } = await client.POST('/v1/conversations/{id}/context/{component}/removal', {
      params: { path: { id: conversation, component } },
    });
    if (data) setTray(data.items);
  };

  const look = async () => {
    const { data } = await client.GET('/v1/search', {
      params: { query: { q: looking.trim(), kind: 'component' } },
    });
    setFound(
      data?.outcome === 'results'
        ? data.items.map((each) => ({ id: each.artifactId, title: each.title }))
        : [],
    );
  };

  const addPart = async (component: string, title: string) => {
    if (conversation === null) return;
    const { data, error } = await client.POST('/v1/conversations/{id}/context', {
      params: { path: { id: conversation } },
      body: { component },
    });
    if (data) {
      setTray(data.items);
      setTitles((was) => new Map(was).set(component, title));
      setFound([]);
      setLooking('');
    } else setSaid(refusalWords(error, 'That part could not be added.'));
  };

  const usage = async () => {
    const { data } = await client.GET('/v1/me/assistant-usage');
    if (!data) return;
    const costs = data.costs.map((each) => `${each.currency} ${each.cost}`).join(', ');
    setMonth(
      `This month: ${data.runs} ${data.runs === 1 ? 'run' : 'runs'}${costs === '' ? '' : `, ${costs}`}.`,
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (ask.trim() === '' || running) return;
    // A first ask starts a conversation of this document's, named by its words (G5-A).
    let id = conversation;
    if (id === null) {
      const { data, error } = await client.POST('/v1/conversations', {
        body: { ...(document === null ? {} : { document }), title: ask.trim() },
      });
      if (!data) {
        setSaid(refusalWords(error, 'The conversation could not be started.'));
        return;
      }
      id = data.conversation.id;
      setConversation(id);
      setTurns([]);
    }
    await run(`${origin}/v1/conversations/${id}/turns`, {
      ask: ask.trim(),
      ...(chosen === '' ? {} : { endpoint: chosen }),
      ...(component === null ? {} : { component }),
    });
    setAsk('');
    await Promise.all([readTurns(id), readConversations()]).catch(() => undefined);
  };

  /** A run streamed: the assistant asked, or a prompt run on the part open (G4-I). */
  const run = async (url: string, body: Record<string, unknown>) => {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setAnswer('');
    setSteps([]);
    setProposals([]);
    setNotices([]);
    setEnded(null);
    setSaid('');
    setReused(null);
    const outcome = await stream({
      url,
      body,
      signal: controller.signal,
      onEvent: (name, data) => {
        const frame = data as Record<string, unknown>;
        switch (name) {
          case 'run':
            setEndpoint(frame.endpoint as { name: string; boundary: string });
            setCurrent(String(frame.run));
            if (typeof frame.cachedFrom === 'string') setReused(body);
            break;
          case 'text':
            setAnswer((was) => was + String(frame.text));
            break;
          case 'tool_call':
            setSteps((was) => [...was, { id: String(frame.id), name: String(frame.name) }]);
            break;
          case 'tool_result':
            setSteps((was) =>
              was.map((step) =>
                step.id === frame.id
                  ? {
                      ...step,
                      ok: Boolean(frame.ok),
                      summary: String(frame.summary),
                      result: String(frame.result),
                    }
                  : step,
              ),
            );
            break;
          case 'proposal':
            setProposals((was) => [
              ...was,
              {
                id: String(frame.id),
                number: Number(frame.number),
                component: typeof frame.component === 'string' ? frame.component : null,
                creates:
                  typeof frame.creates === 'object' && frame.creates !== null
                    ? (frame.creates as { title: string })
                    : null,
                cites:
                  typeof frame.cites === 'object' && frame.cites !== null
                    ? (frame.cites as Cites)
                    : null,
                proposed: frame.proposed as Proposal['proposed'],
                state: 'open',
              },
            ]);
            break;
          case 'notice':
            setNotices((was) => [
              ...was,
              { where: String(frame.where), instruction: String(frame.instruction) },
            ]);
            break;
          case 'ended':
            setEnded(frame as unknown as Ended);
            break;
          case 'failed':
            setSaid(String(frame.message));
            break;
        }
      },
    });
    if (outcome.kind === 'refused') {
      const body = outcome.body as { message?: string } | null;
      setSaid(body?.message ?? 'The assistant could not be asked.');
    } else if (outcome.kind === 'failed') {
      setSaid('The assistant stopped answering.');
    } else if (outcome.kind === 'stopped') {
      setSaid('Stopped.');
    }
    stop.current = null;
    setRunning(false);
    void usage();
  };

  const act = async (proposal: Proposal, act: 'acceptance' | 'keeping' | 'discarding') => {
    const path =
      act === 'acceptance'
        ? '/v1/assistant/proposals/{id}/acceptance'
        : act === 'keeping'
          ? '/v1/assistant/proposals/{id}/keeping'
          : '/v1/assistant/proposals/{id}/discarding';
    const { data, error } = await client.POST(path, { params: { path: { id: proposal.id } } });
    setProposals((was) =>
      was.map((each) =>
        each.id !== proposal.id
          ? each
          : data
            ? {
                ...each,
                state: data.proposal.state,
                said:
                  data.proposal.state === 'accepted'
                    ? each.creates !== null
                      ? 'Accepted: the part is made.'
                      : 'Accepted: it is a new version of the part.'
                    : data.proposal.state === 'kept'
                      ? 'Kept as a suggestion, marked generated, for review.'
                      : 'Discarded.',
              }
            : {
                ...each,
                said:
                  (error as { message?: string } | undefined)?.message ?? 'It could not be done.',
              },
      ),
    );
  };

  const kept = new Set((ended?.citations ?? []).map((each) => `${each.component}#${each.block}`));
  const cited = [...answer.matchAll(CITATION)]
    .map((match) => ({ component: match[1]!, block: match[2]! }))
    .filter(
      (each, index, all) =>
        kept.has(`${each.component}#${each.block}`) &&
        all.findIndex(
          (other) => other.component === each.component && other.block === each.block,
        ) === index,
    );
  const shownAnswer = answer.replace(CITATION, (_match, c: string, b: string) => {
    const at = cited.findIndex((each) => each.component === c && each.block === b);
    return at === -1 ? '' : `[${at + 1}]`;
  });

  return (
    <section className={styles['assistant']} aria-label="Assistant">
      <p className={styles['muted']}>
        {endpoint === null
          ? 'The assistant reads what you may read of this document. Nothing it proposes changes the document until you accept it.'
          : `Using ${endpoint.name}${endpoint.boundary === 'outside' ? ', which is outside your data boundary' : ''}.`}
      </p>
      <div className={styles['actions']}>
        <label className={styles['ask']}>
          Conversation
          <select
            value={conversation ?? ''}
            disabled={running}
            onChange={(change) => {
              const id = change.target.value === '' ? null : change.target.value;
              setConversation(id);
              setTurns([]);
              setCurrent(null);
              setAnswer('');
              setProposals([]);
              setSteps([]);
              setEnded(null);
              setTray([]);
              if (id !== null) void readTurns(id).catch(() => undefined);
            }}
          >
            <option value="">A new conversation</option>
            {conversations.map((each) => (
              <option key={each.id} value={each.id}>
                {each.title}
              </option>
            ))}
          </select>
        </label>
        {endpoints.length > 0 && (
          <label className={styles['ask']}>
            Endpoint
            <select
              value={chosen}
              disabled={running}
              onChange={(change) => setChosen(change.target.value)}
            >
              {endpoints.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.boundary === 'outside'
                    ? `${each.name}, outside your data boundary`
                    : each.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {turns.filter((each) => each.run !== current).length > 0 && (
        <ol aria-label="Earlier turns" className={styles['turns']}>
          {turns
            .filter((each) => each.run !== current)
            .map((each) => (
              <li key={each.run}>
                <p className={styles['strong']}>{each.ask}</p>
                <p>
                  {each.outcome === 'finished'
                    ? (each.reply ?? '')
                    : each.outcome === 'running'
                      ? 'Still answering.'
                      : 'This turn did not finish.'}
                </p>
              </li>
            ))}
        </ol>
      )}
      {conversation !== null && (
        <section aria-label="What it reads" className={styles['prompts']}>
          <h3>What it reads</h3>
          {tray.length === 0 ? (
            <p className={styles['muted']}>
              Nothing yet. A part the assistant reads, or one you add, is read again each turn.
            </p>
          ) : (
            <ul>
              {tray.map((each) => {
                const title = nameOf(each.component) ?? titles.get(each.component) ?? 'A part';
                return (
                  <li key={each.component}>
                    <span>
                      {each.readable ? title : 'A part you may no longer read, which is not sent'}
                    </span>{' '}
                    <button
                      type="button"
                      aria-label={`Remove ${each.readable ? title : 'the part you may no longer read'}`}
                      onClick={() => void removePart(each.component)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={styles['actions']}>
            <label className={styles['ask']}>
              Find a part to add
              <input value={looking} onChange={(change) => setLooking(change.target.value)} />
            </label>
            <button type="button" disabled={looking.trim() === ''} onClick={() => void look()}>
              Find
            </button>
          </div>
          {found.length > 0 && (
            <ul aria-label="Parts found">
              {found.map((each) => (
                <li key={each.id}>
                  <span>{each.title}</span>{' '}
                  <button
                    type="button"
                    aria-label={`Add ${each.title}`}
                    onClick={() => void addPart(each.id, each.title)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <PersonalPrompts client={client} asking={ask} onUse={setAsk} />
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles['ask']}>
          Ask the assistant
          <textarea value={ask} rows={3} onChange={(change) => setAsk(change.target.value)} />
        </label>
        <div className={styles['actions']}>
          <button type="submit" className="primary" disabled={running || ask.trim() === ''}>
            Ask
          </button>
          {running && (
            <button type="button" onClick={() => stop.current?.abort()}>
              Stop
            </button>
          )}
        </div>
      </form>
      {prompts.length > 0 && (
        <section aria-label="Prompts" className={styles['prompts']}>
          <h3>Prompts</h3>
          {node === null ? (
            <p className={styles['muted']}>Open a part to run a prompt on it.</p>
          ) : (
            <ul>
              {prompts.map((each) => (
                <li key={each.id}>
                  <span>{each.title}</span>{' '}
                  <button
                    type="button"
                    disabled={running}
                    aria-label={`Run ${each.title} on this part`}
                    onClick={() =>
                      void run(`${origin}/v1/documents/${document}/prompt-runs`, {
                        prompt: each.id,
                        node,
                      })
                    }
                  >
                    Run
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {reused && (
        <p className={styles['muted']}>
          From your earlier run of this prompt on this part, at no cost.{' '}
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void run(`${origin}/v1/documents/${document}/prompt-runs`, {
                ...reused,
                fresh: true,
              })
            }
          >
            Run afresh
          </button>
        </p>
      )}
      <div aria-live="polite" className={styles['answer']}>
        {shownAnswer}
      </div>
      {/* Announced as each arrives, as the answer is (GEN-021). */}
      <div aria-live="polite">
        {notices.length > 0 && (
          <ul aria-label="Instructions not followed" className={styles['muted']}>
            {notices.map((each, index) => (
              <li key={index}>
                {nameOf(each.where) ?? titles.get(each.where) ?? 'Something it read'} asked: “
                {each.instruction}” Not done.
              </li>
            ))}
          </ul>
        )}
      </div>
      {cited.length > 0 && (
        <ol aria-label="Sources" className={styles['sources']}>
          {cited.map((each) => (
            <li key={`${each.component}#${each.block}`}>
              <button
                type="button"
                className={styles['link']}
                onClick={() => onCite(each.component, each.block)}
              >
                {nameOf(each.component) ?? 'A part'}, block {each.block}
              </button>
            </li>
          ))}
        </ol>
      )}
      {ended?.refused !== undefined && <p role="status">{ended.refused}</p>}
      {ended !== null && ended.dropped.length > 0 && (
        <p className={styles['muted']}>
          {ended.dropped.length === 1
            ? 'One citation was'
            : `${ended.dropped.length} citations were`}{' '}
          left out: it named text the assistant did not read.
        </p>
      )}
      {steps.length > 0 && (
        <details className={styles['steps']}>
          <summary>
            What it did ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
          </summary>
          <ol>
            {steps.map((step) => (
              <li key={step.id}>
                <span className={styles['strong']}>
                  {TOOL_WORDS[step.name] ?? `Asked for ${step.name}`}
                </span>
                {step.summary !== undefined && `: ${step.summary}`}
                {step.result !== undefined && <pre className={styles['result']}>{step.result}</pre>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {proposals.map((proposal) => (
        <article
          key={proposal.id}
          className={styles['proposal']}
          aria-label={`Proposal ${proposal.number}`}
        >
          <h3>
            Proposal {proposal.number}:{' '}
            {proposal.creates !== null
              ? `a new part, ${proposal.creates.title}`
              : ((proposal.component === null ? undefined : nameOf(proposal.component)) ??
                'a part')}
          </h3>
          <pre className={styles['proposed']}>
            {proposedText(proposal.proposed, proposal.cites)}
          </pre>
          {proposal.cites !== null && (
            <p className={styles['muted']}>
              Cites {proposal.cites.title ?? 'a work'},{' '}
              {proposal.cites.source === 'pubmed' ? 'PMID' : 'DOI'} {proposal.cites.identifier} from{' '}
              {proposal.cites.source}. Its entry is found or made in the space as you accept.
            </p>
          )}
          {proposal.state === 'open' && running ? (
            <p className={styles['muted']}>It can be acted on once the answer has ended.</p>
          ) : proposal.state === 'open' ? (
            <div className={styles['actions']}>
              <button
                type="button"
                className="primary"
                onClick={() => void act(proposal, 'acceptance')}
              >
                Accept
              </button>
              {proposal.creates === null && proposal.cites === null && (
                <button type="button" onClick={() => void act(proposal, 'keeping')}>
                  Keep as suggestion
                </button>
              )}
              <button type="button" onClick={() => void act(proposal, 'discarding')}>
                Discard
              </button>
            </div>
          ) : null}
          {proposal.said !== undefined && <p role="status">{proposal.said}</p>}
        </article>
      ))}
      {ended !== null && (
        <p className={styles['muted']}>
          {ended.tokensIn === null
            ? 'No tokens were reported.'
            : `${ended.tokensIn} tokens in, ${ended.tokensOut} out${ended.cost === null ? '' : `: ${ended.currency} ${ended.cost}`}.`}{' '}
          {month}
        </p>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
