import { randomBytes } from 'node:crypto';
import type { ConnectionSettings, PostgresSettings } from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  createConnection,
  credentialOf,
  latestConnectionTest,
  listReadableConnections,
  readConnection,
  recordConnectionTest,
  recordConnectionVersion,
  usableCredentialOf,
  setConnectionCredential,
} from './connections.js';
import { grant } from './grants.js';
import { createQueryDefinition, recordQueryDefinitionVersion } from './queryDefinitions.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  substanceOf,
} from './versions.js';

const ISSUER = 'https://idp.example';
const SECRET = 'an-invented-source-password';

const settings = (over: Partial<PostgresSettings> = {}): PostgresSettings => ({
  schemaVersion: 1,
  name: 'Readings',
  description: 'The sites and their readings.',
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
  ...over,
});

/** Every leaf path at which two values differ, as `a.b.c`. */
function changed(a: unknown, b: unknown, path: string[] = []): string[] {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      changed((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [
        ...path,
        key,
      ]),
    );
  }
  return Object.is(a, b) ? [] : [path.join('.')];
}

describe('a connection', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  const key = randomBytes(32);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada reads General; Grace reads Quality alone.
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space] of [
        [ada, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const made = (over: Partial<PostgresSettings> = {}, spaceId = general) =>
    service.withTenant(production, async (trx) => {
      const answer = await createConnection(trx, {
        author: ada,
        spaceId,
        settings: settings(over),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.connection;
    });

  const sealed = () => sealSecret(key, 'source-credential', production.id, SECRET);

  it("DAT-001 makes a connection in one space of the tenant's own schema, named, holding one source's settings", async () => {
    const connection = await made();
    expect(connection.settings).toEqual(settings());
    expect(connection.space).toEqual({ id: general, name: 'General' });
    expect(connection.version).toMatchObject({ revision: 0, version: 1, author: ada });

    // An artifact of its own kind, in one space, in this tenant's schema and in no other.
    const rows = await queryAs(
      db.adminUrl,
      `select kind, space_id from ${production.schema}.artifact where id = $1`,
      [connection.id],
    );
    expect(rows.rows).toEqual([{ kind: 'connection', space_id: general }]);
    const elsewhere = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${development.schema}.artifact where id = $1`,
      [connection.id],
    );
    expect(elsewhere.rows).toEqual([{ n: 0 }]);
    expect(
      await service.withTenant(production, (trx) => readConnection(trx, connection.id)),
    ).toEqual(connection);

    // Settings that do not pass, or a connection made retired, are refused by rule, and nothing is
    // written.
    const refused = await service.withTenant(production, (trx) =>
      createConnection(trx, {
        author: ada,
        spaceId: general,
        settings: { ...settings(), source: { ...settings().source, host: '/var/run/postgresql' } },
      }),
    );
    expect(refused).toMatchObject({
      answer: 'connection.refused',
      problems: [{ rule: 'connection_invalid', path: 'source.host' }],
    });
    const delegated = await service.withTenant(production, (trx) =>
      createConnection(trx, {
        author: ada,
        spaceId: general,
        settings: settings({
          identity: {
            kind: 'endUser',
            mechanism: 'delegated',
            tokenEndpoint: 'https://idp.example.test/token',
            audience: 'readings',
          },
        }),
      }),
    );
    expect(delegated).toEqual({
      answer: 'connection.refused',
      problems: [{ rule: 'identity_not_supported', type: 'postgres', mechanism: 'delegated' }],
    });
    const retired = await service.withTenant(production, (trx) =>
      createConnection(trx, {
        author: ada,
        spaceId: general,
        settings: settings({ retired: true }),
      }),
    );
    expect(retired).toMatchObject({
      answer: 'connection.refused',
      problems: [{ rule: 'connection_invalid', path: 'retired' }],
    });
    const nowhere = await service.withTenant(production, (trx) =>
      createConnection(trx, {
        author: ada,
        spaceId: '00000000-0000-4000-8000-00000000dead',
        settings: settings(),
      }),
    );
    expect(nowhere).toEqual({ answer: 'space.missing' });
  });

  it('refuses a connection made retired on every path that makes one, createArtifact as well as createConnection', async () => {
    // The stored-shape check's row 10: `true` is refused when a connection is made, whatever makes
    // it. A direct createArtifact is how testing/every-kind.ts and any later caller make one.
    const before = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${production.schema}.artifact where kind = 'connection'`,
    );
    await expect(
      service.withTenant(production, (trx) =>
        createArtifact(trx, {
          spaceId: general,
          author: ada,
          substance: { kind: 'connection', content: settings({ retired: true }) },
        }),
      ),
    ).rejects.toMatchObject({
      problems: [{ rule: 'connection_invalid', path: 'retired' }],
    });
    const after = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${production.schema}.artifact where kind = 'connection'`,
    );
    expect(after.rows).toEqual(before.rows);
    // A later version may retire it: that is what retiring is.
    const inService = await service.withTenant(production, (trx) =>
      createArtifact(trx, {
        spaceId: general,
        author: ada,
        substance: { kind: 'connection', content: settings() },
      }),
    );
    const retired = await service.withTenant(production, (trx) =>
      recordVersion(trx, {
        artifactId: inService.artifactId,
        openedFrom: inService.id,
        author: ada,
        substance: { kind: 'connection', content: settings({ retired: true }) },
      }),
    );
    expect(retired.answer).toBe('recorded');
  });

  it("records each change to a connection's settings as a version, retiring among them, and each credential set as a row naming who and when and never the value", async () => {
    const first = await made();
    const moved = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: first.version.id,
        settings: settings({ source: { ...settings().source, port: 6432 } }),
      }),
    );
    if (moved.answer !== 'recorded') throw new Error(moved.answer);
    expect(moved.connection.version).toMatchObject({ revision: 0, version: 2, author: ada });
    // What changed is a comparison of two versions, and names the member.
    const [before, after] = await service.withTenant(production, async (trx) => [
      await readVersion(trx, first.version.id),
      await readVersion(trx, moved.connection.version.id),
    ]);
    expect(changed(before!.content, after!.content)).toEqual(['source.port']);

    // Retiring is a version, the settings otherwise unchanged; and reinstating is another.
    const retired = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: grace,
        id: first.id,
        openedFrom: moved.connection.version.id,
        settings: { ...moved.connection.settings, retired: true },
      }),
    );
    if (retired.answer !== 'recorded') throw new Error(retired.answer);
    expect(changed(moved.connection.settings, retired.connection.settings)).toEqual(['retired']);
    expect(retired.connection.version).toMatchObject({ version: 3, author: grace });
    const reinstated = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: retired.connection.version.id,
        settings: { ...retired.connection.settings, retired: false },
      }),
    );
    expect(reinstated).toMatchObject({
      answer: 'recorded',
      connection: { settings: { retired: false } },
    });

    // A credential set is a row naming who and when; the chain is unchanged by it.
    const latestBefore = await service.withTenant(production, (trx) =>
      latestVersion(trx, first.id),
    );
    expect(await service.withTenant(production, (trx) => credentialOf(trx, first.id))).toEqual({
      set: false,
    });
    const value = sealed();
    const set = await service.withTenant(production, (trx) =>
      setConnectionCredential(trx, {
        id: first.id,
        sealed: value,
        by: grace,
        sealedFor: retired.connection.settings,
      }),
    );
    expect(set).toMatchObject({ answer: 'set' });
    const credential = await service.withTenant(production, (trx) => credentialOf(trx, first.id));
    expect(credential).toEqual({
      set: true,
      setBy: { id: grace, name: 'Grace' },
      setAt: expect.any(Date),
      targetChanged: false,
      setBeforeBinding: false,
    });
    expect(JSON.stringify(credential)).not.toContain(value);
    expect(JSON.stringify(credential)).not.toContain(SECRET);
    const latestAfter = await service.withTenant(production, (trx) => latestVersion(trx, first.id));
    expect(latestAfter!.id).toBe(latestBefore!.id);

    // Replaced: the latest row is the credential, and the earlier one is still there to say when.
    const replacement = sealSecret(key, 'source-credential', production.id, 'another-invented-one');
    await service.withTenant(production, (trx) =>
      setConnectionCredential(trx, {
        id: first.id,
        sealed: replacement,
        by: ada,
        sealedFor: retired.connection.settings,
      }),
    );
    expect(
      await service.withTenant(production, (trx) => usableCredentialOf(trx, first.id)),
    ).toEqual({ answer: 'usable', sealed: replacement, credentialId: expect.any(String) });
    expect(
      await service.withTenant(production, (trx) => credentialOf(trx, first.id)),
    ).toMatchObject({
      set: true,
      setBy: { id: ada, name: 'Ada' },
    });
    const rows = await queryAs(
      db.adminUrl,
      `select * from ${production.schema}.connection_credential where connection_id = $1 order by id`,
      [first.id],
    );
    expect(rows.rows.map((row) => row.set_by)).toEqual([grace, ada]);
    // Nothing in a row is the secret: its columns are the connection, the sealed value, who and when.
    expect(Object.keys(rows.rows[0]).sort()).toEqual(
      [
        'connection_id',
        'connection_kind',
        'id',
        'sealed',
        'set_at',
        'set_by',
        'target_digest',
      ].sort(),
    );
    expect(JSON.stringify(rows.rows)).not.toContain(SECRET);
  });

  it("DAT-003 holds a connection's credential only sealed, in a row the runtime role can add and never change or remove", async () => {
    const connection = await made();
    const insert = (value: string) =>
      service.withTenant(production, (trx) =>
        sql`insert into connection_credential (connection_id, sealed, set_by) values (${connection.id}, ${value}, ${ada})`.execute(
          trx,
        ),
      );
    // Anything that is not a sealed value is refused, the secret itself among them.
    for (const value of [SECRET, '', 'v1.short.tag.body', `${sealed()}.extra`]) {
      await expect(insert(value), value).rejects.toThrow(/connection_credential_sealed/);
    }
    // And a sealed value longer than any 4,096-byte secret seals to.
    const [version, iv, tag] = sealed().split('.');
    await expect(insert([version, iv, tag, 'A'.repeat(5600)].join('.'))).rejects.toThrow(
      /connection_credential_sealed/,
    );
    await insert(sealed());
    for (const statement of [
      sql`update connection_credential set sealed = ${sealed()}`,
      sql`update connection_credential set set_by = ${grace}`,
      sql`delete from connection_credential`,
      sql`truncate connection_credential`,
      sql`insert into connection_credential (connection_id, sealed, set_by, set_at) values (${connection.id}, ${sealed()}, ${ada}, now() - interval '1 day')`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
    // A credential names a connection, and nothing else.
    const component = await service.withTenant(production, (trx) =>
      trx.selectFrom('space').select('id').executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into connection_credential (connection_id, sealed, set_by) values (${component.id}, ${sealed()}, ${ada})`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('binds a credential to the target it was set for: a version changing the host, port, database, account or TLS leaves none usable until one is set again', async () => {
    const connection = await made();
    let opened = connection.version.id;
    const cut = async (source: Partial<ConnectionSettings['source']>, over = {}) => {
      const current = (await service.withTenant(production, (trx) =>
        readConnection(trx, connection.id),
      ))!;
      const answer = await service.withTenant(production, (trx) =>
        recordConnectionVersion(trx, {
          author: ada,
          id: connection.id,
          openedFrom: opened,
          settings: {
            ...current.settings,
            ...over,
            source: { ...current.settings.source, ...source },
          },
        }),
      );
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      opened = answer.connection.version.id;
    };
    const usable = () =>
      service.withTenant(production, (trx) => usableCredentialOf(trx, connection.id));
    const state = () => service.withTenant(production, (trx) => credentialOf(trx, connection.id));
    const set = () =>
      service.withTenant(production, async (trx) =>
        setConnectionCredential(trx, {
          id: connection.id,
          sealed: sealed(),
          by: ada,
          sealedFor: (await readConnection(trx, connection.id))!.settings,
        }),
      );

    expect(await usable()).toEqual({ answer: 'missing' });
    await set();
    expect(await usable()).toEqual({
      answer: 'usable',
      sealed: expect.any(String),
      credentialId: expect.any(String),
    });
    expect(await state()).toMatchObject({
      set: true,
      targetChanged: false,
      setBeforeBinding: false,
    });

    // A change to anything but the target keeps the credential.
    await cut({}, { name: 'Readings, renamed', description: 'Moved.' });
    expect(await usable()).toMatchObject({ answer: 'usable' });

    for (const change of [
      { host: 'elsewhere.example' },
      { port: 5433 },
      { database: 'other' },
      { account: 'writer' },
      { tls: 'verifyFull' as const },
    ]) {
      await cut(change);
      expect(await usable(), JSON.stringify(change)).toEqual({ answer: 'target_changed' });
      expect(await state(), JSON.stringify(change)).toMatchObject({
        set: true,
        targetChanged: true,
      });
      await set();
      expect(await usable(), JSON.stringify(change)).toMatchObject({ answer: 'usable' });
    }

    // A row that names no target - one set before credentials were bound - is never usable.
    await service.withTenant(production, (trx) =>
      sql`insert into connection_credential (connection_id, sealed, set_by) values (${connection.id}, ${sealed()}, ${ada})`.execute(
        trx,
      ),
    );
    expect(await usable()).toEqual({ answer: 'unbound' });
    // Said so as its own case: nothing changed, it was set before credentials were bound.
    expect(await state()).toMatchObject({ set: true, targetChanged: true, setBeforeBinding: true });
    // And the runtime role cannot write a target of its own shape.
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into connection_credential (connection_id, sealed, set_by, target_digest) values (${connection.id}, ${sealed()}, ${ada}, ${'not a digest'})`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/connection_credential_target_digest/);
  });

  it('answers a stale version precondition with the current one, and an unchanged version unchanged', async () => {
    const first = await made();
    const second = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: first.version.id,
        settings: settings({ name: 'Readings, moved' }),
      }),
    );
    if (second.answer !== 'recorded') throw new Error(second.answer);
    const stale = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: first.version.id,
        settings: settings({ name: 'Readings, again' }),
      }),
    );
    expect(stale).toMatchObject({
      answer: 'version.precondition',
      current: { version: { id: second.connection.version.id } },
    });
    const same = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: second.connection.version.id,
        settings: second.connection.settings,
      }),
    );
    expect(same).toMatchObject({
      answer: 'version.unchanged',
      connection: { version: { id: second.connection.version.id } },
    });
    const refused = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: first.id,
        openedFrom: second.connection.version.id,
        settings: { ...second.connection.settings, type: 'http' },
      }),
    );
    expect(refused).toMatchObject({ answer: 'connection.refused' });
    const missing = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: general,
        openedFrom: second.connection.version.id,
        settings: settings(),
      }),
    );
    expect(missing).toEqual({ answer: 'connection.missing' });
  });

  it("holds an HTTP connection, and refuses a version that changes a connection's type", async () => {
    const http = {
      ...settings(),
      type: 'http',
      source: { baseUrl: 'https://api.example.test/v1', secretHeader: 'x-api-key' },
    };
    const made = await service.withTenant(production, (trx) =>
      createConnection(trx, { author: ada, spaceId: general, settings: http }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    expect(made.connection.settings).toEqual(http);
    const back = made.connection;
    const changed = await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: back.id,
        openedFrom: back.version.id,
        settings: settings(),
      }),
    );
    expect(changed).toEqual({
      answer: 'connection.refused',
      problems: [
        {
          rule: 'connection_invalid',
          path: 'type',
          message: "A connection's type never changes: make a connection of the other type",
        },
      ],
    });
  });

  it("recomputes a version's digests from the row, and reads a version back by its shape", async () => {
    const connection = await made();
    const stored = await service.withTenant(production, (trx) =>
      readVersion(trx, connection.version.id),
    );
    const substance = substanceOf(stored!);
    expect(substance).toEqual({ kind: 'connection', content: settings() });
    expect(versionDigests(substance)).toEqual({
      contentHash: stored!.contentHash,
      versionDigest: stored!.versionDigest,
    });
  });

  it("records a test against the version and the credential it tested, refusing another connection's version or credential, a finding on a failure, an unknown finding, a failure without its code and any change", async () => {
    const connection = await made();
    const other = await made({ name: 'Other' });
    const credentialOn = async (on: typeof connection) => {
      const set = await service.withTenant(production, (trx) =>
        setConnectionCredential(trx, {
          id: on.id,
          sealed: sealed(),
          by: ada,
          sealedFor: on.settings,
        }),
      );
      if (set.answer !== 'set') throw new Error(set.answer);
      return set.credentialId;
    };
    const credentialId = await credentialOn(connection);
    const othersCredential = await credentialOn(other);
    expect(
      await service.withTenant(production, (trx) => latestConnectionTest(trx, connection.id)),
    ).toBeUndefined();
    await service.withTenant(production, (trx) =>
      recordConnectionTest(trx, {
        connectionId: connection.id,
        versionId: connection.version.id,
        credentialId,
        outcome: 'failed',
        findings: [],
        failure: 'connection_failed',
        by: ada,
      }),
    );
    await service.withTenant(production, (trx) =>
      recordConnectionTest(trx, {
        connectionId: connection.id,
        versionId: connection.version.id,
        credentialId,
        outcome: 'ok',
        findings: ['account_not_read_only'],
        failure: null,
        by: grace,
      }),
    );
    expect(
      await service.withTenant(production, (trx) => latestConnectionTest(trx, connection.id)),
    ).toEqual({
      outcome: 'ok',
      findings: ['account_not_read_only'],
      failure: null,
      at: expect.any(Date),
      by: { id: grace, name: 'Grace' },
      version: connection.version.id,
      credentialCurrent: true,
    });
    // A newer credential set: the test was of the earlier one, and says nothing of this.
    await credentialOn(connection);
    expect(
      await service.withTenant(production, (trx) => latestConnectionTest(trx, connection.id)),
    ).toMatchObject({ outcome: 'ok', credentialCurrent: false });
    // A test names its own connection's credential, never another's.
    await expect(
      service.withTenant(production, (trx) =>
        recordConnectionTest(trx, {
          connectionId: connection.id,
          versionId: connection.version.id,
          credentialId: othersCredential,
          outcome: 'ok',
          findings: [],
          failure: null,
          by: ada,
        }),
      ),
    ).rejects.toThrow(/connection_test_credential/);

    const insert = (values: {
      version: string;
      outcome: string;
      findings: string[];
      failure: string | null;
    }) =>
      service.withTenant(production, (trx) =>
        sql`insert into connection_test (connection_id, connection_version_id, outcome, findings, failure, tested_by)
            values (${connection.id}, ${values.version}, ${values.outcome}, ${values.findings}::text[], ${values.failure}, ${ada})`.execute(
          trx,
        ),
      );
    const good = { version: connection.version.id, outcome: 'ok', findings: [], failure: null };
    await insert(good);
    await expect(insert({ ...good, version: other.version.id })).rejects.toThrow(/foreign key/);
    await expect(
      insert({
        ...good,
        outcome: 'failed',
        failure: 'timeout',
        findings: ['account_not_read_only'],
      }),
    ).rejects.toThrow(/connection_test/);
    // 0054's second finding (the D7 plan, D7-D) is taken beside the first; an unknown one is not.
    await insert({ ...good, findings: ['account_not_read_only', 'account_holds_privilege'] });
    await expect(insert({ ...good, findings: ['account_unknown'] })).rejects.toThrow(
      /connection_test/,
    );
    await expect(
      insert({ ...good, findings: ['account_not_read_only', 'account_not_read_only'] }),
    ).rejects.toThrow(/connection_test/);
    await expect(insert({ ...good, outcome: 'failed' })).rejects.toThrow(/connection_test/);
    await expect(insert({ ...good, failure: 'timeout' })).rejects.toThrow(/connection_test/);
    await expect(insert({ ...good, outcome: 'failed', failure: 'row_limit' })).rejects.toThrow(
      /connection_test/,
    );
    await expect(insert({ ...good, outcome: 'maybe' })).rejects.toThrow(/connection_test/);
    for (const statement of [
      sql`update connection_test set outcome = 'failed', failure = 'timeout'`,
      sql`delete from connection_test`,
      sql`truncate connection_test`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('is found on its space by who may read it, with whether a credential is set and its last test, and never in search', async () => {
    const inQuality = await made({ name: 'Quality source' }, quality);
    const set = await service.withTenant(production, (trx) =>
      setConnectionCredential(trx, {
        id: inQuality.id,
        sealed: sealed(),
        by: ada,
        sealedFor: inQuality.settings,
      }),
    );
    if (set.answer !== 'set') throw new Error(set.answer);
    await service.withTenant(production, (trx) =>
      recordConnectionTest(trx, {
        connectionId: inQuality.id,
        versionId: inQuality.version.id,
        credentialId: set.credentialId,
        outcome: 'ok',
        findings: [],
        failure: null,
        by: ada,
      }),
    );
    const listed = await service.withTenant(production, (trx) =>
      listReadableConnections(trx, grace, { limit: 50 }),
    );
    expect(listed!.items).toEqual([
      {
        id: inQuality.id,
        name: 'Quality source',
        type: 'postgres',
        retired: false,
        space: { id: quality, name: 'Quality' },
        version: { id: inQuality.version.id, revision: 0, version: 1 },
        changedAt: expect.any(Date),
        credentialSet: true,
        lastTest: {
          outcome: 'ok',
          at: expect.any(Date),
          version: inQuality.version.id,
          credentialCurrent: true,
        },
      },
    ]);
    expect(listed!.facets.spaces).toEqual([{ value: quality, label: 'Quality', count: 1 }]);
    // Ada reads General alone, where every other connection here was made.
    const ada_ = await service.withTenant(production, (trx) =>
      listReadableConnections(trx, ada, { limit: 50 }, { spaces: [quality] }),
    );
    expect(ada_!.items).toEqual([]);

    // A connection is found on its space's Connections page, not by search (data.md, "Searchable").
    const entries = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${production.schema}.search_entry where artifact_id = $1`,
      [inQuality.id],
    );
    expect(entries.rows).toEqual([{ n: 0 }]);
  });

  it('DAT-065 refuses to retire a connection a definition that is not retired still names, naming it, and retires it once that definition is retired', async () => {
    const used = await made({ name: 'Used source' });
    const inGeneral = await service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: {
          schemaVersion: 1,
          title: 'Sites',
          description: '',
          connection: used.id,
          parameters: [],
          fetch: { kind: 'sql', text: 'select id from sample.site order by id' },
          columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 100_000, seconds: 10 },
          retired: false,
        },
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.definition;
    });
    const retire = (author: string, openedFrom = used.version.id) =>
      service.withTenant(production, (trx) =>
        recordConnectionVersion(trx, {
          author,
          id: used.id,
          openedFrom,
          settings: { ...used.settings, retired: true },
        }),
      );
    // Refused, naming the definition to who may read it and counting it to who may not; nothing cut.
    expect(await retire(ada)).toEqual({
      answer: 'connection.in_use',
      definitions: { readable: [{ id: inGeneral.id, title: 'Sites', retired: false }], others: 0 },
    });
    expect(await retire(grace)).toEqual({
      answer: 'connection.in_use',
      definitions: { readable: [], others: 1 },
    });
    // Nothing cascades, and nothing is left pointing at nothing: the connection is as it was.
    const still = await service.withTenant(production, (trx) => readConnection(trx, used.id));
    expect(still?.version.id).toBe(used.version.id);
    expect(still?.settings.retired).toBe(false);
    // The same refusal on every path that cuts a version, recordVersion itself among them.
    await expect(
      service.withTenant(production, (trx) =>
        recordVersion(trx, {
          artifactId: used.id,
          openedFrom: used.version.id,
          author: ada,
          substance: { kind: 'connection', content: { ...used.settings, retired: true } },
        }),
      ),
    ).rejects.toThrow(/in use/);

    // Once the definition is retired, the connection retires.
    const retiredDefinition = await service.withTenant(production, (trx) =>
      recordQueryDefinitionVersion(trx, {
        author: ada,
        id: inGeneral.id,
        openedFrom: inGeneral.version.id,
        definition: { ...inGeneral.definition, retired: true },
      }),
    );
    expect(retiredDefinition.answer).toBe('recorded');
    const retired = await retire(ada);
    expect(retired).toMatchObject({
      answer: 'recorded',
      connection: { settings: { retired: true } },
    });
  });
});
