import type { createApiClient } from '@alloy-works/api-client';
import type { TemplateParameter } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import type { SaveAnswer } from '../metadata/HeldFields.js';
import styles from '../metadata/FieldsForm.module.css';
import {
  declarationsIn,
  ParameterInput,
  refusedParameters,
  valuesToSend,
  type ParameterValue,
} from './ParameterInput.js';

type Client = ReturnType<typeof createApiClient>;

/** What a save of the parameters came to, and the service's refusal where it refused. */
export interface ParametersSaved {
  readonly answer: SaveAnswer;
  readonly refusal?: unknown;
}

/** One entry of the history, as `GET /v1/documents/{id}/parameters` answers it, checked. */
interface Change {
  readonly version: string;
  readonly number: string;
  readonly createdAt: string;
  readonly author: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly changed: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function changesIn(value: unknown): Change[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each: unknown) => {
    if (!isRecord(each) || !isRecord(each.version) || !isRecord(each.parameters)) return [];
    const { id, number } = each.version;
    if (typeof id !== 'string' || typeof number !== 'string') return [];
    if (typeof each.createdAt !== 'string' || !Array.isArray(each.changed)) return [];
    const author =
      isRecord(each.author) && typeof each.author.name === 'string' ? each.author.name : null;
    return [
      {
        version: id,
        number,
        createdAt: each.createdAt,
        author,
        parameters: each.parameters,
        changed: each.changed.filter((name): name is string => typeof name === 'string'),
      },
    ];
  });
}

/** A value as the history says it: a list's entries one after another, none as removed. */
function shown(value: unknown): string {
  if (value === undefined || value === null) return 'removed';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

/** The values a document holds, as the panel's inputs hold them. */
function heldOf(values: Readonly<Record<string, unknown>>): Record<string, ParameterValue> {
  const held: Record<string, ParameterValue> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'boolean') held[name] = value;
    else if (Array.isArray(value)) {
      held[name] = value.filter(
        (each): each is string | boolean => typeof each === 'string' || typeof each === 'boolean',
      );
    }
  }
  return held;
}

/** Compared whole, members in one order, so an answer's own order never reads as a change. */
const canonical = (values: Readonly<Record<string, unknown>>) =>
  JSON.stringify(
    Object.keys(values)
      .sort()
      .map((name) => [name, values[name]]),
  );

const PAGE = '50';

export interface ParametersPanelProps {
  readonly client: Client;
  readonly document: string;
  /** The version the page holds: the history is read again when it moves. */
  readonly version: string;
  /** The parameters as the page's latest `DocumentView` holds them. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  /** Saves the parameters, whole, as the document's next version. */
  readonly onSave: (parameters: Record<string, ParameterValue>) => Promise<ParametersSaved>;
  /** How long after the last change the parameters are saved: each save is a version. */
  readonly delayMs?: number;
}

/**
 * A document's parameters (templates.md, "Recorded on the document"; the TP1 plan, TP1-I): each value
 * by its type, the changeable ones editable where the author may edit and saved a pause after the
 * last change - each save a version, as a document's fields are - the fixed ones read only; and a
 * **History** disclosure of each change, who made it and when (TPL-020), a page at a time from
 * `GET /v1/documents/{id}/parameters`. Nothing at all for a document whose template declares none.
 */
