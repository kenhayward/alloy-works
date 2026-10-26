import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import listStyles from '../structure/DocumentList.module.css';
import { LIBRARIES, libraryLink, PROMPTS, promptLink } from './links.js';
import styles from './PromptPage.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Summary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly prompts: number;
}

/** One prompt a library lists, as the service says the reader may see it. */
type Listed =
  | {
      readonly id: string;
      readonly state: 'approved';
      readonly revision: { readonly number: number };
      readonly prompt: { readonly title: string };
    }
  | { readonly id: string; readonly state: 'unapproved'; readonly title: string }
  | { readonly id: string; readonly state: 'hidden' };

interface Shown {
  readonly id: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly library: { readonly name: string; readonly prompts: readonly string[] };
  readonly isDefault: boolean;
  readonly prompts: readonly Listed[];
  readonly mayEdit: boolean;
}

const isShown = (value: unknown): value is Shown =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isRecord(value.library) &&
  Array.isArray(value.prompts) &&
  typeof value.mayEdit === 'boolean';

/**
 * The environment's prompt libraries (the G4 plan, G4-F): the default first, which lists nothing and
 * which a template naming none binds; **New library** where the reader designs here.
 */
export function PromptLibraries({ client }: { readonly client: Client }) {
  const [items, setItems] = useState<readonly Summary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/prompt-libraries')
      .then(({ data }) => {
        if (!current) return;
        if (data) setItems(data.items);
        else setFailed(true);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [client]);
  if (failed) {
    return (
      <section aria-labelledby="libraries-heading">
        <h1 id="libraries-heading">{words('prompts.prompt-libraries')}</h1>
        <Notice tone="failed">
          <p>{words('prompts.the-libraries-could-not-be')}</p>
        </Notice>
      </section>
    );
  }
  if (items === null) return null;
  return (
    <section aria-labelledby="libraries-heading">
      <p>
        <a href={PROMPTS}>{words('prompts.prompts')}</a>
      </p>
      <div className={listStyles['titleRow']}>
        <h1 id="libraries-heading">{words('prompts.prompt-libraries')}</h1>
        <button
          type="button"
          className="primary"
          onClick={() => {
            window.location.hash = libraryLink('new');
          }}
        >
          {words('prompts.new-library')}
        </button>
      </div>
      <p className={listStyles['summary']}>{words('prompts.each-template-binds-one-library')}</p>
      {items.length === 0 ? (
        <Empty>
          <p>{words('prompts.there-are-no-libraries')}</p>
        </Empty>
      ) : (
        <div className={listStyles['table']}>
          <table>
            <thead>
              <tr>
                <th scope="col">{words('prompts.name')}</th>
                <th scope="col">{words('prompts.prompts')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className={listStyles['title']}>
                    <a href={libraryLink(item.id)}>{item.name}</a>
                    {item.isDefault && (
                      <span className={listStyles['muted']}> {words('prompts.default')}</span>
                    )}
                  </td>
                  <td>{item.prompts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const STATE_WORDS = (each: Listed): string =>
  each.state === 'approved'
    ? words('prompts.runs-revision', { number: each.revision.number })
    : each.state === 'unapproved'
      ? words('prompts.never-approved-so-it-runs')
      : words('prompts.a-prompt-you-may-not');

/**
 * A library's page (G4-F): its name and the prompts it lists, each saying the revision it runs, in
 * order; a designer adds a prompt they may read, removes one, and saves a version.
 */
export function LibraryPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const isNew = id === 'new';
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [prompts, setPrompts] = useState<readonly string[]>([]);
  const [readable, setReadable] = useState<readonly { id: string; title: string }[]>([]);
  const [adding, setAdding] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void everyPage((cursor) =>
      client.GET('/v1/prompts', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((read) => {
        if (current && 'items' in read) {
          setReadable(read.items.map((each) => ({ id: each.id, title: each.title })));
        }
      })
      .catch(() => undefined);
    if (!isNew) {
      void client
        .GET('/v1/prompt-libraries/{id}', { params: { path: { id } } })
        .then(({ data }) => {
          if (!current) return;
          if (!isShown(data)) {
            setFailed(true);
            return;
          }
          setShown(data);
          setName(data.library.name);
          setPrompts(data.library.prompts);
        })
        .catch(() => current && setFailed(true));
    }
    return () => {
      current = false;
    };
  }, [client, id, isNew]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>{words('prompts.this-library-could-not-be')}</p>
      </Notice>
    );
  }
  if (!isNew && shown === null) return null;
  const mayEdit = isNew || shown!.mayEdit;
  const titleOf = (prompt: string): string => {
    const listed = shown?.prompts.find((each) => each.id === prompt);
    if (listed?.state === 'approved') return listed.prompt.title;
    if (listed?.state === 'unapproved') return listed.title;
    return (
      readable.find((each) => each.id === prompt)?.title ?? words('prompts.a-prompt-you-may-not')
    );
  };
  const addable = readable.filter((each) => !prompts.includes(each.id));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    try {
      const library = { schemaVersion: 1 as const, name: name.trim(), prompts: [...prompts] };
      const { data, error } =
        shown === null
          ? await client.POST('/v1/prompt-libraries', { body: { library } })
          : await client.POST('/v1/prompt-libraries/{id}/versions', {
              params: { path: { id: shown.id } },
              body: { openedFrom: shown.version.id, library },
            });
      if (isShown(data)) {
        if (shown === null) {
          window.location.hash = libraryLink(data.id);
          return;
        }
        setShown(data);
        setSaid(
          data.version.id === shown.version.id
            ? words('prompts.nothing-changed-so-no-version')
            : words('prompts.saved-as-version', { number: data.version.number }),
        );
        return;
      }
      setSaid(refusal(error, words('prompts.the-library-could-not-be')));
    } catch {
      setSaid(words('prompts.the-library-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="library-heading">
      <p>
        <a href={LIBRARIES}>{words('prompts.prompt-libraries')}</a>
      </p>
      <h1 id="library-heading">{isNew ? words('prompts.new-library') : shown!.library.name}</h1>
      {shown !== null && (
        <p>
          <Chip className={styles['mono']}>
            {words('prompts.version', { number: shown.version.number })}
          </Chip>
          {shown.isDefault && <Chip>{words('prompts.default-2')}</Chip>}
        </p>
      )}
      <form className={styles['promptForm']} onSubmit={(event) => void save(event)}>
        <fieldset disabled={!mayEdit || busy}>
          <legend>{words('prompts.library')}</legend>
          <label>
            {words('prompts.name')}
            <input value={name} required onChange={(event) => setName(event.target.value)} />
          </label>
          {prompts.length === 0 ? (
            <p className={styles['promptHint']}>{words('prompts.it-lists-no-prompts')}</p>
          ) : (
            <ol aria-label={words('prompts.prompts-it-lists')}>
              {prompts.map((prompt) => {
                const listed = shown?.prompts.find((each) => each.id === prompt);
                return (
                  <li key={prompt} className={styles['source']}>
                    <span>
                      <a href={promptLink(prompt)}>{titleOf(prompt)}</a>
                      {listed && (
                        <span className={styles['promptHint']}>{` ${STATE_WORDS(listed)}`}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={words('prompts.remove', { value1: titleOf(prompt) })}
                      onClick={() => setPrompts((was) => was.filter((each) => each !== prompt))}
                    >
                      {words('prompts.remove-2')}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {addable.length > 0 && (
            <div className={styles['source']}>
              <label>
                {words('prompts.add-a-prompt')}
                <select value={adding} onChange={(event) => setAdding(event.target.value)}>
                  <option value="">{words('prompts.choose-a-prompt')}</option>
                  {addable.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={adding === ''}
                onClick={() => {
                  setPrompts((was) => [...was, adding]);
                  setAdding('');
                }}
              >
                {words('prompts.add')}
              </button>
            </div>
          )}
        </fieldset>
        {mayEdit && (
          <button type="submit" className="primary" disabled={busy}>
            {isNew ? words('prompts.make-library') : words('prompts.save-version')}
          </button>
        )}
        {said !== '' && <p role="status">{said}</p>}
      </form>
    </section>
  );
}
