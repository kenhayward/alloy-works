import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { useCreatableSpaces } from '../spaces.js';
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from './groups.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface GroupRow {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly number: string };
  readonly members: number;
  readonly state: { readonly key: string; readonly name: string };
}

/**
 * Making a component group (REU-060): its title, where, and its first component, the rest added on
 * its page; a group is never empty.
 */
function NewComponentGroup({ client, onClose }: { client: Client; onClose: () => void }) {
  const { spaces, where, setWhere } = useCreatableSpaces(client);
  const [title, setTitle] = useState('');
  const [components, setComponents] = useState<readonly { id: string; title: string }[] | null>(
    null,
  );
  const [first, setFirst] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (where === '') return undefined;
    let current = true;
    client
      .GET('/v1/components', {
        params: { query: { sort: 'title', order: 'asc', spaces: where } },
      })
      .then(({ data }) => {
        if (current)
          setComponents(data ? data.items.map((each) => ({ id: each.id, title: each.title })) : []);
      })
      .catch(() => current && setComponents([]));
    return () => {
      current = false;
    };
  }, [client, where]);

  const chosen = components?.some((each) => each.id === first)
    ? first
    : (components?.[0]?.id ?? '');

  const make = async () => {
    if (busy) return;
    if (title.trim() === '') {
      setSaid(words('groups.a-group-needs-a-title'));
      return;
    }
    if (chosen === '') return;
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/component-groups', {
        params: { path: { space: where } },
        body: { title: title.trim(), members: [{ component: chosen }] },
      });
      const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
      if (typeof id === 'string') window.location.hash = `#/component-groups/${id}`;
      else
        setSaid(
          typeof error?.message === 'string'
            ? error.message
            : words('groups.the-group-could-not-be-saved'),
        );
    } catch {
      setSaid(words('groups.the-group-could-not-be-saved'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="new-group-heading" onClose={onClose}>
      <section aria-labelledby="new-group-heading">
        <h2 id="new-group-heading">{words('groups.new-component-group')}</h2>
        <label>
          {words('groups.title')}
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {words('document.where')}
          <select value={where} onChange={(event) => setWhere(event.target.value)}>
            {(spaces ?? []).map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        {components !== null && components.length === 0 ? (
          <p>{words('groups.there-are-no-components-here')}</p>
        ) : (
          <label>
            {words('groups.first-component')}
            <select value={chosen} onChange={(event) => setFirst(event.target.value)}>
              {(components ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {each.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <p role="status">{said}</p>
        <button
          type="button"
          className="primary"
          disabled={busy}
          aria-disabled={chosen === '' || undefined}
          onClick={() => void make()}
        >
          {words('groups.make-group')}
        </button>
      </section>
    </Modal>
  );
}

/**
 * Components' component groups (REU-060; the CG plan, CG-D): each the reader may read, with its
 * members counted, its version and its state, and New component group where they may create.
 */
export function ComponentGroupList({ client }: { client: Client }) {
  const [rows, setRows] = useState<readonly GroupRow[] | null | 'failed'>(null);
  const [creating, setCreating] = useState(false);
  const creatable = useCreatableSpaces(client);

  const load = useCallback(async () => {
    try {
      const all = await everyPage((cursor) =>
        client.GET('/v1/component-groups', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      );
      setRows('items' in all ? (all.items as readonly GroupRow[]) : 'failed');
    } catch {
      setRows('failed');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const mayCreate = (creatable.spaces ?? []).length > 0;
  return (
    <section aria-labelledby="groups-heading">
      <div className={styles['chips']}>
        <h1 id="groups-heading">{words('groups.component-groups')}</h1>
        {mayCreate && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            {words('groups.new-component-group')}
          </button>
        )}
      </div>
      {creating && <NewComponentGroup client={client} onClose={() => setCreating(false)} />}
      {rows === 'failed' ? (
        <Notice tone="failed">
          <p>{words('groups.the-groups-could-not-be-loaded')}</p>
          <button type="button" onClick={() => void load()}>
            {words('editor.try-again')}
          </button>
        </Notice>
      ) : rows === null ? null : rows.length === 0 ? (
        <p>{words('groups.there-are-no-component-groups')}</p>
      ) : (
        <table className={styles['table']} aria-label={words('groups.component-groups')}>
          <thead>
            <tr>
              <th scope="col">{words('groups.title')}</th>
              <th scope="col">{words('editor.space')}</th>
              <th scope="col">{words('groups.members')}</th>
              <th scope="col">{words('groups.version')}</th>
              <th scope="col">{words('groups.state')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <a href={`#/component-groups/${row.id}`} data-content>
                    {row.title}
                  </a>
                </td>
                <td data-content>{row.space.name}</td>
                <td>{words('groups.count-members', { count: row.members })}</td>
                <td>{row.version.number}</td>
                <td>
                  <StateLozenge size="small" state={row.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
