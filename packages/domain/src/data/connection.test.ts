import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import {
  bucketHost,
  checkConnection,
  connectionChangeProblems,
  connectionTarget,
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

  it('refuses a lone surrogate in every string of the settings, naming the member, as a string Postgres cannot store', () => {
    const lone = ['\uD800', '\uDC00', 'a\uD83Db', 'z\uDE00'];
    for (const path of [
      ['name'],
      ['description'],
      ['source', 'database'],
      ['source', 'account'],
      ['source', 'host'],
      ['identity', 'tokenEndpoint'],
    ]) {
      for (const text of lone) {
        const value =
          path[0] === 'identity'
            ? withMember(['identity'], {
                kind: 'endUser',
                mechanism: 'delegated',
                tokenEndpoint: `https://idp.example/${text}`,
                audience: 'source',
              })
            : withMember(path, `Read${text}ings`.toLowerCase());
        const problems = refusal(value);
        expect(problems.length, `${path.join('.')} ${JSON.stringify(text)}`).toBeGreaterThan(0);
        expect(
          problems.some(
            (problem) => problem.rule === 'connection_invalid' && problem.path === path.join('.'),
          ),
          `${path.join('.')} ${JSON.stringify(text)}`,
        ).toBe(true);
      }
    }
    // A pair whole is taken where the member takes it.
    expect(refusal(withMember(['name'], 'Readings 😀'))).toEqual([]);
    // And the words read as English: an account, a database.
    const [account] = refusal(withMember(['source', 'account'], ''));
    expect(account).toMatchObject({ message: 'An account is 1 to 63 bytes of UTF-8' });
    const [database] = refusal(withMember(['source', 'database'], ''));
    expect(database).toMatchObject({ message: 'A database is 1 to 63 bytes of UTF-8' });
  });

  it('DAT-078 DAT-117 PostgreSQL declares asserted identity alone: refuses delegated, and a choice of assertion, identity_not_supported', () => {
    expect(connectorIdentities.postgres).toEqual(['asserted']);
    const asserted = withMember(['identity'], {
      kind: 'endUser',
      mechanism: 'asserted',
      attribute: 'email',
    });
    const bySubject = withMember(['identity'], {
      kind: 'endUser',
      mechanism: 'asserted',
      attribute: 'subject',
    });
    const delegated = withMember(['identity'], {
      kind: 'endUser',
      mechanism: 'delegated',
      tokenEndpoint: 'https://idp.example.test/token',
      audience: 'readings',
    });
    expect(refusal(asserted)).toEqual([]);
    expect(refusal(bySubject)).toEqual([]);
    expect(refusal(delegated)).toEqual([
      { rule: 'identity_not_supported', type: 'postgres', mechanism: 'delegated' },
    ]);
    // SQL Server's choice of how to assert is not PostgreSQL's to take.
    for (const assertion of ['sessionContext', 'executeAs']) {
      const chosen = withMember(['identity'], {
        kind: 'endUser',
        mechanism: 'asserted',
        attribute: 'email',
        assertion,
      });
      expect(refusal(chosen), assertion).toEqual([
        {
          rule: 'identity_not_supported',
          type: 'postgres',
          mechanism: 'asserted',
          path: 'identity.assertion',
        },
      ]);
    }
    expect(refusal(whole)).toEqual([]);
    // A version stored with a mechanism no longer declared still reads when the shape alone is asked.
    expect(parseConnection(delegated)).toMatchObject({ identity: { mechanism: 'delegated' } });
    expect(checkConnection(parseConnection(delegated))).toEqual([
      { rule: 'identity_not_supported', type: 'postgres', mechanism: 'delegated' },
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

describe('an http connection version', () => {
  const http = {
    schemaVersion: 1,
    name: 'Readings API',
    description: '',
    type: 'http',
    source: { baseUrl: 'https://api.example.test/v1', secretHeader: 'x-api-key' },
    identity: { kind: 'service' },
    retired: false,
  } as const;
  const withSource = (source: Record<string, unknown>) => ({
    ...http,
    source: { ...http.source, ...source },
  });
  const BACKSLASH = String.fromCharCode(92);

  it('holds a base URL and the header its secret is sent in, whole', () => {
    expect(parseConnectionForWrite(http)).toEqual(http);
    for (const baseUrl of [
      'https://api.example.test',
      'https://api.example.test:8443/v1/readings',
      'https://172.31.20.21/api',
      'https://[2001:db8::1]:8443',
      'https://api.example.test/a%2Fb/~user',
    ]) {
      expect(refusal(withSource({ baseUrl })), baseUrl).toEqual([]);
    }
    for (const secretHeader of ['authorization', 'x-api-key', 'api_key']) {
      expect(refusal(withSource({ secretHeader })), secretHeader).toEqual([]);
    }
  });

  it('refuses a base URL that is not https, holds a user, a query or a fragment, or is not written one way', () => {
    for (const baseUrl of [
      'http://api.example.test',
      'ftp://api.example.test',
      'https://reader:pw@api.example.test',
      'https://api.example.test/v1?key=1',
      'https://api.example.test/v1#top',
      'https://api.example.test/',
      'https://api.example.test/v1/',
      'https://api.example.test//v1',
      'https://api.example.test/./v1',
      'https://api.example.test/../v1',
      'https://API.example.test',
      'https://2130706433',
      'https://0177.0.0.1',
      'https://[::ffff:127.0.0.1]',
      'https://[2001:DB8::1]',
      'https://api.example.test:0',
      'https://api.example.test:080',
      'https://api.example.test:65536',
      'https://api.example.test/a b',
      'https://api.example.test/a%2fb',
      'https://api.example.test/a%zz',
      `https://api.example.test/a${BACKSLASH}b`,
      'https://api.example.test/é',
      `https://api.example.test/${'a'.repeat(2048)}`,
      'https://',
      '',
    ]) {
      const problems = refusal(withSource({ baseUrl }));
      expect(problems[0], baseUrl).toMatchObject({
        rule: 'connection_invalid',
        path: 'source.baseUrl',
      });
    }
  });

  it('refuses a secret header that is not a lower-case token, or is the host, a framing header or a cookie', () => {
    for (const secretHeader of [
      '',
      'X-Api-Key',
      'x api key',
      'x-api-key:',
      'host',
      'cookie',
      'content-length',
      'transfer-encoding',
      'connection',
      'te',
      'upgrade',
      'proxy-authorization',
      'content-encoding',
      'a'.repeat(65),
    ]) {
      const problems = refusal(withSource({ secretHeader }));
      expect(problems[0], secretHeader).toMatchObject({
        rule: 'connection_invalid',
        path: 'source.secretHeader',
      });
    }
  });

  it("refuses another type's source, and declares no end user: delegated is refused, as ADR-0041 leaves it", () => {
    expect(refusal({ ...http, source: whole.source })[0]).toMatchObject({
      rule: 'connection_invalid',
    });
    expect(refusal({ ...whole, source: http.source })[0]).toMatchObject({
      rule: 'connection_invalid',
    });
    expect(connectorIdentities.http).toEqual([]);
    const delegated = {
      ...http,
      identity: {
        kind: 'endUser',
        mechanism: 'delegated',
        tokenEndpoint: 'https://idp.example.test/token',
        audience: 'readings',
      },
    };
    expect(refusal(delegated)).toEqual([
      { rule: 'identity_not_supported', type: 'http', mechanism: 'delegated' },
    ]);
    const asserted = {
      ...http,
      identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' },
    };
    expect(refusal(asserted)).toEqual([
      { rule: 'identity_not_supported', type: 'http', mechanism: 'asserted' },
    ]);
  });

  it('binds a credential to the base URL and the secret header, and a database target as it was', () => {
    expect(connectionTarget(parseConnection(http))).toBe(
      JSON.stringify(['http', 'https://api.example.test/v1', 'x-api-key']),
    );
    // A database's target is spelled as every stored digest was taken over.
    expect(connectionTarget(whole)).toBe(
      JSON.stringify(['postgres', 'source-postgres', 5432, 'readings', 'reader', 'require']),
    );
  });

  it("refuses a version that changes a connection's type", () => {
    expect(connectionChangeProblems(whole, parseConnection(http))).toEqual([
      {
        rule: 'connection_invalid',
        path: 'type',
        message: "A connection's type never changes: make a connection of the other type",
      },
    ]);
    const renamed: ConnectionSettings = { ...whole, name: 'Other' };
    expect(connectionChangeProblems(whole, renamed)).toEqual([]);
  });
});

describe('an s3 connection version', () => {
  const s3 = {
    schemaVersion: 1,
    name: 'Readings bucket',
    description: '',
    type: 's3',
    source: {
      endpoint: 'https://s3.example.test',
      region: 'eu-west-2',
      bucket: 'alloy-readings',
      pathStyle: false,
    },
    identity: { kind: 'service' },
    retired: false,
  } as const;
  const withSource = (source: Record<string, unknown>) => ({
    ...s3,
    source: { ...s3.source, ...source },
  });

  it('holds an endpoint, a region, a bucket and how it is addressed, whole', () => {
    expect(parseConnectionForWrite(s3)).toEqual(s3);
    for (const source of [
      { endpoint: 'https://s3.example.test:8443' },
      { endpoint: 'https://172.31.20.21:8333', pathStyle: true },
      { endpoint: 'https://[2001:db8::1]', pathStyle: true },
      { bucket: 'a.b-c' },
      { region: 'us-east-1' },
    ]) {
      expect(refusal(withSource(source)), JSON.stringify(source)).toEqual([]);
    }
    expect(bucketHost(s3.source)).toEqual({ host: 'alloy-readings.s3.example.test', port: 443 });
    expect(
      bucketHost({ ...s3.source, endpoint: 'https://s3.example.test:8443', pathStyle: true }),
    ).toEqual({ host: 's3.example.test', port: 8443 });
  });

  it('refuses an endpoint with a path, a bucket S3 would not name, a region that is not one, and an address virtual-hosted', () => {
    const refusedAt = (source: Record<string, unknown>, path: string) =>
      expect(refusal(withSource(source))[0], JSON.stringify(source)).toMatchObject({
        rule: 'connection_invalid',
        path,
      });
    for (const endpoint of [
      'http://s3.example.test',
      'https://s3.example.test/',
      'https://s3.example.test/bucket',
      'https://key:secret@s3.example.test',
      'https://s3.example.test?x=1',
      'https://S3.example.test',
      'https://2130706433',
      '',
    ]) {
      refusedAt({ endpoint }, 'source.endpoint');
    }
    for (const bucket of [
      'ab',
      'a'.repeat(64),
      'Readings',
      'readings_2026',
      '-readings',
      'readings-',
      'a..b',
      '192.168.1.1',
      'xn--readings',
      'readings/2026',
      '../readings',
    ]) {
      refusedAt({ bucket }, 'source.bucket');
    }
    for (const region of ['', 'EU-WEST-2', 'eu west 2', 'eu-west-2-', 'r'.repeat(33)]) {
      refusedAt({ region }, 'source.region');
    }
    refusedAt({ endpoint: 'https://172.31.20.21' }, 'source.pathStyle');
    refusedAt({ endpoint: 'https://[2001:db8::1]' }, 'source.pathStyle');
  });

  it('DAT-077 refuses an s3 connection declaring an end user: a store reads as its key pair alone', () => {
    expect(connectorIdentities.s3).toEqual([]);
    expect(
      refusal({
        ...s3,
        identity: {
          kind: 'endUser',
          mechanism: 'delegated',
          tokenEndpoint: 'https://idp.example.test/token',
          audience: 'readings',
        },
      }),
    ).toEqual([{ rule: 'identity_not_supported', type: 's3', mechanism: 'delegated' }]);
    expect(
      refusal({ ...s3, identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' } }),
    ).toEqual([{ rule: 'identity_not_supported', type: 's3', mechanism: 'asserted' }]);
  });

  it('binds a credential to the endpoint, the region, the bucket and its addressing', () => {
    expect(connectionTarget(parseConnection(s3))).toBe(
      JSON.stringify(['s3', 'https://s3.example.test', 'eu-west-2', 'alloy-readings', false]),
    );
    expect(connectionTarget(parseConnection(withSource({ pathStyle: true })))).not.toBe(
      connectionTarget(parseConnection(s3)),
    );
  });
});
