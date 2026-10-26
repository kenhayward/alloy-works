import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { useDefinitionPlaces } from '../data/places.js';
import { promptLink } from '../prompts/links.js';
import styles from './AssistantPanel.module.css';
import { words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Personal {
  readonly id: string;
  readonly title: string;
  readonly instructions: string;
  readonly promotedTo: string | null;
}

/**
 * **Your prompts** (the G5 plan, G5-G; GEN-054, GEN-055): words of your own, saved, used as a turn's
 * words, and promoted into a space as a new prompt at draft. Nobody else sees them.
 */
export function PersonalPrompts({
  client,
  asking,
  onUse,
}: {
  readonly client: Client;
  /** What is being asked now, which **Save** keeps. */
  readonly asking: string;
  /** A prompt of yours used: its words become what is asked. */
  readonly onUse: (words: string) => void;
}) {
  const [items, setItems] = useState<readonly Personal[]>([]);
  const [title, setTitle] = useState('');
  const [promoting, setPromoting] = useState<Personal | null>(null);
  const [space, setSpace] = useState('');
  const [models, setModels] = useState('');
  const [said, setSaid] = useState('');
  const places = useDefinitionPlaces(client);

  const read = async () => {
    const { data } = await client.GET('/v1/me/prompts');
    if (data) setItems(data.items);
  };

  useEffect(() => {
    void read().catch(() => undefined);
    // Read once; `read` closes over the client alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    if (space === '' && places !== null && places.spaces.length > 0) setSpace(places.spaces[0]!.id);
  }, [places, space]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.POST('/v1/me/prompts', {
      body: { title: title.trim(), instructions: asking.trim() },
    });
    if (data) {
      setTitle('');
      setSaid(say('document.is-saved-for-you-alone', { title: data.title }));
      await read();
    } else setSaid(refusal(error, say('document.the-prompt-could-not-be')));
  };

  const promote = async (event: FormEvent) => {
    event.preventDefault();
    if (!promoting) return;
    const accepts = models
      .split(/[\s,]+/u)
      .map((each) => each.trim())
      .filter((each) => each !== '');
    const { data, error } = await client.POST('/v1/me/prompts/{id}/promotion', {
      params: { path: { id: promoting.id } },
      body: {
        space,
        context: [{ source: 'outline', scope: 'part' }],
        output: { componentType: null },
        models: { purpose: 'drafting', accepts },
      },
    });
    if (data) {
      setSaid(
        say('document.is-a-prompt-in-now', {
          title: promoting.title,
          name: data.prompt.space.name,
        }),
      );
      setPromoting(null);
      await read();
    } else setSaid(refusal(error, say('document.the-prompt-could-not-be-2')));
  };

  return (
    <section aria-label={say('document.your-prompts')} className={styles['prompts']}>
      <h3>{say('document.your-prompts')}</h3>
      {items.length === 0 ? (
        <p className={styles['muted']}>{say('document.none-saved-nobody-else-sees')}</p>
      ) : (
        <ul>
          {items.map((each) => (
            <li key={each.id}>
              <span>{each.title}</span>{' '}
              <button
                type="button"
                aria-label={say('document.use', { title: each.title })}
                onClick={() => onUse(each.instructions)}
              >
                {say('document.use-2')}
              </button>{' '}
              {each.promotedTo === null ? (
                <button
                  type="button"
                  aria-label={say('document.promote', { title: each.title })}
                  onClick={() => setPromoting(each)}
                >
                  {say('document.promote-2')}
                </button>
              ) : (
                <a href={promptLink(each.promotedTo)}>{say('document.promoted')}</a>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking.trim() !== '' && (
        <form className={styles['actions']} onSubmit={(event) => void save(event)}>
          <label className={styles['ask']}>
            {say('document.save-what-is-asked-as')}
            <input value={title} onChange={(change) => setTitle(change.target.value)} />
          </label>
          <button type="submit" disabled={title.trim() === ''}>
            {say('document.save')}
          </button>
        </form>
      )}
      {promoting && (
        <form
          className={styles['actions']}
          aria-label={say('document.promote', { title: promoting.title })}
          onSubmit={(event) => void promote(event)}
        >
          <label className={styles['ask']}>
            {say('document.space')}
            <select value={space} onChange={(change) => setSpace(change.target.value)}>
              {(places?.spaces ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles['ask']}>
            {say('document.models-accepted')}
            <input value={models} onChange={(change) => setModels(change.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={space === '' || models.trim() === ''}>
            {say('document.make-it-a-prompt')}
          </button>
          <button type="button" onClick={() => setPromoting(null)}>
            {say('document.cancel')}
          </button>
        </form>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}
