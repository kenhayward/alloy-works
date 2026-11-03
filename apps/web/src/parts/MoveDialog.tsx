import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useImperativeHandle, useState, type Ref } from 'react';

import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { words } from '../words/words.js';
import styles from './MoveDialog.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Skip {
  readonly id: string;
  readonly reason: string;
  readonly title: string | null;
}

interface Preview {
  readonly moved: readonly string[];
  readonly skipped: readonly Skip[];
  readonly grantsEnded: number;
  readonly sharesKept: number;
  readonly consequences: Readonly<Record<string, number>>;
}

interface Target {
  readonly id: string;
  readonly name: string;
}

/** The spaces the service says the caller may move into, from a body checked rather than trusted. */
export function movableSpacesIn(data: unknown, from: string): Target[] {
  if (typeof data !== 'object' || data === null || !('items' in data)) return [];
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, mayMoveInto } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || mayMoveInto !== true) return [];
    return id === from ? [] : [{ id, name }];
  });
}

/** Why it refuses, in words; anything unlooked for says only that it could not. */
function refusedWords(code: unknown): string {
  switch (code) {
    case 'artifact_held':
      return words('moving.refused-held');
    case 'artifact_kept':
      return words('moving.refused-kept');
    case 'artifact_archived':
      return words('moving.refused-archived');
    case 'space_archived':
      return words('moving.refused-space-archived');
    case 'space_moved':
      return words('moving.refused-moved');
    case 'move_too_large':
      return words('moving.refused-too-large');
    case 'asset_uploading':
      return words('moving.refused-uploading');
    default:
      return words('moving.could-not');
  }
}

/** What stays and why, and what the move leaves behind; only what is so is said (MV-G). */
function linesOf(preview: Preview): string[] {
  const reasons: Readonly<Record<string, string>> = {
    not_permitted: words('moving.stays-not-permitted'),
    held: words('moving.stays-held'),
    kept: words('moving.stays-kept'),
    placed_elsewhere: words('moving.stays-placed-elsewhere'),
    archived: words('moving.stays-archived'),
    in_use: words('moving.stays-in-use'),
    dataset: words('moving.stays-dataset'),
    uploading: words('moving.stays-uploading'),
  };
  const { consequences: c } = preview;
  const counted = (key: string, count: number | undefined) =>
    count ? [words(key as never, { count } as never)] : [];
  return [
    ...preview.skipped.map((each) =>
      words('moving.stays', {
        name: each.title ?? words('moving.a-part-you-may-not-read'),
        reason: reasons[each.reason] ?? each.reason,
      }),
    ),
    ...counted('moving.grants-end', preview.grantsEnded),
    ...counted('moving.shares-stay', preview.sharesKept),
    ...counted('moving.citations', c['citations']),
    ...counted('moving.terms', c['terms']),
    ...counted('moving.images-staying', c['imagesStaying']),
    ...counted('moving.bound', c['bound']),
    ...counted('moving.using-template', c['usingTemplate']),
    ...counted('moving.open-rounds', c['openRounds']),
    ...counted('moving.delivered', c['delivered']),
  ];
}

/**
 * Moving to another space (moving.md; the MV plan): what the Document menu and a component's band open.
 * It says first what would come along, what stays and what would stop working, from the service's own
 * plan, so it cannot say what the move would not do.
 */
export function MoveDialog({
  act,
  client,
  id,
  from,
  carries,
  onMoved,
}: {
  act: Ref<() => void>;
  client: Client;
  id: string;
  from: string;
  /** A document: it offers to take its components and images with it. */
  carries: boolean;
  onMoved: (said: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(act, () => () => setOpen(true), []);
  return open ? (
    <Dialog
      client={client}
      id={id}
      from={from}
      carries={carries}
      onClose={() => setOpen(false)}
      onMoved={(said) => {
        setOpen(false);
        onMoved(said);
      }}
    />
  ) : null;
}

function Dialog({
  client,
  id,
  from,
  carries,
  onClose,
  onMoved,
}: {
  client: Client;
  id: string;
  from: string;
  carries: boolean;
  onClose: () => void;
  onMoved: (said: string) => void;
}) {
  const heading = useId();
  const [targets, setTargets] = useState<readonly Target[] | null>(null);
  const [to, setTo] = useState('');
  const [also, setAlso] = useState(carries);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const all = await everyPage((cursor) =>
          client.GET('/v1/spaces', {
            params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
          }),
        );
        if (!current) return;
        const found = movableSpacesIn(all, from);
        setTargets(found);
        setTo(found[0]?.id ?? '');
      } catch {
        if (current) {
          setTargets([]);
          setSaid(words('moving.could-not'));
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [client, from]);

  useEffect(() => {
    if (to === '') return;
    let current = true;
    setPreview(null);
    setSaid('');
    void (async () => {
      try {
        const { data, error } = await client.POST('/v1/artifacts/{id}/move/preview', {
          params: { path: { id } },
          body: { from, to, also },
        });
        if (!current) return;
        if (data) setPreview(data as Preview);
        else setSaid(refusedWords((error as { code?: unknown } | undefined)?.code));
      } catch {
        if (current) setSaid(words('moving.could-not'));
      }
    })();
    return () => {
      current = false;
    };
  }, [client, id, from, to, also]);

  const move = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/artifacts/{id}/move', {
        params: { path: { id } },
        body: { from, to, also },
      });
      if (data) {
        const name = targets?.find((each) => each.id === to)?.name ?? '';
        onMoved(
          words('moving.moved', { name, count: data.moved.length, stays: data.skipped.length }),
        );
        return;
      }
      setSaid(refusedWords((error as { code?: unknown } | undefined)?.code));
    } catch {
      setSaid(words('moving.could-not'));
    } finally {
      setBusy(false);
    }
  };

  const lines = preview === null ? [] : linesOf(preview);
  return (
    <Modal labelledBy={heading} onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void move(event)}>
        <h2 id={heading}>{words('moving.move-to-another-space')}</h2>
        {targets !== null && targets.length === 0 && said === '' && (
          <p>{words('moving.nowhere')}</p>
        )}
        {targets !== null && targets.length > 0 && (
          <label>
            {words('moving.move-to')}
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              {targets.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {carries && (
          <label className={styles['check']}>
            <input
              type="checkbox"
              checked={also}
              onChange={(event) => setAlso(event.target.checked)}
            />
            {words('moving.also')}
          </label>
        )}
        {preview !== null && (
          <>
            <p>{words('moving.will-move', { count: preview.moved.length })}</p>
            {lines.length > 0 && (
              <ul className={styles['lines']}>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy || preview === null}>
            {words('moving.move')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
