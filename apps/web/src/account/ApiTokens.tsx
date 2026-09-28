import type { createApiClient } from '@alloy-works/api-client';
import { tokenScopes } from '@alloy-works/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { refusal, TokenTable, type ShownToken } from './TokenTable.js';
import styles from './Tokens.module.css';

type Client = ReturnType<typeof createApiClient>;

/** How far away a new token's expiry is unless the person changes it. */
const DEFAULT_DAYS = 90;
/**
 * The furthest it may be, in milliseconds from now: the service refuses more (IAM-034, TK-C). Counted as
 * the service counts it, not in days of the calendar, which across a change of the clocks can be an
 * hour longer than 365 of these.
 */
const MAX_MS = 365 * 86_400_000;

/** A day this many days after today's, at its start, in the person's own time zone. */
function daysFromToday(days: number): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
}

/** A day as a date field holds it: `YYYY-MM-DD`, in the person's own time zone. */
function dateField(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * The last day whose start is no more than 365 days from now: a year from today, or the day before it
 * where the clocks go back once more than they go forward in between and it is not yet an hour past
 * midnight, when the start of the day a year away is more than 365 days off.
 */
function latestExpiry(): Date {
  const yearAway = daysFromToday(365);
  return yearAway.getTime() > Date.now() + MAX_MS ? daysFromToday(364) : yearAway;
}

/** The start of the day a date field names, or null for none: a token stops as that day begins. */
function fromDateField(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = new Date(year, month - 1, date);
  return day.getMonth() === month - 1 ? day : null;
}

const capitalised = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** A token as the list shows it: whatever else the answer carries, never its secret. */
const shown = (token: ShownToken): ShownToken => ({
  id: token.id,
  name: token.name,
  scopes: token.scopes,
  createdAt: token.createdAt,
  expiresAt: token.expiresAt,
  lastUsedAt: token.lastUsedAt,
});

/**
 * New token: a name, what it may do besides reading, and its expiry; then its secret, shown this once
 * with Copy. The secret lives in this dialog's state alone - never in storage, the address or a log -
 * and goes when the dialog does, however it is closed.
 */
function NewToken({
  client,
  onIssued,
  onClose,
}: {
  client: Client;
  onIssued: (token: ShownToken) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ReadonlySet<string>>(new Set());
  const [expiry, setExpiry] = useState(() => dateField(daysFromToday(DEFAULT_DAYS)));
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const field = useRef<HTMLInputElement>(null);

  // The form's button, which had focus, is gone: focus goes to the secret, selected, to copy.
  useEffect(() => {
    if (secret === null) return;
    field.current?.focus();
    field.current?.select();
  }, [secret]);

  const close = () => {
    setSecret(null);
    onClose();
  };

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setProblem('Give the token a name, to tell it apart from your others.');
      return;
    }
    const expiresAt = fromDateField(expiry);
    if (
      expiresAt === null ||
      expiresAt < daysFromToday(1) ||
      expiresAt.getTime() > Date.now() + MAX_MS
    ) {
      setProblem('Choose an expiry from tomorrow to a year from today.');
      return;
    }
    setProblem('');
    setSending(true);
    try {
      const { data, error } = await client.POST('/v1/tokens', {
        body: {
          name: trimmed,
          scopes: tokenScopes.filter((scope) => scopes.has(scope)),
          expiresAt: expiresAt.toISOString(),
        },
      });
      if (data) {
        onIssued(shown(data as ShownToken));
        setSecret((data as { secret: string }).secret);
      } else {
        setProblem(refusal(error, 'The token could not be created.'));
      }
    } catch {
      setProblem('The token could not be created.');
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied('Copied.');
    } catch {
      setCopied('The token could not be copied. Select it and copy it yourself.');
    }
  };

  return (
    <Modal labelledBy="new-token-heading" onClose={close}>
      {secret === null ? (
        <section aria-labelledby="new-token-heading">
          <h2 id="new-token-heading">New token</h2>
          <label>
            Name
            <input
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Works until the start of
            <input
              type="date"
              value={expiry}
              min={dateField(daysFromToday(1))}
              max={dateField(latestExpiry())}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </label>
          <fieldset className={styles['scopes']}>
            <legend>What it may do besides reading</legend>
            <p className={styles['muted']}>
              Reading is always allowed: a token reads what you read. It can never do more than you
              may, whatever is chosen here.
            </p>
            {tokenScopes.map((scope) => (
              <label key={scope} className={styles['scope']}>
                <input
                  type="checkbox"
                  checked={scopes.has(scope)}
                  onChange={(event) => {
                    const next = new Set(scopes);
                    if (event.target.checked) next.add(scope);
                    else next.delete(scope);
                    setScopes(next);
                  }}
                />
                {capitalised(permissionName(scope))}
              </label>
            ))}
          </fieldset>
          <p role="status">{problem}</p>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={sending}
            onClick={() => void create()}
          >
            Create token
          </button>
        </section>
      ) : (
        <section aria-labelledby="new-token-heading">
          <h2 id="new-token-heading">Copy your token</h2>
          <p className={styles['warning']}>
            Copy it now: this token will not be shown again, and nobody can find it for you later.
            Keep it as you would a password.
          </p>
          <label className={styles['secret']}>
            Token
            <input
              ref={field}
              readOnly
              value={secret}
              autoComplete="off"
              spellCheck={false}
              className={styles['code']}
            />
          </label>
          <p role="status">{copied}</p>
          <button type="button" onClick={() => void copy()}>
            Copy
          </button>
          <button type="button" className="primary" onClick={close}>
            Done
          </button>
        </section>
      )}
    </Modal>
  );
}

