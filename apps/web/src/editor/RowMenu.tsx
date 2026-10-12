import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useRef, useState } from 'react';

import { isAccessAnswers } from '../access/describe.js';
import { archivalSaid, setArchived } from '../lifecycle/Archive.js';
import styles from './RowMenu.module.css';

type Client = ReturnType<typeof createApiClient>;

const NOT_COPIED = 'The link could not be copied. Select it and copy it instead.';

/**
 * What can be done to one component from the list: open it, copy its link and - only for somebody
 * the service says may administer it - manage its access, and for somebody who may retire it, archive
 * or unarchive it. The last two are asked about when the menu opens, not for every row on the page;
 * the routes enforce permission again either way.
 */
export function RowMenu({
  client,
  id,
  title,
  archived = false,
  onNotice,
  onArchived = () => {},
}: {
  client: Client;
  id: string;
  title: string;
  /** Whether it is archived, so the menu offers Unarchive rather than Archive. */
  archived?: boolean;
  onNotice: (message: string) => void;
  /** Told once it is archived or unarchived, so the list can be read again. */
  onArchived?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [administers, setAdministers] = useState(false);
  const [retires, setRetires] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    client
      .GET('/v1/access', { params: { query: { target: `artifact:${id}` } } })
      .then(({ data }) => {
        if (!current || !isAccessAnswers(data)) return;
        const allowed = (permission: string) =>
          data.permissions.find((each) => each.permission === permission)?.allowed === true;
        setAdministers(allowed('administer'));
        setRetires(allowed('retire'));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, id, open]);

  const close = () => {
    setOpen(false);
    setAdministers(false);
    setRetires(false);
  };

  const archive = async () => {
    close();
    const now = await setArchived(client, 'component', id, !archived);
    onNotice(archivalSaid(title, now, !archived));
    if (now !== undefined) onArchived();
  };

  const copy = () => {
    close();
    const address = `${window.location.origin}${window.location.pathname}#/components/${id}`;
    const copying = navigator.clipboard?.writeText(address);
    if (!copying) {
      onNotice(NOT_COPIED);
      return;
    }
    copying.then(
      () => onNotice(`Copied the link to ${title}.`),
      () => onNotice(NOT_COPIED),
    );
  };

  return (
    <div
      className={styles['holder']}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles['kebab']}
        aria-label={`Actions for ${title}`}
        title={`Actions for ${title}`}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">...</span>
      </button>
      {open && (
        <ul className={styles['menu']}>
          <li>
            <a className={styles['item']} href={`#/components/${id}`}>
              Open
            </a>
          </li>
          <li>
            <button type="button" className={styles['item']} onClick={copy}>
              Copy link
            </button>
          </li>
          {administers && (
            <li>
              <a className={styles['item']} href={`#/components/${id}/access`}>
                Manage access
              </a>
            </li>
          )}
          {retires && (
            <li>
              <button type="button" className={styles['item']} onClick={() => void archive()}>
                {archived ? 'Unarchive' : 'Archive'}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
