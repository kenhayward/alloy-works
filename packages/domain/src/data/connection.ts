import { z } from 'zod';

import { storableText } from '../stored/storable.js';

/**
 * The version of a connection's own payload (data.md, "The connection"), recorded in it and migrated
 * like any stored shape when it changes.
 */
export const CONNECTION_SCHEMA_VERSION = 1;

/**
 * Refuses a string Postgres cannot store in a version's `jsonb` - a lone half of a surrogate pair -
 * so it is the caller's mistake, naming the member, and never a failure on the way to the database.
 */
const storable = (what: string) => (schema: z.ZodString) =>
  schema.refine(storableText, { message: `${what} holds a character that cannot be stored` });

/** Any control character: C0, DEL and C1. */
const CONTROL = /\p{Cc}/u;
/** Any control character but a line feed. */
const CONTROL_BUT_LINE_FEED = /(?!\n)\p{Cc}/u;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const characters = (value: string) => [...value].length;

const name = storable('A name')(z.string())
  .refine((value) => characters(value) >= 1 && characters(value) <= 200, {
    message: 'A name is 1 to 200 characters',
  })
  .refine((value) => value === value.trim(), {
    message: 'A name has no space before or after it',
  })
  .refine((value) => !CONTROL.test(value), { message: 'A name holds no control character' });

const description = storable('A description')(z.string())
  .refine((value) => characters(value) <= 2000, {
    message: 'A description is at most 2,000 characters',
  })
  .refine((value) => !CONTROL_BUT_LINE_FEED.test(value), {
    message: 'A description holds no control character but a line feed',
  });

/** A DNS label: lower-case letters, digits and hyphens, 1 to 63, no hyphen at either edge. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A lower-case DNS name of labels, 253 characters in all, whose last label is not all digits. */
function isDnsName(value: string): boolean {
  if (value.length < 1 || value.length > 253) return false;
  const labels = value.split('.');
  if (!labels.every((label) => LABEL.test(label))) return false;
  return !/^[0-9]+$/.test(labels[labels.length - 1]!);
}

/** A dotted quad of four decimal octets, none with a leading zero. */
const DOTTED_QUAD =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;

/** An IPv6 address's eight groups, or undefined; no brackets, no zone, no embedded IPv4. */
function ipv6Groups(value: string): number[] | undefined {
  if (!/^[0-9a-fA-F:]+$/.test(value)) return undefined;
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const part = (text: string) => (text === '' ? [] : text.split(':'));
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const groups = [...head, ...tail];
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return undefined;
  if (halves.length === 1 && groups.length !== 8) return undefined;
  if (halves.length === 2 && groups.length > 7) return undefined;
  const numbers = groups.map((group) => parseInt(group, 16));
  if (halves.length === 1) return numbers;
  const zeros = 8 - groups.length;
  return [
    ...head.map((group) => parseInt(group, 16)),
    ...Array<number>(zeros).fill(0),
    ...tail.map((group) => parseInt(group, 16)),
  ];
}

/** RFC 5952's text for eight groups: lower case, no leading zero, the longest run of two or more zeros as `::`. */
function rfc5952(groups: readonly number[]): string {
  let best = { at: -1, length: 0 };
  for (let at = 0; at < 8;) {
    if (groups[at] !== 0) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - at > best.length) best = { at, length: end - at };
    at = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (best.length < 2) return hex.join(':');
  return `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.length).join(':')}`;
}

/**
 * Whether a host is one the stored shape takes: a lower-case DNS name, a canonical dotted quad, or a
 * canonical IPv6 address - one spelling per address, so a number, an octal or hexadecimal octet, a
 * short form, a trailing dot, brackets, a zone, a path and a port are refused before anything stores
 * them. An IPv4-mapped IPv6 address is refused too: the dotted quad is that address's spelling.
 * Whether the address may be dialled is not decided here but by the connector's guard at each request,
 * since what a name resolves to changes.
 */
function isCanonicalHost(value: string): boolean {
  if (DOTTED_QUAD.test(value)) return true;
  if (value.includes(':')) {
    const groups = ipv6Groups(value);
    if (!groups) return false;
    const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
    return !mapped && rfc5952(groups) === value;
  }
  // A name whose last label is all digits is a number, which the rule above has already refused
  // unless it was a canonical quad.
  return isDnsName(value);
}

/**
 * PostgreSQL's identifier length, NAMEDATALEN less one, in bytes; U+0000 no string can hold. `what`
 * with its article: "A database", "An account".
 */
