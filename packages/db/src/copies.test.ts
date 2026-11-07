import { randomUUID } from 'node:crypto';
import {
  CONNECTION_SCHEMA_VERSION,
  QUERY_DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { bootstrapCluster } from './bootstrap.js';
import { COPY_MAX, copyArtifact, previewCopy, type CopyInput } from './copies.js';
import { createComponent } from './creation.js';
import { recordDatasetVersion, recordResolution } from './datasets.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { recordRevision } from './revisions.js';
import { findRole } from './roles.js';
import { archiveSpace, createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, latestVersion, type StoredVersion } from './versions.js';

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const node = () =>
  Array.from(
    { length: 26 },
    () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');

describe('copying a document, a component or a template (the RM plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let open = '';
  let closed = '';

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, fn, { actorKind: 'person', actor: ada });

  const component = (title = 'Install the printer', space = open) =>
    work(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        blocks: [{ type: 'paragraph', id: 'p1', style: 'body', content: text(`${title}.`) }],
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const reference = (
    part: StoredVersion,
    mode: OutlineNode extends infer N ? (N extends { mode: infer M } ? M : never) : never,
    more: object = {},
  ): OutlineNode =>
    ({
      type: 'reference',
      id: node(),
      component: part.artifactId,
      mode,
      ...base,
      ...more,
      children: [],
    }) as OutlineNode;

  const document = (nodes: OutlineNode[], title = 'The dosing report', space = open) =>
    work(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        nodes,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const inputOf = (id: string, over: Partial<CopyInput> = {}): CopyInput => ({
    artifactId: id,
    to: open,
    title: 'The copy',
    by: ada,
    ...over,
  });

  const outlineOf = (version: StoredVersion) => version.content as OutlineDocument;

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
    await service.withTenant(tenant, async (trx) => {
      const person = async (subject: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: 'https://idp.example', subject, email: `${subject}@example.com` })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada');
      grace = await person('grace');
      open = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      closed = (await createSpace(trx, 'Closed')).id;
      const author = (await findRole(trx, 'Author'))!.id;
      for (const space of [open, closed]) {
        await grant(trx, {
          subject: { principal: ada },
          roleId: author,
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await grant(trx, {
        subject: { principal: grace },
        roleId: (await findRole(trx, 'Reader'))!.id,
        level: { kind: 'space', id: open },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REU-057 says how many each choice would copy, its own by default, writing nothing', async () => {
    const own = await component('Own');
    const shared = await component('Shared');
    const kept = await component('Kept');
    await work((trx) => archiveArtifact(trx, kept.artifactId, ada));
    await document([reference(shared, { kind: 'latest' })], 'Elsewhere');
    const original = await document([
      reference(own, { kind: 'latest' }),
      reference(shared, { kind: 'latest' }),
      reference(kept, { kind: 'latest' }),
    ]);
    const before = await work((trx) => newestEvent(trx));
    const preview = (components?: CopyInput['components']) =>
      work((trx) => previewCopy(trx, inputOf(original.artifactId, { components })));
    expect(await preview()).toMatchObject({
      answer: 'previewed',
      kind: 'document',
      copied: 1,
      reused: 2,
      kept: 1,
      unreadable: 0,
    });
    expect(await preview('all')).toMatchObject({ copied: 2, reused: 1, kept: 1 });
    expect(await preview('reuse')).toMatchObject({ copied: 0, reused: 3 });
    expect(await work((trx) => auditEvents(trx, before))).toEqual([]);
  });

  it('REU-056 warns of a title in use in the target, and refuses none', async () => {
    const original = await document([], 'Calibration');
    const into = (to: string, title: string) =>
      work((trx) => previewCopy(trx, inputOf(original.artifactId, { to, title })));
    expect(await into(open, ' calibration ')).toMatchObject({
      titleInUse: true,
      consequences: null,
    });
    expect(await into(closed, 'Calibration')).toMatchObject({
      titleInUse: false,
      consequences: { citations: 0, terms: 0, imagesStaying: 0, bound: 0 },
    });
    const copied = await work((trx) =>
      copyArtifact(trx, inputOf(original.artifactId, { title: 'Calibration' })),
    );
    expect(copied).toMatchObject({ answer: 'copied', titleInUse: true });
  });

  it('REU-058 keeps every node identity, repoints its own components to copies at the version shown, and starts at 0.1', async () => {
    const own = await component('Pinned part');
    const approved = await component('Approved part');
    const shared = await component('Shared part');
    await document([reference(shared, { kind: 'latest' })], 'Another');
    const original = await document([
      {
        type: 'section',
        id: node(),
        title: text('Method'),
        ...base,
        values: { owner: 'kept' },
        children: [
          reference(
            own,
            { kind: 'pinned', version: own.id },
            {
              overrides: [{ block: 'p1', against: own.id, text: text('Locally') }],
            },
          ),
          reference(approved, { kind: 'approved' }),
          reference(shared, { kind: 'latest' }),
        ],
      } as OutlineNode,
    ]);
    const answer = await work((trx) =>
      copyArtifact(trx, inputOf(original.artifactId, { to: closed, title: 'Copied report' })),
    );
    if (answer.answer !== 'copied') throw new Error(JSON.stringify(answer));
    expect(answer).toMatchObject({ copied: 2, reused: 1, approvedToLatest: 1 });
    const copy = answer.copy;
    expect([copy.revision, copy.version]).toEqual([0, 1]);
    const was = outlineOf(original);
    const now = outlineOf(copy);
    expect(now.title).toBe('Copied report');
    expect(now.language).toBe('en-GB');
    const [section] = now.nodes;
    expect(section!.id).toBe(was.nodes[0]!.id);
    expect(section!.values).toEqual({ owner: 'kept' });
    expect(section!.children.map((each) => each.id)).toEqual(
      was.nodes[0]!.children.map((each) => each.id),
    );
    const [pinned, latest, reused] = section!.children as Extract<
      OutlineNode,
      { type: 'reference' }
    >[];
    const ownCopy = answer.components.find((each) => each.from === own.artifactId)!.copy;
    const ownVersion = (await work((trx) => latestVersion(trx, ownCopy)))!;
    expect(pinned).toMatchObject({
      component: ownCopy,
      mode: { kind: 'pinned', version: ownVersion.id },
      overrides: [{ block: 'p1', against: ownVersion.id, text: text('Locally') }],
    });
    expect(latest!.mode).toEqual({ kind: 'latest' });
    expect(latest!.component).not.toBe(approved.artifactId);
    expect(reused!.component).toBe(shared.artifactId);
    // Each copy a new component in the target, at 0.1, its title kept.
    expect([ownVersion.revision, ownVersion.version]).toEqual([0, 1]);
    expect((ownVersion.content as ContentDocument).title).toBe('Pinned part');
    const spaces = await work((trx) =>
      trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', 'in', [copy.artifactId, ownCopy])
        .execute(),
    );
    expect(spaces.map((row) => row.space_id)).toEqual([closed, closed]);
  });

  it('REU-058 carries its template, waivers and bindings, and none of its versions; audited as artifact.copied', async () => {
    const original = await work(async (trx) => {
      const template = await createTemplate(trx, {
        spaceId: open,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (template.answer !== 'created') throw new Error(template.answer);
      const made = await createDocument(trx, {
        spaceId: open,
        title: 'From a template',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: template.template.id,
      });
      if (made.answer !== 'created') throw new Error(JSON.stringify(made));
      await trx
        .insertInto('section_waiver')
        .values({
          document_id: made.version.artifactId,
          key: 'safety',
          reason: 'Not this product',
          version_id: made.version.id,
          by: ada,
        })
        .execute();
      const resolution = await recordResolution(trx, {
        document: made.version.artifactId,
        node: 'a'.repeat(26),
        binding: 'b1',
        digest: 'd'.repeat(64),
        version: await datasetVersion(trx),
        replaces: null,
        act: 'resolve',
        by: ada,
      });
      await recordRevision(trx, {
        document: made.version.artifactId,
        node: 'a'.repeat(26),
        binding: 'b1',
        cell: '',
        resolution: resolution.id,
        act: 'revise',
        value: 'Corrected',
        reason: 'A typo',
        replaces: null,
        by: ada,
      });
      return made.version;
    });
    const before = await work((trx) => newestEvent(trx));
    const answer = await work((trx) => copyArtifact(trx, inputOf(original.artifactId)));
    if (answer.answer !== 'copied') throw new Error(JSON.stringify(answer));
    const copy = answer.copy.artifactId;
    const read = await work(async (trx) => ({
      template: await trx
        .selectFrom('document_template')
        .select(['template_id', 'template_version_id'])
        .where('document_id', 'in', [original.artifactId, copy])
        .execute(),
      waivers: await trx
        .selectFrom('section_waiver')
        .select(['key', 'reason'])
        .where('document_id', '=', copy)
        .execute(),
      resolutions: await trx
        .selectFrom('binding_resolution')
        .select(['node_id', 'binding_id', 'dataset_version', 'act', 'resolved_by'])
        .where('document_id', '=', copy)
        .execute(),
      revisions: await trx
        .selectFrom('binding_revision')
        .select(['value', 'reason'])
        .where('document_id', '=', copy)
        .execute(),
      versions: await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', copy)
        .execute(),
      events: await auditEvents(trx, before),
    }));
    expect(read.template[0]).toEqual(read.template[1]);
    expect(read.waivers).toEqual([{ key: 'safety', reason: 'Not this product' }]);
    expect(read.resolutions).toMatchObject([{ node_id: 'a'.repeat(26), act: 'resolve' }]);
    expect(read.revisions).toEqual([{ value: 'Corrected', reason: 'A typo' }]);
    expect(read.versions).toHaveLength(1);
    expect(read.events.find((each) => each.kind === 'artifact.copied')).toMatchObject({
      actor: ada,
      subject: copy,
      subjectVersion: answer.copy.id,
      space: open,
      detail: { from: original.artifactId },
      labels: { subject: { text: 'The copy' } },
    });
  });

  it('REU-057 refuses more than COPY_MAX components at once, counted after its exceptions', async () => {
    const parts = await work(async (trx) => {
      const made: StoredVersion[] = [];
      for (let each = 0; each <= COPY_MAX; each += 1) {
        const answer = await createComponent(trx, {
          spaceId: open,
          title: `Part ${each}`,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (answer.answer !== 'created') throw new Error(answer.answer);
        made.push(answer.version);
      }
      return made;
    });
    const large = await document(parts.map((part) => reference(part, { kind: 'latest' })));
    expect(await work((trx) => copyArtifact(trx, inputOf(large.artifactId)))).toEqual({
      answer: 'copy.too_large',
    });
    expect(await work((trx) => previewCopy(trx, inputOf(large.artifactId)))).toMatchObject({
      copied: COPY_MAX + 1,
    });
    // Counted after the exceptions: one set to Reuse brings it within the limit.
    const within = await work((trx) =>
      copyArtifact(
        trx,
        inputOf(large.artifactId, {
          exceptions: [{ component: parts[0]!.artifactId, as: 'reuse' }],
        }),
      ),
    );
    expect(within).toMatchObject({ answer: 'copied', copied: COPY_MAX });
  });

  it('REU-057 reuses a component its copier may not read, unnamed, rather than refusing the copy', async () => {
    const hidden = await component('Hidden', closed);
    const mixed = await document([reference(hidden, { kind: 'latest' })]);
    const asGrace = { by: grace, components: 'all' as const };
    expect(await work((trx) => previewCopy(trx, inputOf(mixed.artifactId, asGrace)))).toMatchObject(
      {
        copied: 0,
        unreadable: 1,
        components: [
          { component: hidden.artifactId, title: null, placed: 'unreadable', others: null },
        ],
      },
    );
    expect(
      await work((trx) => copyArtifact(trx, inputOf(mixed.artifactId, asGrace))),
    ).toMatchObject({ answer: 'copied', copied: 0, unreadable: 1 });
    expect(
      await work((trx) =>
        previewCopy(
          trx,
          inputOf(mixed.artifactId, {
            by: grace,
            exceptions: [{ component: hidden.artifactId, as: 'copy' }],
          }),
        ),
      ),
    ).toEqual({ answer: 'copy.exception_fixed', component: hidden.artifactId });
  });

  it('REU-057 answers each component: where it stands, how many other documents its reader may read place it, and what the copy does', async () => {
    const own = await component('Alone');
    const shared = await component('Placed twice');
    const kept = await component('Put away');
    await work((trx) => archiveArtifact(trx, kept.artifactId, ada));
    await document([reference(shared, { kind: 'latest' })], 'Readable elsewhere');
    await document([reference(shared, { kind: 'latest' })], 'Hidden elsewhere', closed);
    const original = await document([
      reference(own, { kind: 'latest' }),
      reference(shared, { kind: 'latest' }),
      reference(own, { kind: 'latest' }),
      reference(kept, { kind: 'latest' }),
    ]);
    const preview = await work((trx) => previewCopy(trx, inputOf(original.artifactId)));
    expect(preview).toMatchObject({
      components: [
        { component: own.artifactId, title: 'Alone', placed: 'only', others: 0, outcome: 'copy' },
        {
          component: shared.artifactId,
          title: 'Placed twice',
          placed: 'shared',
          others: 2,
          outcome: 'reuse',
        },
        { component: kept.artifactId, placed: 'kept', outcome: 'reuse' },
      ],
    });
    const asGrace = await work((trx) =>
      previewCopy(trx, inputOf(original.artifactId, { by: grace })),
    );
    expect(asGrace).toMatchObject({ components: [{}, { others: 1 }, {}] });
  });

  it('REU-057 sets components the other way, refusing one not placed or a fixed one copied, and counts the limit after them', async () => {
    const own = await component('Mine');
    const shared = await component('Ours');
    const kept = await component('Retired');
    await work((trx) => archiveArtifact(trx, kept.artifactId, ada));
    await document([reference(shared, { kind: 'latest' })], 'The other');
    const original = await document([
      reference(own, { kind: 'latest' }),
      reference(shared, { kind: 'latest' }),
      reference(kept, { kind: 'latest' }),
    ]);
    const exceptions = [
      { component: own.artifactId, as: 'reuse' as const },
      { component: shared.artifactId, as: 'copy' as const },
    ];
    expect(
      await work((trx) => previewCopy(trx, inputOf(original.artifactId, { exceptions }))),
    ).toMatchObject({
      copied: 1,
      reused: 2,
      components: [{ outcome: 'reuse' }, { outcome: 'copy' }, { outcome: 'reuse' }],
    });
    const copied = await work((trx) =>
      copyArtifact(trx, inputOf(original.artifactId, { exceptions })),
    );
    if (copied.answer !== 'copied') throw new Error(JSON.stringify(copied));
    expect(copied.components.map((each) => each.from)).toEqual([shared.artifactId]);
    const stranger = randomUUID();
    for (const input of [
      { exceptions: [{ component: stranger, as: 'reuse' as const }] },
      { exceptions: [{ component: kept.artifactId, as: 'copy' as const }] },
    ]) {
      const refused = await work((trx) => copyArtifact(trx, inputOf(original.artifactId, input)));
      expect(refused).toEqual({
        answer:
          input.exceptions[0]!.component === stranger
            ? 'copy.exception_unknown'
            : 'copy.exception_fixed',
        component: input.exceptions[0]!.component,
      });
    }
  });

  it('REU-068 keeps the document own rewordings on the copy, or leaves every one behind, and audits the choices', async () => {
    const part = await component('Reworded');
    const original = await document([
      reference(
        part,
        { kind: 'latest' },
        { overrides: [{ block: 'p1', against: part.id, text: text('Said our way.') }] },
      ),
    ]);
    expect(
      await work((trx) => previewCopy(trx, inputOf(original.artifactId, { components: 'reuse' }))),
    ).toMatchObject({ overrides: 1, overridesDropped: 0 });
    const copy = async (rewordings: 'keep' | 'drop') => {
      const before = await work((trx) => newestEvent(trx));
      const answer = await work((trx) =>
        copyArtifact(trx, inputOf(original.artifactId, { components: 'reuse', rewordings })),
      );
      if (answer.answer !== 'copied') throw new Error(JSON.stringify(answer));
      const events = await work((trx) => auditEvents(trx, before));
      return {
        reference: outlineOf(answer.copy).nodes[0] as OutlineNode & { type: 'reference' },
        detail: events.find((each) => each.kind === 'artifact.copied')?.detail,
      };
    };
    const kept = await copy('keep');
    expect(kept.reference.overrides).toHaveLength(1);
    const dropped = await copy('drop');
    expect(dropped.reference.overrides).toBeUndefined();
    expect(dropped.detail).toEqual({
      from: original.artifactId,
      components: 'reuse',
      exceptions: [],
      rewordings: 'drop',
    });
    // The original keeps its own.
    const now = await work((trx) => latestVersion(trx, original.artifactId));
    expect((outlineOf(now!).nodes[0] as { overrides?: unknown[] }).overrides).toHaveLength(1);
  });

  it('REU-056 copies a component at its latest and a template by its definition, under the new title', async () => {
    const part = await component('Original part');
    const copied = await work((trx) =>
      copyArtifact(trx, inputOf(part.artifactId, { title: 'Its copy', to: closed })),
    );
    if (copied.answer !== 'copied') throw new Error(JSON.stringify(copied));
    expect(copied.kind).toBe('component');
    expect((copied.copy.content as ContentDocument).title).toBe('Its copy');
    expect((copied.copy.content as ContentDocument).content).toEqual(
      (part.content as ContentDocument).content,
    );
    expect(copied.copy.values).toEqual(part.values);

    const template = await work(async (trx) => {
      const made = await createTemplate(trx, {
        spaceId: open,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Letter',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.template;
    });
    const named = await work((trx) =>
      copyArtifact(trx, inputOf(template.id, { title: 'Letter, short' })),
    );
    if (named.answer !== 'copied') throw new Error(JSON.stringify(named));
    expect(named.kind).toBe('template');
    expect(named.copy.content).toMatchObject({ name: 'Letter, short', layout: DEFAULT_LAYOUT_ID });
    expect(named.copy.artifactId).not.toBe(template.id);
  });

  it('refuses an archived target, a title that trims to nothing and what is not there', async () => {
    const original = await document([]);
    const archived = await work(async (trx) => {
      const space = (await createSpace(trx, `Old ${randomUUID()}`)).id;
      await archiveSpace(trx, space, ada);
      return space;
    });
    expect(
      await work((trx) => copyArtifact(trx, inputOf(original.artifactId, { to: archived }))),
    ).toEqual({ answer: 'space.archived' });
    expect(
      await work((trx) => copyArtifact(trx, inputOf(original.artifactId, { title: '   ' }))),
    ).toEqual({ answer: 'content.invalid' });
    expect(await work((trx) => copyArtifact(trx, inputOf(randomUUID())))).toEqual({
      answer: 'artifact.missing',
    });
  });

  /** A dataset version to resolve a binding to, through a connection and a query definition. */
  async function datasetVersion(trx: TenantTransaction): Promise<string> {
    const connection = await createArtifact(trx, {
      author: ada,
      spaceId: open,
      substance: {
        kind: 'connection',
        content: {
          schemaVersion: CONNECTION_SCHEMA_VERSION,
          name: `Readings ${randomUUID()}`,
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
        },
      },
    });
    const defined = await createArtifact(trx, {
      author: ada,
      spaceId: open,
      substance: {
        kind: 'queryDefinition',
        content: {
          schemaVersion: QUERY_DEFINITION_SCHEMA_VERSION,
          title: `Sites ${randomUUID()}`,
          description: '',
          connection: connection.artifactId,
          parameters: [],
          fetch: { kind: 'sql', text: 'select id from sample.site order by id' },
          columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 100_000, seconds: 10 },
          retired: false,
        },
      },
    });
    const recorded = await recordDatasetVersion(trx, {
      author: ada,
      provenance: {
        schemaVersion: 1,
        queryDefinition: { artifact: defined.artifactId, version: defined.id },
        connection: { artifact: connection.artifactId, version: connection.id },
        parameters: {},
        ran: { sql: 'select id from sample.site order by id' },
        identity: { kind: 'service' },
        at: '2026-10-03T09:00:00.000Z',
        durationMs: 1,
        rowCount: 0,
        columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
        canonical: 1,
        checksum: 'e'.repeat(64),
        images: {},
      },
    });
    return recorded.version.id;
  }
});
