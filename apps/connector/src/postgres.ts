import { connect, isIP } from 'node:net';

import {
  DESCRIBE_BUDGET_BYTES,
  MAX_COLUMNS,
  sourceNameSchema,
  sourceTypeSchema,
  type PostgresSettings,
  type ProposedType,
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
  settings: PostgresSettings,
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

/*
 * Every catalogue query the connector writes itself names each relation, function, operator and type
 * in it as `pg_catalog`'s: `pg_catalog.pg_type`, `pg_catalog.format_type`,
 * `OPERATOR(pg_catalog.=)`, `::pg_catalog.oid[]`. Left bare, a name resolves through the connection
 * account's search path, where a schema placed ahead of `pg_catalog` could answer in its place and
 * change what types the product believes a column has, or whether the account may write (#376). The
 * builder's generated SQL holds to the same rule (D4-F). So no `in (...)`, `like`, `nullif` or simple
 * `case x when`, each of which compares by an operator the search path resolves.
 */

const SERVER_VERSION = `select pg_catalog.current_setting('server_version_num') as version`;

/** The source's version, as `server_version_num`. */
export async function serverVersion(client: pg.Client): Promise<number> {
  const result = await client.query<{ version: string }>(SERVER_VERSION);
  return Number(result.rows[0]?.version);
}

const ROOT_COLLATION = `select 1 from pg_catalog.pg_collation
  where collname OPERATOR(pg_catalog.=) 'und-x-icu'
    and collnamespace OPERATOR(pg_catalog.=) 'pg_catalog'::pg_catalog.regnamespace`;

/**
 * Whether the source holds ICU's root collation, by which a built filter ignoring case lower-cases
 * (DAT-119, the MC plan's MC-F): a source built without ICU has none.
 */
export async function hasRootCollation(client: pg.Client): Promise<boolean> {
  const result = await client.query(ROOT_COLLATION);
  return result.rows.length > 0;
}

/**
 * A schema of the account's own, outside the catalogues: not `pg_catalog`, `information_schema` or
 * any `pg_` schema.
 */
const OUTSIDE_CATALOGUES = `not (n.nspname OPERATOR(pg_catalog.=) ANY
                (ARRAY['pg_catalog', 'information_schema']::pg_catalog.name[]))
         and n.nspname OPERATOR(pg_catalog.!~~) 'pg\\_%'`;

/** The relation kinds a describe lists: tables, partitioned tables, views, materialized views and foreign tables. */
const LISTED_KINDS = `c.relkind OPERATOR(pg_catalog.=) ANY
         (ARRAY['r', 'p', 'v', 'm', 'f']::pg_catalog."char"[])`;

const MAY_WRITE = `
select r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls
    or pg_catalog.pg_has_role(current_user, 'pg_write_all_data', 'USAGE')
    or pg_catalog.has_database_privilege(pg_catalog.current_database(), 'CREATE')
    or exists (select 1 from pg_catalog.pg_namespace n
               where ${OUTSIDE_CATALOGUES}
                 and pg_catalog.has_schema_privilege(n.oid, 'CREATE'))
    or exists (select 1 from pg_catalog.pg_class c
                 join pg_catalog.pg_namespace n on n.oid OPERATOR(pg_catalog.=) c.relnamespace
               where ${LISTED_KINDS}
                 and ${OUTSIDE_CATALOGUES}
                 and (pg_catalog.has_table_privilege(c.oid, 'INSERT')
                      or pg_catalog.has_table_privilege(c.oid, 'UPDATE')
                      or pg_catalog.has_table_privilege(c.oid, 'DELETE')
                      or pg_catalog.has_table_privilege(c.oid, 'TRUNCATE')))
       as may_write
from pg_catalog.pg_roles r where r.rolname OPERATOR(pg_catalog.=) current_user`;

/** What the authenticated account was found to be (D1-M): read-only or not, by the catalogue. */
export async function readOnlyFindings(client: pg.Client): Promise<TestFinding[]> {
  const result = await client.query<{ may_write: boolean }>(MAY_WRITE);
  return result.rows[0]?.may_write === false ? [] : ['account_not_read_only'];
}

/** Whether `current_user` may create in any schema, `PUBLIC`'s `CREATE` on `public` among them. */
const CREATES_IN_A_SCHEMA = `exists (select 1 from pg_catalog.pg_namespace s
               where pg_catalog.has_schema_privilege(s.oid, 'CREATE'))`;

/**
 * Whether `current_user` owns, or has the privileges of a role that owns, any function or procedure,
 * outside the catalogues: SQL that sets another role from inside the query (the review, 2026-10-06).
 */
const OWNS_A_ROUTINE = `exists (select 1 from pg_catalog.pg_proc p
                 join pg_catalog.pg_namespace n on n.oid OPERATOR(pg_catalog.=) p.pronamespace
               where ${OUTSIDE_CATALOGUES}
                 and pg_catalog.pg_has_role(p.proowner, 'USAGE'))`;

/** As `OWNS_A_ROUTINE`, any relation of these kinds. */
const ownsRelation = (kinds: string) => `exists (select 1 from pg_catalog.pg_class c
                 join pg_catalog.pg_namespace n on n.oid OPERATOR(pg_catalog.=) c.relnamespace
               where c.relkind OPERATOR(pg_catalog.=) ANY (ARRAY[${kinds}]::pg_catalog."char"[])
                 and ${OUTSIDE_CATALOGUES}
                 and pg_catalog.pg_has_role(c.relowner, 'USAGE'))`;

/**
 * Whether the account may read data of its own (DAT-112; the D7 plan, D7-D): a superuser, a member of
 * `pg_read_all_data` by any grant, or `SELECT` on any table, view, materialised view, foreign table,
 * partitioned table or sequence outside the catalogues, or on any column of one - by grant,
 * ownership, `PUBLIC` or a role it inherits. A role it may only `SET`, as each person's is granted,
 * counts for nothing until it is set. Nor may it own a function, a procedure or a view, or create in
 * any schema (the review, 2026-10-06): SQL of its own, in a query's path, could set any person's role.
 * Asked at every asserted run, so measured in D7.1 against 10,000 tables the account may not read,
 * PostgreSQL 18 in a container: 21 ms the median of 15, 81 ms the first, cold; `exists` stops at the
 * first relation it may read.
 */
const HOLDS_PRIVILEGE = `
select r.rolsuper
    or pg_catalog.pg_has_role(current_user, 'pg_read_all_data', 'MEMBER')
    or exists (select 1 from pg_catalog.pg_class c
                 join pg_catalog.pg_namespace n on n.oid OPERATOR(pg_catalog.=) c.relnamespace
               where c.relkind OPERATOR(pg_catalog.=) ANY
                       (ARRAY['r', 'p', 'v', 'm', 'f', 'S']::pg_catalog."char"[])
                 and ${OUTSIDE_CATALOGUES}
                 and (pg_catalog.has_table_privilege(c.oid, 'SELECT')
                      or pg_catalog.has_any_column_privilege(c.oid, 'SELECT')))
    or ${OWNS_A_ROUTINE}
    or ${ownsRelation("'v', 'm'")}
    or ${CREATES_IN_A_SCHEMA}
       as holds
from pg_catalog.pg_roles r where r.rolname OPERATOR(pg_catalog.=) current_user`;

/**
 * Whether a person's role, once set, is one the connector will not run as (the review, 2026-10-06):
 * PostgreSQL checks a later `set_config('role', ...)` against the session's user, the account, which
 * may set every person's role, so SQL a person owns in a query's path could read as anybody. A
 * person's role therefore may not log in, create in any schema or database, or own - or have the
 * privileges of a role that owns - any function, procedure, table, view or materialised view.
 */
const ROLE_UNSAFE = `
select r.rolcanlogin
    or ${CREATES_IN_A_SCHEMA}
    or exists (select 1 from pg_catalog.pg_database d
               where pg_catalog.has_database_privilege(d.oid, 'CREATE'))
    or ${OWNS_A_ROUTINE}
    or ${ownsRelation("'r', 'p', 'v', 'm', 'f'")}
       as unsafe
from pg_catalog.pg_roles r where r.rolname OPERATOR(pg_catalog.=) current_user`;

/** Whether the account holds any privilege on data of its own, as `HOLDS_PRIVILEGE` reads it. */
export async function accountHoldsPrivilege(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ holds: boolean }>(HOLDS_PRIVILEGE);
  return result.rows[0]?.holds !== false;
}

