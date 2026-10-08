import {
  bindingDigestInput,
  defaultLimits,
  defaultNumberingScheme,
  OUTLINE_SCHEMA_VERSION,
  type Binding,
  type ConnectionSettings,
  type ContentDocument,
  type Provenance,
  type QueryDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection, type StoredConnection } from './connections.js';
import { createComponent } from './creation.js';
import { nameDataset, recordDatasetVersion, recordResolution } from './datasets.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { findRole } from './roles.js';
import { createTenant, type Tenant } from './provision.js';
import {
  publicationBindings,
  publicationInputs,
  recordPublication,
  requestPublication,
  sweepPreviews,
} from './publishing.js';
import { createQueryDefinition, type StoredQueryDefinition } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { sha256Hex } from './version-digest.js';
import { createArtifact, recordVersion, substanceOf } from './versions.js';

/**
 * The publish's binding stage in the store (the B3 plan, B3-A, B3-C): what each binding held when a
 * publish was asked for, recorded on the request or refused by name, and what a publication printed
 * from, recorded beside its `provenance.json`.
 */

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
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

const definition = (connection: string): QueryDefinition => ({
  schemaVersion: 1,
  title: 'Depth by site',
  description: '',
  connection,
  parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
  fetch: {
    kind: 'sql',
    text: 'select id, depth from sample.reading where site = {{site}} order by id',
  },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 6, scale: 2 } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { ...defaultLimits },
  retired: false,
});

const NODE = 'b'.repeat(26);

