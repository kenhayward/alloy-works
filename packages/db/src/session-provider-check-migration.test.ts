import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/**
 * Migration 0213 (the PC plan, PC-A): a session may keep its provider's refresh token, sealed, and
 * when the provider was last asked. A session made before it keeps neither.
 */
describe('migration 0213, which lets a session keep a sealed refresh token', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0213-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 213;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('keeps a session made before it, holding no token, and stores only a sealed token of a provider session', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const at = (table: string) => `${tenant.schema}.${table}`;
    const provider = (
      await queryAs(
        db.adminUrl,
        `insert into ${at('identity_provider')} (issuer, client_id, secret_name, name)
         values ('https://idp.example', 'alloy', 'stand_in', 'Acme') returning id`,
      )
    ).rows[0] as { id: string };
    const ada = (
      await queryAs(
        db.adminUrl,
        `insert into ${at('principal')} (issuer, subject, email)
         values ('https://idp.example', 'ada', 'ada@example.com') returning id`,
      )
    ).rows[0] as { id: string };
    const session = (route: string, hash: string, providerId: string | null) =>
      queryAs(
        db.adminUrl,
        `insert into ${at('session')} (token_hash, principal_id, route, provider_id, idle_expires_at, expires_at)
         values ($1, $2, $3, $4, now() + interval '1 hour', now() + interval '1 hour') returning id`,
        [hash, ada.id, route, providerId],
      );
    await session('organisation', 'before', provider.id);

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0213_session_provider_check']);

    expect(
      (
        await queryAs(
          db.adminUrl,
          `select sealed_refresh, provider_checked_at from ${at('session')}`,
        )
      ).rows,
    ).toEqual([{ sealed_refresh: null, provider_checked_at: null }]);

    const google = (await session('google', 'google', null)).rows[0] as { id: string };
    const organisation = (await session('organisation', 'after', provider.id)).rows[0] as {
      id: string;
    };
    const keep = (sessionId: string, value: string) =>
      queryAs(db.adminUrl, `update ${at('session')} set sealed_refresh = $2 where id = $1`, [
        sessionId,
        value,
      ]);
    await expect(keep(google.id, 'v1.a.b.c')).rejects.toThrow(/session_sealed_refresh_provider/);
    await expect(keep(organisation.id, 'a-refresh-token')).rejects.toThrow(
      /session_sealed_refresh_sealed/,
    );
    await keep(organisation.id, 'v1.a.b.c');
  });
});
