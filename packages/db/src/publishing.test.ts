import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql, type KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { requestPublication, resolveOccurrences } from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { recordVersion, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string, mode: ReferenceNode['mode'] = { kind: 'latest' }) =>
  ({
    type: 'reference',
    id: nodeId(),
    component,
    mode,
    ...base,
    children: [],
  }) satisfies ReferenceNode;
const section = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

/**
 * Every row any query returned, as Postgres returned it, so a test can say what was never selected -
 * not only what was left out of an answer after it was read.
 */
function capturingRows(): { readonly plugin: KyselyPlugin; readonly rows: unknown[] } {
  const rows: unknown[] = [];
  return {
    rows,
    plugin: {
      transformQuery: (args) => args.node,
      transformResult: async (args) => {
        rows.push(...args.result.rows);
        return args.result;
      },
    },
  };
}

describe('requesting and recording a publication', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = async (
    trx: TenantTransaction,
    space: string,
    author: string,
    title: string,
  ) => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  /** A document in General at a second version holding these nodes, or at 0.1 holding none. */
  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    if (nodes.length === 0) return made.version;
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const requested = async (trx: TenantTransaction, version: StoredVersion, requester: string) => {
    const answer = await requestPublication(trx, {
      documentId: version.artifactId,
      version: version.id,
      formats: ['pdf'],
      requester,
    });
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return answer.request.id;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
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
      const author = await findRole(trx, 'Author');
      // Ada authors General; Grace authors General and Quality, which Ada may not read.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
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

  it('starts every tenant with a Publisher role holding read and publish', async () => {
    const role = await service.withTenant(production, (trx) => findRole(trx, 'Publisher'));
    expect(role?.permissions).toEqual(['read', 'publish']);
  });

  it('refuses a component the publisher may not read, recording its node and nothing of it', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [section('Introduction', [open, hidden])]);

      const id = await requested(trx, version, ada);
      const row = await trx
        .selectFrom('publication_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ state: 'queued', formats: ['pdf'], requested_by: ada });
      expect(row.failures).toEqual([
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden.id,
          block: null,
          detail: null,
        },
      ]);
      expect(JSON.stringify(row)).not.toContain(secret.artifactId);
      expect(JSON.stringify(row)).not.toContain(secret.id);
      const occurrences = await trx
        .selectFrom('publication_request_occurrence')
        .selectAll()
        .where('request_id', '=', id)
        .execute();
      expect(occurrences.map((each) => [each.node, each.version_id])).toEqual([
        [open.id, shared.id],
      ]);
    });
  });

  it('refuses a version that is not the latest, and a format the template cannot make, recording nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      const older = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', version.artifactId)
        .where('id', '<>', version.id)
        .executeTakeFirstOrThrow();
      const asked = (at: string, formats: string[]) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: at,
          formats,
          requester: ada,
        });
      // The current version by its id alone: its outline names components the caller may not read.
      expect(await asked(older.id, ['pdf'])).toEqual({
        answer: 'version.precondition',
        current: version.id,
      });
      expect((await asked(version.id, ['docx'])).answer).toBe('format.unsupported');
      expect((await asked(version.id, ['pdf', 'docx'])).answer).toBe('format.unsupported');
      const requests = await trx
        .selectFrom('publication_request')
        .select('id')
        .where('document_id', '=', version.artifactId)
        .execute();
      expect(requests).toEqual([]);
    });
  });

  it('answers document.missing for an id that is no document, and records nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Method');
      const before = await trx.selectFrom('publication_request').select('id').execute();
      for (const documentId of [shared.artifactId, randomUUID(), 'not-a-uuid']) {
        await expect(
          requestPublication(trx, {
            documentId,
            version: shared.id,
            formats: ['pdf'],
            requester: ada,
          }),
        ).resolves.toEqual({ answer: 'document.missing' });
      }
      const after = await trx.selectFrom('publication_request').select('id').execute();
      expect(after).toEqual(before);
    });
  });

  it('never selects a row of a component the publisher may not read, however it is referenced', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const hiddenPin = reference(secret.artifactId, { kind: 'pinned', version: secret.id });
      // A readable component's reference pinned to the unreadable one's version (F7).
      const crossPin = reference(shared.artifactId, { kind: 'pinned', version: secret.id });
      const approved = reference(shared.artifactId, { kind: 'approved' });
      const missing = reference(randomUUID());
      const version = await documentWith(trx, [
        section('Introduction', [open, hidden, hiddenPin, crossPin, approved, missing]),
      ]);
      const outline = version.content as OutlineDocument;

      const asAda = capturingRows();
      expect(await resolveOccurrences(trx.withPlugin(asAda.plugin), outline, ada)).toEqual([
        { node: open.id, outcome: 'resolved', component: shared.artifactId, version: shared.id },
        { node: hidden.id, outcome: 'unreadable' },
        { node: hiddenPin.id, outcome: 'unreadable' },
        { node: crossPin.id, outcome: 'unresolved' },
        { node: approved.id, outcome: 'unresolved' },
        // A component that does not exist is told apart from one that may not be read by nothing.
        { node: missing.id, outcome: 'unreadable' },
      ]);
      expect(asAda.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(asAda.rows)).not.toContain(secret.artifactId);
      expect(JSON.stringify(asAda.rows)).not.toContain(secret.id);

      // The same capture sees the component when its reader resolves it, so its silence above is the
      // query's restriction and not the capture missing a row.
      const asGrace = capturingRows();
      expect(await resolveOccurrences(trx.withPlugin(asGrace.plugin), outline, grace)).toEqual([
        { node: open.id, outcome: 'resolved', component: shared.artifactId, version: shared.id },
        { node: hidden.id, outcome: 'resolved', component: secret.artifactId, version: secret.id },
        {
          node: hiddenPin.id,
          outcome: 'resolved',
          component: secret.artifactId,
          version: secret.id,
        },
        { node: crossPin.id, outcome: 'unresolved' },
        { node: approved.id, outcome: 'unresolved' },
        { node: missing.id, outcome: 'unreadable' },
      ]);
      expect(JSON.stringify(asGrace.rows)).toContain(secret.id);
    });
  });

  it('lets the runtime role finish a request once, and change nothing else of it or its occurrences', async () => {
    const { id, node } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const open = reference(shared.artifactId);
      const version = await documentWith(trx, [section('Method', [open])]);
      return { id: await requested(trx, version, ada), node: open.id };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`update publication_request set requested_by = ${grace} where id = ${id}`,
      /permission denied/,
    );
    await refused(
      sql`update publication_request set formats = array['pdf'] where id = ${id}`,
      /permission denied/,
    );
    await refused(sql`delete from publication_request where id = ${id}`, /permission denied/);
    await refused(sql`truncate publication_request cascade`, /permission denied/);
    await refused(
      sql`update publication_request_occurrence set node = ${nodeId()} where request_id = ${id}`,
      /permission denied/,
    );
    await refused(
      sql`delete from publication_request_occurrence where request_id = ${id}`,
      /permission denied/,
    );
    await refused(sql`truncate publication_request_occurrence`, /permission denied/);
    // Still queued, it may not have its failures rewritten short of finishing it.
    await refused(
      sql`update publication_request set failures = '[]' where id = ${id}`,
      /finished once/,
    );

    await service.withTenant(production, (trx) =>
      sql`update publication_request set state = 'done', finished_at = now() where id = ${id}`.execute(
        trx,
      ),
    );
    await refused(
      sql`update publication_request set state = 'queued', finished_at = null where id = ${id}`,
      /finished once/,
    );
    await refused(
      sql`update publication_request set state = 'failed',
            failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]'
          where id = ${id}`,
      /finished once/,
    );
    await refused(
      sql`update publication_request set finished_at = now() where id = ${id}`,
      /finished once/,
    );

    const { row, occurrences } = await service.withTenant(production, async (trx) => ({
      row: await trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'requested_by'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
      occurrences: await trx
        .selectFrom('publication_request_occurrence')
        .select('node')
        .where('request_id', '=', id)
        .execute(),
    }));
    expect(row).toEqual({ state: 'done', failures: [], requested_by: ada });
    expect(occurrences).toEqual([{ node }]);
  });

  it('finishes a request carrying a refusal only as failed, and lets only failed replace its failures', async () => {
    const { id, hidden } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [
        section('Method', [reference(shared.artifactId), hidden]),
      ]);
      return { id: await requested(trx, version, ada), hidden: hidden.id };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`update publication_request set state = 'done', finished_at = now() where id = ${id}`,
      /publication_request_done_without_failures/,
    );
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), failures = '[]'
          where id = ${id}`,
      /finished once/,
    );
    const failures = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select('failures')
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(failures.failures).toEqual([
      { stage: 'resolve', code: 'occurrence_unreadable', node: hidden, block: null, detail: null },
    ]);

    // A platform failure after the last attempt replaces the list with its own.
    const store = [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }];
    await service.withTenant(production, (trx) =>
      sql`update publication_request
            set state = 'failed', finished_at = now(), failures = ${JSON.stringify(store)}::jsonb
          where id = ${id}`.execute(trx),
    );
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select(['state', 'failures'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ state: 'failed', failures: store });
  });

  it('lets the runtime role insert a request only as queued and now, and an occurrence only into a queued one', async () => {
    const { version, shared, finished } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const version = await documentWith(trx, [section('Scope', [reference(shared.artifactId)])]);
      const finished = await requested(trx, version, ada);
      await sql`update publication_request set state = 'done', finished_at = now()
                where id = ${finished}`.execute(trx);
      return { version, shared, finished };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`insert into publication_request
            (document_id, document_version_id, formats, requested_by, state, finished_at)
          values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, 'done', now())`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request
            (document_id, document_version_id, formats, requested_by, requested_at)
          values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, now() - interval '1 year')`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request (id, document_id, document_version_id, formats, requested_by)
          values (${randomUUID()}, ${version.artifactId}, ${version.id}, array['pdf'], ${ada})`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request_occurrence (request_id, node, component_id, version_id)
          values (${finished}, ${nodeId()}, ${shared.artifactId}, ${shared.id})`,
      /only while its request is queued/,
    );

    const occurrences = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request_occurrence')
        .select('node')
        .where('request_id', '=', finished)
        .execute(),
    );
    expect(occurrences).toHaveLength(1);
  });
});