describe('the bindings of a publication request and a publication', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  let connection: StoredConnection;
  let query: StoredQueryDefinition;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const provenance = (site: string): Provenance => ({
    schemaVersion: 1,
    queryDefinition: { artifact: query.id, version: query.version.id },
    connection: { artifact: connection.id, version: connection.version.id },
    parameters: { site },
    ran: { sql: 'select id, depth from sample.reading where site = $1 order by id' },
    identity: { kind: 'service' },
    at: '2026-10-05T09:15:00.000Z',
    durationMs: 12,
    rowCount: 1,
    columns: definition(connection.id).columns,
    canonical: 1,
    checksum: 'a'.repeat(64),
    images: {},
  });

  const binding = (id: string): Binding =>
    ({
      type: 'binding',
      id,
      query: query.id,
      parameters: { site: { literal: 'north' } },
      mode: 'checked',
      take: { key: { id: '1' }, column: 'depth' },
    }) as Binding;
  const digest = (id: string) => sha256Hex(bindingDigestInput(binding(id)));

  /** A document in General whose one node references a component holding these bindings. */
  const documentHolding = (...bindings: string[]) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Depths',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const content = made.version.content as ContentDocument;
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...(substanceOf(made.version) as Extract<
            ReturnType<typeof substanceOf>,
            { kind: 'component' }
          >),
          content: {
            ...content,
            content: [
              { type: 'paragraph', id: 'p1', style: 'body', content: bindings.map(binding) },
            ],
          } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'reference',
                id: NODE,
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                component: made.version.artifactId,
                mode: { kind: 'latest' },
                children: [],
              },
            ],
          },
        } as never,
      });
    });

  /** A result recorded, named, and resolved for a binding of the document, under a digest. */
  const resolved = (document: string, id: string, under = digest(id), site = 'north') =>
    tenant(async (trx) => {
      const made = await recordDatasetVersion(trx, { provenance: provenance(site), author: ada });
      await nameDataset(trx, { dataset: made.dataset.id, name: 'Depths at north', by: ada });
      return recordResolution(trx, {
        document,
        node: NODE,
        binding: id,
        digest: under,
        version: made.version.id,
        replaces: null,
        act: 'resolve',
        by: ada,
      });
    });

  const ask = (
    document: { artifactId: string; id: string },
    kind: 'publish' | 'preview' = 'publish',
  ) =>
    tenant((trx) =>
      requestPublication(trx, {
        documentId: document.artifactId,
        version: document.id,
        formats: ['pdf'],
        requester: ada,
        kind,
      }),
    );
  const requestsOf = (document: string) =>
    tenant((trx) =>
      trx
        .selectFrom('publication_request')
        .select('id')
        .where('document_id', '=', document)
        .execute(),
    );
  const requestBindings = (request: string) =>
    tenant((trx) =>
      trx
        .selectFrom('publication_request_binding')
        .select(['node', 'binding', 'digest', 'resolution', 'dataset_version'])
        .where('request_id', '=', request)
        .orderBy('binding')
        .execute(),
    );
  const recording = (requestId: string, provenance: boolean) => ({
    requestId,
    pipelineVersion: '16',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    outputs: [
      {
        format: 'pdf' as const,
        engineVersion: '0.15.1',
        templateVersion: 13,
        key: `${production.role}/sha256/${'c'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        bytes: 1000,
      },
      ...(provenance
        ? [
            {
              format: 'provenance' as const,
              pipelineVersion: '16',
              key: `${production.role}/sha256/${'e'.repeat(64)}`,
              sha256: 'e'.repeat(64),
              bytes: 200,
            },
          ]
        : []),
    ],
  });
  /** A requested publish, every binding of its document resolved. */
  const requestedWithBindings = async () => {
    const document = await documentHolding('k1');
    await resolved(document.artifactId, 'k1');
    const answer = await ask(document);
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return { document, request: answer.request.id };
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
    service = testTenantDatabase(db.serviceUrl);
    await tenant(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      // Ada reads General, where everything here is.
      await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const made = await createConnection(trx, { author: ada, spaceId: general, settings });
      if (made.answer !== 'created') throw new Error(made.answer);
      connection = made.connection;
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: definition(connection.id),
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      query = defined.definition;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('DAT-087 refuses a publish and a preview of a document holding a binding never resolved or resolved under another digest, naming each by its node, and queues nothing', async () => {
    const document = await documentHolding('k1', 'k2');
    await resolved(document.artifactId, 'k1');
    for (const kind of ['publish', 'preview'] as const) {
      expect(await ask(document, kind)).toEqual({
        answer: 'binding.unresolved',
        bindings: [{ node: NODE, binding: 'k2', reason: 'never' }],
      });
    }
    // Resolved under a digest the binding no longer has: the component changed since.
    await resolved(document.artifactId, 'k2', 'f'.repeat(64));
    expect(await ask(document)).toEqual({
      answer: 'binding.unresolved',
      bindings: [{ node: NODE, binding: 'k2', reason: 'changed' }],
    });
    // The latest resolution is what a binding holds: an older match does not answer for a newer one.
    await resolved(document.artifactId, 'k2');
    await resolved(document.artifactId, 'k1', 'f'.repeat(64));
    expect(await ask(document)).toEqual({
      answer: 'binding.unresolved',
      bindings: [{ node: NODE, binding: 'k1', reason: 'changed' }],
    });
    expect(await requestsOf(document.artifactId)).toEqual([]);
  });

  it('records each binding a request holds as the latest resolution its document has for it, and hands the job each result', async () => {
    const document = await documentHolding('k1', 'k2');
    const one = await resolved(document.artifactId, 'k1');
    const two = await resolved(document.artifactId, 'k2', digest('k2'), 'south');
    const answer = await ask(document);
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    expect(await requestBindings(answer.request.id)).toEqual([
      {
        node: NODE,
        binding: 'k1',
        digest: digest('k1'),
        resolution: one.id,
        dataset_version: one.version,
      },
      {
        node: NODE,
        binding: 'k2',
        digest: digest('k2'),
        resolution: two.id,
        dataset_version: two.version,
      },
    ]);
    const inputs = await tenant((trx) => publicationInputs(trx, answer.request.id));
    const held = inputs!.bindings.get(NODE)!;
    expect([...held.keys()]).toEqual(['k1', 'k2']);
    expect(held.get('k2')).toMatchObject({
      resolution: two.id,
      datasetVersion: two.version,
      dataset: { id: two.dataset, name: 'Depths at north', number: '0.1' },
    });
    expect(held.get('k2')!.dataset.provenance.parameters).toEqual({ site: 'south' });
    // The key of the definition version the dataset version ran (TB3-B), which a keyed note names.
    expect(held.get('k1')!.key).toEqual(['id']);
  });

  it("holds a request's binding to the resolution it names, while the request is queued, and never changes or removes one", async () => {
    const { document, request } = await requestedWithBindings();
    const [row] = await requestBindings(request);
    const insert = (over: Record<string, unknown>) =>
      tenant(async (trx) => {
        const dataset = await trx
          .selectFrom('artifact_version')
          .select('artifact_id')
          .where('id', '=', row!.dataset_version)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication_request_binding')
          .values({
            request_id: request,
            node: NODE,
            binding: 'k9',
            digest: row!.digest,
            resolution: row!.resolution,
            dataset_version: row!.dataset_version,
            dataset_id: dataset.artifact_id,
            ...over,
          } as never)
          .execute();
      });
    // Another binding, another digest or another node than the resolution's: refused.
    await expect(insert({})).rejects.toThrow(/as its document resolved it/);
    await expect(insert({ binding: 'k1', node: 'c'.repeat(26) })).rejects.toThrow(
      /as its document resolved it/,
    );
    await expect(
      tenant((trx) =>
        sql`update publication_request_binding set digest = ${'f'.repeat(64)}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenant((trx) => sql`delete from publication_request_binding`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    expect(document.artifactId).toBeTruthy();
  });

  it("refuses a request's binding whose request is no longer queued, or whose digest or dataset version alone is not its resolution's", async () => {
    const { document, request } = await requestedWithBindings();
    const [held] = await requestBindings(request);
    // A resolution the request did not record: a row naming it exactly is the control.
    const k9 = await resolved(document.artifactId, 'k9', digest('k9'), 'south');
    const insert = (into: string, over: Record<string, unknown> = {}) =>
      tenant(async (trx) => {
        const version = (over.dataset_version as string | undefined) ?? k9.version;
        const dataset = await trx
          .selectFrom('artifact_version')
          .select('artifact_id')
          .where('id', '=', version)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication_request_binding')
          .values({
            request_id: into,
            node: NODE,
            binding: 'k9',
            digest: digest('k9'),
            resolution: k9.id,
            dataset_version: version,
            dataset_id: dataset.artifact_id,
            ...over,
          } as never)
          .execute();
      });
    // The digest alone, or the dataset version alone, differs from the resolution's.
    await expect(insert(request, { digest: 'f'.repeat(64) })).rejects.toThrow(
      /as its document resolved it/,
    );
    expect(held!.dataset_version).not.toBe(k9.version);
    await expect(insert(request, { dataset_version: held!.dataset_version })).rejects.toThrow(
      /as its document resolved it/,
    );
    // A request no longer queued takes no binding, even one matching its resolution exactly.
    const { request: failed } = await requestedWithBindings();
    await tenant((trx) =>
      sql`update publication_request set state = 'failed', finished_at = now(),
                     failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]'
                   where id = ${failed}`.execute(trx),
    );
    const other = await requestsOf(document.artifactId);
    expect(other.map((each) => each.id)).toEqual([request]);
    await expect(
      tenant(async (trx) => {
        const own = await trx
          .selectFrom('publication_request')
          .select('document_id')
          .where('id', '=', failed)
          .executeTakeFirstOrThrow();
        const mine = await recordResolution(trx, {
          document: own.document_id,
          node: NODE,
          binding: 'k9',
          digest: digest('k9'),
          version: k9.version,
          replaces: null,
          act: 'resolve',
          by: ada,
        });
        await trx
          .insertInto('publication_request_binding')
          .values({
            request_id: failed,
            node: NODE,
            binding: 'k9',
            digest: digest('k9'),
            resolution: mine.id,
            dataset_version: k9.version,
            dataset_id: k9.dataset,
          } as never)
          .execute();
      }),
    ).rejects.toThrow(/as its document resolved it/);
    // The control: the same row on the queued request, matching its resolution, is recorded.
    await insert(request);
    expect((await requestBindings(request)).map((each) => each.binding)).toEqual(['k1', 'k9']);
  });

  it('DAT-042 records a publication holding values only with its bindings and its provenance output whole', async () => {
    const { request } = await requestedWithBindings();
    // Without the provenance, or with one where nothing is bound, the record is refused before a row.
    await expect(
      tenant((trx) => recordPublication(trx, recording(request, false))),
    ).rejects.toThrow(/provenance/);
    const unbound = await documentHolding();
    const plain = await ask(unbound);
    if (plain.answer !== 'requested') throw new Error(plain.answer);
    await expect(
      tenant((trx) => recordPublication(trx, recording(plain.request.id, true))),
    ).rejects.toThrow(/provenance/);

    const id = await tenant((trx) => recordPublication(trx, recording(request, true)));
    const [held] = await requestBindings(request);
    expect(await tenant((trx) => publicationBindings(trx, id!))).toMatchObject([
      {
        node: NODE,
        binding: 'k1',
        resolution: held!.resolution,
        datasetVersion: held!.dataset_version,
        dataset: { name: 'Depths at north', number: '0.1' },
      },
    ]);
    const outputs = await tenant((trx) =>
      trx
        .selectFrom('publication_output')
        .select(['format', 'standard', 'producer', 'producer_version', 'report'])
        .where('publication_id', '=', id!)
        .orderBy('format')
        .execute(),
    );
    expect(outputs).toEqual([
      { format: 'pdf', standard: 'ua-1', producer: 'typst', producer_version: '13', report: [] },
      {
        format: 'provenance',
        standard: null,
        producer: 'pipeline',
        producer_version: '16',
        report: [],
      },
    ]);
  });

  it("DAT-042 refuses at commit a publication whose bindings are not its request's, or whose provenance output is missing", async () => {
    const { request } = await requestedWithBindings();
    const pdf = {
      format: 'pdf',
      standard: 'ua-1',
      producer: 'typst',
      producer_version: '13',
      sha256: 'c'.repeat(64),
    };
    const provenanceOutput = {
      format: 'provenance',
      standard: null,
      producer: 'pipeline',
      producer_version: '16',
      sha256: 'e'.repeat(64),
    };
    /** The publication of the request written row by row, committed or refused. */
    const rigged = (outputs: readonly Record<string, unknown>[], bindings: boolean) =>
      tenant(async (trx) => {
        const made = await trx
          .selectFrom('publication_request as r')
          .innerJoin('artifact as a', 'a.id', 'r.document_id')
          .selectAll('r')
          .select('a.space_id')
          .where('r.id', '=', request)
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: made.space_id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: request,
            document_id: made.document_id,
            document_version_id: made.document_version_id,
            publisher: made.requested_by,
            published_at: made.requested_at,
            approval: 'none',
            formats: made.formats,
            engine: 'typst',
            engine_version: '0.15.1',
            template: 'publication',
            template_version: 13,
            pipeline_version: '16',
            fonts: JSON.stringify([
              { file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) },
            ]),
            data_sha256: 'b'.repeat(64),
            numbering: JSON.stringify({ scheme: defaultNumberingScheme.id, entries: [] }),
            layout_id: made.layout_id,
            layout_version_id: made.layout_version_id,
            theme_id: made.theme_id,
            theme_version_id: made.theme_version_id,
          })
          .execute();
        const occurrences = await trx
          .selectFrom('publication_request_occurrence')
          .select(['node', 'version_id'])
          .where('request_id', '=', request)
          .execute();
        await trx
          .insertInto('publication_input')
          .values([
            { publication_id: artifact.id, version_id: made.document_version_id, node: null },
            ...occurrences.map((each) => ({
              publication_id: artifact.id,
              version_id: each.version_id,
              node: each.node,
            })),
          ])
          .execute();
        for (const output of outputs) {
          await trx
            .insertInto('publication_output')
            .values({
              publication_id: artifact.id,
              object_key: `${production.role}/sha256/${output.sha256 as string}`,
              bytes: 1,
              report: '[]',
              ...output,
            } as never)
            .execute();
        }
        if (bindings) {
          await sql`insert into publication_binding
                      (publication_id, node, binding, resolution, dataset_version, dataset_id)
                    select ${artifact.id}, node, binding, resolution, dataset_version, dataset_id
                      from publication_request_binding where request_id = ${request}`.execute(trx);
        }
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${request}`.execute(trx);
      });
    await expect(rigged([pdf], true)).rejects.toThrow(/recorded whole/);
    await expect(rigged([pdf, provenanceOutput], false)).rejects.toThrow(/recorded whole/);
    // A provenance output claiming a standard, or made by anything but the pipeline, is refused.
    await expect(rigged([pdf, { ...provenanceOutput, producer: 'word' }], true)).rejects.toThrow(
      /publication_output_producer/,
    );
    await rigged([pdf, provenanceOutput], true);
  });

  it("sweeps a preview's bindings with it", async () => {
    const document = await documentHolding('k1');
    await resolved(document.artifactId, 'k1');
    const answer = await ask(document, 'preview');
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    expect(await requestBindings(answer.request.id)).toHaveLength(1);
    await tenant((trx) =>
      sql`update publication_request set state = 'failed',
                     finished_at = now() - interval '2 hours',
                     failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]'
                   where id = ${answer.request.id}`.execute(trx),
    );
    await tenant((trx) => sweepPreviews(trx));
    expect(await requestBindings(answer.request.id)).toEqual([]);
    expect(await requestsOf(document.artifactId)).toEqual([]);
  });
});
