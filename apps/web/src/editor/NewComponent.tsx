import type { createApiClient } from '@alloy-works/api-client';
import { contentDocumentSchema } from '@alloy-works/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useCreatableSpaces } from '../spaces.js';
import { DirectionSelect } from './DirectionSelect.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The same tag rule the model applies (packages/domain/src/content/model/document.ts), so the form
 * refuses what the service would refuse, and there is one rule rather than two (the same reasoning
 * `setLanguage` follows in packages/editor/src/header.ts).
 */
const language = contentDocumentSchema.shape.language;

interface ComponentType {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * The client's bodies are `any`, so every one is checked rather than trusted before it is read. The
 * spaces are read by `creatableSpacesIn`, which **New document** shares; the types stay here, because
 * only a component has one.
 */
function typesIn(data: unknown): ComponentType[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, isDefault } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof isDefault !== 'boolean') {
      return [];
    }
    return [{ id, name, isDefault }];
  });
}

export interface NewComponentProps {
  readonly client: Client;
  /** Called with the new component's id, so the page can open it. */
  readonly onCreated: (id: string) => void;
}

/**
 * Making a component: where, what it is called, its base language and direction, and its component
 * type with the environment's default preselected (MET-011, CNT-149). Shown only where there is
 * somewhere the caller may create, so nobody is offered a form that could only refuse them.
 */
