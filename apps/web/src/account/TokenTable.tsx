import { useEffect, useRef, useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Tokens.module.css';
import { formats, words, type WordKey } from '../words/words.js';

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
  formats().date(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A moment as a person reads it, to the minute, in their own time zone and words: when a token stops,
 * which is as a day begins where the form made it, so its day alone would read as a day it still works.
 */
export const moment = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Each permission a token may hold, in a list and as a choice's label. */
const PERMISSIONS: Readonly<Record<string, readonly [WordKey, WordKey]>> = {
  read: ['account.permission.read', 'account.permission-label.read'],
  create: ['account.permission.create', 'account.permission-label.create'],
  edit: ['account.permission.edit', 'account.permission-label.edit'],
  comment: ['account.permission.comment', 'account.permission-label.comment'],
  suggest: ['account.permission.suggest', 'account.permission-label.suggest'],
  approve: ['account.permission.approve', 'account.permission-label.approve'],
  publish: ['account.permission.publish', 'account.permission-label.publish'],
  design: ['account.permission.design', 'account.permission-label.design'],
  manage_definitions: [
    'account.permission.manage-definitions',
    'account.permission-label.manage-definitions',
  ],
  administer: ['account.permission.administer', 'account.permission-label.administer'],
  use_connection: ['account.permission.use-connection', 'account.permission-label.use-connection'],
  write_sql: ['account.permission.write-sql', 'account.permission-label.write-sql'],
  retire: ['account.permission.retire', 'account.permission-label.retire'],
};

/** A permission as a list of them says it; the access page's words for one this page does not know. */
const permissionWords = (permission: string) => {
  const keys = PERMISSIONS[permission];
  return keys === undefined ? permissionName(permission) : words(keys[0]);
};

/** A permission as a choice of it is labelled. */
export const permissionLabel = (permission: string) => {
  const keys = PERMISSIONS[permission];
  return keys === undefined ? permissionName(permission) : words(keys[1]);
};

/**
 * What a token may do, in the access page's words: reading always, since reading is never masked
 * (service-foundations.md, TK-B), and then its scopes.
 */
export const mayDo = (token: ShownToken) =>
  formats().list(['read', ...token.scopes].map(permissionWords), { type: 'unit' });

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
              <th scope="col">{words('account.name')}</th>
              <th scope="col">{words('account.may-do')}</th>
              <th scope="col">{words('account.works-until')}</th>
              <th scope="col">{words('account.last-used')}</th>
              <th scope="col">
                <span className={styles['hidden']}>{words('account.revoke')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className={styles['name']} data-content>
                  {token.name}
                </td>
                <td className={styles['muted']}>{mayDo(token)}</td>
                <td>{moment(token.expiresAt)}</td>
                <td>
                  {token.lastUsedAt === null ? words('account.never-used') : day(token.lastUsedAt)}
                </td>
                <td className={styles['act']}>
                  <button
                    type="button"
                    className="danger"
                    aria-label={words('account.revoke-2', { name: token.name })}
                    onClick={() => setConfirming(token)}
                  >
                    {words('account.revoke')}
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
            <h2 id="revoke-token-heading">
              {words('account.revoke-3', { name: confirming.name })}
            </h2>
            <p>{words('account.anything-using-this-token-is')}</p>
            <div className={styles['actions']}>
              <button type="button" onClick={() => setConfirming(null)}>
                {words('account.keep-it')}
              </button>
              <button type="button" className="danger" onClick={() => void confirm()}>
                {words('account.revoke-token')}
              </button>
            </div>
          </section>
        </Modal>
      )}
    </div>
  );
}
