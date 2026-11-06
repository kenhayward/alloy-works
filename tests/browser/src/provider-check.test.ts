import { createHash } from 'node:crypto';
import { createTenantDatabase } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { API, DATABASE, idpFromNode, SERVICE } from './testing/addresses.js';
import { allowPageNoise, withPage } from './testing/page.js';
import { signInFromNode } from './testing/setup.js';

/** The stand-in's control for a person disabled at their provider (the PC plan). */
const disabled = (person: string, method: 'PUT' | 'DELETE') =>
  fetch(`${idpFromNode()}/stand-in/people/${person}/disabled`, { method });

/**
 * As though the provider was last asked about the session longer ago than the five minutes it waits:
 * written straight to the stack's database, as the suite's own setup writes, rather than waiting.
 */
async function lastAskedLongAgo(cookie: string): Promise<number> {
  const database = createTenantDatabase(DATABASE, {
    max: 1,
    auditContext: { actorKind: 'system', traceId: 'browser-suite' },
  });
  try {
    const tenant = await database.resolveHostname(new URL(API).hostname);
    if (!tenant) throw new Error(`No environment answers to ${new URL(API).hostname}`);
    const hash = createHash('sha256')
      .update(cookie.slice(cookie.indexOf('=') + 1))
      .digest('hex');
    const moved = await database.withTenant(tenant, (trx) =>
      trx
        .updateTable('session')
        .set({ provider_checked_at: new Date(Date.now() - 6 * 60 * 1000) })
        .where('token_hash', '=', hash)
        .where('sealed_refresh', 'is not', null)
        .executeTakeFirst(),
    );
    return Number(moved.numUpdatedRows);
  } finally {
    await database.close();
  }
}

/**
 * A person disabled at their organisation's provider, in the pinned Chromium: Grace rather than Ada,
 * whose sessions every other test shares. Uncited: the service's tests cite IAM-010.
 */
describe('a person disabled at their provider, in Chromium', () => {
  it('is signed out at their next request once the provider has not been asked for five minutes', async () => {
    allowPageNoise(/status of 401 \(Unauthorized\)/);
    const cookie = await signInFromNode('grace');
    try {
      await withPage(
        async (page) => {
          await page.goto(SERVICE);
          await page.getByRole('button', { name: /Grace/ }).waitFor();
          expect((await disabled('grace', 'PUT')).status).toBe(204);

          // Within the five minutes the provider is not asked, and Grace stays.
          await page.reload();
          await page.getByRole('button', { name: /Grace/ }).waitFor();

          expect(await lastAskedLongAgo(cookie)).toBe(1);
          await page.reload();
          await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
          expect(await page.getByRole('button', { name: /Grace/ }).count()).toBe(0);
        },
        { signedInAs: cookie },
      );
    } finally {
      await disabled('grace', 'DELETE');
    }
  });
});
