import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXPORT_NOT_CARRIED_COLUMNS,
  EXPORT_TABLES,
  NOT_OBJECTS,
  NOT_SECRETS,
  type CarriedTable,
} from './export-tables.js';
import { migrate, prepareDatabase } from './index.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import { freshDatabase, testTenantDatabase, type TestDatabase } from './testing/database.js';

interface Column {
  table_name: string;
  column_name: string;
  identity: boolean;
}
interface ForeignKey {
  table: string;
  refers: string;
  columns: string[];
  nullable: boolean;
}

const SECRET_SHAPED = /seal|secret|password|private|client_|_hash$/;
const OBJECT_SHAPED = /(^|_)(object|package|report|preview)_key$/;

describe('the census of what an export does with each table (EI-B)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let columns: Column[];
  let foreignKeys: ForeignKey[];
  let tables: string[];

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      columns = (
        await sql<Column>`
          select c.table_name, c.column_name, c.identity_generation is not null as identity
            from information_schema.columns c
            join information_schema.tables t
              on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'`.execute(trx)
      ).rows;
      foreignKeys = (
        await sql<ForeignKey>`
          select conrelid::regclass::text as table, confrelid::regclass::text as refers,
                 array(select a.attname::text from pg_attribute a
                        where a.attrelid = conrelid and a.attnum = any(conkey)) as columns,
                 exists (select from pg_attribute a where a.attrelid = conrelid
                          and a.attnum = any(conkey) and not a.attnotnull) as nullable
            from pg_constraint
           where contype = 'f' and connamespace = current_schema()::regnamespace`.execute(trx)
      ).rows;
    });
    tables = [...new Set(columns.map((each) => each.table_name))];
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const carried = () =>
    tables.flatMap((name) => {
      const table = EXPORT_TABLES[name];
      return table?.fate === 'carried' ? [[name, table] as const] : [];
    });
  const carriedOf = (name: string): CarriedTable | undefined => {
    const table = EXPORT_TABLES[name];
    return table?.fate === 'carried' ? table : undefined;
  };

  it('IMP-020 names every table in the schema, and only those', () => {
    expect(tables.filter((name) => !(name in EXPORT_TABLES))).toEqual([]);
    expect(Object.keys(EXPORT_TABLES).filter((name) => !tables.includes(name))).toEqual([]);
  });

  it('calls renumbered exactly the tables whose keys the database generates', () => {
    const wrong = carried().filter(
      ([name, table]) =>
        (table.identity === 'renumbered') !==
        columns.some((each) => each.table_name === name && each.identity),
    );
    expect(wrong.map(([name]) => name)).toEqual([]);
  });

  it('calls singleton exactly the tables of one row', () => {
    const wrong = carried().filter(
      ([name, table]) =>
        (table.identity === 'singleton') !==
        columns.some(
          (each) =>
            each.table_name === name && ['singleton', 'only_one'].includes(each.column_name),
        ),
    );
    expect(wrong.map(([name]) => name)).toEqual([]);
  });

  it('matches a natural row by a key the database holds unique', async () => {
    const unique = await service.withTenant(tenant, async (trx) => {
      const { rows } = await sql<{ table: string; columns: string[] }>`
        select i.indrelid::regclass::text as table,
               array(select a.attname::text from pg_attribute a
                      where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) as columns
          from pg_index i join pg_class c on c.oid = i.indrelid
         where i.indisunique and i.indpred is null
           and c.relnamespace = current_schema()::regnamespace`.execute(trx);
      return rows;
    });
    const wrong = carried().filter(
      ([name, table]) =>
        table.identity === 'natural' &&
        !unique.some(
          (each) =>
            each.table === name &&
            [...each.columns].sort().join() === [...(table.key ?? [])].sort().join(),
        ),
    );
    expect(wrong.map(([name]) => name)).toEqual([]);
  });

  it('ADM-054 names every column shaped like a secret in a carried table', () => {
    const unnamed = columns
      .filter(
        (each) =>
          SECRET_SHAPED.test(each.column_name) &&
          carriedOf(each.table_name) !== undefined &&
          !carriedOf(each.table_name)?.secrets?.columns.includes(each.column_name) &&
          !(`${each.table_name}.${each.column_name}` in NOT_SECRETS),
      )
      .map((each) => `${each.table_name}.${each.column_name}`);
    expect(unnamed).toEqual([]);
  });

  it('IMP-020 names every column shaped like a store key in a carried table', () => {
    const unnamed = columns
      .filter(
        (each) =>
          OBJECT_SHAPED.test(each.column_name) &&
          carriedOf(each.table_name) !== undefined &&
          !carriedOf(each.table_name)?.objects?.includes(each.column_name) &&
          !(`${each.table_name}.${each.column_name}` in NOT_OBJECTS),
      )
      .map((each) => `${each.table_name}.${each.column_name}`);
    expect(unnamed).toEqual([]);
  });

  it('breaks every foreign-key cycle at a nullable column, so the rows have an insert order', () => {
    const left = new Map<string, Set<string>>(carried().map(([name]) => [name, new Set<string>()]));
    const notNull: string[] = [];
    for (const fk of foreignKeys) {
      const from = carriedOf(fk.table);
      if (!from || !carriedOf(fk.refers)) continue;
      if (!fk.columns.some((column) => from.breaksCycleAt?.includes(column))) {
        left.get(fk.table)!.add(fk.refers);
      } else if (!fk.nullable) notNull.push(`${fk.table}.${fk.columns.join()}`);
    }
    expect(notNull).toEqual([]);
    // Kahn's: whatever cannot be taken refers, through unbroken keys, to itself.
    for (let taken = true; taken;) {
      taken = false;
      for (const [name, refers] of left) {
        if ([...refers].every((each) => !left.has(each))) {
          left.delete(name);
          taken = true;
        }
      }
    }
    expect([...left.keys()]).toEqual([]);
  });

  it('IMP-020 lets a carried row point out of the archive only through a nullable key it names', () => {
    const wrong = foreignKeys.flatMap((fk) => {
      const from = carriedOf(fk.table);
      if (!from || carriedOf(fk.refers)) return [];
      const named = fk.columns.some((column) => from.pointsOut?.includes(column));
      return named && fk.nullable ? [] : [`${fk.table}.${fk.columns.join()} -> ${fk.refers}`];
    });
    expect(wrong).toEqual([]);
  });

  it('drops no column a foreign key needs', () => {
    const wrong = foreignKeys.filter((fk) =>
      fk.columns.some((column) => EXPORT_NOT_CARRIED_COLUMNS.includes(column)),
    );
    expect(wrong).toEqual([]);
  });
});
