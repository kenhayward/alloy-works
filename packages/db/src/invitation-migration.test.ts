import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0014, over invitations made before it', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every migration up to 0013 and not 0014, so a tenant can hold invitations in their old shape.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0014-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => !source.endsWith('0014_invitations.sql'),
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('gives a waiting invitation the principal its sign-in would have made, and leaves an accepted one bound', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const schema = tenant.schema;
    const { rows: grace } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.principal (issuer, subject, email) values ('https://idp.example', 'grace-1', 'grace@example.com') returning id`,
    );
    await queryAs(
      db.adminUrl,
      `insert into ${schema}.invitation (email, principal_id, accepted_at) values
         ('grace@example.com', $1, now()), ('ada@example.com', null, null)`,
      [grace[0].id],
    );

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0014_invitations']);

    const { rows } = await queryAs(
      db.adminUrl,
      `select i.email, i.principal_id = $1 as graces, p.issuer, p.email as label, i.expires_at
       from ${schema}.invitation i join ${schema}.principal p on p.id = i.principal_id
       order by i.email`,
      [grace[0].id],
    );
    expect(rows).toEqual([
      {
        email: 'ada@example.com',
        graces: false,
        issuer: null,
        label: 'ada@example.com',
        expires_at: null,
      },
      {
        email: 'grace@example.com',
        graces: true,
        issuer: 'https://idp.example',
        label: 'grace@example.com',
        expires_at: null,
      },
    ]);
  });
});
