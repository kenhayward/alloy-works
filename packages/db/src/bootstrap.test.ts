import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrapCluster, bootstrapLoginRoles, prepareDatabase } from './bootstrap.js';
import { migrate } from './migrate.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('bootstrapCluster', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
  });

  afterAll(() => db.drop());

  it('creates three login roles that can log in and do nothing else by themselves', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb
         from pg_roles where rolname in ('aw_service', 'aw_worker', 'aw_migrator')
        order by rolname`,
    );
    const role = (rolname: string) => ({
      rolname,
      rolcanlogin: true,
      rolinherit: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    expect(rows).toEqual([role('aw_migrator'), role('aw_service'), role('aw_worker')]);
  });

  it('lets each login role connect with its password', async () => {
    for (const url of [db.serviceUrl, db.workerUrl, db.migratorUrl]) {
      const { rows } = await queryAs(url, 'select 1 as ok');
      expect(rows[0].ok).toBe(1);
    }
  });

  it('gives the platform schema to the migrator and pgvector a schema of its own', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select n.nspname, pg_get_userbyid(n.nspowner) as owner
         from pg_namespace n where n.nspname in ('platform', 'extensions') order by 1`,
    );
    expect(rows).toEqual([
      { nspname: 'extensions', owner: 'postgres' },
      { nspname: 'platform', owner: 'aw_migrator' },
    ]);
    const vector = await queryAs(
      db.adminUrl,
      `select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'vector'`,
    );
    expect(vector.rows).toEqual([{ nspname: 'extensions' }]);
  });

  it('does not let the login roles create anything in the public schema', async () => {
    await expect(queryAs(db.serviceUrl, 'create table public.stray (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('is safe to run again', async () => {
    await expect(bootstrapCluster(db.adminUrl, TEST_PASSWORDS)).resolves.toBeUndefined();
  });
});

describe('prepareDatabase', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapLoginRoles(db.adminUrl, TEST_PASSWORDS);
  });

  afterAll(() => db.drop());

  // What lets a suite set the login roles up once and prepare a database per file in parallel: a
  // database's preparation sends no statement that writes a role. Watched at the client rather than
  // read from pg_authid, which every other suite on the cluster is writing at the same time.
  it('makes a database ready to migrate without writing a login role', async () => {
    const query = vi.spyOn(pg.Client.prototype, 'query');
    try {
      await prepareDatabase(db.adminUrl);
      // A statement may be sent as a string or as `{ text }`; both are read.
      const sent = query.mock.calls.map(([statement]) =>
        typeof statement === 'string'
          ? statement
          : String((statement as { text?: unknown } | undefined)?.text ?? ''),
      );
      // A role's attributes, and one role's membership of another (`grant aw_tenant to ...`), are
      // the cluster's rows; a privilege granted on a schema is this database's.
      const writesARole = (text: string) =>
        /\b(create|alter|drop)\s+role\b/i.test(text) ||
        /^\s*grant\s+[\w"]+\s+to\b/i.test(text) ||
        /^\s*revoke\s+[\w"]+\s+from\b/i.test(text);

      expect(sent.some((text) => /create schema if not exists platform/i.test(text))).toBe(true);
      expect(sent.filter(writesARole)).toEqual([]);
    } finally {
      query.mockRestore();
    }
    await migrate(db.migratorUrl);
  });
});
