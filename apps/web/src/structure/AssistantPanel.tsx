import { streamPost, type createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { PENDING_ENTRY } from '@alloy-works/domain';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import styles from './AssistantPanel.module.css';
import { AnswerMarkdown } from './AnswerMarkdown.js';
import { PersonalPrompts } from './PersonalPrompts.js';
import { Icon } from '../editor/Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { MenuButton } from '../parts/MenuButton.js';
import { Popup } from '../parts/Popup.js';
import { Segmented } from '../parts/Segmented.js';
import { Toolbar } from '../parts/Toolbar.js';
import { formats, words, wordsWith } from '../words/words.js';
import { failedWords, proposedNothingWords, stepWords, type StepSaid } from './runWords.js';

type Client = ReturnType<typeof createApiClient>;

/** A step the assistant took: a tool it called, and what came back. */
interface Step {
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
  readonly said?: StepSaid | undefined;
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
  /** What the last model call took in, which the context window holds; `tokensIn` sums every call. */
  readonly contextTokens?: number | null;
  readonly cost: string | null;
  readonly currency: string;
  readonly citations: readonly Citation[];
  readonly dropped: readonly Citation[];
  /** A prompt run's reply that could not be proposed, and why, by code and in words (G4-I). */
  readonly refusal?: string;
  readonly refused?: string;
}

const TOOL_WORDS: Readonly<Record<string, string>> = {
  get read_outline() {
    return words('document.read-the-outline');
  },
  get read_component() {
    return words('document.read-a-part');
  },
  get search_document() {
    return words('document.searched-the-document');
  },
  get read_values() {
    return words('document.read-the-bound-values');
  },
  get propose_edit() {
    return words('document.proposed-an-edit');
  },
  get search_references() {
    return words('document.searched-a-reference-source');
  },
  get cite_reference() {
    return words('document.proposed-a-citation');
  },
  get declined() {
    return words('document.declined-an-instruction');
  },
};

/** A step: the tool, and what it did where it said. */
function stepLine(step: Step) {
  const tool = (
    <span className={styles['strong']}>
      {TOOL_WORDS[step.name] ?? words('document.asked-for', { name: step.name })}
    </span>
  );
  const said = stepWords(step.said, step.summary);
  return said === undefined ? tool : wordsWith('assistant.step-said', { said }, { tool });
}

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
      // A table by its caption and rows, a cell's paragraphs run together (the TE change).
      if (each.type === 'table') {
        const table = block as {
          caption?: unknown;
          rows?: { cells?: { content?: { content?: unknown }[] }[] }[];
        };
        const caption = inline(table.caption);
        const rows = (table.rows ?? []).map(
          (row) =>
            `| ${(row.cells ?? [])
              .map((cell) => (cell.content ?? []).map((child) => inline(child.content)).join(' '))
              .join(' | ')} |`,
        );
        return [...(caption === '' ? [] : [`Table: ${caption}`]), ...rows].join('\n');
      }
      return `[${each.type ?? 'block'}]`;
    })
    .join('\n\n');
}

