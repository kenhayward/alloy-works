import { describe, expect, it } from 'vitest';
import { freshDatabase, queryAs } from './database.js';

describe('the test harness', () => {
  it('creates a throwaway database and drops it again', async () => {
    const db = await freshDatabase();
    const { rows } = await queryAs(db.adminUrl, 'select current_database() as name');
    expect(rows[0].name).toBe(db.name);
    expect(db.name).toMatch(/^aw_test_[0-9a-f]{12}$/);

    await db.drop();

    const server = db.adminUrl.replace(`/${db.name}`, '/postgres');
    const gone = await queryAs(server, 'select 1 from pg_database where datname = $1', [db.name]);
    expect(gone.rowCount).toBe(0);
  });

  it('hands out test tenant ids that are valid and distinct', async () => {
    const db = await freshDatabase();
    const a = db.newTenantId();
    const b = db.newTenantId();
    expect(a).toMatch(/^test[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    await db.drop();
  });
});