/** What was read of the person's tokens: the list, failed, or null while it is being read. */
type Read = readonly ShownToken[] | 'failed' | null;

/**
 * API tokens, from the account chip: a modal over the page that asked for it, never a route
 * (docs/interface/README.md). The person's own tokens, each revoked after asking, and New token, whose
 * dialog opens beside this one rather than inside it, so it closes alone.
 */
export function ApiTokens({ client, onClose }: { client: Client; onClose: () => void }) {
  const [read, setRead] = useState<Read>(null);
  const [status, setStatus] = useState('');
  const [issuing, setIssuing] = useState(false);

  const load = useCallback(async () => {
    setRead(null);
    try {
      const answer = await everyPage<ShownToken>((cursor) =>
        client.GET('/v1/tokens', { params: { query: cursor === undefined ? {} : { cursor } } }),
      );
      setRead('items' in answer ? answer.items.map(shown) : 'failed');
    } catch {
      setRead('failed');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (token: ShownToken) => {
    const gone = () =>
      setRead((was) => (Array.isArray(was) ? was.filter((each) => each.id !== token.id) : was));
    try {
      const { response, error } = await client.DELETE('/v1/tokens/{id}', {
        params: { path: { id: token.id } },
      });
      if (response.ok) {
        gone();
        setStatus(`Revoked ${token.name}.`);
      } else if (response.status === 404) {
        gone();
        setStatus(`${token.name} had already been revoked.`);
      } else {
        setStatus(refusal(error, `${token.name} could not be revoked.`));
      }
    } catch {
      setStatus(`${token.name} could not be revoked.`);
    }
  };

  return (
    <>
      <Modal labelledBy="api-tokens-heading" onClose={onClose}>
        <div className={styles['tokens']}>
          <h2 id="api-tokens-heading">API tokens</h2>
          <p className={styles['muted']}>
            A token lets a script act as you, doing only what you choose of what you may do, until
            it expires or you revoke it.
          </p>
          {read === null && <Waiting>Loading...</Waiting>}
          {read === 'failed' && (
            <Notice tone="failed">
              <p>Your tokens could not be loaded.</p>
              <button type="button" onClick={() => void load()}>
                Try again
              </button>
            </Notice>
          )}
          {Array.isArray(read) && (
            <TokenTable
              label="Your tokens"
              tokens={read}
              empty={
                <Empty>
                  <p>You have no API tokens.</p>
                </Empty>
              }
              onRevoke={revoke}
            />
          )}
          <p role="status">{status}</p>
          <div className={styles['actions']}>
            <button type="button" className="primary" onClick={() => setIssuing(true)}>
              New token
            </button>
          </div>
        </div>
      </Modal>
      {issuing && (
        <NewToken
          client={client}
          onIssued={(token) => {
            setRead((was) => (Array.isArray(was) ? [...was, token] : was));
            setStatus(`Created ${token.name}.`);
          }}
          onClose={() => setIssuing(false)}
        />
      )}
    </>
  );
}
