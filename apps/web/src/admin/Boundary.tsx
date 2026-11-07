import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { permissionName } from '../access/describe.js';
import { administersAt } from '../access/ManageAccessLink.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { words } from '../words/words.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

type Way =
  | 'model_endpoint'
  | 'embedding'
  | 'translation'
  | 'reference_source'
  | 'malware_scanning'
  | 'data_connection'
  | 'webhook'
  | 'mail'
  | 'extension'
  | 'vocabulary_source'
  | 'ct_studio';

/** A way out as `GET /v1/boundary` answers it: never a secret or an address's path. */
interface WayRow {
  readonly way: Way;
  readonly onByDefault: boolean;
  readonly changedBy: { readonly operation: string; readonly permission: string } | null;
  readonly residency: 'endpoint' | 'not_declared';
  readonly absent: string | null;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly on: boolean;
    readonly host: string | null;
    readonly boundary: 'inside' | 'outside' | null;
  }[];
}

/** Where each is changed: the page that already does it. */
const CHANGED_AT: Readonly<Record<Way, string | null>> = {
  model_endpoint: '#/admin/models',
  embedding: '#/admin/models',
  translation: '#/admin/translation',
  reference_source: '#/admin/reference-sources',
  malware_scanning: null,
  data_connection: '#/admin/connections',
  webhook: '#/admin/webhooks',
  mail: '#/admin/email',
  extension: '#/admin/extensions',
  vocabulary_source: '#/admin/vocabularies',
  ct_studio: '#/admin/ctstudio',
};

const wayName = (way: Way) => words(`admin.boundary-way.${way}`);

/**
 * Administration's **What leaves** (secrets.md, "The boundary"; ADM-041): every way anything can leave
 * the environment, what may leave by it, whether it is on before anyone changes it, who may change
 * it, its residency where an endpoint declares one, and what is set up here, each linked to the page
 * that changes it. Asked of the service, as every panel is: one who does not administer is told so.
 */
export function Boundary({ client }: { client: Client }) {
  const [read, setRead] = useState<readonly WayRow[] | 'refused' | 'failed' | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      if (!(await administersAt(client, 'tenant', 'administer'))) {
        if (current) setRead('refused');
        return;
      }
      try {
        const { data, response } = await client.GET('/v1/boundary');
        if (!current) return;
        if (data) setRead((data as { ways: readonly WayRow[] }).ways);
        else setRead(response.status === 403 ? 'refused' : 'failed');
      } catch {
        if (current) setRead('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.boundary-lead')}</p>
      </div>
      {read === null ? (
        <Waiting>{words('admin.loading')}</Waiting>
      ) : read === 'refused' ? (
        <Notice tone="refused">
          <p>{words('admin.boundary-not-yours')}</p>
        </Notice>
      ) : read === 'failed' ? (
        <Notice tone="failed">
          <p>{words('admin.boundary-could-not-be-read')}</p>
        </Notice>
      ) : (
        <table aria-label={words('admin.boundary')} className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">{words('admin.boundary-way')}</th>
              <th scope="col">{words('admin.boundary-by-default')}</th>
              <th scope="col">{words('admin.boundary-changed-by')}</th>
              <th scope="col">{words('admin.boundary-residency')}</th>
              <th scope="col">{words('admin.boundary-here')}</th>
              <th scope="col">
                <span className={styles['hidden']}>{words('admin.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {read.map((row) => {
              const at = CHANGED_AT[row.way];
              return (
                <tr key={row.way}>
                  <td className={styles['wraps']}>
                    <span className={styles['strong']}>{wayName(row.way)}</span>
                    <br />
                    <span className={styles['muted']}>
                      {words(`admin.boundary-what.${row.way}`)}
                    </span>
                  </td>
                  <td>{words('admin.boundary-on-off', { on: row.onByDefault ? 'yes' : 'no' })}</td>
                  <td className={styles['wraps']}>
                    {row.changedBy === null
                      ? words('admin.boundary-changed-by-nobody')
                      : words('admin.boundary-changed-by-holder', {
                          permission: permissionName(row.changedBy.permission),
                        })}
                  </td>
                  <td className={styles['wraps']}>
                    {words(`admin.boundary-residency.${row.residency}`)}
                  </td>
                  <td className={styles['wraps']}>
                    {row.absent !== null ? (
                      <span className={styles['muted']}>
                        {row.way === 'malware_scanning'
                          ? words('admin.boundary-absent.malware_scanning')
                          : words('admin.boundary-absent')}
                      </span>
                    ) : row.items.length === 0 ? (
                      <span className={styles['muted']}>{words('admin.boundary-here-none')}</span>
                    ) : (
                      <ul className={styles['consumers']}>
                        {row.items.map((item) => (
                          <li key={item.id}>
                            {words('admin.boundary-item', {
                              name: item.name,
                              on: item.on ? 'yes' : 'no',
                              host:
                                item.host === null || item.host === item.name ? 'none' : item.host,
                              boundary: item.boundary ?? 'none',
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={styles['wraps']}>
                    {at !== null && (
                      <a
                        href={at}
                        aria-label={words('admin.boundary-change-for', { way: wayName(row.way) })}
                      >
                        {words('admin.boundary-change')}
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
