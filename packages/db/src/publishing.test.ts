import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  defaultNumberingScheme,
  type ContentDocument,
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
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  failPublicationRequest,
  publicationInputs,
  recordPublication,
  requestPublication,
  resolveOccurrences,
} from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilBlockedBy,
  type TestDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

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

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Like `latch`, but the opener carries a value out - here, a transaction's own backend pid. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

/**
 * Fails after an insert into `table` has run, as a lost connection or a driver's fault would: the
 * statement took effect, and its caller is told it failed.
 */
function failingAfterInsertInto(table: string): KyselyPlugin {
  const marked = new WeakSet<object>();
  return {
    transformQuery: (args) => {
      if (args.node.kind === 'InsertQueryNode' && args.node.into?.table.identifier.name === table) {
        marked.add(args.queryId);
      }
      return args.node;
    },
    transformResult: async (args) => {
      if (marked.has(args.queryId)) throw new Error('The connection was lost');
      return args.result;
    },
  };
}

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

  it('refuses a version that is not the latest, and a format the layout does not make, recording nothing', async () => {
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

  /** Every request the tenant holds, by id - to say a refusal recorded none. */
  const requestIds = (trx: TenantTransaction) =>
    trx
      .selectFrom('publication_request')
      .select('id')
      .execute()
      .then((rows) => rows.map((row) => row.id));

  /** A document in General at 0.1, in the language given. */
  const documentIn = async (trx: TenantTransaction, language: string) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language,
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  it('PUB-014 refuses a format its layout does not make, naming it, and records nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      // The layout the request would be made under declares its formats, one member each: `pdf` alone.
      expect(Object.keys((await defaultLayout(trx)).layout.formats)).toEqual(['pdf']);
      const before = await requestIds(trx);
      const asked = (formats: string[]) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats,
          requester: ada,
        });
      // Refused, never approximated as the formats it can make: the one it cannot is named.
      expect(await asked(['pdf', 'docx'])).toEqual({
        answer: 'format.unsupported',
        formats: ['docx'],
      });
      expect(await asked(['docx', 'odt', 'docx'])).toEqual({
        answer: 'format.unsupported',
        formats: ['docx', 'odt'],
      });
      expect(await requestIds(trx)).toEqual(before);
      // A format it declares is taken.
      expect((await asked(['pdf'])).answer).toBe('requested');
    });
  });

  it('refuses a request naming no format, or one format twice, and records nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      const before = await requestIds(trx);
      for (const formats of [[], ['pdf', 'pdf']]) {
        expect(
          await requestPublication(trx, {
            documentId: version.artifactId,
            version: version.id,
            formats,
            requester: ada,
          }),
        ).toEqual({ answer: 'format.unsupported', formats: [] });
      }
      expect(await requestIds(trx)).toEqual(before);
    });
  });

  it("PUB-095 refuses a document in a language its layout is not written in, naming both, and takes one in the layout's language", async () => {
    await service.withTenant(production, async (trx) => {
      // The layout declares its words' language as a BCP 47 tag.
      expect((await defaultLayout(trx)).layout.language).toBe('en');
      const french = await documentIn(trx, 'fr');
      const before = await requestIds(trx);
      expect(
        await requestPublication(trx, {
          documentId: french.artifactId,
          version: french.id,
          formats: ['pdf'],
          requester: ada,
        }),
      ).toEqual({ answer: 'layout.language', document: 'fr', layout: 'en' });
      expect(await requestIds(trx)).toEqual(before);

      // `en`, taken as a language range, matches `en-GB`.
      const british = await documentIn(trx, 'en-GB');
      const answer = await requestPublication(trx, {
        documentId: british.artifactId,
        version: british.id,
        formats: ['pdf'],
        requester: ada,
      });
      expect(answer).toMatchObject({ answer: 'requested', request: { state: 'queued' } });
    });
  });

  it('records the layout version a request was made under, and hands it and the revision to the job', async () => {
    const rolledBack = new Error('rolled back');
    await expect(
      service.withTenant(production, async (trx) => {
        const declared = await defaultLayout(trx);
        const version = await documentIn(trx, 'en-GB');
        const id = await requested(trx, version, ada);
        const row = await trx
          .selectFrom('publication_request')
          .select(['layout_id', 'layout_version_id'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({
          layout_id: DEFAULT_LAYOUT_ID,
          layout_version_id: declared.versionId,
        });

        // The layout moves on after the request: the job is still handed the version it was made
        // under, never the latest.
        const next = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: declared.versionId,
          author: ada,
          substance: {
            kind: 'layout',
            content: {
              ...declared.layout,
              words: { ...declared.layout.words, contents: 'Table of contents' },
            },
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        // The default is at 0.3 since 0021, so the version recorded after it is 0.4.
        expect((await defaultLayout(trx)).number).toBe('0.4');

        const inputs = await publicationInputs(trx, id);
        expect(inputs!.layout).toEqual({ versionId: declared.versionId, layout: declared.layout });
        // The document's version as `revision.version` (VER-009): a first version is 0.1.
        expect(inputs!.revision).toBe('0.1');
        // Thrown to roll the layout's 0.4 back: the rest of the suite publishes under the default.
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
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
  /**
   * What a worker records for a request made under a layout - template 2 and pipeline 2 - over an
   * output the store need not hold.
   */
  const recording = (requestId: string) => ({
    requestId,
    engineVersion: '0.15.1',
    templateVersion: 2,
    pipelineVersion: '2',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    output: {
      key: `${production.role}/sha256/${'c'.repeat(64)}`,
      sha256: 'c'.repeat(64),
      bytes: 1000,
    },
  });

  /** How many of each row a publication is made of the tenant holds - to say a record left none. */
  const publications = () =>
    service.withTenant(production, async (trx) => ({
      records: (await trx.selectFrom('publication').select('id').execute()).length,
      artifacts: (
        await trx.selectFrom('artifact').select('id').where('kind', '=', 'publication').execute()
      ).length,
      inputs: (await trx.selectFrom('publication_input').select('version_id').execute()).length,
      outputs: (await trx.selectFrom('publication_output').select('sha256').execute()).length,
    }));

  const stateOf = (id: string) =>
    service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'finished_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  it('reads back exactly the versions a request recorded, and nothing it refused', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [section('Introduction', [open, hidden])]);
      const adas = await publicationInputs(trx, await requested(trx, version, ada));
      expect([...adas!.occurrences.keys()]).toEqual([open.id]);
      expect(adas!.refused.map((each) => each.node)).toEqual([hidden.id]);
      // Grace may read both.
      const graces = await publicationInputs(trx, await requested(trx, version, grace));
      // As a set: the occurrences are keyed by node, and the query reading them names no order, so
      // the order rows come back in is the plan's (it changed when 0018 added the layout's version).
      expect(new Set(graces!.occurrences.keys())).toEqual(new Set([open.id, hidden.id]));
      expect(graces!.refused).toEqual([]);
    });
  });

  it('reads a request as it was made: who asked, when, the document at its version, and each version it took', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const open = reference(shared.artifactId);
      const version = await documentWith(trx, [section('Method', [open])]);
      const id = await requested(trx, version, ada);
      const row = await trx
        .selectFrom('publication_request')
        .select('requested_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const inputs = await publicationInputs(trx, id);
      expect(inputs!.request).toEqual({
        id,
        documentId: version.artifactId,
        documentVersionId: version.id,
        requestedBy: ada,
        requestedAt: row.requested_at,
        spaceId: general,
      });
      expect(inputs!.outline).toEqual(version.content);
      expect(inputs!.occurrences.get(open.id)?.version).toBe(shared.id);
      expect(inputs!.occurrences.get(open.id)?.content).toEqual(shared.content);
      expect(await publicationInputs(trx, randomUUID())).toBeUndefined();
    });
  });

  it('PUB-050 records a publication the runtime role can insert and read and never change', async () => {
    const rowOf = (trx: TenantTransaction, id: string) =>
      trx.selectFrom('publication').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const { first, again, version, queued } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      const one = await recordPublication(trx, recording(await requested(trx, version, ada)));
      const recorded = await rowOf(trx, one!);
      // A second worker racing an expired lease finds the request done and records nothing.
      expect(await recordPublication(trx, recording(recorded.request_id))).toBeUndefined();
      // Correcting it is publishing again: another request, another publication, the first unchanged.
      const two = await recordPublication(trx, recording(await requested(trx, version, ada)));
      expect(await rowOf(trx, one!)).toEqual(recorded);
      return { first: one!, again: two!, version, queued: await requested(trx, version, ada) };
    });
    expect(again).not.toBe(first);
    for (const statement of [
      sql`update publication set approval = 'none' where id = ${first}`,
      sql`delete from publication where id = ${first}`,
      sql`delete from publication_output where publication_id = ${first}`,
      sql`update publication_input set node = null where publication_id = ${first}`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }

    // Nothing is added to a publication once made: not a version it did not read, nor another output.
    const other = 'e'.repeat(64);
    for (const statement of [
      sql`insert into publication_input (publication_id, version_id, node)
          values (${first}, ${version.id}, ${nodeId()})`,
      sql`insert into publication_output (publication_id, format, object_key, sha256, bytes, standard)
          values (${first}, 'pdf', ${`${production.role}/sha256/${other}`}, ${other}, 1, 'ua-1')`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /only while its publication's request is queued/,
      );
    }

    // Nor is a publication made except as its request was made: one inserted beside a queued request
    // is refused when its transaction commits - bare, or whole and its request marked done, in
    // another publisher's name and back-dated.
    const forged = async (trx: TenantTransaction) => {
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'publication', space_id: general })
        .returning('id')
        .executeTakeFirstOrThrow();
      const made = recording(queued);
      // Under its request's own layout, so the row passes every check but the one at commit.
      const under = await trx
        .selectFrom('publication_request')
        .select(['layout_id', 'layout_version_id'])
        .where('id', '=', queued)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('publication')
        .values({
          id: artifact.id,
          request_id: queued,
          document_id: version.artifactId,
          document_version_id: version.id,
          publisher: grace,
          published_at: new Date('2020-01-01T00:00:00Z'),
          approval: 'none',
          formats: ['pdf'],
          engine: 'typst',
          engine_version: made.engineVersion,
          template: 'publication',
          template_version: made.templateVersion,
          pipeline_version: made.pipelineVersion,
          fonts: JSON.stringify(made.fonts),
          data_sha256: made.dataSha256,
          numbering: JSON.stringify(made.numbering),
          layout_id: under.layout_id,
          layout_version_id: under.layout_version_id,
        })
        .execute();
      return artifact.id;
    };
    await expect(service.withTenant(production, forged)).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(production, async (trx) => {
        const id = await forged(trx);
        await trx
          .insertInto('publication_input')
          .values({ publication_id: id, version_id: version.id, node: null })
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: id,
            format: 'pdf',
            object_key: `${production.role}/sha256/${other}`,
            sha256: other,
            bytes: 1,
            standard: 'ua-1',
          })
          .execute();
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${queued}`.execute(trx);
      }),
    ).rejects.toThrow(/recorded whole/);
    // Its request is untouched by either, and publishes as it was made.
    expect(await stateOf(queued)).toEqual({ state: 'queued', failures: [], finished_at: null });
    expect(
      await service.withTenant(production, (trx) => recordPublication(trx, recording(queued))),
    ).toBeDefined();
  });

  it('records every version a publication read, what made it, and its output by its own digest', async () => {
    const made = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const other = await component(trx, general, ada, 'Method');
      const open = reference(shared.artifactId);
      const pinned = reference(other.artifactId, { kind: 'pinned', version: other.id });
      const version = await documentWith(trx, [
        section('Introduction', [open]),
        section('Scope', [pinned]),
      ]);
      const request = await requested(trx, version, ada);
      const id = await recordPublication(trx, recording(request));
      return { id: id!, request, version, shared, other, open, pinned };
    });

    await service.withTenant(production, async (trx) => {
      const layout = await defaultLayout(trx);
      const request = await trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'finished_at', 'requested_at'])
        .where('id', '=', made.request)
        .executeTakeFirstOrThrow();
      expect(request).toMatchObject({ state: 'done', failures: [] });
      expect(request.finished_at).toBeInstanceOf(Date);

      const artifact = await trx
        .selectFrom('artifact')
        .select(['kind', 'space_id'])
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(artifact).toEqual({ kind: 'publication', space_id: general });

      const publication = await trx
        .selectFrom('publication')
        .selectAll()
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(publication).toEqual({
        id: made.id,
        kind: 'publication',
        request_id: made.request,
        document_id: made.version.artifactId,
        document_version_id: made.version.id,
        document_kind: 'document',
        publisher: ada,
        // The time it was asked for, which is the time compiled into the PDF.
        published_at: request.requested_at,
        approval: 'none',
        formats: ['pdf'],
        engine: 'typst',
        engine_version: '0.15.1',
        template: 'publication',
        template_version: 2,
        pipeline_version: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        data_sha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        // Its request's layout version, copied under the request's lock (0018).
        layout_id: DEFAULT_LAYOUT_ID,
        layout_version_id: layout.versionId,
        layout_kind: 'layout',
      });

      const inputs = await trx
        .selectFrom('publication_input')
        .select(['version_id', 'node'])
        .where('publication_id', '=', made.id)
        .execute();
      // The document's version with no place, and each occurrence's version at its place.
      expect(inputs).toHaveLength(3);
      expect(inputs).toEqual(
        expect.arrayContaining([
          { version_id: made.version.id, node: null },
          { version_id: made.shared.id, node: made.open.id },
          { version_id: made.other.id, node: made.pinned.id },
        ]),
      );

      const outputs = await trx
        .selectFrom('publication_output')
        .selectAll()
        .where('publication_id', '=', made.id)
        .execute();
      expect(outputs).toEqual([
        {
          publication_id: made.id,
          format: 'pdf',
          object_key: `${production.role}/sha256/${'c'.repeat(64)}`,
          sha256: 'c'.repeat(64),
          bytes: 1000,
          standard: 'ua-1',
        },
      ]);
    });
  });

  it("records the publication under its request's layout, and refuses another", async () => {
    const { request, declared } = await service.withTenant(production, async (trx) => ({
      request: await requested(trx, await documentWith(trx, []), ada),
      declared: await defaultLayout(trx),
    }));

    // Rigged as the runtime role, in SQL: a publication whole in every other respect, its request
    // marked done, but made under another version of the layout - here a 0.2 recorded in the same
    // transaction. Refused when the transaction commits, which takes the 0.2 with it.
    const other = 'e'.repeat(64);
    await expect(
      service.withTenant(production, async (trx) => {
        const version = await trx
          .selectFrom('publication_request')
          .select(['document_id', 'document_version_id', 'requested_at'])
          .where('id', '=', request)
          .executeTakeFirstOrThrow();
        const next = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: declared.versionId,
          author: ada,
          substance: {
            kind: 'layout',
            content: {
              ...declared.layout,
              words: { ...declared.layout.words, contents: 'Table of contents' },
            },
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: general })
          .returning('id')
          .executeTakeFirstOrThrow();
        const made = recording(request);
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: request,
            document_id: version.document_id,
            document_version_id: version.document_version_id,
            publisher: ada,
            published_at: version.requested_at,
            approval: 'none',
            formats: ['pdf'],
            engine: 'typst',
            engine_version: made.engineVersion,
            template: 'publication',
            template_version: made.templateVersion,
            pipeline_version: made.pipelineVersion,
            fonts: JSON.stringify(made.fonts),
            data_sha256: made.dataSha256,
            numbering: JSON.stringify(made.numbering),
            layout_id: DEFAULT_LAYOUT_ID,
            layout_version_id: next.version.id,
          })
          .execute();
        await trx
          .insertInto('publication_input')
          .values({
            publication_id: artifact.id,
            version_id: version.document_version_id,
            node: null,
          })
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: artifact.id,
            format: 'pdf',
            object_key: `${production.role}/sha256/${other}`,
            sha256: other,
            bytes: 1,
            standard: 'ua-1',
          })
          .execute();
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${request}`.execute(trx);
      }),
    ).rejects.toThrow(/recorded whole/);
    expect(await stateOf(request)).toEqual({ state: 'queued', failures: [], finished_at: null });

    // Recorded as the worker records it, the publication carries its request's layout version.
    const id = await service.withTenant(production, (trx) =>
      recordPublication(trx, recording(request)),
    );
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication')
        .select(['layout_id', 'layout_version_id'])
        .where('id', '=', id!)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ layout_id: DEFAULT_LAYOUT_ID, layout_version_id: declared.versionId });
  });

  it('leaves no row of a record any part of which is refused, such as an output keyed by other bytes', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    const elsewhere = {
      ...recording(id),
      output: {
        key: `${production.role}/sha256/${'d'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        bytes: 1000,
      },
    };
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, elsewhere)),
    ).rejects.toThrow(/publication_output_check/);
    const anotherTenants = {
      ...recording(id),
      output: { key: `t_another/sha256/${'c'.repeat(64)}`, sha256: 'c'.repeat(64), bytes: 1000 },
    };
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, anotherTenants)),
    ).rejects.toThrow(/keyed in its own tenant's store/);
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toEqual({ state: 'queued', failures: [], finished_at: null });
    // Nothing of the refused record was kept, so the request can still be recorded whole.
    expect(
      await service.withTenant(production, (trx) => recordPublication(trx, recording(id))),
    ).toBeDefined();
  });

  it('keeps nothing of a record that fails part way, where its caller catches the failure and carries on', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    await service.withTenant(production, async (trx) => {
      await expect(
        recordPublication(
          trx.withPlugin(failingAfterInsertInto('publication_input')),
          recording(id),
        ),
      ).rejects.toThrow(/connection was lost/);
      // The caller carries on in the same transaction and fails the request, which commits.
      await failPublicationRequest(trx, id, [
        { stage: 'store', code: 'store_failed', node: null, block: null, detail: null },
      ]);
    });
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
  });

  it('refuses loudly to record a request carrying failures, and leaves no row of it', async () => {
    const { id, hidden } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [
        section('Method', [reference(shared.artifactId), hidden]),
      ]);
      return { id: await requested(trx, version, ada), hidden: hidden.id };
    });
    const before = await publications();
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, recording(id))),
    ).rejects.toThrow(/carries failures/);
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toEqual({
      state: 'queued',
      failures: [
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden,
          block: null,
          detail: null,
        },
      ],
      finished_at: null,
    });
  });

  it('lets two workers racing one request make one publication: the second waits, then records nothing', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    const holding = deferred<number>();
    const commit = latch();
    const winner = service.withTenant(production, async (trx) => {
      let answer: string | undefined;
      try {
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
        answer = await recordPublication(trx, recording(id));
        holding.resolve(rows[0]!.pid);
      } catch (error) {
        // Reported through `holding`, so the test fails on the winner's own error at once.
        holding.reject(error);
        throw error;
      }
      await commit.opened;
      return answer;
    });
    winner.catch(() => undefined);
    const pid = await holding.promise;
    // The winner holds the request's row until it commits, so the second worker must wait behind it.
    // The latch opens in `finally`, so a wait that fails still lets the winner commit.
    let loser: Promise<string | undefined>;
    try {
      loser = service.withTenant(production, (trx) => recordPublication(trx, recording(id)));
      await untilBlockedBy(db.adminUrl, pid, 1);
    } finally {
      commit.open();
    }
    const [won, lost] = await Promise.all([winner, loser]);
    expect(won).toBeDefined();
    expect(lost).toBeUndefined();
    expect(await publications()).toMatchObject({
      records: before.records + 1,
      artifacts: before.artifacts + 1,
    });
  });

  it('fails a request with every failure at once, after which it has nothing left to publish', async () => {
    await service.withTenant(production, async (trx) => {
      const id = await requested(trx, await documentWith(trx, []), ada);
      await failPublicationRequest(trx, id, [
        { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
      ]);
      // Finished at the database's time, as a recorded publication's request is, not the worker's.
      const { rows } = await sql<{ now: Date }>`select now() as now`.execute(trx);
      const finished = await trx
        .selectFrom('publication_request')
        .select('finished_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(finished.finished_at).toEqual(rows[0]!.now);
      expect(await publicationInputs(trx, id)).toBeUndefined();
      expect(await recordPublication(trx, recording(id))).toBeUndefined();
      // Only finishing it: nothing else about a request can be changed.
      await expect(
        sql`update publication_request set requested_by = ${grace} where id = ${id}`.execute(trx),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // Figures 3, ruling R6: every image the resolved components place, decided as the publisher.
  /** An asset version in this space, made directly, with the facts a request hands the job. */
  const image = (trx: TenantTransaction, space: string, author: string, fill: string) =>
    createArtifact(trx, {
      spaceId: space,
      author,
      substance: {
        kind: 'asset',
        content: {
          schemaVersion: 1,
          object: `${production.role}/sha256/${fill.repeat(64)}`,
          format: 'png',
          bytes: 3530,
          width: 800,
          height: 600,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
          alternative: { text: 'Two red squares', language: 'en-GB' },
        },
      },
    });
  const figureOf = (id: string, asset: string) => ({
    type: 'figure' as const,
    id,
    asset,
    imageStyle: 'figure' as const,
    caption: [{ type: 'text' as const, value: 'Shapes', marks: [] }],
    alternative: { kind: 'inherited' as const },
  });
  /** A component in General holding these blocks, at its second version. */
  const holding = async (trx: TenantTransaction, author: string, blocks: unknown[]) => {
    const first = await component(trx, general, author, 'Install the printer');
    const substance = substanceOf(first);
    if (substance.kind !== 'component') throw new Error('not a component');
    const next = await recordVersion(trx, {
      artifactId: first.artifactId,
      openedFrom: first.id,
      author,
      substance: {
        ...substance,
        content: { ...substance.content, content: blocks as ContentDocument['content'] },
      },
    });
    if (next.answer !== 'recorded') throw new Error(next.answer);
    return next.version;
  };
  /** A request's failures, read in the transaction that made it. */
  const failuresIn = (trx: TenantTransaction, id: string) =>
    trx
      .selectFrom('publication_request')
      .select('failures')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
      .then((row) => row.failures);
  const requestAssets = (trx: TenantTransaction, id: string) =>
    trx
      .selectFrom('publication_request_asset')
      .select(['version_id', 'asset_id'])
      .where('request_id', '=', id)
      .execute();

  it('resolves every image a figure places as the publisher, wherever it stands, and hands the job its facts', async () => {
    await service.withTenant(production, async (trx) => {
      const red = await image(trx, general, ada, 'd');
      const blue = await image(trx, general, ada, 'e');
      const placed = await holding(trx, ada, [
        figureOf('f1', red.id),
        {
          type: 'list',
          id: 'l1',
          kind: 'unordered',
          items: [{ content: [figureOf('f2', blue.id)] }],
        },
        { type: 'blockquote', id: 'q1', content: [figureOf('f3', red.id)] },
      ]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      const id = await requested(trx, version, ada);

      expect(await failuresIn(trx, id)).toEqual([]);
      // Each version once, however many figures place it.
      expect(new Set((await requestAssets(trx, id)).map((each) => each.version_id))).toEqual(
        new Set([red.id, blue.id]),
      );
      const inputs = await publicationInputs(trx, id);
      expect(inputs!.assets.get(red.id)).toEqual({
        object: `${production.role}/sha256/${'d'.repeat(64)}`,
        format: 'png',
        width: 800,
        height: 600,
        alternative: { text: 'Two red squares', language: 'en-GB' },
      });
      expect([...inputs!.assets.keys()].sort()).toEqual([red.id, blue.id].sort());
    });
  });

  it('refuses a figure whose image the publisher may not read, naming the figure and nothing of the image', async () => {
    await service.withTenant(production, async (trx) => {
      // In Quality, which Grace may read and Ada may not; placed by Grace in a component in General.
      const secret = await image(trx, quality, grace, 'f');
      const missing = randomUUID();
      const placed = await holding(trx, grace, [
        figureOf('f1', secret.id),
        figureOf('f2', missing),
      ]);
      const placement = reference(placed.artifactId);
      const version = await documentWith(trx, [placement]);

      const adas = await requested(trx, version, ada);
      const unreadable = (block: string) => ({
        stage: 'resolve',
        code: 'asset_unreadable',
        node: placement.id,
        block,
        detail: null,
      });
      const refused = await failuresIn(trx, adas);
      expect(refused).toEqual([unreadable('f1'), unreadable('f2')]);
      expect(JSON.stringify(refused)).not.toContain(secret.id);
      expect(JSON.stringify(refused)).not.toContain(secret.artifactId);
      expect(await requestAssets(trx, adas)).toEqual([]);

      // Grace may read the image; the one naming no version is still refused, and told the same way.
      const graces = await requested(trx, version, grace);
      expect(await failuresIn(trx, graces)).toEqual([unreadable('f2')]);
      expect(await requestAssets(trx, graces)).toEqual([
        { version_id: secret.id, asset_id: secret.artifactId },
      ]);
    });
  });

  it('resolves an image in a run of text as the publisher too, in a paragraph and in a table cell', async () => {
    // Figures 5, ruling R5: an inline image is resolved as a figure's is, and a refusal names the block
    // holding it.
    const inline = (asset: string) => ({
      type: 'image' as const,
      asset,
      imageStyle: 'inline',
      alternative: { kind: 'decorative' as const },
    });
    await service.withTenant(production, async (trx) => {
      const open = await image(trx, general, grace, '2');
      const secret = await image(trx, quality, grace, '3');
      const placed = await holding(trx, grace, [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [{ type: 'text', value: 'Press ', marks: [] }, inline(open.id)],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  // Two it may not read in one paragraph, which is named once.
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [inline(secret.id), inline(secret.id)],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ]);
      const placement = reference(placed.artifactId);
      const version = await documentWith(trx, [placement]);
      const adas = await requested(trx, version, ada);
      expect(await failuresIn(trx, adas)).toEqual([
        {
          stage: 'resolve',
          code: 'asset_unreadable',
          node: placement.id,
          block: 'c1',
          detail: null,
        },
      ]);
      expect(await requestAssets(trx, adas)).toEqual([
        { version_id: open.id, asset_id: open.artifactId },
      ]);
    });
  });

  it('records the images a publication printed, and never one on a request once it is finished', async () => {
    const { id, red } = await service.withTenant(production, async (trx) => {
      const red = await image(trx, general, ada, '1');
      const placed = await holding(trx, ada, [figureOf('f1', red.id)]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      return { id: await requested(trx, version, ada), red };
    });
    const publication = await service.withTenant(production, (trx) =>
      recordPublication(trx, recording(id)),
    );
    const printed = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_asset')
        .select(['version_id', 'asset_id'])
        .where('publication_id', '=', publication!)
        .execute(),
    );
    expect(printed).toEqual([{ version_id: red.id, asset_id: red.artifactId }]);

    // A publication naming fewer images than its request recorded does not commit.
    const { id: other } = await service.withTenant(production, async (trx) => {
      const placed = await holding(trx, ada, [figureOf('f1', red.id)]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      return { id: await requested(trx, version, ada) };
    });
    // Written row by row as the runtime role, as recordPublication writes it, but for its image.
    await expect(
      service.withTenant(production, async (trx) => {
        const made = recording(other);
        const request = await trx
          .selectFrom('publication_request as r')
          .innerJoin('artifact as a', 'a.id', 'r.document_id')
          .selectAll('r')
          .select('a.space_id')
          .where('r.id', '=', other)
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: request.space_id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: other,
            document_id: request.document_id,
            document_version_id: request.document_version_id,
            publisher: request.requested_by,
            published_at: request.requested_at,
            approval: 'none',
            formats: ['pdf'],
            engine: 'typst',
            engine_version: made.engineVersion,
            template: 'publication',
            template_version: made.templateVersion,
            pipeline_version: made.pipelineVersion,
            fonts: JSON.stringify(made.fonts),
            data_sha256: made.dataSha256,
            numbering: JSON.stringify(made.numbering),
            layout_id: request.layout_id,
            layout_version_id: request.layout_version_id,
          })
          .execute();
        const occurrences = await trx
          .selectFrom('publication_request_occurrence')
          .select(['node', 'version_id'])
          .where('request_id', '=', other)
          .execute();
        await trx
          .insertInto('publication_input')
          .values([
            { publication_id: artifact.id, version_id: request.document_version_id, node: null },
            ...occurrences.map((each) => ({
              publication_id: artifact.id,
              version_id: each.version_id,
              node: each.node,
            })),
          ])
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: artifact.id,
            format: 'pdf',
            object_key: made.output.key,
            sha256: made.output.sha256,
            bytes: made.output.bytes,
            standard: 'ua-1',
          })
          .execute();
        await trx
          .updateTable('publication_request')
          .set({ state: 'done', finished_at: new Date() })
          .where('id', '=', other)
          .execute();
      }),
    ).rejects.toThrow(/recorded whole/);
    expect((await stateOf(other)).state).toBe('queued');

    // The request is done: an image recorded on it now would say it read what it never read.
    await expect(
      service.withTenant(production, (trx) =>
        trx
          .insertInto('publication_request_asset')
          .values({ request_id: id, version_id: red.id, asset_id: red.artifactId })
          .execute(),
      ),
    ).rejects.toThrow(/only while its request is queued/);
    await expect(
      service.withTenant(production, (trx) =>
        trx.deleteFrom('publication_asset').where('publication_id', '=', publication!).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
