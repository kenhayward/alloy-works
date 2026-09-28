// packages/db/src/api-token.test.ts
import { createHash, randomBytes } from 'node:crypto';
import { permissions, tokenScopes } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const aHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');

describe('api_token, where a personal token is kept as its hash (service-foundations.md, TK-A to TK-F)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ada = await principal('ada', 'Ada');
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  async function principal(subject: string, name: string): Promise<string> {
    const row = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return row.id;
  }

  /** A token as the runtime role writes one, with anything the case changes. */
  const issue = (
    change: Partial<{
      principal_id: string;
      name: string;
      token_hash: string;
      scopes: string[];
      expires_at: Date;
    }> = {},
  ) =>
    service.withTenant(tenant, (trx) =>
      trx
        .insertInto('api_token')
        .values({
          principal_id: ada,
          name: 'Nightly import',
          token_hash: aHash(),
          scopes: ['edit'],
          expires_at: new Date(Date.now() + 30 * DAY_MS),
          ...change,
        })
        .returning(['id', 'created_at', 'last_used_at'])
        .executeTakeFirstOrThrow(),
    );

  it('keeps a token with its principal, name, scopes, hash and expiry, created now and never used', async () => {
    const made = await issue();
    expect(made.last_used_at).toBeNull();
    expect(Math.abs(made.created_at.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('IAM-034 takes scopes only from the closed permission set, never read, each once', async () => {
    expect(await issue({ scopes: [...tokenScopes] })).toBeDefined();
    expect(await issue({ scopes: [] })).toBeDefined();
    await expect(issue({ scopes: ['read'] })).rejects.toThrow(/api_token_scopes_closed/);
    await expect(issue({ scopes: ['edit', 'read'] })).rejects.toThrow(/api_token_scopes_closed/);
    await expect(issue({ scopes: ['delete'] })).rejects.toThrow(/api_token_scopes_closed/);
    await expect(issue({ scopes: ['edit', 'edit'] })).rejects.toThrow(/api_token_scopes_closed/);
    // Every permission but read, as the domain names the scopes: the check and the code agree.
    for (const permission of permissions) {
      const answer = issue({ scopes: [permission] });
      if (permission === 'read') await expect(answer, permission).rejects.toThrow();
      else expect(await answer, permission).toBeDefined();
    }
  });

  it('IAM-034 requires an expiry after the token is made and at most 365 days after', async () => {
    await expect(issue({ expires_at: new Date(Date.now() - DAY_MS) })).rejects.toThrow(
      /api_token_expires_after_creation/,
    );
    await expect(issue({ expires_at: new Date(Date.now() + 366 * DAY_MS) })).rejects.toThrow(
      /api_token_expires_within_a_year/,
    );
    expect(await issue({ expires_at: new Date(Date.now() + 364 * DAY_MS) })).toBeDefined();
    await expect(
      queryAs(
        db.adminUrl,
        `insert into "${tenant.schema}".api_token (principal_id, name, token_hash, scopes)
         values ($1, 'No expiry', $2, '{}')`,
        [ada, aHash()],
      ),
    ).rejects.toThrow(/expires_at/);
  });

  it('takes a name of 1 to 80 characters with no space at either end, and a hash of 64 hex digits', async () => {
    await expect(issue({ name: '' })).rejects.toThrow(/api_token_name/);
    await expect(issue({ name: ' Import' })).rejects.toThrow(/api_token_name/);
    await expect(issue({ name: 'x'.repeat(81) })).rejects.toThrow(/api_token_name/);
    expect(await issue({ name: 'x'.repeat(80) })).toBeDefined();
    await expect(issue({ token_hash: 'awt_not-a-hash' })).rejects.toThrow(/api_token_token_hash/);
    const hash = aHash();
    await issue({ token_hash: hash });
    await expect(issue({ token_hash: hash })).rejects.toThrow(/unique/);
  });

  it('lets the runtime role record a use and revoke by deleting, and change nothing else', async () => {
    const made = await issue();
    await service.withTenant(tenant, (trx) =>
      trx
        .updateTable('api_token')
        .set({ last_used_at: sql<Date>`now()` })
        .where('id', '=', made.id)
        .execute(),
    );
    for (const change of [
      sql`update api_token set scopes = '{edit,publish}' where id = ${made.id}`,
      sql`update api_token set expires_at = expires_at + interval '1 day' where id = ${made.id}`,
      sql`update api_token set token_hash = ${aHash()} where id = ${made.id}`,
      sql`update api_token set principal_id = principal_id where id = ${made.id}`,
      sql`insert into api_token (principal_id, name, token_hash, scopes, expires_at, created_at)
          values (${ada}, 'Backdated', ${aHash()}, '{}', now(), now() - interval '2 days')`,
    ]) {
      await expect(service.withTenant(tenant, (trx) => change.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
    await service.withTenant(tenant, (trx) =>
      trx.deleteFrom('api_token').where('id', '=', made.id).execute(),
    );
    const left = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('api_token').select('id').where('id', '=', made.id).executeTakeFirst(),
    );
    expect(left).toBeUndefined();
  });

  it('goes with its principal: a person removed takes their tokens with them', async () => {
    const grace = await principal('grace', 'Grace');
    const made = await issue({ principal_id: grace });
    await queryAs(db.adminUrl, `delete from "${tenant.schema}".principal where id = $1`, [grace]);
    const left = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('api_token').select('id').where('id', '=', made.id).executeTakeFirst(),
    );
    expect(left).toBeUndefined();
  });
});
