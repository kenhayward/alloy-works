import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { administersAt } from '../access/ManageAccessLink.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { formats, words } from '../words/words.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

export type SecretKind =
  | 'sign_in_client_secret'
  | 'shared_provider_secret'
  | 'connection_credential'
  | 'delivery_store_password'
  | 'model_endpoint_key'
  | 'webhook_signing_secret'
  | 'extension_secret'
  | 'mail_relay_password'
  | 'scim_token'
  | 'ct_studio_token'
  | 'service_identity_token';

type ConsumerKind =
  | 'sign_in'
  | 'member_tenant'
  | 'query_definition'
  | 'dataset'
  | 'data_delivery'
  | 'purpose'
  | 'guardrails'
  | 'translation_policy'
  | 'webhook_subscription'
  | 'reference_source'
  | 'mail_delivery'
  | 'provisioning'
  | 'ct_studio_space'
  | 'service_identity';

/** A secret as `GET /v1/secrets` lists it: never its value. */
export interface SecretRow {
  readonly kind: SecretKind;
  readonly of: { readonly id: string; readonly name: string | null };
  readonly replacedAt: string | null;
  readonly previousUntil: string | null;
  readonly replacement: { readonly how: 'overlap' | 'atomic' | 'beside' };
  readonly consumers: readonly {
    readonly kind: ConsumerKind;
    readonly id: string | null;
    readonly name: string | null;
  }[];
}

interface Listing {
  readonly items: readonly SecretRow[];
  readonly absent: readonly { readonly what: string; readonly why: string }[];
}

/** A kind of secret, as a cell names it. */
export const secretKindName = (kind: SecretKind): string => words(`admin.secret-kind.${kind}`);

/** Where each is replaced: the page that already does it. */
const replacedAt = (row: SecretRow): string =>
  ({
    sign_in_client_secret: '#/admin/sign-in',
    shared_provider_secret: '#/admin/sign-in',
    scim_token: '#/admin/sign-in',
    connection_credential: `#/connections/${row.of.id}/credential`,
    delivery_store_password: '#/admin/ctstudio',
    ct_studio_token: '#/admin/ctstudio',
    model_endpoint_key: '#/admin/models',
    webhook_signing_secret: '#/admin/webhooks',
    extension_secret: '#/admin/extensions',
    mail_relay_password: '#/admin/email',
    service_identity_token: '#/admin/people',
  })[row.kind];

const consumerName = (each: SecretRow['consumers'][number]): string =>
  each.name === null
    ? words(`admin.secret-consumer.${each.kind}`)
    : words('admin.secret-consumer-named', {
        kind: words(`admin.secret-consumer.${each.kind}`),
        name: each.name,
      });

const when = (at: string) =>
  formats().date(new Date(at), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Administration's **Secrets** (secrets.md; ADM-007, ADM-047): every secret the environment holds,
 * what uses each, when it was last replaced and how long an old value is still accepted, each linked
 * to where it is replaced, so an administrator sees every dependent first. Asked of the service, as
 * every panel is: one without `rotate_secrets` is told so and sent nothing more.
 */
export function Secrets({ client }: { client: Client }) {
  const [read, setRead] = useState<Listing | 'refused' | 'failed' | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      if (!(await administersAt(client, 'tenant', 'rotate_secrets'))) {
        if (current) setRead('refused');
        return;
      }
      try {
        const { data, response } = await client.GET('/v1/secrets');
        if (!current) return;
        if (data) setRead(data as Listing);
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
        <p>{words('admin.secrets-lead')}</p>
      </div>
      {read === null ? (
        <Waiting>{words('admin.loading')}</Waiting>
      ) : read === 'refused' ? (
        <Notice tone="refused">
          <p>{words('admin.secrets-not-yours')}</p>
        </Notice>
      ) : read === 'failed' ? (
        <Notice tone="failed">
          <p>{words('admin.secrets-could-not-be-read')}</p>
        </Notice>
      ) : (
        <>
          {read.items.length === 0 ? (
            <p className={styles['muted']}>{words('admin.secrets-none')}</p>
          ) : (
            <table aria-label={words('admin.secrets')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.secret')}</th>
                  <th scope="col">{words('admin.secret-used-by')}</th>
                  <th scope="col">{words('admin.secret-replaced')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {read.items.map((row) => (
                  <tr key={`${row.kind}:${row.of.id}`}>
                    <td className={styles['wraps']}>
                      <span className={styles['strong']} data-content>
                        {row.of.name ?? words('admin.secret-unnamed')}
                      </span>
                      <br />
                      <span className={styles['muted']}>{secretKindName(row.kind)}</span>
                    </td>
                    <td className={styles['wraps']}>
                      {row.consumers.length === 0 ? (
                        <span className={styles['muted']}>
                          {words('admin.secret-used-by-none')}
                        </span>
                      ) : (
                        <ul className={styles['consumers']}>
                          {row.consumers.map((each) => (
                            <li key={`${each.kind}:${each.id ?? ''}`} data-content>
                              {consumerName(each)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={styles['wraps']}>
                      {row.replacedAt === null
                        ? words('admin.secret-replaced-unknown')
                        : when(row.replacedAt)}
                      {row.previousUntil !== null && (
                        <>
                          <br />
                          <span className={styles['muted']}>
                            {words('admin.secret-old-until', { until: when(row.previousUntil) })}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={styles['wraps']}>
                      <a
                        href={replacedAt(row)}
                        aria-label={words('admin.secret-replace-for', {
                          name: row.of.name ?? secretKindName(row.kind),
                        })}
                      >
                        {words('admin.secret-replace')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {read.absent.length > 0 && (
            <p className={styles['muted']}>{words('admin.secrets-absent')}</p>
          )}
        </>
      )}
    </>
  );
}