/** A conversation of the person's on this document, as the panel lists it (G5-A). */
interface ConversationItem {
  readonly id: string;
  readonly title: string;
  readonly madeAt: string;
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
  /** The most tokens its model takes in one call: what a turn is measured against. */
  readonly contextWindow: number;
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
/** A citation's mark and the space before it: what a copied answer leaves out. */
const CITATION_MARK = new RegExp(`\\s*${CITATION.source}`, 'g');

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
  onCitations,
  stream = streamPost,
  origin = window.location.origin,
  now = () => performance.now(),
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
  /** The citations the last answer kept, once each in its order: none while another is asked. */
  onCitations?: (cited: readonly Citation[]) => void;
  /** Given in tests. */
  stream?: (options: StreamPostOptions) => ReturnType<typeof streamPost>;
  origin?: string;
  /** Milliseconds, for how fast a reply came; given in tests. */
  now?: () => number;
}) {
  const [ask, setAsk] = useState('');
  // What this turn asked, shown above its answer and asked again on request (the DP plan).
  const [asked, setAsked] = useState<string | null>(null);
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
  // The reply's first and latest streamed token counts and when each came: how fast it came, in tokens
  // a second, from its own text alone, never the run's other calls (issue #871).
  const firstToken = useRef<{ at: number; tokens: number } | null>(null);
  const lastToken = useRef<{ at: number; tokens: number } | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const stop = useRef<AbortController | null>(null);
  const [prompts, setPrompts] = useState<readonly RunnablePrompt[]>([]);
  // This document's conversations of the person's, the one open and its turns (G5-A).
  const [conversations, setConversations] = useState<readonly ConversationItem[]>([]);
  const [conversation, setConversation] = useState<string | null>(null);
  // The open conversation's own name and whether it is kept: never read from the list, which holds
  // only those kept (the DQ plan).
  const [opened, setOpened] = useState<{ title: string; kept: boolean } | null>(null);
  // Its name as it is being written, or null where it is not.
  const [naming, setNaming] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [offering, setOffering] = useState(false);
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
  // Parts added before the first ask: held here, and given to the conversation it begins (#864).
  const [pending, setPending] = useState<readonly string[]>([]);
  const promptsButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const askedNow = useRef<HTMLParagraphElement>(null);
  // What the assistant is given with an ask on a document: the component open, or every one.
  const [scope, setScope] = useState<'component' | 'document'>('component');
  // The part asked about, held from when the box is entered until the ask is sent, so the cursor
  // leaving the part for the box does not change what is asked about (as Diariz holds its scope).
  const [held, setHeld] = useState<string | null>(null);
  // Let go once the box is left and another part, or none, is open: that is the one asked about.
  const inBox = useRef(false);
  // The conversation open now: a read begun for another lands nowhere (the final review).
  const openNow = useRef<string | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!inBox.current) setHeld(null);
  }, [component]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [ask]);
  // A turn asked brought into view, its words whole at the top of the conversation with the answer
  // coming under them, a follow-up too: the conversation scrolled alone, never the page around it
  // (issues #864, #871). Where the bubble is not drawn, a prompt run's, its foot.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !(running || asked !== null)) return;
    const bubble = askedNow.current;
    element.scrollTo?.({
      top: bubble ? bubble.offsetTop - 12 : element.scrollHeight,
    });
  }, [running, asked]);
  const asking = held ?? component;
  const given = asking === null ? 'document' : scope;
  // The reply's tokens so far, while it streams.
  const [received, setReceived] = useState(0);

  const readTray = async (id: string) => {
    const { data } = await client.GET('/v1/conversations/{id}/context', {
      params: { path: { id } },
    });
    if (data && openNow.current === id) setTray(data.items);
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
    if (openNow.current !== id) return;
    if (data) {
      setTurns(data.conversation.turns);
      setOpened({ title: data.conversation.title, kept: data.conversation.kept });
    }
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
    if (conversation === null) {
      setPending((was) => was.filter((each) => each !== component));
      return;
    }
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
    const done = () => {
      setTitles((was) => new Map(was).set(component, title));
      setFound([]);
      setLooking('');
      setFinding(false);
      addButton.current?.focus();
    };
    if (conversation === null) {
      setPending((was) => (was.includes(component) ? was : [...was, component]));
      done();
      return;
    }
    const { data, error } = await client.POST('/v1/conversations/{id}/context', {
      params: { path: { id: conversation } },
      body: { component },
    });
    if (data) {
      setTray(data.items);
      done();
    } else setSaid(refusalWords(error, words('document.that-part-could-not-be')));
  };

  /** A conversation of this document's opened, or none: a new one, begun by the next ask. */
  const open = (id: string | null) => {
    setHeld(null);
    openNow.current = id;
    setConversation(id);
    setOpened(null);
    setNaming(null);
    setFinding(false);
    setFound([]);
    setLooking('');
    setReused(null);
    setSaid('');
    setTurns([]);
    setCurrent(null);
    setAsked(null);
    setAnswer('');
    setProposals([]);
    setSteps([]);
    setEnded(null);
    setTray([]);
    setPending([]);
    if (id !== null) void readTurns(id).catch(() => undefined);
  };

  /** The open conversation named, or kept or let go, by its owner (the DQ plan). */
  const change = async (body: { title?: string; kept?: boolean }) => {
    if (conversation === null) return;
    const id = conversation;
    const { data, error } = await client.PATCH('/v1/conversations/{id}', {
      params: { path: { id } },
      body,
    });
    if (openNow.current !== id) return;
    if (!data) {
      setSaid(refusalWords(error, words('document.the-conversation-could-not-be-changed')));
      return;
    }
    setOpened({ title: data.title, kept: data.kept });
    await readConversations().catch(() => undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await send(ask);
  };

  /** An ask sent as a turn of the conversation open, or of a new one. */
  const send = async (text: string) => {
    if (text.trim() === '' || running) return;
    // A first ask starts a conversation of this document's, named by its words (G5-A).
    let id = conversation;
    if (id === null) {
      const { data, error } = await client.POST('/v1/conversations', {
        body: { ...(document === null ? {} : { document }), title: text.trim() },
      });
      if (!data) {
        setSaid(refusalWords(error, words('document.the-conversation-could-not-be')));
        return;
      }
      id = data.conversation.id;
      openNow.current = id;
      setConversation(id);
      setOpened({ title: data.conversation.title, kept: data.conversation.kept });
      setTurns([]);
      // The parts added before it began, given to it before the turn reads them.
      for (const part of pending) {
        const given = await client.POST('/v1/conversations/{id}/context', {
          params: { path: { id } },
          body: { component: part },
        });
        if (given.data) setTray(given.data.items);
      }
      setPending([]);
    }
    setAsked(text.trim());
    // The box emptied as it sends, so a sent ask never looks unsent; only the words sent, so what was
    // typed since, asking again, stays (issue #868).
    setAsk((was) => (was.trim() === text.trim() ? '' : was));
    await run(`${origin}/v1/conversations/${id}/turns`, {
      ask: text.trim(),
      ...(chosen === '' ? {} : { endpoint: chosen }),
      ...(asking === null ? {} : { component: asking }),
      ...(document === null ? {} : { context: given }),
    });
    setHeld(null);
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
    setReceived(0);
    firstToken.current = null;
    lastToken.current = null;
    setRate(null);
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
            if (typeof frame.tokens === 'number') {
              const seen = { at: now(), tokens: frame.tokens };
              firstToken.current ??= seen;
              lastToken.current = seen;
            }
            setAnswer((was) => was + String(frame.text));
            if (typeof frame.tokens === 'number') setReceived(frame.tokens);
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
                      said: frame.said as StepSaid | undefined,
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
          case 'ended': {
            setEnded(frame as unknown as Ended);
            const first = firstToken.current;
            const last = lastToken.current;
            // Unmeasured where the reply came in one piece.
            if (first !== null && last !== null && last.at - first.at >= 250) {
              setRate((last.tokens - first.tokens) / ((last.at - first.at) / 1000));
            }
            break;
          }
          case 'failed':
            setSaid(failedWords(frame));
            break;
        }
      },
    });
    if (outcome.kind === 'refused') {
      const body = outcome.body as { message?: string } | null;
      setSaid(body?.message ?? words('document.the-assistant-could-not-be'));
    } else if (outcome.kind === 'failed') {
      setSaid(words('document.the-assistant-stopped-answering'));
    } else if (outcome.kind === 'stopped') {
      setSaid(words('document.stopped'));
    }
    stop.current = null;
    setRunning(false);
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
                      ? words('document.accepted-the-part-is-made')
                      : words('document.accepted-it-is-a-new')
                    : data.proposal.state === 'kept'
                      ? words('document.kept-as-a-suggestion-marked')
                      : words('document.discarded'),
              }
            : {
                ...each,
                said:
                  (error as { message?: string } | undefined)?.message ??
                  words('document.it-could-not-be-done'),
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
  // The page steps through what the answer cited (the DP plan): told once the answer ends.
  const citedKey = cited.map((each) => `${each.component}#${each.block}`).join(' ');
  useEffect(() => {
    onCitations?.(cited);
    // Told when the set changes, not on every render that computes it anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citedKey]);

  // The last turn measured against the context window of the endpoint that ran it, in Diariz's three
  // bands: what its last call took in, the conversation as it then stood, not the run's sum.
  const window_ = endpoints.find((each) => each.name === endpoint?.name)?.contextWindow;
  const percent =
    ended?.contextTokens == null || window_ === undefined
      ? null
      : Math.round((ended.contextTokens / window_) * 100);
  const measured =
    percent === null
      ? null
      : { percent, band: percent < 50 ? 'low' : percent < 75 ? 'mid' : 'high' };

  // Each citation kept is a button to the part it names, numbered as Sources lists it.
  const cite = (component: string, block: string, key: string) => {
    const at = cited.findIndex((each) => each.component === component && each.block === block);
    return at === -1 ? null : (
      <button
        key={key}
        type="button"
        className={styles['cite']}
        aria-label={words('document.source-n', { number: at + 1 })}
        onClick={() => onCite(cited[at]!.component, cited[at]!.block)}
      >
        {formats().number(at + 1)}
      </button>
    );
  };

  const endpointNow = endpoints.find((each) => each.id === chosen);
  const modelName = (each: { name: string; boundary: string }) =>
    each.boundary === 'outside'
      ? words('document.outside-your-data-boundary', { name: each.name })
      : each.name;

  return (
    <section className={styles['assistant']} aria-label={words('document.assistant')}>
      <div className={styles['bar']}>
        <h2 className={styles['title']}>{words('document.assistant')}</h2>
        <Toolbar label={words('document.conversation')} className={styles['tools']}>
          {endpointNow !== undefined && (
            <MenuButton
              label={words('document.model', { name: modelName(endpointNow) })}
              className={styles['model']}
              disabled={running}
              face={
                <>
                  <span className={styles['modelName']}>{endpointNow.name}</span>
                  {endpointNow.boundary === 'outside' && (
                    <span className={styles['outside']}>{words('document.outside')}</span>
                  )}
                  <Icon name="Chevron down" size={12} />
                </>
              }
              items={endpoints.map((each) => ({
                key: each.id,
                label: each.name,
                detail:
                  each.boundary === 'outside'
                    ? words('document.outside-your-boundary')
                    : words('document.inside-your-boundary'),
                checked: each.id === chosen,
                onSelect: () => setChosen(each.id),
              }))}
            />
          )}
          {measured !== null && (
            <span
              role="img"
              className={styles['gauge']}
              data-band={measured.band}
              aria-label={words('document.context-used', { percent: measured.percent })}
              title={words('document.context-used', { percent: measured.percent })}
            >
              <span
                className={styles['gaugeRing']}
                style={{ '--used': `${Math.min(measured.percent, 100)}%` } as React.CSSProperties}
                aria-hidden="true"
              />
              {formats().number(measured.percent)}%
            </span>
          )}
          <span className={styles['spacer']} />
          <IconButton
            ref={promptsButton}
            label={words('document.prompts')}
            aria-haspopup="dialog"
            aria-expanded={offering}
            onClick={() => setOffering((was) => !was)}
          >
            <Icon name="Prompts" size={16} />
          </IconButton>
          <MenuButton
            label={words('document.earlier-conversations')}
            align="end"
            wide
            disabled={running}
            face={<Icon name="Versions" size={16} />}
            empty={words('document.none-kept-yet')}
            items={conversations.map((each) => ({
              key: each.id,
              label: each.title,
              detail: formats().date(new Date(each.madeAt), {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
              onSelect: () => open(each.id),
            }))}
          />
          <IconButton
            ref={nameButton}
            label={words('document.name-this-conversation')}
            pressed={naming !== null}
            disabled={running || opened === null}
            onClick={() => setNaming(naming === null ? (opened?.title ?? '') : null)}
          >
            <Icon name="Rename" size={16} />
          </IconButton>
          <IconButton
            label={words('document.keep-this-conversation')}
            pressed={opened?.kept ?? false}
            disabled={running || opened === null}
            onClick={() => void change({ kept: !(opened?.kept ?? false) })}
          >
            <Icon name="Keep" size={16} />
          </IconButton>
          <IconButton
            label={words('document.a-new-conversation')}
            disabled={running || conversation === null}
            onClick={() => open(null)}
          >
            <Icon name="Add" size={16} />
          </IconButton>
        </Toolbar>
        {offering && (
          <Popup
            label={words('document.prompts')}
            opener={promptsButton}
            onClose={() => setOffering(false)}
            className={styles['promptsPopup']}
          >
            <PersonalPrompts client={client} asking={ask} onUse={setAsk} />
            {prompts.length > 0 && (
              <section aria-label={words('document.prompts')} className={styles['prompts']}>
                <h3>{words('document.prompts')}</h3>
                {node === null ? (
                  <p className={styles['muted']}>{words('document.open-a-part-to-run')}</p>
                ) : (
                  <ul>
                    {prompts.map((each) => (
                      <li key={each.id}>
                        <span>{each.title}</span>{' '}
                        <button
                          type="button"
                          disabled={running}
                          aria-label={words('document.run-on-this-part', { title: each.title })}
                          onClick={() => {
                            setAsked(null);
                            void run(`${origin}/v1/documents/${document}/prompt-runs`, {
                              prompt: each.id,
                              node,
                            });
                          }}
                        >
                          {words('document.run')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </Popup>
        )}
      </div>
      <div ref={scroller} className={styles['scroll']}>
        {/* The name while it is written; never the title over the turns, which says the first ask
        again (issue #871). */}
        {naming !== null && (
          <div className={styles['named']}>
            {
              <input
                aria-label={words('document.the-conversation-s-name')}
                value={naming}
                maxLength={200}
                autoFocus
                onChange={(typed) => setNaming(typed.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setNaming(null);
                    nameButton.current?.focus();
                  } else if (event.key === 'Enter' && naming.trim() !== '') {
                    event.preventDefault();
                    setNaming(null);
                    nameButton.current?.focus();
                    void change({ title: naming.trim() });
                  }
                }}
              />
            }
          </div>
        )}
        {turns.filter((each) => each.run !== current).length > 0 && (
          <ol aria-label={words('document.earlier-turns')} className={styles['turns']}>
            {turns
              .filter((each) => each.run !== current)
              .map((each) => (
                <li key={each.run} className={styles['turn']}>
                  {each.ask !== null && (
                    <p className={styles['asked']}>
                      <span className={styles['hidden']}>{words('document.you')} </span> {each.ask}
                    </p>
                  )}
                  <div className={styles['answer']}>
                    {each.outcome === 'finished' ? (
                      // An earlier turn's citations were numbered with its own Sources, not shown now.
                      <AnswerMarkdown text={each.reply ?? ''} cite={() => null} />
                    ) : each.outcome === 'running' ? (
                      words('document.still-answering')
                    ) : (
                      words('document.this-turn-did-not-finish')
                    )}
                  </div>
                </li>
              ))}
          </ol>
        )}
        {(asked !== null || running || answer !== '' || ended !== null || proposals.length > 0) && (
          <article aria-label={words('document.this-turn')} className={styles['turn']}>
            {asked !== null && (
              <p ref={askedNow} className={styles['asked']}>
                <span className={styles['hidden']}>{words('document.you')} </span> {asked}
              </p>
            )}
            {endpoint !== null &&
              (endpoint.name !== endpointNow?.name ||
                endpoint.boundary !== endpointNow.boundary) && (
                <p className={styles['muted']}>
                  {words('document.using', { name: endpoint.name, boundary: endpoint.boundary })}
                </p>
              )}
            {running && (
              <>
                {/* What it is doing now, as Diariz says it: the step it took last, and the reply's
                tokens so far on the same line (issue #864). */}
                <p className={styles['doing']} data-doing="" aria-live="polite">
                  <span className={styles['pulse']} aria-hidden="true" />
                  {steps.length > 0 ? stepLine(steps.at(-1)!) : words('document.answering')}
                  <span
                    role="progressbar"
                    aria-label={words('document.answering')}
                    aria-valuetext={words('document.answering-tokens', { count: received })}
                    className={styles['streaming']}
                  >
                    {words('document.tokens-so-far', { count: received })}
                  </span>
                </p>
              </>
            )}
            <div
              role="region"
              aria-label={words('document.the-answer')}
              aria-live="polite"
              className={styles['answer']}
            >
              <AnswerMarkdown text={answer} cite={cite} />
            </div>
            {/* Announced as each arrives, as the answer is (GEN-021). */}
            <div aria-live="polite">
              {notices.length > 0 && (
                <ul
                  aria-label={words('document.instructions-not-followed')}
                  className={styles['muted']}
                >
                  {notices.map((each, index) => (
                    <li key={index}>
                      {words('document.instruction-not-done', {
                        where:
                          nameOf(each.where) ??
                          titles.get(each.where) ??
                          words('document.something-it-read'),
                        instruction: each.instruction,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {cited.length > 0 && (
              <ol aria-label={words('document.sources')} className={styles['sources']}>
                {cited.map((each) => (
                  <li key={`${each.component}#${each.block}`}>
                    <button
                      type="button"
                      className={styles['link']}
                      onClick={() => onCite(each.component, each.block)}
                    >
                      {words('document.part-block', {
                        part: nameOf(each.component) ?? words('document.a-part'),
                        block: each.block,
                      })}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {ended?.refused !== undefined && (
              <p role="status">{proposedNothingWords(ended.refusal, ended.refused)}</p>
            )}
            {ended !== null && ended.dropped.length > 0 && (
              <p className={styles['muted']}>
                {words('document.citations-were', { count: ended.dropped.length })}{' '}
                {words('document.left-out-it-named-text')}
              </p>
            )}
            {steps.length > 0 && (
              <details className={styles['steps']}>
                <summary>{words('document.what-it-did', { count: steps.length })}</summary>
                <ol>
                  {steps.map((step) => (
                    <li key={step.id}>
                      {stepLine(step)}
                      {step.result !== undefined && (
                        <pre className={styles['result']}>{step.result}</pre>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {proposals.map((proposal) => (
              <article
                key={proposal.id}
                className={styles['proposal']}
                aria-label={words('document.proposal', { number: proposal.number })}
              >
                <h3>
                  {words('document.proposal-of', {
                    number: proposal.number,
                    what:
                      proposal.creates !== null
                        ? words('document.a-new-part', { title: proposal.creates.title })
                        : ((proposal.component === null ? undefined : nameOf(proposal.component)) ??
                          words('document.a-part-2')),
                  })}
                </h3>
                <pre className={styles['proposed']}>
                  <ins>{proposedText(proposal.proposed, proposal.cites)}</ins>
                </pre>
                {proposal.component !== null && (
                  <button
                    type="button"
                    className={styles['link']}
                    onClick={() => onCite(proposal.component!, '')}
                  >
                    {words('document.show-in-page')}
                  </button>
                )}
                {proposal.cites !== null && (
                  <p className={styles['muted']}>
                    {words('document.cites-work', {
                      title: proposal.cites.title ?? words('document.a-work'),
                      scheme: proposal.cites.source === 'pubmed' ? 'pubmed' : 'doi',
                      identifier: proposal.cites.identifier,
                      source: proposal.cites.source,
                    })}
                  </p>
                )}
                {proposal.state === 'open' && running ? (
                  <p className={styles['muted']}>{words('document.it-can-be-acted-on')}</p>
                ) : proposal.state === 'open' ? (
                  <div className={styles['actions']}>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void act(proposal, 'acceptance')}
                    >
                      {words('document.accept')}
                    </button>
                    {proposal.creates === null && proposal.cites === null && (
                      <button type="button" onClick={() => void act(proposal, 'keeping')}>
                        {words('document.keep-as-suggestion')}
                      </button>
                    )}
                    <button type="button" onClick={() => void act(proposal, 'discarding')}>
                      {words('document.discard')}
                    </button>
                  </div>
                ) : null}
                {proposal.said !== undefined && <p role="status">{proposal.said}</p>}
              </article>
            ))}
            {ended !== null && (
              <p className={styles['muted']}>
                {ended.tokensIn === null
                  ? words('document.no-tokens-were-reported')
                  : // The cost where the run incurred one (GEN-037), never a free run's zero (#871).
                    ended.cost === null || Number(ended.cost) === 0
                    ? words('document.tokens-in-out', {
                        tokensIn: ended.tokensIn,
                        tokensOut: ended.tokensOut,
                      })
                    : words('document.tokens-in-out-cost', {
                        tokensIn: ended.tokensIn,
                        tokensOut: ended.tokensOut,
                        currency: ended.currency,
                        cost: ended.cost,
                      })}
                {rate !== null &&
                  ` ${words('document.tokens-a-second', { rate: formats().number(Math.round(rate)) })}`}
              </p>
            )}
            {!running && asked !== null && answer !== '' && (
              <div className={styles['turnActions']}>
                <IconButton
                  label={words('document.copy-the-answer')}
                  className={styles['quiet']}
                  onClick={() =>
                    void navigator.clipboard?.writeText(answer.replace(CITATION_MARK, ''))
                  }
                >
                  <Icon name="Copy" size={14} />
                </IconButton>
                <IconButton
                  label={words('document.ask-again')}
                  className={styles['quiet']}
                  onClick={() => void send(asked)}
                >
                  <Icon name="Retry" size={14} />
                </IconButton>
              </div>
            )}
          </article>
        )}
        {reused && (
          <p className={styles['muted']}>
            {words('document.from-your-earlier-run-of')}{' '}
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
              {words('document.run-afresh')}
            </button>
          </p>
        )}
      </div>
      <div className={styles['composer']}>
        <div role="group" aria-label={words('document.what-it-reads')} className={styles['chips']}>
          {document !== null && (
            <Segmented
              label={words('document.context')}
              className={styles['scopes']}
              value={given}
              disabled={running}
              onChange={(value) => setScope(value as 'component' | 'document')}
              options={[
                { value: 'document', name: words('document.all-components') },
                {
                  value: 'component',
                  name: words('document.current-component'),
                  disabled: asking === null,
                },
              ]}
            />
          )}
          {[
            ...tray,
            ...pending.map((part) => ({ component: part, version: null, readable: true })),
          ].map((each) => {
            const title =
              nameOf(each.component) ?? titles.get(each.component) ?? words('document.a-part');
            return (
              <span key={each.component} className={styles['chip']}>
                {each.readable ? title : words('document.a-part-you-may-no')}
                <IconButton
                  label={words('document.remove', {
                    value1: each.readable
                      ? title
                      : words('document.the-part-you-may-no-longer-read'),
                  })}
                  className={styles['chipRemove']}
                  onClick={() => void removePart(each.component)}
                >
                  <Icon name="Close" size={12} />
                </IconButton>
              </span>
            );
          })}
          <button
            ref={addButton}
            type="button"
            className={styles['addPart']}
            aria-haspopup="dialog"
            aria-expanded={finding}
            onClick={() => setFinding((was) => !was)}
          >
            <Icon name="Add" size={12} />
            {words('document.add-a-part')}
          </button>
          {finding && (
            <Popup
              label={words('document.add-a-part')}
              opener={addButton}
              onClose={() => setFinding(false)}
              className={styles['finder']}
            >
              <form
                className={styles['look']}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (looking.trim() !== '') void look();
                }}
              >
                <input
                  aria-label={words('document.find-a-part-to-add')}
                  placeholder={words('document.find-a-part-to-add')}
                  value={looking}
                  onChange={(change) => setLooking(change.target.value)}
                />
                <button type="submit" disabled={looking.trim() === ''}>
                  {words('document.find')}
                </button>
              </form>
              {found.length > 0 && (
                <ul aria-label={words('document.parts-found')} className={styles['found']}>
                  {found.map((each) => (
                    <li key={each.id}>
                      <span>{each.title}</span>
                      <button
                        type="button"
                        aria-label={words('document.add', { title: each.title })}
                        onClick={() => void addPart(each.id, each.title)}
                      >
                        {words('document.add-2')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popup>
          )}
        </div>
        <form onSubmit={(event) => void submit(event)} className={styles['box']}>
          <label className={styles['askLabel']}>
            <span className={styles['hidden']}>{words('document.ask-the-assistant')}</span>
            <textarea
              ref={box}
              value={ask}
              rows={2}
              placeholder={words('document.ask-about-this-document')}
              onChange={(typed) => setAsk(typed.target.value)}
              onFocus={() => {
                inBox.current = true;
                setHeld(component);
              }}
              onBlur={() => {
                inBox.current = false;
              }}
              onKeyDown={(event) => {
                // Enter asks; Shift and Enter starts a new line (Diariz's composer).
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                void send(ask);
              }}
            />
          </label>
          <div className={styles['composerFoot']}>
            <span className={styles['hint']}>{words('document.enter-asks')}</span>
            <span className={styles['spacer']} />
            {/* Stop where Ask was, while it answers (Diariz's send that becomes stop). */}
            {running ? (
              <IconButton
                label={words('document.stop')}
                className={styles['stop']}
                onClick={() => stop.current?.abort()}
              >
                <span className={styles['stopMark']} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton
                label={words('document.ask')}
                type="submit"
                className={styles['send']}
                disabled={ask.trim() === ''}
              >
                <Icon name="Send" size={16} />
              </IconButton>
            )}
          </div>
        </form>
      </div>
      <p role="status" className={styles['said']}>
        {said}
      </p>
    </section>
  );
}
