import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { deleteArtifact, deletionOf, undeleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { placeHold } from './holds.js';
import { keptUntil, listKeeps, setKeep, type KeepKey } from './keeps.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const DAY = 86_400_000;

describe('retention keeps (lifecycle.md, "Retention"; the DL plan, DL-G)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const person = (trx: TenantTransaction, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A space of its own Ada authors, so no keep set by another test reaches it but a kind's. */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const ada = await person(trx, 'Ada');
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: ada,
      });
      return { space, ada };
    });

  const component = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

  const document = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const keep = (key: KeepKey, days: number | null, by: string) =>
    as((trx) => setKeep(trx, { ...key, days, by }));

  /** Its versions made `days` ago, as the schema's owner: the chain is never changed otherwise. */
  async function aged(artifact: string, days: number) {
    const client = new pg.Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`set local role "${tenant.role}_owner"`);
      await client.query(`select set_config('search_path', $1, true)`, [tenant.schema]);
      await client.query(
        `update artifact_version set created_at = created_at - make_interval(days => $2)
          where artifact_id = $1`,
        [artifact, days],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
  }

  const latestAt = (artifact: string) =>
    as(async (trx) => {
      const { rows } = await sql<{ at: Date }>`select created_at as at from artifact_version
        where artifact_id = ${artifact} order by revision_no desc, version_no desc limit 1`.execute(
        trx,
      );
      return rows[0]!.at;
    });

  const refusals = (id: string, by: string) => as((trx) => deletionOf(trx, id, by));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('LIF-019 declares a keep per kind and per space, the longest of those reaching an artifact applying', async () => {
    const { space, ada } = await fresh();
    const { space: other } = await fresh();
    const procedure = await component(space, ada, 'Kept procedure');
    const report = await document(space, ada, 'Kept report');
    const at = await latestAt(procedure);
    expect(await keep({ kind: 'component', space: null }, 10, ada)).toEqual({ answer: 'changed' });
    expect(await keep({ kind: null, space }, 30, ada)).toEqual({ answer: 'changed' });
    expect(await keep({ kind: 'component', space }, 20, ada)).toEqual({ answer: 'changed' });
    // A keep elsewhere, and a document's of another space, reach neither.
    await keep({ kind: null, space: other }, 400, ada);
    await keep({ kind: 'document', space: other }, 400, ada);
    expect(await as((trx) => keptUntil(trx, procedure))).toEqual(new Date(at.getTime() + 30 * DAY));
    // The space's cleared, the kind and space's is the longest left; the kind's alone after that.
    expect(await keep({ kind: null, space }, null, ada)).toEqual({ answer: 'changed' });
    expect(await as((trx) => keptUntil(trx, procedure))).toEqual(new Date(at.getTime() + 20 * DAY));
    await keep({ kind: 'component', space }, null, ada);
    expect(await as((trx) => keptUntil(trx, procedure))).toEqual(new Date(at.getTime() + 10 * DAY));
    // A document is no component: nothing keeps it.
    expect(await as((trx) => keptUntil(trx, report.artifactId))).toBeUndefined();
    // The keeps in force, a cleared one not among them.
    const listed = await as((trx) => listKeeps(trx));
    expect(
      listed.map(({ kind, space: of, days }) => ({ kind, space: of?.id ?? null, days })),
    ).toEqual(
      expect.arrayContaining([
        { kind: 'component', space: null, days: 10 },
        { kind: null, space: other, days: 400 },
        { kind: 'document', space: other, days: 400 },
      ]),
    );
    expect(listed.some((each) => each.space?.id === space)).toBe(false);
    await keep({ kind: 'component', space: null }, null, ada);
  });

  it('LIF-019 VER-036 refuses deleting within the longest keep, saying until when, and once it has passed deletes it, its versions kept', async () => {
    const { space, ada } = await fresh();
    const procedure = await component(space, ada, 'Young procedure');
    await keep({ kind: null, space }, 30, ada);
    await keep({ kind: 'component', space }, 10, ada);
    const until = new Date((await latestAt(procedure)).getTime() + 30 * DAY);
    expect((await refusals(procedure, ada))?.refusals).toEqual([{ reason: 'kept', until }]);
    expect(await as((trx) => deleteArtifact(trx, procedure, ada))).toEqual({
      answer: 'refused',
      refusals: [{ reason: 'kept', until }],
    });
    await aged(procedure, 31);
    expect((await refusals(procedure, ada))?.refusals).toEqual([]);
    expect(await as((trx) => deleteArtifact(trx, procedure, ada))).toEqual({ answer: 'deleted' });
    // A keep passing expires nothing: the deleted one's version is still there.
    expect((await refusals(procedure, ada))?.remains.versions).toBe(1);
  });

  it('LIF-021 refuses deleting what a hold holds once its keep has passed', async () => {
    const { space, ada } = await fresh();
    const procedure = await component(space, ada, 'Old held procedure');
    await keep({ kind: null, space }, 5, ada);
    await aged(procedure, 6);
    await as((trx) =>
      placeHold(trx, { target: { artifact: procedure }, reason: 'A matter', by: ada }),
    );
    expect(await as((trx) => deleteArtifact(trx, procedure, ada))).toEqual({
      answer: 'refused',
      refusals: [{ reason: 'held' }],
    });
  });

  it('VER-037 refuses deleting a baselined document that a keep and a hold each also refuse, listing all three', async () => {
    const { space, ada } = await fresh();
    const report = await document(space, ada, 'Baselined report');
    const issue = await as(async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: report.artifactId,
        version: report.id,
        name: 'Issue 1',
        maker: ada,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.baseline;
    });
    await keep({ kind: 'document', space }, 365, ada);
    await as((trx) => placeHold(trx, { target: { space }, reason: 'A matter', by: ada }));
    const until = new Date((await latestAt(report.artifactId)).getTime() + 365 * DAY);
    expect(await as((trx) => deleteArtifact(trx, report.artifactId, ada))).toEqual({
      answer: 'refused',
      refusals: [
        { reason: 'baselined', named: [{ id: issue, title: 'Issue 1' }], unreadable: false },
        { reason: 'held' },
        { reason: 'kept', until },
      ],
    });
  });

  it('never refuses an undelete, whatever keeps or holds it', async () => {
    const { space, ada } = await fresh();
    const procedure = await component(space, ada, 'Undeleted procedure');
    expect(await as((trx) => deleteArtifact(trx, procedure, ada))).toEqual({ answer: 'deleted' });
    await keep({ kind: null, space }, 3650, ada);
    await as((trx) => placeHold(trx, { target: { space }, reason: 'A matter', by: ada }));
    expect(await as((trx) => undeleteArtifact(trx, procedure, ada))).toEqual({
      answer: 'undeleted',
    });
  });

  it('LIF-019 records retention.changed with the key and the days, and a keep set again unchanged records nothing', async () => {
    const { space, ada } = await fresh();
    const events = () =>
      as(async (trx) => {
        const { rows } = await sql<{
          subject_kind: string;
          space: string | null;
          detail: unknown;
          label: string | null;
        }>`select e.subject_kind, e.space, e.detail,
                  (select l.text from audit_label l
                    where l.sequence = e.sequence and l.role = 'space') as label
             from audit_event e
            where e.kind = 'retention.changed' and e.space = ${space} order by e.sequence`.execute(
          trx,
        );
        return rows;
      });
    const name = await as(
      async (trx) =>
        (
          await trx
            .selectFrom('space')
            .select('name')
            .where('id', '=', space)
            .executeTakeFirstOrThrow()
        ).name,
    );
    await keep({ kind: 'document', space }, 90, ada);
    expect(await keep({ kind: 'document', space }, 90, ada)).toEqual({ answer: 'unchanged' });
    await keep({ kind: 'document', space }, null, ada);
    expect(await keep({ kind: 'document', space }, null, ada)).toEqual({ answer: 'unchanged' });
    expect(await events()).toEqual([
      {
        subject_kind: 'retention',
        space,
        detail: { kind: 'document', space, days: 90 },
        label: name,
      },
      {
        subject_kind: 'retention',
        space,
        detail: { kind: 'document', space, days: null },
        label: name,
      },
    ]);
  });

  it('refuses a keep with no key, of no days, on a space the tenant does not hold, and any change at the store', async () => {
    const { space, ada } = await fresh();
    expect(await keep({ kind: null, space: null }, 5, ada)).toEqual({ answer: 'key.invalid' });
    expect(await keep({ kind: null, space }, 0, ada)).toEqual({ answer: 'days.invalid' });
    expect(await keep({ kind: null, space: randomUUID() }, 5, ada)).toEqual({
      answer: 'space.missing',
    });
    await keep({ kind: null, space }, 5, ada);
    await expect(as((trx) => sql`update retention_keep set days = 1`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as((trx) => sql`delete from retention_keep`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });
});
