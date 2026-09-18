import type { createApiClient } from '@alloy-works/api-client';
import { outlineDocumentSchema } from '@alloy-works/domain';
import { useCallback, useRef, useState } from 'react';

import { DirectionSelect } from '../editor/DirectionSelect.js';
import { useCreatableSpaces } from '../spaces.js';

type Client = ReturnType<typeof createApiClient>;

/** The outline's own tag rule, so the form refuses what the service would, with one rule and not two. */
const language = outlineDocumentSchema.shape.language;

export interface NewDocumentProps {
  readonly client: Client;
  /** Called with the new document's id, so the page can open it. */
  readonly onCreated: (id: string) => void;
}

/**
 * Making a document: where, what it is called, its language and its direction - **New component**
 * without a component type, because a document has none. Shown only where there is somewhere the
 * caller may create (the plan's decision 8), so nobody is offered a form that could only refuse them,
 * and built the way `NewComponent` is so the two pages do not disagree about what a person may do.
 */
export function NewDocument({ client, onCreated }: NewDocumentProps) {
  const {
    spaces,
    problem: spacesProblem,
    where,
    setWhere,
    reload: loadSpaces,
  } = useCreatableSpaces(client);
  const [title, setTitle] = useState('');
  const [languageTag, setLanguageTag] = useState('en-GB');
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  const create = useCallback(async () => {
    if (pending.current) return;
    if (title.trim() === '') {
      setNotice('A document needs a title.');
      return;
    }
    if (!language.safeParse(languageTag).success) {
      setNotice('A language tag looks like en-GB.');
      return;
    }
    pending.current = true;
    setSending(true);
    setNotice(null);
    try {
      const { data, response } = await client.POST('/v1/spaces/{space}/documents', {
        params: { path: { space: where } },
        body: { title, language: languageTag, direction },
      });
      const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
      if (typeof id !== 'string') {
        if (response.status === 401) {
          setNotice('You are signed out. Sign in again to create a document.');
        } else if (response.status === 403) {
          setNotice('You may not create a document here.');
          // A withdrawn grant answers 403 while the space is still readable: read the spaces afresh,
          // so the chooser stops offering one that would only refuse again.
          void loadSpaces();
        } else if (response.status === 404) {
          setNotice('This space is no longer open to you. Choose another.');
          void loadSpaces();
        } else if (response.status === 400) {
          setNotice('The title, language or direction was not accepted. Check them and try again.');
        } else {
          setNotice('The document could not be created. Try again.');
        }
        return;
      }
      onCreated(id);
    } catch {
      setNotice('The document could not be created. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [client, direction, languageTag, loadSpaces, onCreated, title, where]);

  const status = <p role="status">{notice}</p>;

  if (spacesProblem !== null) {
    return (
      <section aria-labelledby="new-document-heading">
        <h2 id="new-document-heading">New document</h2>
        {spacesProblem === 'signedOut' ? (
          <p>You are signed out. Sign in again to create a document.</p>
        ) : (
          <>
            <p>The spaces you may create in could not be loaded.</p>
            <button type="button" onClick={() => void loadSpaces()}>
              Try again
            </button>
          </>
        )}
        {status}
      </section>
    );
  }
  if (spaces === null || spaces.length === 0) {
    // Nothing to create in says nothing at all - unless a refusal just re-read the spaces and left
    // none, which must not vanish along with the form it was said about. Its own sentence, because the
    // standing notice may end "Choose another" beside no chooser.
    if (notice === null) return null;
    return (
      <section aria-labelledby="new-document-heading">
        <h2 id="new-document-heading">New document</h2>
        <p role="status">There is nowhere left for you to create a document.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="new-document-heading">
      <h2 id="new-document-heading">New document</h2>
      <label>
        Where
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Language
        <input value={languageTag} onChange={(event) => setLanguageTag(event.target.value)} />
      </label>
      <label>
        Direction
        <DirectionSelect value={direction} onChange={setDirection} />
      </label>
      <button type="button" disabled={sending} onClick={() => void create()}>
        Create
      </button>
      {status}
    </section>
  );
}
