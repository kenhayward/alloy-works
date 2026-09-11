import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

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
