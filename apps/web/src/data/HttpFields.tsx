import { Choice } from './Choice.js';
import type { ParameterDraft } from './definitionDraft.js';
import { NEW_PAIR, NEW_PART, type HttpDraft, type PairDraft, type PartDraft } from './httpDraft.js';
import styles from './QueryDefinitionPage.module.css';

/**
 * An HTTP connection's half of a query definition's Query step (the D6 plan, D6-E): the method, each
 * path segment, query pair, header and body member either fixed text or one of the parameters below,
 * and where the rows are in what the API answers. A value is never typed into a URL: it is placed by
 * its position, which refuses what it cannot carry.
 */

/** A part's value: fixed text, or a parameter chosen by name. */
function PartField({
  label,
  part,
  parameters,
  onChange,
}: {
  readonly label: string;
  readonly part: PartDraft;
  readonly parameters: readonly ParameterDraft[];
  readonly onChange: (part: PartDraft) => void;
}) {
  return (
    <>
      <Choice label={`${label}: fixed or a parameter`}>
        {(id) => (
          <select
            id={id}
            value={part.kind}
            onChange={(event) =>
              onChange({
                kind: event.target.value as PartDraft['kind'],
                text: event.target.value === 'parameter' ? (parameters[0]?.name ?? '') : '',
              })
            }
          >
            <option value="fixed">Fixed</option>
            <option value="parameter">Parameter</option>
          </select>
        )}
      </Choice>
      {part.kind === 'fixed' ? (
        <label>
          {label}
          <input
            value={part.text}
            spellCheck={false}
            onChange={(event) => onChange({ ...part, text: event.target.value })}
          />
        </label>
      ) : (
        <Choice label={`${label} parameter`}>
          {(id) => (
            <select
              id={id}
              value={part.text}
              onChange={(event) => onChange({ ...part, text: event.target.value })}
            >
              {part.text === '' && <option value="">Choose a parameter</option>}
              {parameters.map((parameter) => (
                <option key={parameter.name} value={parameter.name}>
                  {parameter.name}
                </option>
              ))}
            </select>
          )}
        </Choice>
      )}
    </>
  );
}

/** A named list of pairs: query pairs, headers or body members. */
function Pairs({
  legend,
  noun,
  pairs,
  parameters,
  onChange,
}: {
  readonly legend: string;
  readonly noun: string;
  readonly pairs: readonly PairDraft[];
  readonly parameters: readonly ParameterDraft[];
  readonly onChange: (pairs: PairDraft[]) => void;
}) {
  const set = (at: number, pair: PairDraft) =>
    onChange(pairs.map((held, place) => (place === at ? pair : held)));
  return (
    <fieldset className={styles['parameter']}>
      <legend>{legend}</legend>
      {pairs.map((pair, at) => (
        <div key={at} className={styles['fragment']}>
          <label>
            {`${noun} ${at + 1} name`}
            <input
              value={pair.name}
              spellCheck={false}
              onChange={(event) => set(at, { ...pair, name: event.target.value })}
            />
          </label>
          <PartField
            label={`${noun} ${at + 1} value`}
            part={pair.value}
            parameters={parameters}
            onChange={(value) => set(at, { ...pair, value })}
          />
          <button type="button" onClick={() => onChange(pairs.filter((_, place) => place !== at))}>
            {`Remove ${noun.toLowerCase()} ${at + 1}`}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...pairs, NEW_PAIR])}>
        {`Add ${noun.toLowerCase()}`}
      </button>
    </fieldset>
  );
}

export function HttpFields({
  http,
  parameters,
  onChange,
}: {
  readonly http: HttpDraft;
  readonly parameters: readonly ParameterDraft[];
  readonly onChange: (http: HttpDraft) => void;
}) {
  const setSegment = (at: number, part: PartDraft) =>
    onChange({ ...http, path: http.path.map((held, place) => (place === at ? part : held)) });
  return (
    <div className={styles['form']}>
      <Choice label="Method">
        {(id) => (
          <select
            id={id}
            value={http.method}
            onChange={(event) =>
              onChange({ ...http, method: event.target.value as 'GET' | 'POST' })
            }
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        )}
      </Choice>
      <fieldset className={styles['parameter']}>
        <legend>Path, after the connection&apos;s base URL</legend>
        {http.path.map((part, at) => (
          <div key={at} className={styles['fragment']}>
            <PartField
              label={`Segment ${at + 1}`}
              part={part}
              parameters={parameters}
              onChange={(changed) => setSegment(at, changed)}
            />
            <button
              type="button"
              onClick={() =>
                onChange({ ...http, path: http.path.filter((_, place) => place !== at) })
              }
            >
              {`Remove segment ${at + 1}`}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...http, path: [...http.path, NEW_PART] })}>
          Add segment
        </button>
      </fieldset>
      <Pairs
        legend="Query"
        noun="Pair"
        pairs={http.query}
        parameters={parameters}
        onChange={(query) => onChange({ ...http, query })}
      />
      <Pairs
        legend="Headers"
        noun="Header"
        pairs={http.headers}
        parameters={parameters}
        onChange={(headers) => onChange({ ...http, headers })}
      />
      {http.method === 'POST' && (
        <Pairs
          legend="Body, a JSON object"
          noun="Member"
          pairs={http.body}
          parameters={parameters}
          onChange={(body) => onChange({ ...http, body })}
        />
      )}
      <Choice label="The answer is">
        {(id) => (
          <select
            id={id}
            value={http.format}
            onChange={(event) =>
              onChange({ ...http, format: event.target.value as HttpDraft['format'] })
            }
          >
            <option value="json">JSON</option>
            <option value="jsonLines">JSON Lines, an object a line</option>
          </select>
        )}
      </Choice>
      {http.format === 'json' && (
        <>
          <label>
            Rows at
            <input
              value={http.rows}
              spellCheck={false}
              placeholder="/data/items"
              onChange={(event) => onChange({ ...http, rows: event.target.value })}
            />
          </label>
          <label>
            Row count at, where the answer states one
            <input
              value={http.count}
              spellCheck={false}
              onChange={(event) => onChange({ ...http, count: event.target.value })}
            />
          </label>
          <p className={styles['hint']}>
            Each is a JSON Pointer: empty for the whole answer, or each name after a /. A stated
            count is checked against the rows read.
          </p>
        </>
      )}
      <p className={styles['hint']}>
        A parameter&apos;s value is placed where it stands and encoded for it: a path segment
        refuses a slash, . and .., and a header a line break. The connection&apos;s secret is sent
        in its own header, which a request may not name.
      </p>
    </div>
  );
}
