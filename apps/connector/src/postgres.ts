import { connect, isIP } from 'node:net';

import {
  DESCRIBE_BUDGET_BYTES,
  MAX_COLUMNS,
  sourceNameSchema,
  sourceTypeSchema,
  type ConnectionSettings,
  type Relation,
  type TestFinding,
  type ValueType,
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
    // request's deadline - a second line behind the child's own cancel, since a statement can set
    // either of these to nothing (DAT-109; the D2 plan, final review 3). A run reads every value as the server's
    // text, which these two fix: an instant in UTC, and dates and times in ISO order (D2-Q). And a
    // standard string's backslash is itself, as the lexer that found a definition's markers read it,
    // whatever the source's or the account's default (the D2 plan, final review 8).
    options: [
      '-c client_connection_check_interval=250',
      `-c statement_timeout=${Math.max(1, Math.floor(timing.statementTimeoutMs))}`,
      '-c TimeZone=UTC',
      '-c DateStyle=ISO,YMD',
      '-c standard_conforming_strings=on',
    ].join(' '),
  });
  // A driver error after connecting is the request's to answer, never an uncaught event.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/** How long a cancel is waited for, at the most, before the child answers and exits. */
export const CANCEL_WAIT_MS = 300;

/** PostgreSQL's CancelRequest code: 1234 in the high 16 bits, 5678 in the low (protocol 3.0). */
const CANCEL_REQUEST_CODE = 80877102;

/**
 * Asks the source to cancel whatever a client's backend is running (DAT-109): the protocol's
 * CancelRequest, carrying the backend's process id and secret key, on a fresh connection to the same
 * checked address the client dialled - never a name resolved again, which could now answer another
 * address. The source reads it before any authentication and closes the connection; this waits for
 * that, or `waitMs`, whichever is sooner, and never fails: a cancel is a best effort beside the socket
 * the caller has already destroyed. The source's own settings cannot refuse it, where the author's SQL
 * can turn off both `client_connection_check_interval` and `statement_timeout`.
 */
export function cancelBackend(
  address: string,
  port: number,
  client: pg.Client,
  waitMs = CANCEL_WAIT_MS,
): Promise<void> {
  const { processID, secretKey } = client as unknown as {
    processID: number | null;
    secretKey: number | null;
  };
  if (typeof processID !== 'number' || typeof secretKey !== 'number') return Promise.resolve();
  return new Promise((resolve) => {
    const packet = Buffer.alloc(16);
    packet.writeInt32BE(16, 0);
    packet.writeInt32BE(CANCEL_REQUEST_CODE, 4);
    packet.writeInt32BE(processID, 8);
    packet.writeInt32BE(secretKey, 12);
    const socket = connect({ host: address, port });
    const done = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };
    const timer = setTimeout(done, waitMs);
    socket.on('error', done);
    socket.on('close', done);
    socket.once('connect', () => socket.end(packet));
  });
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

/**
 * Types by OID, each named as the product reads it: a built-in's name only where it is PostgreSQL's
 * own, in `pg_catalog`, and `citext` only where it is the extension's, its input function `citextin`
 * beside it. Any other type is nameless here, whatever it is called: an account can make a type named
 * `int8` or `bool` in a schema of its own, and a name alone would admit it as the built-in (D2-L). An
 * enum is text wherever it is, by its kind; a domain is followed to its base.
 */
const TYPES_BY_OID = `
select t.oid::int as oid,
       case when t.typnamespace = 'pg_catalog'::regnamespace then t.typname
            when t.typname = 'citext' and p.proname = 'citextin'
                 and p.pronamespace = t.typnamespace then 'citext'
            else '' end as typname,
       t.typtype::text as typtype, t.typbasetype::int as typbasetype, t.typtypmod
  from pg_type t left join pg_proc p on p.oid = t.typinput
 where t.oid = any($1::oid[])`;

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
}): ValueType | null {
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
    const rows = await client.query<TypeRow>(TYPES_BY_OID, [wanted]);
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

/**
 * A type parser for every type that answers the server's own text (D2-Q; ADR-0035): a run reads each
 * value as the source printed it, never through `pg`'s parsers, which case 6 found lose microseconds
 * and move a time in a daylight-saving gap.
 */
export const SERVER_TEXT = {
  getTypeParser: () => (value: string) => value,
} as unknown as pg.CustomTypesConfig;

/** A source type, followed through any domain to the type it is: its name, kind and modifier. */
export interface SourceType {
  /** `pg_type.typname` of the base type. */
  readonly name: string;
  /** `pg_type.typtype`: `b` base, `e` enum, and so on. */
  readonly kind: string;
  readonly typmod: number;
  /** `format_type`'s text for the type as the statement named it. */
  readonly formatted: string;
}

/**
 * The types of a statement's columns or parameters, each by its OID and modifier: named as
 * `format_type` names them, and followed through any domain to its base, as `describeRelations` does.
 */
export async function sourceTypes(
  client: pg.Client,
  types: readonly { readonly oid: number; readonly typmod: number }[],
): Promise<SourceType[]> {
  if (types.length === 0) return [];
  const formatted = await client.query<{ at: number; text: string }>(
    `select u.at::int as at, format_type(u.oid, nullif(u.typmod, -1)) as text
       from unnest($1::oid[], $2::int[]) with ordinality as u (oid, typmod, at)
      order by u.at`,
    [types.map((each) => each.oid), types.map((each) => each.typmod)],
  );
  const rows = new Map<number, TypeRow>();
  let wanted = [...new Set(types.map((each) => each.oid))];
  while (wanted.length > 0) {
    const found = await client.query<TypeRow>(TYPES_BY_OID, [wanted]);
    for (const row of found.rows) rows.set(row.oid, row);
    wanted = found.rows
      .filter((row) => row.typtype === 'd' && !rows.has(row.typbasetype))
      .map((row) => row.typbasetype);
  }
  return types.map((each, at) => {
    let type = rows.get(each.oid);
    let typmod = each.typmod;
    for (let depth = 0; type?.typtype === 'd' && depth < 32; depth += 1) {
      typmod = type.typtypmod;
      type = rows.get(type.typbasetype);
    }
    return {
      name: type?.typname ?? '',
      kind: type?.typtype ?? '',
      typmod,
      formatted: formatted.rows[at]?.text ?? '',
    };
  });
}
