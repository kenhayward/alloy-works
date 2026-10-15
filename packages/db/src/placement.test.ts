import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { placeFromSection, previewPlacement } from './placement.js';
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
import { recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});
const section = (title: string, children: OutlineNode[], values = {}): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: text(title),
  ...base,
  values,
  children,
});

describe('placing another document section (the R2 plan, R2-F)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let shared = '';
  let restricted = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (space: string, title: string, words: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              { type: 'paragraph', id: 'p1', style: 'body', content: text(words) },
            ] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const document = (space: string, title: string, nodes: OutlineNode[]) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (nodes.length === 0) return made.version;
      const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const person = (trx: TenantTransaction, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

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
    await as(async (trx) => {
      shared = (await createSpace(trx, 'Shared')).id;
      restricted = (await createSpace(trx, 'Restricted')).id;
      ada = await person(trx, 'Ada');
      grace = await person(trx, 'Grace');
      for (const [who, space] of [
        [ada, shared],
        [grace, shared],
        [grace, restricted],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: who,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** A manual whose Maintenance section places Flush twice and Prime once, beneath a subsection. */
  const manual = async () => {
    const flush = await component(shared, 'Flush the line', 'Open the drain.');
    const prime = await component(shared, 'Prime the pump', 'Fill it.');
    const maintenance = section(
      'Maintenance',
      [
        reference(flush.artifactId),
        section('Weekly', [reference(prime.artifactId), reference(flush.artifactId)]),
      ],
      { owner: 'kept' },
    );
    const source = await document(shared, 'Pump manual', [maintenance]);
    return { flush, prime, maintenance, source };
  };

  it('REU-046 reports how much a section pulls in before anything is placed', async () => {
    const { flush, prime, maintenance, source } = await manual();
    const answer = await as((trx) =>
      previewPlacement(trx, { by: ada, from: source.artifactId, section: maintenance.id }),
    );
    expect(answer).toEqual({
      answer: 'report',
      report: {
        from: {
          document: source.artifactId,
          version: source.id,
          section: { id: maintenance.id, title: text('Maintenance') },
        },
        occurrences: 3,
        components: [
          {
            id: flush.artifactId,
            title: 'Flush the line',
            occurrences: 2,
            blocks: 1,
            characters: 15,
            approved: false,
          },
          {
            id: prime.artifactId,
            title: 'Prime the pump',
            occurrences: 1,
            blocks: 1,
            characters: 8,
            approved: false,
          },
        ],
        unreadable: 0,
        blocks: 3,
        characters: 38,
      },
    });
  });

  it('REU-054 places each occurrence as a reference under a new section of its own, pinned where asked, copying no values', async () => {
    const { flush, prime, maintenance, source } = await manual();
    const target = await document(shared, 'Pump handbook', []);
    const answer = await as((trx) =>
      placeFromSection(trx, {
        documentId: target.artifactId,
        openedFrom: target.id,
        author: ada,
        from: source.artifactId,
        fromVersion: source.id,
        section: maintenance.id,
        parent: null,
        position: 0,
        title: text('Upkeep'),
        mode: 'pinned',
      }),
    );
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    const [placed] = (answer.version.content as OutlineDocument).nodes;
    expect(placed).toMatchObject({ type: 'section', title: text('Upkeep'), values: {} });
    expect(placed!.id).not.toBe(maintenance.id);
    expect(
      placed!.children.map((each) =>
        each.type === 'reference' ? [each.component, each.mode] : null,
      ),
    ).toEqual([
      [flush.artifactId, { kind: 'pinned', version: flush.id }],
      [prime.artifactId, { kind: 'pinned', version: prime.id }],
      [flush.artifactId, { kind: 'pinned', version: flush.id }],
    ]);
  });

  it('refuses a source moved since the report, a section that is not there, and a component the author may not read', async () => {
    const { maintenance, source } = await manual();
    const target = await document(shared, 'Pump guide', []);
    const place = (over: Partial<Parameters<typeof placeFromSection>[1]>) =>
      as((trx) =>
        placeFromSection(trx, {
          documentId: target.artifactId,
          openedFrom: target.id,
          author: ada,
          from: source.artifactId,
          fromVersion: source.id,
          section: maintenance.id,
          parent: null,
          position: 0,
          title: text('Upkeep'),
          mode: 'latest',
          ...over,
        }),
      );
    expect(await place({ fromVersion: target.id })).toEqual({
      answer: 'source.moved',
      current: source.id,
    });
    expect(await place({ section: nodeId() })).toEqual({ answer: 'source.missing' });

    const hidden = await component(restricted, 'Hidden step', 'Secret.');
    const mixed = section('Mixed', [reference(hidden.artifactId)]);
    const other = await document(shared, 'Mixed manual', [mixed]);
    const report = await as((trx) =>
      previewPlacement(trx, { by: ada, from: other.artifactId, section: mixed.id }),
    );
    expect(report).toMatchObject({
      answer: 'report',
      report: { occurrences: 1, components: [], unreadable: 1 },
    });
    expect(
      await place({ from: other.artifactId, fromVersion: other.id, section: mixed.id }),
    ).toMatchObject({ answer: 'outline.invalid' });
    // And a source in a space the author may not read is not there at all.
    const unseen = await document(restricted, 'Unseen manual', [
      section('Hidden', [reference(hidden.artifactId)]),
    ]);
    expect(
      await as((trx) =>
        previewPlacement(trx, { by: ada, from: unseen.artifactId, section: maintenance.id }),
      ),
    ).toEqual({ answer: 'missing' });
  });
});
