import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import styles from './PublicationPage.module.css';

type Client = ReturnType<typeof createApiClient>;

const DAY = 86_400_000;
/** The default and the cap for access from outside, as the service holds them (IAM-049). */
const DEFAULT_DAYS = 30;
const CAP_DAYS = 90;

interface Share {
  readonly id: string;
  readonly recipient: {
    readonly email: string | null;
    readonly name: string | null;
    readonly signedIn: boolean;
  };
  readonly expiresAt: string;
  readonly expired: boolean;
  readonly accesses: readonly { readonly at: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A listing's shares, read defensively: none where the answer is not one. */
function sharesIn(data: unknown): readonly Share[] | undefined {
  return isRecord(data) && Array.isArray(data.shares) ? (data.shares as Share[]) : undefined;
}

/** A date as a date input holds it, in the reader's own time. */
const localDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
const inDays = (days: number) => localDay(new Date(Date.now() + days * DAY));
const when = (at: string) => new Date(at).toLocaleDateString(undefined, { dateStyle: 'long' });

/**
 * **Shared outside the organisation** (PUB-057, PUB-058, PUB-060; the R17 plan): to whoever may share
 * the publication, each share - who, until when, whether they have signed in, how often they opened
 * it - with Revoke, which asks first; and **Share outside**, by address, until a day within the cap.
 * Nothing at all to anybody else.
 */
export function Shares({ client, publication }: { client: Client; publication: string }) {
  const headingId = useId();
  const [shares, setShares] = useState<readonly Share[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [revoking, setRevoking] = useState<Share | null>(null);
  const [said, setSaid] = useState('');

  const read = useCallback(async () => {
    const { data } = await client
      .GET('/v1/publications/{id}/shares', { params: { path: { id: publication } } })
      .catch(() => ({ data: undefined }));
    setShares(sharesIn(data) ?? null);
  }, [client, publication]);
  useEffect(() => {
    void read();
  }, [read]);

  if (shares === null) return null;
  const nameOf = (each: Share) => each.recipient.name ?? each.recipient.email ?? 'Somebody';
  return (
    <section className={styles['section']} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles['label']}>
        Shared outside
      </h3>
      {shares.length === 0 ? (
        <p>Shared with nobody outside the organisation.</p>
      ) : (
        <ul className={styles['shares']}>
          {shares.map((each) => (
            <li key={each.id}>
              <span>{nameOf(each)}</span>
              {each.recipient.name !== null && each.recipient.email !== null && (
                <span className={styles['muted']}>{each.recipient.email}</span>
              )}
              <span className={styles['muted']}>
                {each.expired ? `Ended ${when(each.expiresAt)}` : `Until ${when(each.expiresAt)}`}
              </span>
              <span className={styles['muted']}>
                {!each.recipient.signedIn
                  ? 'Not signed in yet'
                  : each.accesses.length === 0
                    ? 'Not opened yet'
                    : `Opened ${each.accesses.length} ${each.accesses.length === 1 ? 'time' : 'times'}, last on ${when(each.accesses[0]!.at)}`}
              </span>
              <button
                type="button"
                aria-label={`Revoke ${each.recipient.email ?? nameOf(each)}`}
                onClick={() => setRevoking(each)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {said !== '' && <p role="status">{said}</p>}
      <p>
        <button type="button" onClick={() => setSharing(true)}>
          Share outside
        </button>
      </p>
      {sharing && (
        <ShareDialog
          client={client}
          publication={publication}
          onClose={() => setSharing(false)}
          onShared={(email) => {
            setSharing(false);
            setSaid(
              `Shared with ${email}. Send them the address of this page: they read it once they sign in with that address.`,
            );
            void read();
          }}
        />
      )}
      {revoking !== null && (
        <ConfirmDialog
          question="Revoke this share?"
          sentence={`${nameOf(revoking)} can no longer open this publication or save its files, from now.`}
          keep="Keep it"
          act="Revoke"
          onKeep={() => setRevoking(null)}
          onAct={async () => {
            const { error } = await client.DELETE('/v1/publications/{id}/shares/{share}', {
              params: { path: { id: publication, share: revoking.id } },
            });
            if (error) throw new Error('not revoked');
            setRevoking(null);
            setSaid('');
            await read();
          }}
        />
      )}
    </section>
  );
}

function ShareDialog({
  client,
  publication,
  onClose,
  onShared,
}: {
  client: Client;
  publication: string;
  onClose: () => void;
  onShared: (email: string) => void;
}) {
  const headingId = useId();
  const [email, setEmail] = useState('');
  const [until, setUntil] = useState(inDays(DEFAULT_DAYS));
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const share = async (event: React.FormEvent) => {
    event.preventDefault();
    if (email.trim() === '') {
      setSaid('Give the address of the person to share it with.');
      return;
    }
    // The day chosen, at this time of day: 30 days from now unless changed, never past the cap.
    const [year, month, day] = until.split('-').map(Number);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(year!, month! - 1, day!);
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/publications/{id}/shares', {
        params: { path: { id: publication } },
        body: { email: email.trim(), expiresAt: expiresAt.toISOString() },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onShared(email.trim().toLowerCase());
    else setSaid(refusal(error, 'It could not be shared.'));
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void share(event)}>
        <h2 id={headingId}>Share outside the organisation</h2>
        <p className={styles['muted']}>
          Somebody from outside reads this publication alone, and only once they sign in with the
          address given here. Every time they open it is recorded.
        </p>
        <label>
          Their email address
          <input
            type="email"
            value={email}
            maxLength={254}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Until
          <input
            type="date"
            value={until}
            min={inDays(1)}
            max={inDays(CAP_DAYS)}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
        {said !== '' && <p role="alert">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Share
          </button>
        </div>
      </form>
    </Modal>
  );
}
