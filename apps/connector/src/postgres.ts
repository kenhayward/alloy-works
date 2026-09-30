import { isIP } from 'node:net';

import type { ColumnType, ConnectionSettings, Relation, TestFinding } from '@alloy-works/domain';
import pg from 'pg';

/**
 * PostgreSQL, as the child reaches it (the D1 plan, task 4): one client, to the address the guard
 * checked, closed by the child that opened it (DAT-114). The child's environment is empty, so no
 * `PG*` variable and no `~/.pgpass` reaches the driver: everything it uses is here.
 */

/** The oldest source whose catalogue the test reads: `pg_write_all_data` arrived with 14. */
export const OLDEST_SERVER_VERSION = 140000;

/** A source asked for the password in a form it could read: refused before anything is sent. */
export class AuthenticationRefused extends Error {}

/**
 * A client that authenticates by SCRAM-SHA-256 alone (the D1 fix, C3). node-postgres answers
 * `AuthenticationCleartextPassword` with the password and `AuthenticationMD5Password` with a digest
 * as good as it, to whatever server asked, and `tls: 'require'` checks no certificate: an
 * administrator who pointed a connection at a server of their own would be handed the stored
 * password. SCRAM proves the password without sending it. Both handlers are node-postgres 8's, which
 * `authentication.test.ts` holds to a server that asks each way.
 */
class ScramOnlyClient extends pg.Client {
  private refuse(): void {
    (
      this as unknown as { connection: { emit(event: 'error', error: Error): void } }
    ).connection.emit(
      'error',
      new AuthenticationRefused('The source asked for the password in a form it could read'),
    );
  }

  _handleAuthCleartextPassword(): void {
    this.refuse();
  }

  _handleAuthMD5Password(): void {
    this.refuse();
  }
}

