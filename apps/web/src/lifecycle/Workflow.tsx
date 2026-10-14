import type { createApiClient } from '@alloy-works/api-client';
import { useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

export type Movable = 'component' | 'document';

/** A transition the reader may take, as a view offers it. */
export interface Offered {
  readonly key: string;
  readonly name: string;
  readonly to: { readonly key: string; readonly name: string };
  readonly reasonRequired: boolean;
}

/** Where a component or a document stands, as its view says (workflow.md, "Shown"). */
export interface Standing {
  readonly state: { readonly key: string; readonly name: string; readonly approved: boolean };
  readonly transitions: readonly Offered[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const named = (value: unknown): value is Record<string, unknown> & { key: string; name: string } =>
  isRecord(value) && typeof value.key === 'string' && typeof value.name === 'string';

/** A view's state and transitions, checked rather than trusted; undefined where it carries none. */
export function standingIn(data: unknown): Standing | undefined {
  if (!isRecord(data) || !named(data.state)) return undefined;
  const transitions = Array.isArray(data.transitions) ? data.transitions : [];
  return {
    state: {
      key: data.state.key,
      name: data.state.name,
      approved: data.state.approved === true,
    },
    transitions: transitions.flatMap((each: unknown) => {
      if (!isRecord(each) || !named(each) || !named(each.to)) return [];
      return [
        {
          key: each.key,
          name: each.name,
          to: { key: each.to.key, name: each.to.name },
          reasonRequired: each.reasonRequired === true,
        },
      ];
    }),
  };
}

/** Its standing read again from its view, for a page told it moved; undefined where it could not be. */
export async function readStanding(
  client: Client,
  kind: Movable,
  id: string,
): Promise<Standing | undefined> {
  const params = { params: { path: { id } } };
  try {
    const { data } =
      kind === 'component'
        ? await client.GET('/v1/components/{id}', params)
        : await client.GET('/v1/documents/{id}', params);
    return standingIn(data);
  } catch {
    return undefined;
  }
}

type Moved = { readonly moved: Standing } | { readonly refused: string; readonly stale: boolean };

async function move(
  client: Client,
  kind: Movable,
  id: string,
  body: { transition: string; from: string; reason?: string },
): Promise<Moved> {
  const options = { params: { path: { id } }, body };
  try {
    const { data, error } =
      kind === 'component'
        ? await client.POST('/v1/components/{id}/transitions', options)
        : await client.POST('/v1/documents/{id}/transitions', options);
    const moved = standingIn(data);
    if (moved) return { moved };
    const code = (error as { code?: unknown } | undefined)?.code;
    return {
      refused: refusal(error, 'Try again.'),
      stale:
        code === 'state_moved' ||
        code === 'transition_unknown' ||
        code === 'artifact_archived' ||
        // A permission tightened since the view was read (WF-E).
        code === 'forbidden',
    };
  } catch {
    return { refused: 'Try again.', stale: false };
  }
}

/**
 * A button for each transition the view says the reader may take (WF-F), none otherwise: the move
 * sends the state it was seen in, asks for a reason first where the transition requires one, and says
 * a refusal by the service's own words, reading the state again where it moved meanwhile.
 */
export function TransitionButtons({
  client,
  kind,
  id,
  title,
  standing,
  onMoved,
  onNotice,
  onStale,
  className,
}: {
  client: Client;
  kind: Movable;
  id: string;
  title: string;
  standing: Standing;
  onMoved: (standing: Standing, said: string) => void;
  onNotice: (said: string) => void;
  onStale: () => void;
  className?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<Offered | null>(null);

  /** Moves along `transition`, answering what to say where it was refused. */
  const take = async (transition: Offered, reason?: string): Promise<string | undefined> => {
    setBusy(true);
    const answer = await move(client, kind, id, {
      transition: transition.key,
      from: standing.state.key,
      ...(reason === undefined ? {} : { reason }),
    });
    setBusy(false);
    if ('moved' in answer) {
      onMoved(answer.moved, `Moved ${title} to ${answer.moved.state.name}.`);
      return undefined;
    }
    if (answer.stale) onStale();
    return `${title} was not moved. ${answer.refused}`;
  };

  return (
    <>
      {standing.transitions.map((transition) => (
        <button
          key={transition.key}
          type="button"
          className={className}
          disabled={busy}
          title={`Move to ${transition.to.name}`}
          onClick={() => {
            if (transition.reasonRequired) setAsking(transition);
            else {
              void take(transition).then((refused) => {
                if (refused !== undefined) onNotice(refused);
              });
            }
          }}
        >
          {transition.name}
        </button>
      ))}
      {asking && (
        <ReasonDialog
          heading={`${asking.name} ${title}`}
          explained={`It moves to ${asking.to.name}.`}
          submit={`${asking.name} to ${asking.to.name}`}
          act={async (reason) => {
            const refused = await take(asking, reason);
            if (refused === undefined) setAsking(null);
            return refused;
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

/** The longest reason the service takes. */
const MAX_REASON = 2000;

/** Asks why before a transition that requires a reason (LIF-061); a refusal is said inside it. */
function ReasonDialog({
  heading,
  explained,
  submit,
  act,
  onClose,
}: {
  heading: string;
  explained: string;
  submit: string;
  act: (reason: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const headingId = useId();
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === '') {
      setSaid('Give a reason.');
      return;
    }
    if (trimmed.length > MAX_REASON) {
      setSaid(`A reason is at most ${MAX_REASON} characters.`);
      return;
    }
    setBusy(true);
    const refused = await act(trimmed);
    if (refused !== undefined) {
      setSaid(refused);
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={headingId} onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={headingId}>{heading}</h2>
        <p>{explained}</p>
        <label>
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className={styles['muted']}>Kept with the move, for whoever reads its history.</p>
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
