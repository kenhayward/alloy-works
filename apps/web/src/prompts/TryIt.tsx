import { streamPost, type createApiClient, type StreamPostOptions } from '@alloy-works/api-client';
import { useEffect, useRef, useState } from 'react';

import { isRecord } from '../data/shapes.js';
import { failedWords } from '../structure/runWords.js';
import styles from './PromptPage.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Part {
  readonly node: string;
  readonly label: string;
}

/** The text of a section's title, as its inline content says it. */
const titleOf = (title: unknown): string =>
  Array.isArray(title)
    ? title
        .map((each) => (isRecord(each) && typeof each.value === 'string' ? each.value : ''))
        .join('')
    : '';

/** Each part of an outline the reader may read, labelled by its place: "Part 2, in Results". */
export function partsOf(outline: unknown): Part[] {
  const parts: Part[] = [];
  const visit = (nodes: unknown, section: string | null) => {
    if (!Array.isArray(nodes)) return;
    for (const each of nodes) {
      if (!isRecord(each)) continue;
      if (
        each.type === 'reference' &&
        typeof each.id === 'string' &&
        typeof each.component === 'string'
      ) {
        parts.push({
          node: each.id,
          label:
            section === null
              ? words('prompts.part', { number: parts.length + 1 })
              : words('prompts.part-in-section', { number: parts.length + 1, section }),
        });
      }
      visit(each.children, each.type === 'section' ? titleOf(each.title) : section);
    }
  };
  visit(isRecord(outline) ? outline.nodes : [], null);
  return parts;
}

/**
 * A prompt version tried on a part of a document the reader may read (the G4 plan, G4-I; GN-F): the
 * same run as on the document, its output shown here and proposed nowhere. Approving the version
 * needs a finished trial of it.
 */
export function TryIt({
  client,
  prompt,
  version,
  onTried,
  stream = streamPost,
  origin = window.location.origin,
}: {
  client: Client;
  prompt: string;
  /** The version tried: the one the page shows. */
  version: string;
  /** A trial finished, so the page reads where the prompt stands again. */
  onTried: () => void;
  /** Given in tests. */
  stream?: (options: StreamPostOptions) => ReturnType<typeof streamPost>;
  origin?: string;
}) {
  const [documents, setDocuments] = useState<readonly { id: string; title: string }[]>([]);
  const [document, setDocument] = useState('');
  const [parts, setParts] = useState<readonly Part[]>([]);
  const [node, setNode] = useState('');
  const [output, setOutput] = useState('');
  const [said, setSaid] = useState('');
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => () => stop.current?.abort(), []);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/documents', { params: { query: { limit: '100' } } })
      .then(({ data }) => {
        if (current && data)
          setDocuments(data.items.map((each) => ({ id: each.id, title: each.title })));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    setParts([]);
    setNode('');
    if (document === '') return;
    let current = true;
    void client
      .GET('/v1/documents/{id}', { params: { path: { id: document } } })
      .then(({ data }) => {
        if (!current || !data) return;
        const found = partsOf(data.outline);
        setParts(found);
        setNode(found[0]?.node ?? '');
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, document]);

  const tryIt = async () => {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setOutput('');
    setSaid('');
    const outcome = await stream({
      url: `${origin}/v1/prompts/${prompt}/versions/${version}/trials`,
      body: { document, node },
      signal: controller.signal,
      onEvent: (name, data) => {
        const frame = data as Record<string, unknown>;
        if (name === 'text') setOutput((was) => was + String(frame.text));
        if (name === 'ended') {
          setSaid(
            frame.outcome !== 'finished'
              ? words('prompts.the-trial-did-not-finish')
              : frame.tokensIn === null
                ? words('prompts.tried-no-tokens-were-reported')
                : words('prompts.tried-tokens-in-out', {
                    tokensIn: Number(frame.tokensIn),
                    tokensOut: Number(frame.tokensOut),
                  }),
          );
        }
        if (name === 'failed') setSaid(failedWords(frame));
      },
    });
    if (outcome.kind === 'refused') {
      const body = outcome.body as { message?: string } | null;
      setSaid(body?.message ?? words('prompts.the-prompt-could-not-be-2'));
    } else if (outcome.kind === 'failed') {
      setSaid(words('prompts.the-trial-stopped-answering'));
    } else if (outcome.kind === 'stopped') {
      setSaid(words('prompts.stopped'));
    }
    stop.current = null;
    setRunning(false);
    if (outcome.kind === 'streamed') onTried();
  };

  return (
    <section aria-label={words('prompts.try-it')} className={styles['promptForm']}>
      <p className={styles['promptHint']}>{words('prompts.a-trial-runs-this-version')}</p>
      <label>
        {words('prompts.document')}
        <select value={document} onChange={(event) => setDocument(event.target.value)}>
          <option value="">{words('prompts.choose-a-document')}</option>
          {documents.map((each) => (
            <option key={each.id} value={each.id}>
              {each.title}
            </option>
          ))}
        </select>
      </label>
      {document !== '' && (
        <label>
          {words('prompts.part-2')}
          <select value={node} onChange={(event) => setNode(event.target.value)}>
            {parts.map((each) => (
              <option key={each.node} value={each.node}>
                {each.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={styles['source']}>
        <button
          type="button"
          className="primary"
          disabled={running || document === '' || node === ''}
          onClick={() => void tryIt()}
        >
          {words('prompts.try-it')}
        </button>
        {running && (
          <button type="button" onClick={() => stop.current?.abort()}>
            {words('prompts.stop')}
          </button>
        )}
      </div>
      {output !== '' && (
        <pre role="region" aria-label={words('prompts.what-it-wrote')} className={styles['output']}>
          {output}
        </pre>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