export function NewComponent({ client, onCreated }: NewComponentProps) {
  // Read by the loader New document shares (`useCreatableSpaces`): the three states it tells apart -
  // failed, legitimately empty, and signed out - are this form's own review history (review round 1,
  // item 6; fix round 2), kept in one place so the two forms cannot drift apart.
  const {
    spaces,
    problem: spacesProblem,
    where,
    setWhere,
    reload: loadSpaces,
  } = useCreatableSpaces(client);
  const [types, setTypes] = useState<readonly ComponentType[]>([]);
  // The same three states as `spacesProblem`, for the same reason (final review): a refused or failed
  // component-types read otherwise left an empty chooser and no reason at all, beside a spaces read
  // that reports itself. The form stays up, because a create naming no type takes the environment's
  // default and can still succeed - so this is said beside the chooser, not instead of the form.
  const [typesProblem, setTypesProblem] = useState<'signedOut' | 'failed' | null>(null);
  const [componentType, setComponentType] = useState<string>('');
  const [title, setTitle] = useState('');
  const [languageTag, setLanguageTag] = useState('en-GB');
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  // A generation counter, not a mount-scoped `current` flag: the types are read imperatively too -
  // after a 409 - so a request that is no longer the latest one still has to be told apart from one
  // that is, whichever call started it. The spaces' own counter lives in `useCreatableSpaces`.
  const typesRequest = useRef(0);

  /**
   * Answers whether there is a chooser to choose from afterwards, which is what the 409 below has to
   * know before it can tell somebody to choose another (re-review, finding 2). A read this one no
   * longer owns answers `false` too: the shorter sentence is true whatever the newer read finds, and
   * the instruction is the only part that could be wrong.
   */
  const loadTypes = useCallback(
    async (space: string): Promise<boolean> => {
      const generation = ++typesRequest.current;
      setTypesProblem(null);
      try {
        const { data, response } = await client.GET('/v1/spaces/{space}/component-types', {
          params: { path: { space } },
        });
        if (typesRequest.current !== generation) return false;
        const offered = typesIn(data);
        if (offered === undefined) {
          setTypes([]);
          setComponentType('');
          setTypesProblem(response.status === 401 ? 'signedOut' : 'failed');
          return false;
        }
        setTypes(offered);
        setComponentType((offered.find((each) => each.isDefault) ?? offered[0])?.id ?? '');
        return offered.length > 0;
      } catch {
        if (typesRequest.current === generation) {
          setTypes([]);
          setTypesProblem('failed');
        }
        return false;
      }
    },
    [client],
  );

  // The effect leaves its generation behind on the way out (fix round 2, finding F), as the spaces'
  // loader does in `useCreatableSpaces`. Without it a read
  // still in flight when the page goes finds its own generation current and sets state into a
  // component that is no longer there - which is how a stray act() warning gets into a suite that is
  // supposed to run silent.
  useEffect(() => {
    if (where === '') return undefined;
    setTypes([]);
    setComponentType('');
    void loadTypes(where);
    return () => {
      typesRequest.current += 1;
    };
  }, [loadTypes, where]);

  const create = useCallback(async () => {
    if (pending.current) return;
    if (title.trim() === '') {
      setNotice('A component needs a title.');
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
      const { data, response } = await client.POST('/v1/spaces/{space}/components', {
        params: { path: { space: where } },
        body: {
          title,
          language: languageTag,
          direction,
          ...(componentType === '' ? {} : { componentType }),
        },
      });
      const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
      if (typeof id !== 'string') {
        // Signed out and refused are different from a failure somebody should try again (final
        // review's rule for every renderer call); 404, 409 and 400 are further refusals of what was
        // sent, each with something the author can actually act on rather than a bare "Try again"
        // that only resends the same now-refused request (review round 1, item 5).
        if (response.status === 401) {
          setNotice('You are signed out. Sign in again to create a component.');
        } else if (response.status === 403) {
          setNotice('You may not create a component here.');
          // A withdrawn create grant answers 403 rather than 404 - the space is still readable - and
          // the chooser went on offering it, so every retry was refused again (final review). Read
          // the spaces afresh, exactly as the 404 branch does.
          void loadSpaces();
        } else if (response.status === 404) {
          setNotice('This space is no longer open to you. Choose another.');
          void loadSpaces();
        } else if (response.status === 409) {
          // The re-read decides which sentence is true: "Choose another" beside an empty chooser -
          // the read having failed, been refused, or found nothing - asks for something that is not
          // there, which is the trap fix round 2 carved out for the spaces one door over.
          const chooser = await loadTypes(where);
          setNotice(
            chooser
              ? 'That component type is no longer available. Choose another.'
              : 'That component type is no longer available.',
          );
        } else if (response.status === 400) {
          setNotice('The title, language or direction was not accepted. Check them and try again.');
        } else {
          setNotice('The component could not be created. Try again.');
        }
        return;
      }
      onCreated(id);
    } catch {
      setNotice('The component could not be created. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [
    client,
    componentType,
    direction,
    languageTag,
    loadSpaces,
    loadTypes,
    onCreated,
    title,
    where,
  ]);

  // The one status region, rendered by every branch below (fix round 2, finding E). A 404 re-reads
  // the spaces, and that read can fail outright or come back with nowhere left to create - and either
  // used to replace the whole section, carrying off the very message that said what had happened.
  const status = <p role="status">{notice}</p>;

  if (spacesProblem !== null) {
    return (
      <section aria-labelledby="new-component-heading">
        <h2 id="new-component-heading">New component</h2>
        <p>
          {spacesProblem === 'signedOut'
            ? 'You are signed out. Sign in again to create a component.'
            : 'The spaces you may create in could not be loaded.'}
        </p>
        <button type="button" onClick={() => void loadSpaces()}>
          Try again
        </button>
        {status}
      </section>
    );
  }
  if (spaces === null || spaces.length === 0) {
    // Nothing to create in says nothing at all - unless something has just been said about a space
    // that was, which must not vanish along with the form it was said about. What it says here is
    // this branch's own sentence rather than the standing notice: the only way in is a refusal whose
    // re-read then left nothing, and that notice ends "Choose another" beside no chooser. This is
    // the one fact the branch itself knows, so it needs to know nothing about what was refused.
    if (notice === null) return null;
    return (
      <section aria-labelledby="new-component-heading">
        <h2 id="new-component-heading">New component</h2>
        <p role="status">There is nowhere left for you to create a component.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="new-component-heading">
      <h2 id="new-component-heading">New component</h2>
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
      <label>
        Component type
        <select value={componentType} onChange={(event) => setComponentType(event.target.value)}>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </label>
      {typesProblem !== null && (
        <>
          <p>
            {typesProblem === 'signedOut'
              ? 'You are signed out. Sign in again to choose a component type.'
              : 'The component types could not be loaded.'}
          </p>
          <button type="button" onClick={() => void loadTypes(where)}>
            Try again
          </button>
        </>
      )}
      <button type="button" disabled={sending} onClick={() => void create()}>
        Create
      </button>
      {status}
    </section>
  );
}
