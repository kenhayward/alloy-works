import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import {
  readStanding,
  RevisionChip,
  standingIn,
  TransitionButtons,
  type Standing,
} from '../lifecycle/Workflow.js';
import { everyPage } from '../paging.js';
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import { termLink, TERMS } from './links.js';
import { baseLabel, isSummary, said, type Summary, type Term } from './shape.js';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly term: Term;
  readonly archived: boolean;
  readonly deprecated: boolean;
  readonly mayEdit: boolean;
  readonly mayRetire: boolean;
}

interface Uses {
  readonly named: readonly { readonly id: string; readonly title: string }[];
  readonly unreadable: boolean;
}

const RELATIONS = [
  { key: 'broader', label: 'Broader' },
  { key: 'narrower', label: 'Narrower' },
  { key: 'related', label: 'Related' },
] as const;

/**
 * A term's page (terms.md, "The term"): its labels per language, its definition, its relations to
 * terms of its space, its replacement, where it is used, and its workflow (LIB-049).
 */
export function TermPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  const [uses, setUses] = useState<Uses | null>(null);
  const [others, setOthers] = useState<readonly Summary[]>([]);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await client.GET('/v1/terms/{id}', { params: { path: { id } } });
      if (!live) return;
      if (!data) {
        setFailed(true);
        return;
      }
      setShown(data as unknown as Shown);
      setStanding(standingIn(data));
      const used = await client.GET('/v1/terms/{id}/uses', { params: { path: { id } } });
      if (live && used.data) setUses(used.data);
      const listed = await everyPage<unknown>(async (cursor) =>
        client.GET('/v1/spaces/{space}/terms', {
          params: {
            path: { space: data.space.id },
            query: cursor === undefined ? {} : { cursor },
          },
        }),
      );
      if (live && 'items' in listed) setOthers(listed.items.filter(isSummary));
    })();
    return () => {
      live = false;
    };
  }, [client, id]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>The term could not be loaded.</p>
      </Notice>
    );
  }
  if (shown === null) return null;
  const { term } = shown;
  const nameOf = (other: string) => others.find((each) => each.id === other)?.label ?? other;
  const used = uses !== null && (uses.named.length > 0 || uses.unreadable);

  const archive = async (archived: boolean) => {
    setProblem(null);
    const path = archived ? '/v1/terms/{id}/archive' : '/v1/terms/{id}/unarchive';
    const { data, error } = await client.POST(path, { params: { path: { id } } });
    if (!data) {
      setProblem(said(error, 'The term could not be changed.'));
      return;
    }
    setShown({ ...shown, archived: data.archived });
  };

  return (
    <article aria-labelledby="term-heading">
      <p>
        <a href={TERMS}>Terms</a>
      </p>
      <h1 id="term-heading">{baseLabel(term).preferred}</h1>
      <p>
        {standing && <StateLozenge state={standing.state} />}{' '}
        <RevisionChip revision={standing?.revision} />
      </p>
      {shown.deprecated && (
        <p role="note">
          {term.replacedBy === undefined
            ? 'This term is deprecated.'
            : `This term is deprecated. Use ${nameOf(term.replacedBy)} instead.`}
        </p>
      )}
      {standing && (
        <TransitionButtons
          client={client}
          kind="term"
          id={shown.id}
          title={baseLabel(term).preferred}
          standing={standing}
          versionId={shown.version.id}
          onMoved={(now, words) => {
            setStanding(now);
            setShown({ ...shown, deprecated: now.state.key === 'deprecated' });
            setNotice(words);
          }}
          onNotice={setNotice}
          onStale={() => {
            void readStanding(client, 'term', shown.id).then((now) => {
              if (now) setStanding(now);
            });
          }}
        />
      )}
      {notice !== '' && <p role="status">{notice}</p>}
      <table aria-label="Labels">
        <thead>
          <tr>
            <th scope="col">Language</th>
            <th scope="col">Preferred</th>
            <th scope="col">Alternatives</th>
            <th scope="col">Abbreviation</th>
          </tr>
        </thead>
        <tbody>
          {term.labels.map((each) => (
            <tr key={each.language}>
              <td>{each.language === term.base ? `${each.language} (base)` : each.language}</td>
              <td>{each.preferred}</td>
              <td>{each.alternatives.join(', ')}</td>
              <td>{each.abbreviation ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl>
        {term.definition.map((each) => (
          <div key={each.language}>
            <dt>{`Definition, ${each.language}`}</dt>
            <dd>{each.text}</dd>
          </div>
        ))}
        {RELATIONS.map(({ key, label }) =>
          term[key].length === 0 ? null : (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {term[key].map((other, at) => (
                  <span key={other}>
                    {at > 0 && ', '}
                    <a href={termLink(other)}>{nameOf(other)}</a>
                  </span>
                ))}
              </dd>
            </div>
          ),
        )}
        {term.replacedBy !== undefined && (
          <div>
            <dt>Replaced by</dt>
            <dd>
              <a href={termLink(term.replacedBy)}>{nameOf(term.replacedBy)}</a>
            </dd>
          </div>
        )}
        <dt>Space</dt>
        <dd>{shown.space.name}</dd>
        <dt>Version</dt>
        <dd>{shown.version.number}</dd>
      </dl>
      {shown.archived && <p>This term is archived.</p>}
      {shown.mayEdit && !editing && (
        <p>
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </p>
      )}
      {editing && (
        <EditTerm
          client={client}
          shown={shown}
          others={others.filter((each) => each.id !== shown.id)}
          onSaved={(next) => {
            setShown(next);
            setStanding(standingIn(next) ?? standing);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {uses !== null && (
        <section aria-label="Used in">
          <h2>Used in</h2>
          {!used && <p>Nothing uses this term.</p>}
          {uses.named.length > 0 && (
            <ul>
              {uses.named.map((each) => (
                <li key={each.id}>
                  <a href={`#/components/${each.id}`}>{each.title}</a>
                </li>
              ))}
            </ul>
          )}
          {uses.unreadable && <p>Used in more you may not read.</p>}
        </section>
      )}
      {shown.mayRetire && (
        <p>
          {shown.archived ? (
            <button type="button" onClick={() => void archive(false)}>
              Unarchive
            </button>
          ) : (
            <button type="button" disabled={used} onClick={() => void archive(true)}>
              Archive
            </button>
          )}
          {!shown.archived && used && ' A term in use is kept, so it cannot be archived.'}
        </p>
      )}
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </article>
  );
}

/** One language's row as edited: alternatives a line each. */
interface Row {
  readonly language: string;
  readonly preferred: string;
  readonly alternatives: string;
  readonly abbreviation: string;
  readonly definition: string;
}

/**
 * A term's next version: its labels and definition per language, its base language, and its
 * relations and replacement, each picked from the space's terms by label (LIB-025).
 */
function EditTerm({
  client,
  shown,
  others,
  onSaved,
  onCancel,
}: {
  readonly client: Client;
  readonly shown: Shown;
  readonly others: readonly Summary[];
  readonly onSaved: (next: Shown) => void;
  readonly onCancel: () => void;
}) {
  const { term } = shown;
  const [rows, setRows] = useState<readonly Row[]>(
    term.labels.map((each) => ({
      language: each.language,
      preferred: each.preferred,
      alternatives: each.alternatives.join('\n'),
      abbreviation: each.abbreviation ?? '',
      definition: term.definition.find((held) => held.language === each.language)?.text ?? '',
    })),
  );
  const [base, setBase] = useState(term.base);
  const [relations, setRelations] = useState({
    broader: [...term.broader],
    narrower: [...term.narrower],
    related: [...term.related],
  });
  const [replacedBy, setReplacedBy] = useState(term.replacedBy ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (at: number, member: keyof Row, value: string) =>
    setRows(rows.map((row, n) => (n === at ? { ...row, [member]: value } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const labels = rows.map((row) => {
      const abbreviation = row.abbreviation.trim();
      return {
        language: row.language.trim(),
        preferred: row.preferred.trim(),
        alternatives: row.alternatives
          .split('\n')
          .map((each) => each.trim())
          .filter((each) => each !== ''),
        ...(abbreviation === '' ? {} : { abbreviation }),
      };
    });
    const next = {
      schemaVersion: 1 as const,
      base,
      labels,
      definition: rows.flatMap((row) =>
        row.definition.trim() === ''
          ? []
          : [{ language: row.language.trim(), text: row.definition.trim() }],
      ),
      ...relations,
      ...(replacedBy === '' ? {} : { replacedBy }),
    };
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/terms/{id}/versions', {
        params: { path: { id: shown.id } },
        body: { openedFrom: shown.version.id, term: next },
      });
      if (!data) {
        setProblem(said(error, 'The term could not be changed.'));
        return;
      }
      onSaved(data as unknown as Shown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Edit term" onSubmit={(event) => void submit(event)}>
      {rows.map((row, at) => (
        <fieldset key={at}>
          <legend>{row.language === '' ? 'A new language' : row.language}</legend>
          <label>
            Language{' '}
            <input value={row.language} onChange={(e) => change(at, 'language', e.target.value)} />
          </label>
          <label>
            Preferred label{' '}
            <input
              value={row.preferred}
              required
              onChange={(e) => change(at, 'preferred', e.target.value)}
            />
          </label>
          <label>
            Alternative labels, one a line{' '}
            <textarea
              value={row.alternatives}
              onChange={(e) => change(at, 'alternatives', e.target.value)}
            />
          </label>
          <label>
            Abbreviation{' '}
            <input
              value={row.abbreviation}
              onChange={(e) => change(at, 'abbreviation', e.target.value)}
            />
          </label>
          <label>
            Definition{' '}
            <textarea
              value={row.definition}
              onChange={(e) => change(at, 'definition', e.target.value)}
            />
          </label>
        </fieldset>
      ))}
      <p>
        <button
          type="button"
          onClick={() =>
            setRows([
              ...rows,
              { language: '', preferred: '', alternatives: '', abbreviation: '', definition: '' },
            ])
          }
        >
          Add a language
        </button>
      </p>
      <label>
        Base language{' '}
        <select value={base} onChange={(event) => setBase(event.target.value)}>
          {rows
            .filter((row) => row.language.trim() !== '')
            .map((row) => (
              <option key={row.language} value={row.language.trim()}>
                {row.language.trim()}
              </option>
            ))}
        </select>
      </label>
      {RELATIONS.map(({ key, label }) => (
        <label key={key}>
          {label}{' '}
          <select
            multiple
            aria-label={label}
            value={relations[key]}
            onChange={(event) =>
              setRelations({
                ...relations,
                [key]: [...event.target.selectedOptions].map((option) => option.value),
              })
            }
          >
            {others.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label>
        Replaced by{' '}
        <select value={replacedBy} onChange={(event) => setReplacedBy(event.target.value)}>
          <option value="">None</option>
          {others.map((each) => (
            <option key={each.id} value={each.id}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={busy}>
        Save version
      </button>{' '}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </form>
  );
}
