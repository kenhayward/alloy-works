import { Choice } from './Choice.js';
import { FormatFields } from './FormatFields.js';
import type { ParameterDraft } from './definitionDraft.js';
import { NEW_PAIR, NEW_PART, type HttpDraft, type PairDraft, type PartDraft } from './httpDraft.js';
import styles from './QueryDefinitionPage.module.css';
import { words } from '../words/words.js';

/**
 * An HTTP connection's half of a query definition's Query step (the D6 plan, D6-E): the method, each
 * path segment, query pair, header and body member either fixed text or one of the parameters below,
 * and where the rows are in what the API answers. A value is never typed into a URL: it is placed by
 * its position, which refuses what it cannot carry.
 */

/** A part's value: fixed text, or a parameter chosen by name. */
/** A part made fixed, emptied, or a parameter, the first offered. */
export const partOfKind = (
  kind: PartDraft['kind'],
  parameters: readonly ParameterDraft[],
): PartDraft => ({ kind, text: kind === 'parameter' ? (parameters[0]?.name ?? '') : '' });

export function PartField({
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
      <Choice label={words('data.fixed-or-a-parameter-2', { label })}>
        {(id) => (
          <select
            id={id}
            value={part.kind}
            onChange={(event) =>
              onChange(partOfKind(event.target.value as PartDraft['kind'], parameters))
            }
          >
            <option value="fixed">{words('data.fixed')}</option>
            <option value="parameter">{words('data.parameter')}</option>
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
        <Choice label={words('data.parameter-2', { label })}>
          {(id) => (
            <select
              id={id}
              value={part.text}
              onChange={(event) => onChange({ ...part, text: event.target.value })}
            >
              {part.text === '' && <option value="">{words('data.choose-a-parameter')}</option>}
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
  kind,
  pairs,
  parameters,
  onChange,
}: {
  readonly legend: string;
  readonly kind: 'pair' | 'header' | 'member';
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
            {words('data.pair-name', { kind, n: at + 1 })}
            <input
              value={pair.name}
              spellCheck={false}
              onChange={(event) => set(at, { ...pair, name: event.target.value })}
            />
          </label>
          <PartField
            label={words('data.pair-value', { kind, n: at + 1 })}
            part={pair.value}
            parameters={parameters}
            onChange={(value) => set(at, { ...pair, value })}
          />
          <button type="button" onClick={() => onChange(pairs.filter((_, place) => place !== at))}>
            {words('data.remove-pair', { kind, n: at + 1 })}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...pairs, NEW_PAIR])}>
        {words('data.add-pair', { kind })}
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
      <Choice label={words('data.method')}>
        {(id) => (
          <select
            id={id}
            value={http.method}
            onChange={(event) =>
              onChange({ ...http, method: event.target.value as 'GET' | 'POST' })
            }
          >
            <option value="GET">{words('data.get')}</option>
            <option value="POST">{words('data.post')}</option>
          </select>
        )}
      </Choice>
      <fieldset className={styles['parameter']}>
        <legend>{words('data.path-after-the-connection-s')}</legend>
        {http.path.map((part, at) => (
          <div key={at} className={styles['fragment']}>
            <PartField
              label={words('data.segment-2', { n: at + 1 })}
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
              {words('data.remove-segment', { n: at + 1 })}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...http, path: [...http.path, NEW_PART] })}>
          {words('data.add-segment')}
        </button>
      </fieldset>
      <Pairs
        legend={words('data.query')}
        kind="pair"
        pairs={http.query}
        parameters={parameters}
        onChange={(query) => onChange({ ...http, query })}
      />
      <Pairs
        legend={words('data.headers')}
        kind="header"
        pairs={http.headers}
        parameters={parameters}
        onChange={(headers) => onChange({ ...http, headers })}
      />
      {http.method === 'POST' && (
        <Pairs
          legend={words('data.body-a-json-object')}
          kind="member"
          pairs={http.body}
          parameters={parameters}
          onChange={(body) => onChange({ ...http, body })}
        />
      )}
      <FormatFields draft={http} holder="answer" onChange={onChange} />
      <p className={styles['hint']}>{words('data.a-parameter-s-value-is')}</p>
    </div>
  );
}
