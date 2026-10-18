import type { createApiClient } from '@alloy-works/api-client';
import type { Prompt } from '@alloy-works/domain';
import { useEffect, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { useDefinitionPlaces } from '../data/places.js';
import { isRecord } from '../data/shapes.js';
import {
  readStanding,
  RevisionChip,
  standingIn,
  TransitionButtons,
  type Standing,
} from '../lifecycle/Workflow.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { DetailPage } from '../parts/DetailPage.js';
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import { promptLink, PROMPTS } from './links.js';
import styles from './PromptPage.module.css';
import { TryIt } from './TryIt.js';
import {
  BLANK,
  draftOf,
  promptOf,
  PURPOSES,
  SCOPES,
  type Draft,
  type DraftSource,
  type PromptPurpose,
} from './shape.js';

type Client = ReturnType<typeof createApiClient>;

/** A prompt as its route answers it. */
interface Shown {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly prompt: Prompt;
  readonly mayEdit: boolean;
}

/** A definition a prompt may name, by kind. */
interface Named {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

const isShown = (value: unknown): value is Shown =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isRecord(value.space) &&
  isRecord(value.version) &&
  typeof value.version.id === 'string' &&
  isRecord(value.prompt) &&
  typeof value.mayEdit === 'boolean';

const SOURCE_NAMES: Readonly<Record<DraftSource['source'], string>> = {
  outline: 'Part of the outline',
  related: 'Related components',
  field: 'Parts whose field holds a value',
  parameters: "The document's parameters",
};

const blankSource = (source: DraftSource['source'], named: readonly Named[]): DraftSource => {
  const first = (kind: string) => named.find((each) => each.kind === kind)?.id ?? '';
  switch (source) {
    case 'outline':
      return { source, scope: 'part' };
    case 'related':
      return { source, type: first('relationshipType'), direction: 'out' };
    case 'field':
      return { source, field: first('field'), value: '' };
    case 'parameters':
      return { source, names: '' };
  }
};

/** Each problem a refusal names, by where. */
function problemsIn(error: unknown): string[] {
  if (!isRecord(error) || !Array.isArray(error.problems)) return [];
  return error.problems.flatMap((each: unknown) =>
    isRecord(each) && typeof each.message === 'string'
      ? [
          typeof each.path === 'string' && each.path !== ''
            ? `${each.path}: ${each.message}`
            : each.message,
        ]
      : [],
  );
}

/**
 * A prompt's page (generation.md, "Prompts"; the G4 plan, G4-A and G4-E): what it says, editable by a
 * person who may edit it, every save a version; where it stands in its workflow, and its transitions.
 * `new` writes one in a space the person may edit.
 */
export function PromptPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const isNew = id === 'new';
  const places = useDefinitionPlaces(client);
  const [shown, setShown] = useState<Shown | null>(null);
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [space, setSpace] = useState('');
  const [named, setNamed] = useState<readonly Named[]>([]);
  const [said, setSaid] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void everyPage((cursor) =>
      client.GET('/v1/definitions', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((read) => {
        if (current && 'items' in read) setNamed(read.items as Named[]);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (isNew) return;
    let current = true;
    void client
      .GET('/v1/prompts/{id}', { params: { path: { id } } })
      .then(({ data }) => {
        if (!current) return;
        if (!isShown(data)) {
          setFailed(true);
          return;
        }
        setShown(data);
        setStanding(standingIn(data));
        setDraft(draftOf(data.prompt));
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [client, id, isNew]);

  useEffect(() => {
    if (isNew && space === '' && places !== null && places.spaces.length > 0) {
      setSpace(places.spaces[0]!.id);
    }
  }, [isNew, places, space]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>This prompt could not be loaded, or there is none you may read.</p>
      </Notice>
    );
  }
  if (!isNew && shown === null) return null;

  const mayEdit = isNew ? (places?.spaces.length ?? 0) > 0 : shown!.mayEdit;
  const ofKind = (kind: string) => named.filter((each) => each.kind === kind);
  const change = (patch: Partial<Draft>) => setDraft((was) => ({ ...was, ...patch }));
  const changeSource = (at: number, source: DraftSource) =>
    change({ context: draft.context.map((each, i) => (i === at ? source : each)) });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    setProblems([]);
    try {
      const prompt = promptOf(draft);
      const { data, error } =
        shown === null
          ? await client.POST('/v1/spaces/{space}/prompts', {
              params: { path: { space } },
              body: { prompt },
            })
          : await client.POST('/v1/prompts/{id}/versions', {
              params: { path: { id: shown.id } },
              body: { openedFrom: shown.version.id, prompt },
            });
      if (isShown(data)) {
        if (shown === null) {
          window.location.hash = promptLink(data.id);
          return;
        }
        setShown(data);
        setStanding(standingIn(data));
        setSaid(
          data.version.id === shown.version.id
            ? 'Nothing changed, so no version was saved.'
            : `Saved as version ${data.version.number}.`,
        );
        return;
      }
      setProblems(problemsIn(error));
      setSaid(refusal(error, 'The prompt could not be saved. Try again.'));
    } catch {
      setSaid('The prompt could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className={styles['promptForm']} onSubmit={(event) => void save(event)}>
      <fieldset disabled={!mayEdit || busy}>
        <legend>Prompt</legend>
        {isNew && (
          <label>
            Space
            <select value={space} onChange={(event) => setSpace(event.target.value)}>
              {(places?.spaces ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Title
          <input
            value={draft.title}
            required
            onChange={(event) => change({ title: event.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            value={draft.description}
            onChange={(event) => change({ description: event.target.value })}
          />
        </label>
        <label>
          Instructions
          <textarea
            value={draft.instructions}
            required
            onChange={(event) => change({ instructions: event.target.value })}
          />
          <span className={styles['promptHint']}>
            Place a parameter the context declares as {'{{name}}'}.
          </span>
        </label>
      </fieldset>
      <fieldset disabled={!mayEdit || busy}>
        <legend>What it reads</legend>
        <p className={styles['promptHint']}>Nothing else reaches the model.</p>
        {draft.context.map((each, at) => (
          <div key={at} className={styles['source']}>
            <label>
              {`Source ${at + 1}`}
              <select
                value={each.source}
                onChange={(event) =>
                  changeSource(at, blankSource(event.target.value as DraftSource['source'], named))
                }
              >
                {Object.entries(SOURCE_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {each.source === 'outline' && (
              <label>
                Which parts
                <select
                  value={each.scope}
                  onChange={(event) =>
                    changeSource(at, { ...each, scope: event.target.value as typeof each.scope })
                  }
                >
                  {Object.entries(SCOPES).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {each.source === 'related' && (
              <>
                <label>
                  Relationship type
                  <select
                    value={each.type}
                    onChange={(event) => changeSource(at, { ...each, type: event.target.value })}
                  >
                    {ofKind('relationshipType').map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Direction
                  <select
                    value={each.direction}
                    onChange={(event) =>
                      changeSource(at, { ...each, direction: event.target.value as 'out' | 'in' })
                    }
                  >
                    <option value="out">From the part</option>
                    <option value="in">To the part</option>
                  </select>
                </label>
              </>
            )}
            {each.source === 'field' && (
              <>
                <label>
                  Field
                  <select
                    value={each.field}
                    onChange={(event) => changeSource(at, { ...each, field: event.target.value })}
                  >
                    {ofKind('field').map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Value
                  <input
                    value={each.value}
                    onChange={(event) => changeSource(at, { ...each, value: event.target.value })}
                  />
                </label>
              </>
            )}
            {each.source === 'parameters' && (
              <label>
                Parameter names
                <input
                  value={each.names}
                  onChange={(event) => changeSource(at, { ...each, names: event.target.value })}
                />
              </label>
            )}
            <button
              type="button"
              aria-label={`Remove source ${at + 1}`}
              onClick={() => change({ context: draft.context.filter((_, i) => i !== at) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => change({ context: [...draft.context, blankSource('parameters', named)] })}
        >
          Add a source
        </button>
      </fieldset>
      <fieldset disabled={!mayEdit || busy}>
        <legend>What it writes</legend>
        <label>
          The text of a part of type
          <select
            value={draft.componentType}
            onChange={(event) => change({ componentType: event.target.value })}
          >
            <option value="">Any</option>
            {ofKind('componentType').map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <fieldset disabled={!mayEdit || busy}>
        <legend>Models</legend>
        <label>
          Purpose
          <select
            value={draft.purpose}
            onChange={(event) => change({ purpose: event.target.value as PromptPurpose })}
          >
            {Object.entries(PURPOSES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          <span className={styles['promptHint']}>
            It runs on the endpoint this purpose goes to, and fails on any model not accepted.
          </span>
        </label>
        <label>
          Models accepted
          <textarea
            value={draft.accepts}
            onChange={(event) => change({ accepts: event.target.value })}
          />
          <span className={styles['promptHint']}>One model identifier a line.</span>
        </label>
      </fieldset>
      {mayEdit && (
        <button type="submit" className="primary" disabled={busy}>
          {isNew ? 'Make prompt' : 'Save version'}
        </button>
      )}
      {problems.length > 0 && (
        <ul className={styles['promptProblems']}>
          {problems.map((each) => (
            <li key={each}>{each}</li>
          ))}
        </ul>
      )}
    </form>
  );

  return (
    <DetailPage
      trail={
        <>
          <a href={PROMPTS}>Prompts</a>
          {shown !== null && ` / ${shown.space.name}`}
        </>
      }
      title={isNew ? 'New prompt' : shown!.prompt.title}
      chips={
        shown === null ? undefined : (
          <>
            <Chip className={styles['mono']}>{`Version ${shown.version.number}`}</Chip>
            <Chip>{`In ${shown.space.name}`}</Chip>
            {standing && <StateLozenge state={standing.state} />}
            <RevisionChip revision={standing?.revision} />
            {shown.prompt.description !== '' && (
              <span className={styles['described']}>{shown.prompt.description}</span>
            )}
          </>
        )
      }
      actions={
        standing && shown !== null ? (
          <TransitionButtons
            client={client}
            kind="prompt"
            id={shown.id}
            title={shown.prompt.title}
            standing={standing}
            versionId={shown.version.id}
            onMoved={(now, words) => {
              setStanding(now);
              setSaid(words);
            }}
            onNotice={setSaid}
            onStale={() => {
              void readStanding(client, 'prompt', shown.id).then((now) => {
                if (now) setStanding(now);
              });
            }}
          />
        ) : undefined
      }
      strip={[]}
      notice={said === '' ? undefined : <p role="status">{said}</p>}
      label="Prompt"
      tabs={
        shown === null
          ? [{ key: 'prompt', label: 'Prompt' }]
          : [
              { key: 'prompt', label: 'Prompt' },
              { key: 'try', label: 'Try it' },
            ]
      }
      chosen={null}
      link={() => (shown === null ? '#/prompts/new' : promptLink(shown.id))}
    >
      {(tab) =>
        tab === 'try' && shown !== null ? (
          <TryIt
            client={client}
            prompt={shown.id}
            version={shown.version.id}
            onTried={() => {
              void readStanding(client, 'prompt', shown.id).then((now) => {
                if (now) setStanding(now);
              });
            }}
          />
        ) : (
          form
        )
      }
    </DetailPage>
  );
}
