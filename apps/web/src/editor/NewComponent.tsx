import type { createApiClient } from '@alloy-works/api-client';
import { contentDocumentSchema } from '@alloy-works/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DirectionSelect } from './DirectionSelect.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The same tag rule the model applies (packages/domain/src/content/model/document.ts), so the form
 * refuses what the service would refuse, and there is one rule rather than two (the same reasoning
 * `setLanguage` follows in packages/editor/src/header.ts).
 */
const language = contentDocumentSchema.shape.language;

interface Space {
  readonly id: string;
  readonly name: string;
}
interface ComponentType {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * The client's bodies are `any`, so every one is checked rather than trusted before it is read.
 * `spacesIn` and `typesIn` stay two small functions rather than one shared `itemsIn(data, read)`
 * (review round 1, item 7): the shapes only look alike - a space is kept by a boolean permission
 * (`mayCreate`), a type by which one is the default - and a generic version would have to smuggle
 * that distinction back in through its caller anyway, for two call sites total.
 */
function spacesIn(data: unknown): Space[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, mayCreate } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || mayCreate !== true) return [];
    return [{ id, name }];
  });
}

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
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  // A read that failed is not the same as a read that came back legitimately empty (review round 1,
  // item 6): the first is a page that never rendered its own form at all and is worth saying
  // something about, the second is silent by design (nobody is offered a form that could only refuse
  // them) - conflating the two would hide a real outage behind the same nothing an empty environment
  // shows on its best day.
  const [spacesFailed, setSpacesFailed] = useState(false);
  const [where, setWhere] = useState<string>('');
  const [types, setTypes] = useState<readonly ComponentType[]>([]);
  const [componentType, setComponentType] = useState<string>('');
  const [title, setTitle] = useState('');
  const [languageTag, setLanguageTag] = useState('en-GB');
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  // A generation counter each, not a mount-scoped `current` flag (the shape the brief's other effects
  // use): both are now called imperatively too - on demand, after a 404 or a 409 - not only once from
  // an effect at mount, so a request that is no longer the latest one still has to be told apart from
  // one that is, whichever call started it.
  const spacesRequest = useRef(0);
  const typesRequest = useRef(0);

  const loadSpaces = useCallback(async () => {
    const generation = ++spacesRequest.current;
    setSpacesFailed(false);
    try {
      const { data } = await client.GET('/v1/spaces');
      if (spacesRequest.current !== generation) return;
      const open = spacesIn(data);
      if (open === undefined) {
        setSpacesFailed(true);
        return;
      }
      setSpaces(open);
      setWhere(open[0]?.id ?? '');
    } catch {
      if (spacesRequest.current === generation) setSpacesFailed(true);
    }
  }, [client]);

  const loadTypes = useCallback(
    async (space: string) => {
      const generation = ++typesRequest.current;
      try {
        const { data } = await client.GET('/v1/spaces/{space}/component-types', {
          params: { path: { space } },
        });
        if (typesRequest.current !== generation) return;
        const offered = typesIn(data) ?? [];
        setTypes(offered);
        setComponentType((offered.find((each) => each.isDefault) ?? offered[0])?.id ?? '');
      } catch {
        if (typesRequest.current === generation) setTypes([]);
      }
    },
    [client],
  );

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    if (where === '') return;
    setTypes([]);
    setComponentType('');
    void loadTypes(where);
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
        } else if (response.status === 404) {
          setNotice('This space is no longer open to you. Choose another.');
          void loadSpaces();
        } else if (response.status === 409) {
          setNotice('That component type is no longer available. Choose another.');
          void loadTypes(where);
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

  if (spacesFailed) {
    return (
      <section aria-labelledby="new-component-heading">
        <h2 id="new-component-heading">New component</h2>
        <p>The spaces you may create in could not be loaded.</p>
        <button type="button" onClick={() => void loadSpaces()}>
          Try again
        </button>
      </section>
    );
  }
  if (spaces === null || spaces.length === 0) return null;
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
      <button type="button" disabled={sending} onClick={() => void create()}>
        Create
      </button>
      <p role="status">{notice}</p>
    </section>
  );
}
