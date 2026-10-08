import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Administration.module.css';

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
  | { readonly kind: 'rename' | 'archive' | 'restore'; readonly space: SpaceRow };

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
  const heading = space === null ? 'New space' : `Rename ${space.name}`;
  const failed =
    space === null ? 'The space could not be made.' : `${space.name} could not be renamed.`;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setSaid('Give the space a name.');
      return;
    }
    // In code points, as the service counts (SP-B): `maxLength` would count UTF-16 units, and stop a
    // name of 200 characters from outside the Basic Multilingual Plane at 100.
    if ([...trimmed.normalize('NFC')].length > 200) {
      setSaid('A space name is at most 200 characters.');
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
            ? `Made the space ${data.name}.`
            : `Renamed ${space.name} to ${data.name}.`,
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
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className={styles['muted']}>
          {space === null
            ? 'Grant roles on it from Access once it is made.'
            : 'Only the name changes: what is in it, and who has access, stay as they are.'}
        </p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {space === null ? 'Make space' : 'Rename space'}
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
  const failed = `${space.name} could not be ${restore ? 'restored' : 'archived'}.`;

  const change = async () => {
    setBusy(true);
    try {
      const { data, error } = await client.PATCH('/v1/spaces/{id}', {
        params: { path: { id: space.id } },
        body: { archived: !restore },
      });
      if (data) onDone(`${restore ? 'Restored' : 'Archived'} ${data.name}.`);
      else onDone(refusal(error, failed));
    } catch {
      onDone(failed);
    }
  };

  return (
    <Modal labelledBy="space-archive-heading" onClose={onClose}>
      <section aria-labelledby="space-archive-heading" className={styles['dialog']}>
        <h2 id="space-archive-heading">{`${restore ? 'Restore' : 'Archive'} ${space.name}?`}</h2>
        {restore ? (
          <p>New components, documents and the rest can be made in it again.</p>
        ) : (
          <p>
            Nothing new can be made in it. Nothing already in it changes: it can still be read,
            edited and published, and everyone keeps the access they have. It can be restored at any
            time.
          </p>
        )}
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={restore ? 'primary' : 'danger'}
            disabled={busy}
            onClick={() => void change()}
          >
            {restore ? 'Restore space' : 'Archive space'}
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
