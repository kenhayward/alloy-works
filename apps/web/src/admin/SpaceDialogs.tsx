import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { PlaceHoldDialog } from '../lifecycle/Hold.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A space as Administration's Spaces lists it. */
export interface SpaceRow {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly mayCreate: boolean;
}

/** What is being done to a space, while its dialog is open. */
export type SpaceAct =
  | { readonly kind: 'new' }
  | { readonly kind: 'rename' | 'archive' | 'restore' | 'hold'; readonly space: SpaceRow };

/**
 * Making or renaming a space (the SP1 plan, SP-G): a name, which the service normalises, trims and
 * checks, saying why where it refuses one.
 */
function Naming({
  client,
  space,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow | null;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(space?.name ?? '');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const heading =
    space === null ? words('admin.new-space') : words('admin.rename', { name: space.name });
  const failed =
    space === null
      ? words('admin.the-space-could-not-be')
      : words('admin.could-not-be-renamed', { name: space.name });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setSaid(words('admin.give-the-space-a-name'));
      return;
    }
    // In code points, as the service counts (SP-B): `maxLength` would count UTF-16 units, and stop a
    // name of 200 characters from outside the Basic Multilingual Plane at 100.
    if ([...trimmed.normalize('NFC')].length > 200) {
      setSaid(words('admin.a-space-name-is-at'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } =
        space === null
          ? await client.POST('/v1/spaces', { body: { name: trimmed } })
          : await client.PATCH('/v1/spaces/{id}', {
              params: { path: { id: space.id } },
              body: { name: trimmed },
            });
      if (data) {
        onDone(
          space === null
            ? words('admin.made-the-space', { name: data.name })
            : words('admin.renamed-to', { from: space.name, to: data.name }),
        );
      } else setSaid(refusal(error, failed));
    } catch {
      setSaid(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="space-name-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void save(event)}>
        <h2 id="space-name-heading">{heading}</h2>
        <label>
          {words('admin.name')}
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className={styles['muted']}>
          {space === null
            ? words('admin.grant-roles-on-it-from')
            : words('admin.only-the-name-changes-what')}
        </p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {space === null ? words('admin.make-space') : words('admin.rename-space')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Archiving or restoring a space, after saying what it changes and what it does not (SP-C, SP-G). A
 * refusal - the last space not archived - is said in Spaces once the dialog has gone.
 */
function Archiving({
  client,
  space,
  restore,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow;
  restore: boolean;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const failed = words('admin.could-not-be', {
    name: space.name,
    change: restore ? 'restore' : 'archive',
  });

  const change = async () => {
    setBusy(true);
    try {
      const { data, error } = await client.PATCH('/v1/spaces/{id}', {
        params: { path: { id: space.id } },
        body: { archived: !restore },
      });
      if (data)
        onDone(
          words('admin.space-changed', {
            change: restore ? 'restore' : 'archive',
            name: data.name,
          }),
        );
      else onDone(refusal(error, failed));
    } catch {
      onDone(failed);
    }
  };

  return (
    <Modal labelledBy="space-archive-heading" onClose={onClose}>
      <section aria-labelledby="space-archive-heading" className={styles['dialog']}>
        <h2 id="space-archive-heading">
          {words('admin.space-change-question', {
            change: restore ? 'restore' : 'archive',
            name: space.name,
          })}
        </h2>
        {restore ? (
          <p>{words('admin.new-components-documents-and-the')}</p>
        ) : (
          <p>{words('admin.nothing-new-can-be-made')}</p>
        )}
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button
            type="button"
            className={restore ? 'primary' : 'danger'}
            disabled={busy}
            onClick={() => void change()}
          >
            {restore ? words('admin.restore-space') : words('admin.archive-space')}
          </button>
        </div>
      </section>
    </Modal>
  );
}

/** The dialog for what is being done to a space; `onDone` says what came of it. */
export function SpaceDialog({
  client,
  act,
  onDone,
  onClose,
}: {
  client: Client;
  act: SpaceAct;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  if (act.kind === 'new') {
    return <Naming client={client} space={null} onDone={onDone} onClose={onClose} />;
  }
  if (act.kind === 'hold') {
    return (
      <PlaceHoldDialog
        client={client}
        target={{ space: act.space.id }}
        title={act.space.name}
        onDone={onDone}
        onClose={onClose}
      />
    );
  }
  if (act.kind === 'rename') {
    return <Naming client={client} space={act.space} onDone={onDone} onClose={onClose} />;
  }
  return (
    <Archiving
      client={client}
      space={act.space}
      restore={act.kind === 'restore'}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
