import { useEffect, useRef, useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Tokens.module.css';

/**
 * A personal token as `GET /v1/tokens` and `GET /v1/principals/{id}/tokens` list it: never its secret,
 * which the service answers once, to `POST /v1/tokens`, and keeps only as a hash. Written out rather
 * than taken from `@alloy-works/api-client`, whose built declarations do not carry its generated types.
 */
export interface ShownToken {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
}

/** A day as a person reads it, in their own time zone and words. */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * What a token may do, in the access page's words: reading always, since reading is never masked
 * (service-foundations.md, TK-B), and then its scopes.
 */
export const mayDo = (token: ShownToken) =>
  ['read', ...token.scopes].map(permissionName).join(', ');

/** The service's own sentence for a refusal, where it gave one; this page's otherwise. */
export function refusal(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown };
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}

/**
 * A person's tokens, each with Revoke, which asks first, or what is said where there are none. Shared
 * by the person's own API tokens and by Administration's People; what revoking calls, and what is said
 * of it, are the caller's.
 */
export function TokenTable({
  label,
  tokens,
  empty,
  onRevoke,
}: {
  label: string;
  tokens: readonly ShownToken[];
  /** Shown in place of the table where there are no tokens, the last one revoked included. */
  empty: React.ReactNode;
  /** Revokes it, and says what happened; resolves once the list says so too. */
  onRevoke: (token: ShownToken) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<ShownToken | null>(null);
  const [revoked, setRevoked] = useState(0);
  const holder = useRef<HTMLDivElement>(null);

  // A row revoked takes its Revoke button, which had focus, with it: focus stays with the list, or with
  // what is said in its place, rather than falling out of the dialog, where Escape would not close it.
  useEffect(() => {
    if (revoked === 0) return;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) holder.current?.focus();
  }, [revoked]);

  const confirm = async () => {
    const token = confirming;
    setConfirming(null);
    if (token === null) return;
    await onRevoke(token);
    setRevoked((count) => count + 1);
  };

  return (
    <div ref={holder} className={styles['holder']} tabIndex={-1}>
      {tokens.length === 0 ? (
        empty
      ) : (
        <table aria-label={label}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">May</th>
              <th scope="col">Expires</th>
              <th scope="col">Last used</th>
              <th scope="col">
                <span className={styles['hidden']}>Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className={styles['name']}>{token.name}</td>
                <td className={styles['muted']}>{mayDo(token)}</td>
                <td>{day(token.expiresAt)}</td>
                <td>{token.lastUsedAt === null ? 'never' : day(token.lastUsedAt)}</td>
                <td className={styles['act']}>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Revoke ${token.name}`}
                    onClick={() => setConfirming(token)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming !== null && (
        <Modal labelledBy="revoke-token-heading" onClose={() => setConfirming(null)}>
          <section aria-labelledby="revoke-token-heading">
            <h2 id="revoke-token-heading">{`Revoke ${confirming.name}?`}</h2>
            <p>
              Anything using this token is refused from its next request. A token revoked cannot be
              brought back: issue a new one instead.
            </p>
            <div className={styles['actions']}>
              <button type="button" onClick={() => setConfirming(null)}>
                Keep it
              </button>
              <button type="button" className="danger" onClick={() => void confirm()}>
                Revoke token
              </button>
            </div>
          </section>
        </Modal>
      )}
    </div>
  );
}