/**
 * The assertion (D7-A): the person's role set for the transaction, the name a bound value and never
 * text, so no name reads as SQL; then `current_user`, the identity as the source saw it.
 */
const ASSERT_ROLE = `select pg_catalog.set_config('role', $1, true)`;
const CURRENT_USER = `select current_user::pg_catalog.text as name`;

/** The SQLSTATEs of a role the source lacks (22023) and one the account may not set (42501). */
const ROLE_REFUSED = new Set(['22023', '42501']);

/** What an assertion found: the identity as the source saw it, or why it is refused. */
export type Asserted =
  | { readonly asSeen: string }
  | {
      readonly refused: 'account_holds_privilege' | 'identity_unmatched' | 'identity_role_unsafe';
    };

/**
 * A person's role asserted, first in the read-only transaction the caller has begun (D7-A, D7-D): the
 * account refused where it may read data of its own, then the role set, then `current_user` held to
 * it - so `none`, which sets no role, is refused like a role the source lacks. Never says the role.
 */
export async function assertRole(client: pg.Client, role: string): Promise<Asserted> {
  if (await accountHoldsPrivilege(client)) return { refused: 'account_holds_privilege' };
  try {
    await client.query(ASSERT_ROLE, [role]);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && ROLE_REFUSED.has(code))
      return { refused: 'identity_unmatched' };
    throw error;
  }
  if (!(await heldAs(client, role))) return { refused: 'identity_unmatched' };
  // Before anything is read: a role that could switch to another person's is not run as.
  const unsafe = await client.query<{ unsafe: boolean }>(ROLE_UNSAFE);
  if (unsafe.rows[0]?.unsafe !== false) return { refused: 'identity_role_unsafe' };
  return { asSeen: role };
}

