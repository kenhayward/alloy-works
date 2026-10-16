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
import { changesSince } from './changes.js';
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
import { recordRevision } from './revisions.js';
import { unmetConditions } from './workflow-conditions.js';
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
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

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

  it('makes a baseline where what its maker cannot read is a reference the profile leaves out (the R11 plan, R11-C)', async () => {
    const secret = await component(quality, grace, 'Calibration');
    const hidden = {
      ...reference(secret.artifactId),
      conditions: [{ axis: 'audience', values: ['regulator'] }],
    };
    const document = await documentWith([hidden]);
    made(await make(document, 'Left out'));
  });

  /** A new version of a document with this profile, its nodes as they are. */
  const profiled = (document: StoredVersion, profile: OutlineDocument['profile']) =>
    tenant(async (trx) => {
      const { profile: dropped, ...outline } = document.content as OutlineDocument;
      void dropped;
      const recorded = await recordVersion(trx, {
        artifactId: document.artifactId,
        openedFrom: document.id,
        author: ada,
        substance: {
          kind: 'document',
          content: profile === undefined ? outline : { ...outline, profile },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  it('pins nothing of a reference the profile leaves out, so a requester who may not read it still publishes the baseline (the R11 final review)', async () => {
    const secret = await component(quality, grace, 'Calibration');
    const left = {
      ...reference(secret.artifactId),
      conditions: [{ axis: 'audience', values: ['regulator'] }],
    };
    const document = await profiled(await documentWith([left]), {
      values: { audience: ['internal'] },
    });
    const id = made(await make(document, 'Internal', grace));
    expect((await tenant((trx) => readBaseline(trx, id, grace)))!.pins.occurrences).toEqual([]);
    const asked = await tenant((trx) =>
      requestBaselinePublication(trx, { baseline: id, formats: ['pdf'], requester: ada }),
    );
    expect(asked.answer).toBe('requested');
  });

  it('VER-020 records the profile in force when it was taken, and publishes under it rather than none', async () => {
    const document = await profiled(await documentWith([]), {
      values: { audience: ['regulator'] },
      excludeUnset: true,
    });
    const id = made(await make(document, 'For the regulator'));
    // The document moves on; the baseline keeps what was in force.
    await profiled(document, { values: { audience: ['internal'] } });
    const read = await tenant((trx) => readBaseline(trx, id, ada));
    expect(read!.profile).toEqual({ values: { audience: ['regulator'] }, excludeUnset: true });
    const inputs = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return publicationInputs(trx, asked.request.id);
    });
    expect(inputs!.profile).toEqual({ values: { audience: ['regulator'] }, excludeUnset: true });
    // A document that declares none is baselined under none.
    const plain = made(await make(await documentWith([]), 'Plain'));
    expect((await tenant((trx) => readBaseline(trx, plain, ada)))!.profile).toBeNull();
  });

  it('LIF-065 holds a transition requiring a complete profile while an axis its kept content depends on is unset, naming each', async () => {
    const notice = await component(general, ada, 'Notice');
    await revise(notice, [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          {
            type: 'text',
            value: 'For vets.',
            marks: [{ type: 'condition', id: 'c1', axis: 'audience', values: ['vets'] }],
          },
        ],
      },
    ]);
    const annex = {
      ...section('Annex', [reference(notice.artifactId)]),
      conditions: [{ axis: 'market', values: ['uk'] }],
    };
    const document = await documentWith([annex, reference(notice.artifactId)]);
    const unmet = () =>
      tenant((trx) =>
        unmetConditions(trx, {
          artifactId: document.artifactId,
          kind: 'document',
          requires: ['profile'],
          principal: ada,
        }),
      );
    expect(await unmet()).toEqual([
      { condition: 'profile', count: 2, names: ['audience', 'market'], unreadable: 0 },
    ]);
    // Accepting exclusion by unset is not setting it.
    const accepted = await profiled(document, { values: {}, excludeUnset: true });
    expect((await unmet())[0]).toMatchObject({ names: ['audience', 'market'] });
    // A market that leaves the annex out leaves nothing it holds to ask.
    await profiled(accepted, { values: { market: ['us'], audience: ['vets'] } });
    expect(await unmet()).toEqual([]);
  });

  it('LIF-065 counts no component the profile leaves out as unproven, though its decider may not read it', async () => {
    const secret = await component(quality, grace, 'Calibration');
    const annex = {
      ...section('Annex', [reference(secret.artifactId)]),
      conditions: [{ axis: 'market', values: ['uk'] }],
    };
    const document = await profiled(await documentWith([annex]), { values: { market: ['us'] } });
    expect(
      await tenant((trx) =>
        unmetConditions(trx, {
          artifactId: document.artifactId,
          kind: 'document',
          requires: ['profile'],
          principal: ada,
        }),
      ),
    ).toEqual([]);
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

    // What changed since names a value resolved at a node only to a reader of its component (SCH-025).
    const secret = await component(quality, grace, 'Hidden depths');
    const hidden = reference(secret.artifactId);
    const mixed = await documentWith([node, hidden]);
    const since = new Date(Date.now() - 60_000);
    await tenant(async (trx) => {
      const result = await recordDatasetVersion(trx, { provenance, author: ada });
      for (const at of [node.id, hidden.id]) {
        await recordResolution(trx, {
          document: mixed.artifactId,
          node: at,
          binding: 'k1',
          digest: sha256Hex(bindingDigestInput(binding('k1'))),
          version: result.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        });
      }
    });
    const seen = (reader: string) =>
      tenant((trx) => changesSince(trx, { since, reader, artifacts: [mixed.artifactId] })).then(
        (answer) => answer.values.map((each) => each.node).sort(),
      );
    expect(await seen(ada)).toEqual([node.id]);
    expect(await seen(grace)).toEqual([node.id, hidden.id].sort());
  });

  it('LIF-004 DAT-123 holds a transition requiring bindings while one is unresolved, and revisions while a revision by hand stands', async () => {
    const binding = {
      type: 'binding',
      id: 'k1',
      query: query.id,
      parameters: {},
      mode: 'checked',
      take: { key: { id: '1' }, column: 'depth' },
    } as Binding;
    const holder = await component(general, ada, 'Gated depths');
    const bound = await revise(holder, [
      { type: 'paragraph', id: 'p1', style: 'body', content: [binding] },
    ] as ContentDocument['content']);
    const node = reference(bound.artifactId);
    const document = await documentWith([node]);
    const unmet = () =>
      tenant((trx) =>
        unmetConditions(trx, {
          artifactId: document.artifactId,
          kind: 'document',
          requires: ['bindings', 'revisions'],
          principal: ada,
        }),
      );
    expect(await unmet()).toEqual([{ condition: 'bindings', count: 1, names: [], unreadable: 0 }]);

    const resolution = await tenant(async (trx) => {
      const result = await recordDatasetVersion(trx, {
        provenance: {
          schemaVersion: 1,
          queryDefinition: { artifact: query.id, version: query.version.id },
          connection: { artifact: connection.id, version: connection.version.id },
          parameters: {},
          ran: { sql: 'select id, depth from sample.reading order by id' },
          identity: { kind: 'service' },
          at: '2026-10-15T09:15:00.000Z',
          durationMs: 12,
          rowCount: 1,
          columns: [
            { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
            { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
          ],
          canonical: 1,
          checksum: 'c'.repeat(64),
          images: {},
        },
        author: ada,
      });
      return recordResolution(trx, {
        document: document.artifactId,
        node: node.id,
        binding: 'k1',
        digest: sha256Hex(bindingDigestInput(binding)),
        version: result.version.id,
        replaces: null,
        act: 'resolve',
        by: ada,
      });
    });
    expect(await unmet()).toEqual([]);

    const revised = (act: 'revise' | 'withdraw', replaces: string | null) =>
      tenant((trx) =>
        recordRevision(trx, {
          document: document.artifactId,
          node: node.id,
          binding: 'k1',
          cell: '',
          resolution: resolution.id,
          act,
          value: act === 'revise' ? '12 m' : null,
          reason: 'Measured again.',
          replaces,
          by: ada,
        }),
      );
    const first = await revised('revise', null);
    expect(await unmet()).toEqual([{ condition: 'revisions', count: 1, names: [], unreadable: 0 }]);
    await revised('withdraw', first.id);
    expect(await unmet()).toEqual([]);
  });

  it('DAT-062 pins the values revised by hand standing when a baseline is made, its digest over them, and publishes them, never one made since', async () => {
    const binding = {
      type: 'binding',
      id: 'k1',
      query: query.id,
      parameters: {},
      mode: 'checked',
      take: { key: { id: '1' }, column: 'depth' },
    } as Binding;
    const holder = await component(general, ada, 'Revised depths');
    const bound = await revise(holder, [
      { type: 'paragraph', id: 'p1', style: 'body', content: [binding] },
    ] as ContentDocument['content']);
    const node = reference(bound.artifactId);
    const document = await documentWith([node]);
    const resolution = await tenant(async (trx) => {
      const result = await recordDatasetVersion(trx, {
        provenance: {
          schemaVersion: 1,
          queryDefinition: { artifact: query.id, version: query.version.id },
          connection: { artifact: connection.id, version: connection.version.id },
          parameters: {},
          ran: { sql: 'select id, depth from sample.reading order by id' },
          identity: { kind: 'service' },
          at: '2026-10-12T09:15:00.000Z',
          durationMs: 12,
          rowCount: 1,
          columns: [
            { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
            { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
          ],
          canonical: 1,
          checksum: 'b'.repeat(64),
          images: {},
        },
        author: ada,
      });
      return recordResolution(trx, {
        document: document.artifactId,
        node: node.id,
        binding: 'k1',
        digest: sha256Hex(bindingDigestInput(binding)),
        version: result.version.id,
        replaces: null,
        act: 'resolve',
        by: ada,
      });
    });
    const revisedTo = (value: string, replaces: string | null) =>
      tenant((trx) =>
        recordRevision(trx, {
          document: document.artifactId,
          node: node.id,
          binding: 'k1',
          cell: '',
          resolution: resolution.id,
          act: 'revise',
          value,
          reason: 'Measured again.',
          replaces,
          by: ada,
        }),
      );
    const first = await revisedTo('12 m', null);
    const id = made(await make(document, 'Revised'));
    await revisedTo('13 m', first.id);

    const whole = await tenant((trx) => readBaseline(trx, id, ada));
    expect(whole!.pins.bindings).toEqual([
      expect.objectContaining({ binding: 'k1', revisions: [{ id: first.id, value: '12 m' }] }),
    ]);
    expect(sha256Hex(baselineDigestInput(whole!.pins))).toBe(whole!.digest);
    const inputs = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return publicationInputs(trx, asked.request.id);
    });
    expect(inputs!.bindings.get(node.id)!.get('k1')!.revisions).toEqual([
      expect.objectContaining({ id: first.id, value: '12 m', reason: 'Measured again.' }),
    ]);

    // A revision is a change since, for whoever may read its node (SCH-025).
    const since = new Date(Date.now() - 60_000);
    const changes = await tenant((trx) =>
      changesSince(trx, { since, reader: ada, artifacts: [document.artifactId] }),
    );
    expect(changes.values.map((each) => each.act)).toEqual(['revise', 'revise', 'resolve']);
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

  /** An image in General, and a component placing it in a figure. */
  const placingAnImage = (object: string) =>
    tenant(async (trx) => {
      const image = await createArtifact(trx, {
        spaceId: general,
        author: ada,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: `${production.role}/sha256/${object.repeat(64)}`,
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
        } as never,
      });
      return image;
    });

  it('VER-043 shows a reader every image they may read, so a document with one has a digest they can recompute', async () => {
    const image = await placingAnImage('d');
    const holder = await component(general, ada, 'Shapes');
    await revise(holder, [
      {
        type: 'figure',
        id: 'f1',
        asset: image.id,
        imageStyle: 'figure',
        caption: [{ type: 'text', value: 'Shapes', marks: [] }],
        alternative: { kind: 'inherited' },
      },
    ] as ContentDocument['content']);
    const document = await documentWith([reference(holder.artifactId)]);
    const id = made(await make(document, 'With an image'));

    const read = await tenant((trx) => readBaseline(trx, id, ada));
    expect(read!.withheld).toEqual({ nodes: [], assets: 0 });
    expect(read!.pins.assets.map((each) => each.version)).toEqual([image.id]);
    expect(sha256Hex(baselineDigestInput(read!.pins))).toBe(read!.digest);
  });

  it('refuses a part added to a baseline’s request after the transaction that asked for it, and a preview naming a baseline', async () => {
    const image = await placingAnImage('e');
    const document = await documentWith([]);
    const id = made(await make(document, 'Asked once'));
    const asked = await tenant((trx) =>
      requestBaselinePublication(trx, { baseline: id, formats: ['pdf'], requester: ada }),
    );
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    await expect(
      tenant((trx) =>
        trx
          .insertInto('publication_request_asset')
          .values({
            request_id: asked.request.id,
            version_id: image.id,
            asset_id: image.artifactId,
          })
          .execute(),
      ),
    ).rejects.toThrow(/in the transaction that asked for it/);

    const row = await tenant((trx) =>
      trx.selectFrom('baseline').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );
    await expect(
      tenant((trx) =>
        trx
          .insertInto('publication_request')
          .values({
            kind: 'preview',
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
    ).rejects.toThrow(/publication_request_baseline_publish/);
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

  /** The database's own now, which every version's time is. */
  const now = () =>
    tenant(
      async (trx) =>
        (await sql<{ at: Date }>`select clock_timestamp() as at`.execute(trx)).rows[0]!.at,
    );

  it('SCH-025 says what changed since an instant in a space, among a set of results, and in a document, as the caller may read it', async () => {
    const printer = await component(general, ada, 'Changes printer');
    const secret = await component(quality, grace, 'Changes secret');
    const since = await now();
    await revise(printer, [{ type: 'paragraph', id: 'p9', style: 'body', content: [] }]);
    await revise(secret, [{ type: 'paragraph', id: 'p9', style: 'body', content: [] }]);

    const inSpace = await tenant((trx) =>
      changesSince(trx, { since, reader: ada, space: general }),
    );
    expect(inSpace.artifacts.map((each) => each.artifact)).toContain(printer.artifactId);
    expect(inSpace.artifacts.find((each) => each.artifact === printer.artifactId)).toMatchObject({
      kind: 'component',
      title: 'Changes printer',
      versions: 1,
    });
    const among = await tenant((trx) =>
      changesSince(trx, { since, reader: ada, artifacts: [printer.artifactId, secret.artifactId] }),
    );
    expect(among.artifacts.map((each) => each.artifact)).toEqual([printer.artifactId]);
    expect(JSON.stringify(among)).not.toContain(secret.artifactId);
    expect(among.fromRecordStart).toBe(false);
  });

  it('SCH-048 answers a question reaching back before the record from where the record begins, and says so', async () => {
    const printer = await component(general, ada, 'Changes earliest');
    const answer = await tenant((trx) =>
      changesSince(trx, {
        since: new Date('2000-01-01T00:00:00Z'),
        reader: ada,
        artifacts: [printer.artifactId],
      }),
    );
    expect(answer.fromRecordStart).toBe(true);
    expect(answer.recordBegins!.getTime()).toBeGreaterThan(
      new Date('2000-01-01T00:00:00Z').getTime(),
    );
    expect(answer.artifacts.map((each) => each.artifact)).toEqual([printer.artifactId]);
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

  it('VER-058 records a baseline’s parts only in the transaction that made it, and a gate only by its transition key', async () => {
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
        `update ${production.role}.baseline set gate = 'Not a key' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/baseline_gate/);
  });

  it('puts each baseline made, and each superseded, on the log about the document version it pins', async () => {
    const document = await documentWith([]);
    const first = made(await make(document, 'Logged 1'));
    const second = made(await make(document, 'Logged 2'));
    await tenant((trx) => supersedeBaseline(trx, { baseline: first, by: second, principal: ada }));
    const asked = await tenant((trx) =>
      requestBaselinePublication(trx, { baseline: second, formats: ['pdf'], requester: ada }),
    );
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    const requested = await tenant((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'publication.requested')
        .where('subject', '=', document.artifactId)
        .executeTakeFirstOrThrow(),
    );
    expect(requested.detail).toEqual({
      request: asked.request.id,
      formats: ['pdf'],
      baseline: second,
    });
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