export function ParametersPanel(props: ParametersPanelProps) {
  const { client, document, version } = props;
  const id = useId();
  const [declared, setDeclared] = useState<readonly TemplateParameter[] | 'failed' | null>(null);
  const [history, setHistory] = useState<{
    readonly at: string;
    readonly changes: readonly Change[];
    readonly next: string | null;
  } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [reading, setReading] = useState(false);
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [held, setHeld] = useState<Record<string, ParameterValue>>(() => heldOf(props.values));
  const heldNow = useRef(held);
  heldNow.current = held;
  const waiting = useRef<Record<string, ParameterValue> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useRef(props.onSave);
  save.current = props.onSave;
  const declaredNow = useRef<readonly TemplateParameter[]>([]);
  declaredNow.current = Array.isArray(declared) ? declared : [];
  const delay = props.delayMs ?? 800;

  /** A page of the history, the first or the one after `cursor`, with the declarations. */
  const read = useCallback(
    async (cursor: string | null) => {
      setReading(true);
      try {
        const { data } = await client.GET('/v1/documents/{id}/parameters', {
          params: {
            path: { id: document },
            query: { limit: PAGE, ...(cursor === null ? {} : { cursor }) },
          },
        });
        if (!isRecord(data)) {
          if (cursor === null) setDeclared((was) => (Array.isArray(was) ? was : 'failed'));
          return;
        }
        setDeclared(declarationsIn(data.declarations));
        const changes = changesIn(data.history);
        const next = typeof data.next === 'string' ? data.next : null;
        setHistory((was) => ({
          at: version,
          changes: cursor === null || was === null ? changes : [...was.changes, ...changes],
          next,
        }));
      } catch {
        if (cursor === null) setDeclared((was) => (Array.isArray(was) ? was : 'failed'));
      } finally {
        setReading(false);
      }
    },
    [client, document, version],
  );

  // The declarations and the first page when the document opens; the history again, while it is
  // shown, whenever the document moves to another version.
  const readFirst = useRef(read);
  readFirst.current = read;
  useEffect(() => {
    void readFirst.current(null);
  }, [document]);
  useEffect(() => {
    if (showHistory && history !== null && history.at !== version) void read(null);
  }, [showHistory, history, version, read]);

  // Taken back only where it says something the panel does not hold, and nothing typed is waiting.
  const stored = canonical(props.values);
  useEffect(() => {
    if (waiting.current !== null || stored === canonical(heldNow.current)) return;
    setHeld(heldOf(Object.fromEntries(JSON.parse(stored) as [string, unknown][])));
  }, [stored]);

  const send = useCallback((values: Record<string, ParameterValue>) => {
    return save.current(valuesToSend(declaredNow.current, values)).then((saved) => {
      if (saved.answer === 'saved') setProblems(new Map());
      if (saved.answer === 'refused') setProblems(refusedParameters(saved.refusal));
      return saved.answer;
    });
  }, []);

  // Torn down with something typed and not yet sent, it is sent now rather than dropped.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      const values = waiting.current;
      waiting.current = null;
      if (values !== null) void send(values);
    },
    [send],
  );

  const schedule = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const values = waiting.current;
      if (values === null) return;
      void send(values).then((answer) => {
        // Typed again while this was on the wire: that is the next save, already waiting.
        if (waiting.current !== values) return;
        if (answer === 'unsent') {
          schedule();
          return;
        }
        waiting.current = null;
      });
    }, delay);
  };

  if (declared === null) return null;
  const headingId = `${id}-heading`;
  if (declared === 'failed') {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId}>Parameters</h2>
        <p>The parameters could not be loaded.</p>
        <button type="button" disabled={reading} onClick={() => void read(null)}>
          Try again
        </button>
      </section>
    );
  }
  const withheld = declared.length === 0;
  // Declarations withheld from a reader of the document who may not read its template: the values
  // alone, by name and read only. Nothing at all where there are neither.
  if (withheld && Object.keys(props.values).length === 0) return null;
  const historyId = `${id}-history`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Parameters</h2>
      {withheld && (
        <dl>
          {Object.keys(props.values)
            .sort()
            .map((name) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{shown(props.values[name])}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className={styles['form']}>
        {declared.map((parameter) => {
          const fixed = !parameter.changeable;
          return (
            <ParameterInput
              key={parameter.name}
              parameter={parameter}
              id={`${id}-${parameter.name}`}
              value={held[parameter.name]}
              readOnly={props.readOnly || fixed}
              {...(fixed ? { note: 'Fixed when the document was made.' } : {})}
              {...(problems.has(parameter.name) ? { problem: problems.get(parameter.name)! } : {})}
              onChange={(value) => {
                const next = { ...heldNow.current, [parameter.name]: value };
                setHeld(next);
                waiting.current = next;
                schedule();
              }}
            />
          );
        })}
      </div>
      <button
        type="button"
        aria-expanded={showHistory}
        aria-controls={historyId}
        onClick={() => setShowHistory((was) => !was)}
      >
        History
      </button>
      <div id={historyId} hidden={!showHistory}>
        {history !== null && (
          <ol aria-label="Changes to the parameters" className={styles['many']}>
            {history.changes.map((change) => (
              <li key={change.version}>
                {`Version ${change.number}, by ${change.author ?? 'somebody'}, `}
                <time dateTime={change.createdAt}>{whenChanged(change.createdAt)}</time>
                {`: ${change.changed
                  .map((name) => `${name} ${shown(change.parameters[name])}`)
                  .join(', ')}`}
              </li>
            ))}
          </ol>
        )}
        {history?.next != null && (
          <button type="button" disabled={reading} onClick={() => void read(history.next)}>
            Show more changes
          </button>
        )}
      </div>
    </section>
  );
}
