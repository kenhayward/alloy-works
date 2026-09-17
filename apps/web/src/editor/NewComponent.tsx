import type { createApiClient } from '@alloy-works/api-client';
import { contentDocumentSchema } from '@alloy-works/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

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

/** The client's bodies are `any`, so every one is checked rather than trusted before it is read. */
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

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/spaces')
      .then(({ data }) => {
        if (!current) return;
        const open = spacesIn(data) ?? [];
        setSpaces(open);
        setWhere(open[0]?.id ?? '');
      })
      .catch(() => {
        if (current) setSpaces([]);
      });
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (where === '') return undefined;
    let current = true;
    setTypes([]);
    setComponentType('');
    client
      .GET('/v1/spaces/{space}/component-types', { params: { path: { space: where } } })
      .then(({ data }) => {
        if (!current) return;
        const offered = typesIn(data) ?? [];
        setTypes(offered);
        setComponentType((offered.find((each) => each.isDefault) ?? offered[0])?.id ?? '');
      })
      .catch(() => {
        if (current) setTypes([]);
      });
    return () => {
      current = false;
    };
  }, [client, where]);

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
        // review's rule for every renderer call).
        setNotice(
          response.status === 401
            ? 'You are signed out. Sign in again to create a component.'
            : response.status === 403
              ? 'You may not create a component here.'
              : 'The component could not be created. Try again.',
        );
        return;
      }
      onCreated(id);
    } catch {
      setNotice('The component could not be created. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [client, componentType, direction, languageTag, onCreated, title, where]);

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
        <select
          value={direction}
          onChange={(event) => setDirection(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
        >
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
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
