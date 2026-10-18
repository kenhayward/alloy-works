import { streamPost, type createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import styles from './AssistantPanel.module.css';

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
  readonly component: string;
  readonly proposed: { readonly content?: readonly unknown[] };
  readonly state: 'open' | 'accepted' | 'kept' | 'discarded';
  readonly said?: string;
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
};

/** A proposal's text, a block a line, as it would read: paragraphs and list items. */
function proposedText(proposed: Proposal['proposed']): string {
  const inline = (content: unknown): string =>
    Array.isArray(content)
      ? content
          .map((node) =>
            typeof node === 'object' && node !== null && 'value' in node
              ? String((node as { value: unknown }).value)
              : '',
          )
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
  document: string;
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
  const [ended, setEnded] = useState<Ended | null>(null);
  const [said, setSaid] = useState('');
  const [month, setMonth] = useState<string>('');
  const stop = useRef<AbortController | null>(null);
  const [prompts, setPrompts] = useState<readonly RunnablePrompt[]>([]);

  useEffect(() => () => stop.current?.abort(), []);

  // The prompts this document's library lists that run, each at its approved revision (G4-F).
  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/documents/{id}/prompts', { params: { path: { id: document } } })
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
  }, [client, document]);

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
    await run(`${origin}/v1/documents/${document}/assistant/runs`, {
      ask: ask.trim(),
      ...(component === null ? {} : { component }),
    });
  };

  /** A run streamed: the assistant asked, or a prompt run on the part open (G4-I). */
  const run = async (url: string, body: Record<string, unknown>) => {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setAnswer('');
    setSteps([]);
    setProposals([]);
    setEnded(null);
    setSaid('');
    const outcome = await stream({
      url,
      body,
      signal: controller.signal,
      onEvent: (name, data) => {
        const frame = data as Record<string, unknown>;
        switch (name) {
          case 'run':
            setEndpoint(frame.endpoint as { name: string; boundary: string });
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
                component: String(frame.component),
                proposed: frame.proposed as Proposal['proposed'],
                state: 'open',
              },
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
                    ? 'Accepted: it is a new version of the part.'
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
      <div aria-live="polite" className={styles['answer']}>
        {shownAnswer}
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
            Proposal {proposal.number}: {nameOf(proposal.component) ?? 'a part'}
          </h3>
          <pre className={styles['proposed']}>{proposedText(proposal.proposed)}</pre>
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
              <button type="button" onClick={() => void act(proposal, 'keeping')}>
                Keep as suggestion
              </button>
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