const sourceName = (what: string) =>
  storable(what)(z.string())
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 63, {
      message: `${what} is 1 to 63 bytes of UTF-8`,
    })
    .refine((value) => !value.includes('\u0000'), { message: `${what} holds no U+0000` });

const postgresSource = z.strictObject({
  host: z.string().refine(isCanonicalHost, {
    message: 'A host is a lower-case name or a canonical address: no path, port, zone or number',
  }),
  port: z.number().int().min(1).max(65535),
  database: sourceName('A database'),
  account: sourceName('An account'),
  // No `disable`: a credential never crosses a network in the clear. A private CA arrives as an
  // optional member, which refuses nothing stored.
  tls: z.enum(['require', 'verifyFull']),
});

const bounded = storable('A value')(z.string())
  .min(1)
  .max(2048)
  .refine((value) => !CONTROL.test(value), { message: 'No control character' });

/**
 * The design's three identities (data.md). Whether a type's connector declares an end-user mechanism
 * is `checkConnection`'s, so a version stored once a mechanism is declared still reads if a later
 * reader asks for the shape alone.
 */
const identity = z.union([
  z.strictObject({ kind: z.literal('service') }),
  z.strictObject({
    kind: z.literal('endUser'),
    mechanism: z.literal('delegated'),
    tokenEndpoint: bounded,
    audience: bounded,
  }),
  z.strictObject({
    kind: z.literal('endUser'),
    mechanism: z.literal('asserted'),
    attribute: z.enum(['email', 'subject']),
    assertion: z.enum(['sessionContext', 'executeAs']).optional(),
  }),
]);

/**
 * A connection version's settings (data.md, "The connection"; D1-C, D1-D): what anybody who may read
 * it sees, and never a secret. PostgreSQL alone in D1; each other type arrives as an arm with its
 * slice, which refuses nothing stored.
 */
export const connectionSettingsSchema = z.strictObject({
  schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
  name,
  description,
  type: z.literal('postgres'),
  source: postgresSource,
  identity,
  retired: z.boolean(),
});

export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;

type EndUserMechanism = 'delegated' | 'asserted';

/**
 * The end-user mechanisms each type's connector declares (DAT-078). PostgreSQL declares none in D1;
 * D7 adds `asserted`.
 */
export const connectorIdentities: Readonly<
  Record<ConnectionSettings['type'], readonly EndUserMechanism[]>
> = Object.freeze({ postgres: Object.freeze([]) });

export type ConnectionProblem =
  | { readonly rule: 'connection_invalid'; readonly path: string; readonly message: string }
  | { readonly rule: 'identity_not_supported'; readonly type: string; readonly mechanism: string };

/** A connection's settings refused, with every problem found. */
export class ConnectionRefused extends Error {
  constructor(readonly problems: readonly ConnectionProblem[]) {
    super(`The connection's settings are refused: ${problems.map((each) => each.rule).join(', ')}`);
  }
}

/** The shape alone: what a stored version is read back by. Throws `ConnectionRefused`. */
export function parseConnection(value: unknown): ConnectionSettings {
  const parsed = connectionSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ConnectionRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'connection_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The rules beyond the shape: an identity the type's connector does not declare (DAT-078). */
export function checkConnection(settings: ConnectionSettings): ConnectionProblem[] {
  const { identity: declared, type } = settings;
  if (declared.kind === 'endUser' && !connectorIdentities[type].includes(declared.mechanism)) {
    return [{ rule: 'identity_not_supported', type, mechanism: declared.mechanism }];
  }
  return [];
}

/** The shape, then the rules: what every write path parses a version by. Throws `ConnectionRefused`. */
export function parseConnectionForWrite(value: unknown): ConnectionSettings {
  const settings = parseConnection(value);
  const problems = checkConnection(settings);
  if (problems.length > 0) throw new ConnectionRefused(problems);
  return settings;
}

/**
 * What a connection's credential is bound to (the D1 fix, C3): its type and where it signs in - host,
 * port, database, account and TLS - and nothing else of its settings. A credential is sealed with this
 * as associated data and stored beside its digest, so a version that changes any of it leaves no
 * credential that opens, or that the service will hand over, until one is set again: an administrator
 * cannot point a stored password at a server of their own. A name or a description changes nothing.
 */
export function connectionTarget(settings: Pick<ConnectionSettings, 'type' | 'source'>): string {
  const { host, port, database, account, tls } = settings.source;
  return JSON.stringify([settings.type, host, port, database, account, tls]);
}
