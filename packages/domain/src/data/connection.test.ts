import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import {
  checkConnection,
  ConnectionRefused,
  connectorIdentities,
  parseConnection,
  parseConnectionForWrite,
  type ConnectionProblem,
  type ConnectionSettings,
} from './connection.js';

const whole: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: 'The sites and their readings.\nRead-only.',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

/** The settings with one member replaced at a path, or removed where the value is undefined. */
function withMember(path: readonly string[], value: unknown): unknown {
  const copy = structuredClone(whole) as unknown as Record<string, unknown>;
  let at = copy;
  for (const step of path.slice(0, -1)) at = at[step] as Record<string, unknown>;
  const last = path[path.length - 1]!;
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy;
}

/** The problems a write is refused with, or none. */
function refusal(value: unknown): readonly ConnectionProblem[] {
  try {
    parseConnectionForWrite(value);
    return [];
  } catch (error) {
    if (error instanceof ConnectionRefused) return error.problems;
    throw error;
  }
}

describe('a connection version', () => {
  it("DAT-001 holds a connection's name and the settings of one PostgreSQL source, whole, or refuses them by rule", () => {
    expect(parseConnectionForWrite(whole)).toEqual(whole);
    expect(parseConnection(whole)).toEqual(whole);

    const refused: readonly [string, readonly string[], unknown][] = [
      // 1: the shape's own version.
      ['schemaVersion 2', ['schemaVersion'], 2],
      // 2: a name, 1 to 200 characters, its own trim, no control.
      ['an empty name', ['name'], ''],
      ['a name of 201 characters', ['name'], 'a'.repeat(201)],
      ['a name with a space before it', ['name'], ' Readings'],
      ['a name with a space after it', ['name'], 'Readings '],
      ['a name with a tab', ['name'], 'Read\tings'],
      ['a name with a line feed', ['name'], 'Read\nings'],
      ['a name with a C1 control', ['name'], 'Read\u0085ings'],
      // 3: a description, 0 to 2,000 characters, no control but a line feed.
      ['a description of 2,001 characters', ['description'], 'a'.repeat(2001)],
      ['a description with a carriage return', ['description'], 'one\r\ntwo'],
      ['a description with U+0000', ['description'], 'one\u0000two'],
      // 4: PostgreSQL alone in D1.
      ['another type', ['type'], 'sqlServer'],
      // 5: a host that is a name or a canonical address.
      ['an empty host', ['source', 'host'], ''],
      ['an upper-case host', ['source', 'host'], 'Source-Postgres'],
      // 6: a port.
      ['port 0', ['source', 'port'], 0],
      ['port 65536', ['source', 'port'], 65536],
      ['a fractional port', ['source', 'port'], 5432.5],
      ['a port as text', ['source', 'port'], '5432'],
      // 7: a database and an account, 1 to 63 UTF-8 bytes, no U+0000.
      ['an empty database', ['source', 'database'], ''],
      ['a database of 64 bytes', ['source', 'database'], 'd'.repeat(64)],
      ['a database of 32 characters and 64 bytes', ['source', 'database'], '\u00e9'.repeat(32)],
      ['a database with U+0000', ['source', 'database'], 'read\u0000ings'],
      ['an empty account', ['source', 'account'], ''],
      ['an account of 64 bytes', ['source', 'account'], 'r'.repeat(64)],
      ['an account with U+0000', ['source', 'account'], 'rea\u0000der'],
      ['no account', ['source', 'account'], undefined],
      // 8: TLS, never off.
      ['TLS disabled', ['source', 'tls'], 'disable'],
      ['TLS preferred', ['source', 'tls'], 'prefer'],
      // 9: an identity of the design's shapes.
      ['an identity of no kind', ['identity'], { kind: 'nobody' }],
      ['a service identity with more', ['identity'], { kind: 'service', attribute: 'email' }],
      // 10: retired is a boolean.
      ['retired as text', ['retired'], 'false'],
      // Unknown members, at the top and in the source.
      ['an unknown member', ['password'], 'secret-that-never-belongs-here'],
      ['an unknown source member', ['source', 'password'], 'secret-that-never-belongs-here'],
      ['a missing source', ['source'], undefined],
    ];
    for (const [what, path, value] of refused) {
      const problems = refusal(withMember(path, value));
      expect(problems.length, what).toBeGreaterThan(0);
      for (const problem of problems) expect(problem.rule, what).toBe('connection_invalid');
    }

    // The bounds themselves are taken.
    for (const [path, value] of [
      [['name'], 'a'.repeat(200)],
      [['name'], 'R'],
      [['description'], ''],
      [['description'], 'a'.repeat(2000)],
      [['source', 'port'], 1],
      [['source', 'port'], 65535],
      [['source', 'database'], 'd'.repeat(63)],
      [['source', 'account'], '\u00e9'.repeat(31) + 'r'],
      [['source', 'tls'], 'verifyFull'],
      [['retired'], true],
    ] as const) {
      expect(refusal(withMember(path, value)), `${path.join('.')} ${String(value)}`).toEqual([]);
    }
  });

  it('DAT-078 refuses a connection whose identity its connector does not declare, identity_not_supported', () => {
    expect(connectorIdentities.postgres).toEqual([]);
    const asserted = withMember(['identity'], {
      kind: 'endUser',
      mechanism: 'asserted',
      attribute: 'email',
    });
    const delegated = withMember(['identity'], {
      kind: 'endUser',
      mechanism: 'delegated',
      tokenEndpoint: 'https://idp.example.test/token',
      audience: 'readings',
    });
    expect(refusal(asserted)).toEqual([
      { rule: 'identity_not_supported', type: 'postgres', mechanism: 'asserted' },
    ]);
    expect(refusal(delegated)).toEqual([
      { rule: 'identity_not_supported', type: 'postgres', mechanism: 'delegated' },
    ]);
    expect(refusal(whole)).toEqual([]);
    // A version stored once a connector declares a mechanism still reads when the shape alone is
    // asked, so widening a declaration later never makes a stored version unreadable.
    expect(parseConnection(asserted)).toMatchObject({ identity: { mechanism: 'asserted' } });
    expect(checkConnection(parseConnection(asserted))).toEqual([
      { rule: 'identity_not_supported', type: 'postgres', mechanism: 'asserted' },
    ]);
  });

  it('refuses a host that names a path, a socket, a port or a number that is not a canonical address', () => {
    for (const host of [
      // Case 1's spellings of the platform's and the loopback address.
      '2887715339',
      '0254.037.012.013',
      '::ffff:172.31.10.11',
      '172.31.10.11.',
      '2130706433',
      '0177.0.0.1',
      '0x7f.0.0.1',
      '127.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '[::1]',
      'fe80::1%eth0',
      // Paths, a socket and a key file.
      '/var/run/postgresql',
      '/etc/ssl/private/source.key',
      'C:\\x',
      // A port, a user, a scheme.
      'source-postgres:5432',
      'reader@source-postgres',
      'postgres://source-postgres',
      // Not a name: a trailing dot, an empty label, a label of 64, a hyphen at an edge, all digits
      // last, a space, an underscore.
      'source-postgres.',
      'source..postgres',
      `${'a'.repeat(64)}.test`,
      '-source.test',
      'source-.test',
      'source.123',
      'source postgres',
      'source_postgres',
      // Not canonical addresses.
      '010.0.0.1',
      '256.0.0.1',
      '1.2.3',
      '2001:DB8::1',
      '2001:db8:0:0:0:0:0:1',
      '2001:0db8::1',
      '2001:db8::0:1',
      '0:0:0:0:0:0:0:1',
    ]) {
      const problems = refusal(withMember(['source', 'host'], host));
      expect(problems, host).not.toEqual([]);
      expect(problems[0], host).toMatchObject({ rule: 'connection_invalid', path: 'source.host' });
    }
    // The canonical spellings are taken: whether the address may be dialled is the guard's, at each
    // request, since what a name resolves to changes.
    for (const host of [
      'source-postgres',
      'db.example.test',
      'a',
      '172.31.20.21',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '2001:db8::1',
      'fe80::1',
      '2001:db8:0:1:1:1:1:1',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`,
    ]) {
      expect(refusal(withMember(['source', 'host'], host)), host).toEqual([]);
    }
    expect(
      refusal(
        withMember(
          ['source', 'host'],
          `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
        ),
      ),
    ).not.toEqual([]);
  });

  it("a version's digest is the same for any order of its members", () => {
    const reordered = {
      retired: false,
      identity: { kind: 'service' },
      source: {
        tls: 'require',
        account: 'reader',
        database: 'readings',
        port: 5432,
        host: 'source-postgres',
      },
      type: 'postgres',
      description: whole.description,
      name: whole.name,
      schemaVersion: 1,
    };
    expect(canonicalJson(parseConnectionForWrite(reordered))).toBe(canonicalJson(whole));
  });
});
