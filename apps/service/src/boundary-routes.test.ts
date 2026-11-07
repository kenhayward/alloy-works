import { createServiceIdentity, createWebhookSubscription } from '@alloy-works/db';
import { OUTBOUND_WAYS } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;
// An address can carry a key in its path or query: only its host is ever answered.
const HOOK = 'https://hooks.example.test/in/k3y-in-the-path?token=t0ken-in-the-query';

describe('everything that can leave a tenant through the API (the SA plan, SAe)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const identity = await createServiceIdentity(trx, {
        name: 'Indexer',
        description: 'Reads for the search index.',
        by: h.ids.ada!,
      });
      await createWebhookSubscription(trx, {
        id: crypto.randomUUID(),
        serviceIdentity: identity.id,
        url: HOOK,
        description: '',
        eventTypes: ['content.version_cut'],
        sealed: SEALED,
        by: h.ids.ada!,
      });
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('ADM-041 answers every way out with its declaration and what is configured here', async () => {
    const answer = await h.call('ada', 'GET', '/v1/boundary');
    expect(answer.statusCode, answer.body).toBe(200);
    const { ways } = answer.json<{
      ways: {
        way: string;
        onByDefault: boolean;
        changedBy: { operation: string; permission: string } | null;
        residency: string;
        absent: string | null;
        on: boolean;
        items: { name: string; host: string | null; on: boolean }[];
      }[];
    }>();
    expect(ways.map((each) => each.way)).toEqual([...OUTBOUND_WAYS]);
    const by = Object.fromEntries(ways.map((each) => [each.way, each]));
    expect(by['webhook']).toMatchObject({
      changedBy: { operation: 'createWebhook', permission: 'configure_webhooks' },
      residency: 'not_declared',
      on: true,
      items: [{ name: 'hooks.example.test', host: 'hooks.example.test', on: true }],
    });
    expect(by['model_endpoint']).toMatchObject({ residency: 'endpoint', onByDefault: false });
    expect(by['reference_source']).toMatchObject({ onByDefault: true, on: true });
    expect(by['malware_scanning']).toMatchObject({ changedBy: null, on: false, items: [] });
    expect(by['malware_scanning']!.absent).toMatch(/AST-Q03/);
  });

  it('ADM-041 never answers a secret, nor the path or query of an address', async () => {
    const answer = await h.call('ada', 'GET', '/v1/boundary');
    expect(answer.statusCode, answer.body).toBe(200);
    for (const never of [SEALED, 'k3y-in-the-path', 't0ken-in-the-query', '/in/', 'sealed']) {
      expect(answer.body).not.toContain(never);
    }
  });

  it('refuses one who does not administer the environment', async () => {
    const refused = await h.call('grace', 'GET', '/v1/boundary');
    expect(refused.statusCode).toBe(403);
  });
});
