import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

/** What a hold is placed on: an artifact or a space, by its id. */
export type HoldTarget = { readonly artifact: string } | { readonly space: string };

/** The longest reason the service takes. */
const MAX_REASON = 2000;

/**
 * Asks why before a hold is placed or released (AH-I), then does it: `act` answers what to say once
 * done, or throws what to say where it was refused, which the dialog shows and stays open.
 */
export function HoldDialog({
  heading,
  explained,
  submit,
  act,
  onDone,
  onClose,
}: {
  heading: string;
  explained: string;
  /** The button's words: Place hold or Release hold. */
  submit: string;
  act: (reason: string) => Promise<string>;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
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
    try {
      onDone(await act(trimmed));
    } catch (failed) {
      setSaid(failed instanceof Error ? failed.message : String(failed));
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="hold-heading" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id="hold-heading">{heading}</h2>
        <p>{explained}</p>
        <label>
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className={styles['muted']}>
          Shown only in Administration, to environment administrators.
        </p>
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

/** Places a hold, answering what to say, or throwing what to say where it was not. */
export async function placeHold(
  client: Client,
  target: HoldTarget,
  title: string,
  reason: string,
): Promise<string> {
  const failed = `The hold on ${title} could not be placed.`;
  const answer = await client
    .POST('/v1/holds', { body: { target, reason } })
    .catch(() => ({ data: undefined, error: undefined }));
  if (!answer.data) throw new Error(refusal(answer.error, failed));
  return `Placed a hold on ${title}.`;
}

/** Releases a hold, as `placeHold` places one. */
export async function releaseHold(
  client: Client,
  id: string,
  title: string,
  reason: string,
): Promise<string> {
  const failed = `The hold on ${title} could not be released.`;
  const answer = await client
    .POST('/v1/holds/{id}/release', { params: { path: { id } }, body: { reason } })
    .catch(() => ({ data: undefined, error: undefined }));
  if (!answer.data) throw new Error(refusal(answer.error, failed));
  return `Released the hold on ${title}.`;
}

/**
 * **Place a hold**, offered on a component's or a document's own page only to an environment
 * administrator, as its view says (AH-G); the route decides again.
 */
export function PlaceHoldButton({
  client,
  target,
  title,
  mayHold,
  onPlaced,
  className,
}: {
  client: Client;
  target: HoldTarget;
  title: string;
  mayHold: boolean;
  onPlaced: (said: string) => void;
  className?: string | undefined;
}) {
  const [asking, setAsking] = useState(false);
  if (!mayHold) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)}>
        Place a hold
      </button>
      {asking && (
        <PlaceHoldDialog
          client={client}
          target={target}
          title={title}
          onClose={() => setAsking(false)}
          onDone={(said) => {
            setAsking(false);
            onPlaced(said);
          }}
        />
      )}
    </>
  );
}

/** The dialog that places a hold on `target`, named `title`. */
export function PlaceHoldDialog({
  client,
  target,
  title,
  onDone,
  onClose,
}: {
  client: Client;
  target: HoldTarget;
  title: string;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  return (
    <HoldDialog
      heading={`Place a hold on ${title}`}
      explained={
        'space' in target
          ? 'Everything in this space is held until the hold is released.'
          : 'It is held until the hold is released.'
      }
      submit="Place hold"
      act={(reason) => placeHold(client, target, title, reason)}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