/** Whether the source still sees the person's role (D7-E): read again once the rows are read. */
export async function heldAs(client: pg.Client, role: string): Promise<boolean> {
  const result = await client.query<{ name: string }>(CURRENT_USER);
  return result.rows[0]?.name === role;
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
select t.oid::pg_catalog.int4 as oid,
       case when t.typnamespace OPERATOR(pg_catalog.=) 'pg_catalog'::pg_catalog.regnamespace
                 then t.typname
            when t.typname OPERATOR(pg_catalog.=) 'citext'
                 and p.proname OPERATOR(pg_catalog.=) 'citextin'
                 and p.pronamespace OPERATOR(pg_catalog.=) t.typnamespace then 'citext'
            else '' end as typname,
       t.typtype::pg_catalog.text as typtype, t.typbasetype::pg_catalog.int4 as typbasetype,
       t.typtypmod
  from pg_catalog.pg_type t
  left join pg_catalog.pg_proc p on p.oid OPERATOR(pg_catalog.=) t.typinput
 where t.oid OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.oid[])`;

/** The relations the account may read outside the catalogues, at most `$1` of them. */
const RELATIONS = `
select c.oid::pg_catalog.int4 as oid, n.nspname as schema, c.relname as name,
       c.relkind::pg_catalog.text as kind
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid OPERATOR(pg_catalog.=) c.relnamespace
 where ${LISTED_KINDS}
   and ${OUTSIDE_CATALOGUES}
   and pg_catalog.has_schema_privilege(n.oid, 'USAGE')
   and pg_catalog.has_table_privilege(c.oid, 'SELECT')
 order by n.nspname, c.relname
 limit $1`;

/** The columns of the relations `$1` names, in order, each with its type as `format_type` names it. */
const COLUMNS = `
select a.attrelid::pg_catalog.int4 as relation, a.attname as name,
       a.atttypid::pg_catalog.int4 as type, a.atttypmod as typmod,
       not a.attnotnull as nullable,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as source_type
  from pg_catalog.pg_attribute a
 where a.attrelid OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.oid[])
   and a.attnum OPERATOR(pg_catalog.>) 0 and not a.attisdropped
 order by a.attrelid, a.attnum`;

/**
 * Each type of `$1` with its modifier in `$2`, as `format_type` names it, in order. ROWS FROM rather
 * than unnest's two-array form, which PostgreSQL expands only for a bare `unnest` the search path
 * resolves; and a case rather than nullif, whose equality the search path would resolve too.
 */
const FORMATTED = `
select u.at::pg_catalog.int4 as at,
       pg_catalog.format_type(u.oid, case when u.typmod OPERATOR(pg_catalog.=) -1 then null
                                          else u.typmod end) as text
  from rows from (pg_catalog.unnest($1::pg_catalog.oid[]),
                  pg_catalog.unnest($2::pg_catalog.int4[])) with ordinality as u (oid, typmod, at)
 order by u.at`;

/** Every statement the connector writes itself, for the test that holds each to `pg_catalog`'s names. */
export const CATALOGUE_QUERIES: Readonly<Record<string, string>> = {
  SERVER_VERSION,
  ROOT_COLLATION,
  MAY_WRITE,
  HOLDS_PRIVILEGE,
  ROLE_UNSAFE,
  ASSERT_ROLE,
  CURRENT_USER,
  TYPES_BY_OID,
  RELATIONS,
  COLUMNS,
  FORMATTED,
};

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
 * followed first; an image for `bytea`, its description the author's to declare (D8-A); null for a type
 * the author declares in D2.
 */
export function proposedType(type: {
  readonly name: string;
  readonly kind: string;
  readonly typmod: number;
}): ProposedType | null {
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
  if (name === 'bytea') return { base: 'image', encoding: 'binary' };
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
    RELATIONS,
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
  }>(COLUMNS, [listed.map((each) => each.oid)]);
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
  const formatted = await client.query<{ at: number; text: string }>(FORMATTED, [
    types.map((each) => each.oid),
    types.map((each) => each.typmod),
  ]);
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
