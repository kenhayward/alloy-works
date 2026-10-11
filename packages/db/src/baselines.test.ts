import { randomBytes } from 'node:crypto';
import {
  baselineDigestInput,
  bindingDigestInput,
  blockIdentifierFrom,
  defaultLimits,
  type Binding,
  type ConnectionSettings,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type Provenance,
  type QueryDefinition,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listBaselines,
  makeBaseline,
  readBaseline,
  requestBaselinePublication,
  supersedeBaseline,
  type MakeBaselineAnswer,
} from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection } from './connections.js';
import { createComponent } from './creation.js';
import { nameDataset, recordDatasetVersion, recordResolution } from './datasets.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { addThemeVersion, defaultTheme } from './themes.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createQueryDefinition, type StoredQueryDefinition } from './queryDefinitions.js';
import { publicationInputs } from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { sha256Hex } from './version-digest.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});
const section = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

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

describe('baselines', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let query: StoredQueryDefinition;
  let connection: { id: string; version: { id: string } };

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = (space: string, author: string, title: string) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** A new version of a component whose content is these blocks. */
  const revise = (version: StoredVersion, blocks: ContentDocument['content']) =>
    tenant(async (trx) => {
      const substance = substanceOf(version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: { ...substance, content: { ...substance.content, content: blocks } },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  /** A document in General at a second version holding these nodes. */
  const documentWith = (nodes: OutlineNode[]) =>
    tenant(async (trx) => {
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
    });

  const make = (document: StoredVersion, name: string, maker = ada) =>
    tenant((trx) =>
      makeBaseline(trx, { documentId: document.artifactId, version: document.id, name, maker }),
    );
  const made = (answer: MakeBaselineAnswer) => {
    if (answer.answer !== 'made') throw new Error(answer.answer);
    return answer.baseline;
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
      const madeConnection = await createConnection(trx, {
        author: ada,
        spaceId: general,
        settings,
      });
      if (madeConnection.answer !== 'created') throw new Error(madeConnection.answer);
      connection = madeConnection.connection;
      const definition: QueryDefinition = {
        schemaVersion: 1,
        title: 'Depth by site',
        description: '',
        connection: connection.id,
        parameters: [],
        fetch: { kind: 'sql', text: 'select id, depth from sample.reading order by id' },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
        ],
        key: ['id'],
        order: [{ column: 'id', direction: 'ascending' }],
        empty: 'valid',
        limits: { ...defaultLimits },
        retired: false,
      };
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition,
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      query = defined.definition;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('VER-017 pins the document’s version and each occurrence’s, whatever the components become after', async () => {
    const printer = await component(general, ada, 'Install the printer');
    const tray = await component(general, ada, 'Load the tray');
    const first = reference(printer.artifactId);
    const second = reference(tray.artifactId);
    const document = await documentWith([section('Introduction', [first, second])]);

    const id = made(await make(document, 'As approved'));
    await revise(printer, [{ type: 'paragraph', id: 'p9', style: 'body', content: [] }]);

    const read = await tenant((trx) => readBaseline(trx, id, ada));
    expect(read).toMatchObject({
      id,
      documentId: document.artifactId,
      name: 'As approved',
      madeBy: { id: ada, name: 'Ada' },
      superseded: null,
      withheld: { nodes: [], assets: 0 },
    });
    expect(read!.pins.document.version).toBe(document.id);
    expect(new Map(read!.pins.occurrences.map((each) => [each.node, each.version]))).toEqual(
      new Map([
        [first.id, printer.id],
        [second.id, tray.id],
      ]),
    );
  });

  it('STY-028 and PUB-013 pin the theme and layout versions in force, and a newer theme later is not taken', async () => {
    const document = await documentWith([]);
    const id = made(await make(document, 'Themed'));
    const before = await tenant((trx) => defaultTheme(trx));
    await tenant(async (trx) => {
      const next = await addThemeVersion(trx, {
        artifactId: before.artifactId,
        openedFrom: before.versionId,
        author: ada,
        theme: { ...before.content, paper: '#fafafa' },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
    });
    const after = await tenant((trx) => defaultTheme(trx));
    expect(after.versionId).not.toBe(before.versionId);
    const read = await tenant((trx) => readBaseline(trx, id, ada));
    expect(read!.pins.theme.version).toBe(before.versionId);
    const row = await tenant((trx) =>
      trx.selectFrom('baseline').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );
    expect(row.theme_version_id).toBe(before.versionId);
    expect(row.layout_version_id).toBe(read!.pins.layout.version);
  });

  it('VER-046 refuses a second baseline of the document by the same name whatever its case, and a name it cannot store', async () => {
    const document = await documentWith([]);
    made(await make(document, 'Issue 1'));
    expect(await make(document, 'ISSUE 1')).toEqual({ answer: 'name.taken' });
    expect(await make(document, ' Issue 2')).toEqual({
      answer: 'name.invalid',
      problem: 'A name has no space before or after it',
    });
    // The same name in another document is another record.
    made(await make(await documentWith([]), 'Issue 1'));
  });

  it('VER-046 gives the runtime role no way to change a name, or anything else of a baseline', async () => {
    const document = await documentWith([]);
    const id = made(await make(document, 'Fixed'));
    await expect(
      tenant((trx) => sql`update baseline set name = 'Renamed' where id = ${id}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenant((trx) => sql`delete from baseline where id = ${id}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('VER-043 records a digest anybody reading every pin can recompute, and withholds from a reader what they may not read', async () => {
    const open = await component(general, grace, 'Shared');
    const secret = await component(quality, grace, 'Calibration');
    const shown = reference(open.artifactId);
    const hidden = reference(secret.artifactId);
    const document = await tenant(async (trx) => {
      const madeDocument = await createDocument(trx, {
        spaceId: general,
        title: 'Grace’s report',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (madeDocument.answer !== 'created') throw new Error(madeDocument.answer);
      const outline: OutlineDocument = {
        ...(madeDocument.version.content as OutlineDocument),
        nodes: [shown, hidden],
      };
      const recorded = await recordVersion(trx, {
        artifactId: madeDocument.version.artifactId,
        openedFrom: madeDocument.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    const id = made(await make(document, 'Grace’s', grace));

    const whole = await tenant((trx) => readBaseline(trx, id, grace));
    expect(sha256Hex(baselineDigestInput(whole!.pins))).toBe(whole!.digest);
    expect(whole!.pins.occurrences).toHaveLength(2);

    const partial = await tenant((trx) => readBaseline(trx, id, ada));
    expect(partial!.withheld).toEqual({ nodes: [hidden.id], assets: 0 });
    expect(JSON.stringify(partial)).not.toContain(secret.artifactId);
    expect(JSON.stringify(partial)).not.toContain(secret.id);
    expect(partial!.digest).toBe(whole!.digest);
  });

  it('refuses a baseline of a document its maker cannot wholly read, naming the node and nothing of it', async () => {
    const secret = await component(quality, grace, 'Calibration');
    const hidden = reference(secret.artifactId);
    const document = await documentWith([hidden]);
    const answer = await make(document, 'Partial');
    expect(answer).toEqual({
      answer: 'baseline.unresolved',
      failures: [
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden.id,
          block: null,
          detail: null,
        },
      ],
    });
    expect(await tenant((trx) => listBaselines(trx, document.artifactId))).toEqual([]);
  });

  it('refuses a baseline of a version that is not the latest, naming the latest by its heading', async () => {
    const document = await documentWith([]);
    const answer = await tenant((trx) =>
      makeBaseline(trx, {
        documentId: document.artifactId,
        version: '00000000-0000-4000-8000-000000000000',
        name: 'Stale',
        maker: ada,
      }),
    );
    expect(answer).toMatchObject({ answer: 'version.precondition' });
  });

  it('DAT-038 pins the dataset version each binding holds, and the dataset’s name then, and refuses one unresolved', async () => {
    const binding = (id: string): Binding =>
      ({
        type: 'binding',
        id,
        query: query.id,
        parameters: {},
        mode: 'checked',
        take: { key: { id: '1' }, column: 'depth' },
      }) as Binding;
    const holder = await component(general, ada, 'Depths');
    const bound = await revise(holder, [
      { type: 'paragraph', id: 'p1', style: 'body', content: [binding('k1'), binding('k2')] },
    ] as ContentDocument['content']);
    const node = reference(bound.artifactId);
    const document = await documentWith([node]);
    const provenance: Provenance = {
      schemaVersion: 1,
      queryDefinition: { artifact: query.id, version: query.version.id },
      connection: { artifact: connection.id, version: connection.version.id },
      parameters: {},
      ran: { sql: 'select id, depth from sample.reading order by id' },
      identity: { kind: 'service' },
      at: '2026-10-05T09:15:00.000Z',
      durationMs: 12,
      rowCount: 1,
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
      ],
      canonical: 1,
      checksum: 'a'.repeat(64),
      images: {},
    };
    const resolve = (id: string) =>
      tenant(async (trx) => {
        const result = await recordDatasetVersion(trx, { provenance, author: ada });
        await nameDataset(trx, { dataset: result.dataset.id, name: 'Depths at north', by: ada });
        await recordResolution(trx, {
          document: document.artifactId,
          node: node.id,
          binding: id,
          digest: sha256Hex(bindingDigestInput(binding(id))),
          version: result.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        });
        return result;
      });
    const k1 = await resolve('k1');
    expect(await make(document, 'Half bound')).toEqual({
      answer: 'binding.unresolved',
      bindings: [{ node: node.id, binding: 'k2', reason: 'never' }],
    });
    await resolve('k2');
    const id = made(await make(document, 'Bound'));
    await tenant((trx) => nameDataset(trx, { dataset: k1.dataset.id, name: 'Renamed', by: ada }));

    const rows = await tenant((trx) =>
      trx
        .selectFrom('baseline_binding')
        .select(['node', 'binding', 'dataset_version', 'dataset_name'])
        .where('baseline_id', '=', id)
        .orderBy('binding')
        .execute(),
    );
    expect(rows).toEqual([
      {
        node: node.id,
        binding: 'k1',
        dataset_version: k1.version.id,
        dataset_name: 'Depths at north',
      },
      expect.objectContaining({ node: node.id, binding: 'k2', dataset_name: 'Depths at north' }),
    ]);

    // Published later, it prints the name it pinned, not the one the dataset has now (BL-F).
    const inputs = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return publicationInputs(trx, asked.request.id);
    });
    expect(inputs!.bindings.get(node.id)!.get('k1')!.dataset.name).toBe('Depths at north');
    expect(inputs!.request.baseline).toBe(id);
  });

  it('PUB-046 publishes a baseline from its pins, at its own time, whatever its components became', async () => {
    const printer = await component(general, ada, 'Install the printer');
    const node = reference(printer.artifactId);
    const document = await documentWith([node]);
    const id = made(await make(document, 'Pinned'));
    const later = await revise(printer, [
      { type: 'paragraph', id: 'p9', style: 'body', content: [] },
    ]);

    const inputs = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return publicationInputs(trx, asked.request.id);
    });
    expect(inputs!.occurrences.get(node.id)!.version).toBe(printer.id);
    expect(inputs!.occurrences.get(node.id)!.version).not.toBe(later.id);
    const madeAt = (await tenant((trx) => readBaseline(trx, id, ada)))!.madeAt;
    expect(inputs!.request.compiledAt.getTime()).toBe(Math.floor(madeAt.getTime() / 1000) * 1000);
  });

  it('refuses to publish a baseline to somebody who may not read all it pins, by node, and a format its layout does not make', async () => {
    const secret = await component(quality, grace, 'Calibration');
    const hidden = reference(secret.artifactId);
    const document = await tenant(async (trx) => {
      const madeDocument = await createDocument(trx, {
        spaceId: general,
        title: 'Grace’s second report',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (madeDocument.answer !== 'created') throw new Error(madeDocument.answer);
      const recorded = await recordVersion(trx, {
        artifactId: madeDocument.version.artifactId,
        openedFrom: madeDocument.version.id,
        author: grace,
        substance: {
          kind: 'document',
          content: { ...(madeDocument.version.content as OutlineDocument), nodes: [hidden] },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    const id = made(await make(document, 'Grace’s second', grace));
    const ask = (requester: string, formats: string[]) =>
      tenant((trx) => requestBaselinePublication(trx, { baseline: id, formats, requester }));
    expect(await ask(ada, ['pdf'])).toEqual({
      answer: 'baseline.unreadable',
      nodes: [hidden.id],
      assets: 0,
    });
    expect(await ask(grace, ['epub'])).toEqual({ answer: 'format.unsupported', formats: ['epub'] });
  });

  it('refuses at commit a request naming a baseline whose rows are not exactly its pins', async () => {
    const printer = await component(general, ada, 'Pinned once');
    const document = await documentWith([reference(printer.artifactId)]);
    const id = made(await make(document, 'Whole'));
    const row = await tenant((trx) =>
      trx.selectFrom('baseline').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );
    await expect(
      tenant((trx) =>
        trx
          .insertInto('publication_request')
          .values({
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            formats: ['pdf'],
            requested_by: ada,
            failures: '[]',
            layout_id: row.layout_id,
            layout_version_id: row.layout_version_id,
            theme_id: row.theme_id,
            theme_version_id: row.theme_version_id,
            baseline_id: id,
          })
          .execute(),
      ),
    ).rejects.toThrow(/exactly what the baseline pins/);
  });

  it('VER-049 marks a baseline superseded by a later one of its document, once, keeps it readable, and lists by state', async () => {
    const document = await documentWith([]);
    const first = made(await make(document, 'Issue 1'));
    const second = made(await make(document, 'Issue 2'));
    const other = made(await make(await documentWith([]), 'Elsewhere'));

    const supersede = (baseline: string, by: string) =>
      tenant((trx) => supersedeBaseline(trx, { baseline, by, principal: grace }));
    expect(await supersede(second, first)).toEqual({ answer: 'superseder.invalid' });
    expect(await supersede(first, other)).toEqual({ answer: 'superseder.invalid' });
    expect(await supersede(first, first)).toEqual({ answer: 'superseder.invalid' });
    expect(await supersede(first, second)).toEqual({ answer: 'superseded' });
    expect(await supersede(first, second)).toEqual({ answer: 'superseded.already' });

    const read = await tenant((trx) => readBaseline(trx, first, ada));
    expect(read!.superseded).toMatchObject({ by: second, principal: grace });
    const names = async (state?: 'current' | 'superseded') =>
      (await tenant((trx) => listBaselines(trx, document.artifactId, state))).map(
        (each) => each.name,
      );
    expect(await names()).toEqual(['Issue 2', 'Issue 1']);
    expect(await names('current')).toEqual(['Issue 2']);
    expect(await names('superseded')).toEqual(['Issue 1']);
  });

  it('VER-023 refuses deleting a version only a baseline pins, in the database itself', async () => {
    const lone = await component(general, ada, 'Lone');
    const document = await documentWith([reference(lone.artifactId)]);
    made(await make(document, 'Pinned'));
    // As the cluster's superuser, past every grant, and with what else holds a version gone with it:
    // only the baseline's key is left to refuse.
    await expect(
      queryAs(
        db.adminUrl,
        `with gone as (delete from ${production.role}.version_definition where version_id = $1), unsearched as (delete from ${production.role}.search_entry where version_id = $1) delete from ${production.role}.artifact_version where id = $1`,
        [lone.id],
      ),
    ).rejects.toMatchObject({ constraint: expect.stringMatching(/^baseline_pin/) });
  });

  it('records a baseline’s parts only in the transaction that made it, and no gate until LIF names one', async () => {
    const lone = await component(general, ada, 'Late');
    const document = await documentWith([]);
    const id = made(await make(document, 'Closed'));
    await expect(
      tenant((trx) =>
        trx
          .insertInto('baseline_pin')
          .values({
            baseline_id: id,
            node: nodeId(),
            version_id: lone.id,
            artifact_id: lone.artifactId,
            kind: 'component',
          })
          .execute(),
      ),
    ).rejects.toThrow(/only in the transaction that made it/);
    await expect(
      queryAs(
        db.adminUrl,
        `update ${production.role}.baseline set gate = 'approval' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/baseline_gate/);
  });

  it('puts each baseline made, and each superseded, on the log about the document version it pins', async () => {
    const document = await documentWith([]);
    const first = made(await make(document, 'Logged 1'));
    const second = made(await make(document, 'Logged 2'));
    await tenant((trx) => supersedeBaseline(trx, { baseline: first, by: second, principal: ada }));
    const events = await tenant((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'detail', 'subject', 'subject_version'])
        .where('kind', 'in', ['baseline.made', 'baseline.superseded'])
        .where('subject', '=', document.artifactId)
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      {
        kind: 'baseline.made',
        detail: { baseline: first },
        subject: document.artifactId,
        subject_version: document.id,
      },
      {
        kind: 'baseline.made',
        detail: { baseline: second },
        subject: document.artifactId,
        subject_version: document.id,
      },
      {
        kind: 'baseline.superseded',
        detail: { baseline: first, by: second },
        subject: document.artifactId,
        subject_version: document.id,
      },
    ]);
  });
});