/** Opens a client to the checked address, as the connection's account, over TLS. */
export async function connectPostgres(
  settings: ConnectionSettings,
  secret: string,
  address: string,
  timing: { readonly connectTimeoutMs: number; readonly statementTimeoutMs: number },
): Promise<pg.Client> {
  const { source } = settings;
  const client = new ScramOnlyClient({
    host: address,
    port: source.port,
    database: source.database,
    user: source.account,
    password: secret,
    ssl: {
      // A name is what the certificate is checked against; an address is never a server name (RFC 6066).
      ...(isIP(source.host) === 0 ? { servername: source.host } : {}),
      rejectUnauthorized: source.tls === 'verifyFull',
    },
    connectionTimeoutMillis: timing.connectTimeoutMs,
    application_name: 'alloy-connector',
    // The source notices a client gone within a quarter of a second, and stops a statement at the
    // request's deadline whatever the driver does (case 7).
    options: `-c client_connection_check_interval=250 -c statement_timeout=${Math.max(1, Math.floor(timing.statementTimeoutMs))}`,
  });
  // A driver error after connecting is the request's to answer, never an uncaught event.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/** The source's version, as `server_version_num`. */
export async function serverVersion(client: pg.Client): Promise<number> {
  const result = await client.query<{ version: string }>(
    `select current_setting('server_version_num') as version`,
  );
  return Number(result.rows[0]?.version);
}

const MAY_WRITE = `
select r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls
    or pg_has_role(current_user, 'pg_write_all_data', 'USAGE')
    or has_database_privilege(current_database(), 'CREATE')
    or exists (select 1 from pg_namespace n
               where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
                 and has_schema_privilege(n.oid, 'CREATE'))
    or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind in ('r', 'p', 'v', 'm', 'f')
                 and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
                 and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE')
                      or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE')))
       as may_write
from pg_roles r where r.rolname = current_user`;

/** What the authenticated account was found to be (D1-M): read-only or not, by the catalogue. */
export async function readOnlyFindings(client: pg.Client): Promise<TestFinding[]> {
  const result = await client.query<{ may_write: boolean }>(MAY_WRITE);
  return result.rows[0]?.may_write === false ? [] : ['account_not_read_only'];
}

/** The most relations a describe lists; past it, `truncated`. */
export const MAX_RELATIONS = 2000;

const RELATION_KINDS = {
  r: 'table',
  v: 'view',
  m: 'materializedView',
  f: 'foreignTable',
  p: 'partitionedTable',
} as const satisfies Record<string, Relation['kind']>;

interface TypeRow {
  readonly oid: number;
  readonly typname: string;
  readonly typtype: string;
  readonly typbasetype: number;
  readonly typtypmod: number;
}

/** A numeric's precision and scale from its type modifier, as PostgreSQL packs them. */
function numericModifier(typmod: number): { precision: number; scale: number } {
  const packed = typmod - 4;
  return {
    precision: (packed >> 16) & 0xffff,
    // Signed eleven bits since PostgreSQL 15, which allows a negative scale.
    scale: ((packed & 0x7ff) ^ 1024) - 1024,
  };
}

const AS_TEXT = new Set([
  'text',
  'varchar',
  'bpchar',
  'name',
  'citext',
  'uuid',
  'json',
  'jsonb',
  'xml',
]);

/**
 * The column type proposed for a source type (the D1 plan, "The proposal map"), a domain's base type
 * followed first; null for a type the author declares in D2.
 */
export function proposedType(type: {
  readonly name: string;
  readonly kind: string;
  readonly typmod: number;
}): ColumnType | null {
  const { name, kind, typmod } = type;
  if (name === 'int2' || name === 'int4' || name === 'int8') return { base: 'integer' };
  if (name === 'numeric') {
    if (typmod < 4) return null;
    const { precision, scale } = numericModifier(typmod);
    if (precision < 1 || precision > 1000 || scale < 0 || scale > precision) return null;
    return { base: 'decimal', precision, scale };
  }
  if (AS_TEXT.has(name) || kind === 'e') return { base: 'text' };
  if (name === 'bool') return { base: 'boolean' };
  if (name === 'date') return { base: 'date' };
  const fraction = typmod >= 0 && typmod <= 6 ? typmod : 6;
  if (name === 'time') return { base: 'time', fraction };
  if (name === 'timestamp') return { base: 'localDateTime', fraction };
  if (name === 'timestamptz') return { base: 'instant', fraction };
  return null;
}

/**
 * The relations the account may `SELECT` in a schema it may use, outside the catalogues, ordered by
 * schema, name and column number, with each column's source type and proposal; at most 2,000.
 */
export async function describeRelations(
  client: pg.Client,
): Promise<{ relations: Relation[]; truncated: boolean }> {
  const relations = await client.query<{ oid: number; schema: string; name: string; kind: string }>(
    `select c.oid::int as oid, n.nspname as schema, c.relname as name, c.relkind::text as kind
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
        and has_schema_privilege(n.oid, 'USAGE') and has_table_privilege(c.oid, 'SELECT')
      order by n.nspname, c.relname
      limit $1`,
    [MAX_RELATIONS + 1],
  );
  const truncated = relations.rows.length > MAX_RELATIONS;
  const listed = relations.rows.slice(0, MAX_RELATIONS);
  if (listed.length === 0) return { relations: [], truncated };
  const columns = await client.query<{
    relation: number;
    name: string;
    type: number;
    typmod: number;
    nullable: boolean;
    source_type: string;
  }>(
    `select a.attrelid::int as relation, a.attname as name, a.atttypid::int as type,
            a.atttypmod as typmod, not a.attnotnull as nullable,
            format_type(a.atttypid, a.atttypmod) as source_type
       from pg_attribute a
      where a.attrelid = any($1::oid[]) and a.attnum > 0 and not a.attisdropped
      order by a.attrelid, a.attnum`,
    [listed.map((each) => each.oid)],
  );
  // Every type the columns name, and every domain's base, followed to a type that is not a domain.
  const types = new Map<number, TypeRow>();
  let wanted = [...new Set(columns.rows.map((each) => each.type))];
  while (wanted.length > 0) {
    const rows = await client.query<TypeRow>(
      `select oid::int as oid, typname, typtype::text as typtype, typbasetype::int as typbasetype,
              typtypmod from pg_type where oid = any($1::oid[])`,
      [wanted],
    );
    for (const row of rows.rows) types.set(row.oid, row);
    wanted = rows.rows
      .filter((row) => row.typtype === 'd' && !types.has(row.typbasetype))
      .map((row) => row.typbasetype);
  }
  const resolve = (oid: number, typmod: number) => {
    let type = types.get(oid);
    let modifier = typmod;
    for (let depth = 0; type?.typtype === 'd' && depth < 32; depth += 1) {
      modifier = type.typtypmod;
      type = types.get(type.typbasetype);
    }
    return type ? { name: type.typname, kind: type.typtype, typmod: modifier } : undefined;
  };
  const byRelation = new Map<number, Relation['columns'][number][]>();
  for (const column of columns.rows) {
    const base = resolve(column.type, column.typmod);
    const list = byRelation.get(column.relation) ?? [];
    list.push({
      name: column.name,
      sourceType: column.source_type,
      nullable: column.nullable,
      proposed: base ? proposedType(base) : null,
    });
    byRelation.set(column.relation, list);
  }
  return {
    relations: listed.map((relation) => ({
      schema: relation.schema,
      name: relation.name,
      kind: RELATION_KINDS[relation.kind as keyof typeof RELATION_KINDS],
      columns: byRelation.get(relation.oid) ?? [],
    })),
    truncated,
  };
}
