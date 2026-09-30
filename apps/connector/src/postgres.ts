import { isIP } from 'node:net';

import {
  DESCRIBE_BUDGET_BYTES,
  MAX_COLUMNS,
  sourceNameSchema,
  sourceTypeSchema,
  type ColumnType,
  type ConnectionSettings,
  type Relation,
  type TestFinding,
} from '@alloy-works/domain';
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
    // Every connection is TLS, so SCRAM is bound to the channel where the source offers
    // SCRAM-SHA-256-PLUS: a relay between the child and the source, which `tls: 'require'` does not
    // detect, cannot pass the exchange on, since the binding names the certificate the child saw
    // (the D1 fix, round two). A source that offers plain SCRAM alone is still signed in to, with the
    // client's word that it could have bound, so a real source that offers binding refuses a relay
    // that strips the offer; refusing plain SCRAM would refuse poolers and proxies that cannot bind.
    enableChannelBinding: true,
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

/** A describe's answer, as the child gives it. */
export interface Described {
  readonly relations: Relation[];
  readonly truncated: boolean;
  readonly leftOut: { readonly relations: number; readonly columns: number };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * The relations the account may `SELECT` in a schema it may use, outside the catalogues, ordered by
 * schema, name and column number, with each column's source type and proposal; at most 2,000, and no
 * more than fit an answer of `budgetBytes` (the D1 fix, round two). Each relation and column is held
 * to the protocol's own bounds here, one at a time: one PostgreSQL allows and a page cannot show - a
 * name with a control character, a type longer than any it names - is left out and counted, rather
 * than failing the whole answer. Past the budget the list stops at the last relation that fits, and
 * says `truncated`, as it does past 2,000.
 */
export async function describeRelations(
  client: pg.Client,
  options: { readonly budgetBytes?: number } = {},
): Promise<Described> {
  const budgetBytes = options.budgetBytes ?? DESCRIBE_BUDGET_BYTES;
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
  const leftOut = { relations: 0, columns: 0 };
  const shown = (schema: typeof sourceNameSchema, value: string) => schema.safeParse(value).success;
  const listed = relations.rows.slice(0, MAX_RELATIONS).filter((relation) => {
    const fits = shown(sourceNameSchema, relation.schema) && shown(sourceNameSchema, relation.name);
    if (!fits) leftOut.relations += 1;
    return fits;
  });
  if (listed.length === 0) return fitted([], truncated, leftOut, budgetBytes);
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
  const leftOutColumns = new Map<number, number>();
  for (const column of columns.rows) {
    if (!shown(sourceNameSchema, column.name) || !shown(sourceTypeSchema, column.source_type)) {
      leftOutColumns.set(column.relation, (leftOutColumns.get(column.relation) ?? 0) + 1);
      continue;
    }
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
  const described: Relation[] = [];
  for (const relation of listed) {
    const columns = byRelation.get(relation.oid) ?? [];
    // More than a relation can have: nothing a real source answers, and nothing to list.
    if (columns.length > MAX_COLUMNS) {
      leftOut.relations += 1;
      continue;
    }
    leftOut.columns += leftOutColumns.get(relation.oid) ?? 0;
    described.push({
      schema: relation.schema,
      name: relation.name,
      kind: RELATION_KINDS[relation.kind as keyof typeof RELATION_KINDS],
      columns,
    });
  }
  return fitted(described, truncated, leftOut, budgetBytes);
}

/**
 * The longest run of relations, from the first, whose answer is no more than `budgetBytes` of JSON:
 * `truncated` where any was cut, and whatever it already was otherwise.
 */
function fitted(
  relations: Relation[],
  truncated: boolean,
  leftOut: Described['leftOut'],
  budgetBytes: number,
): Described {
  // The answer with no relations, as the budget counts it: said truncated, the longer of the two.
  let size = bytes({ relations: [], truncated: true, leftOut });
  const kept: Relation[] = [];
  for (const relation of relations) {
    size += bytes(relation) + (kept.length === 0 ? 0 : 1);
    if (size > budgetBytes) return { relations: kept, truncated: true, leftOut };
    kept.push(relation);
  }
  return { relations: kept, truncated, leftOut };
}
