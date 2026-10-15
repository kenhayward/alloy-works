import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument, editOutline } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { publicationInputs, requestPublication } from './publishing.js';
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
import { componentUses } from './uses.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

describe('local overrides (the R4 plan, R4-A to R4-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A component at a version holding these two paragraphs, and a preformatted block. */
  const revise = (version: StoredVersion, opening: string, closing = 'Close the valve.') =>
    as(async (trx) => {
      const substance = substanceOf(version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              { type: 'paragraph', id: 'p1', style: 'body', content: [text(opening)] },
              { type: 'paragraph', id: 'p2', style: 'body', content: [text(closing)] },
              { type: 'preformatted', id: 'c1', text: 'drain --all' },
            ] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  /** A component, and a document placing it once. */
  const placed = async () => {
    const made = await as((trx) =>
      createComponent(trx, {
        spaceId: space,
        title: 'Flush the line',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const step = await revise(made.version, 'Open the drain.');
    const node: ReferenceNode = {
      type: 'reference',
      id: blockIdentifierFrom(randomBytes(16)),
      component: step.artifactId,
      mode: { kind: 'latest' },
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    };
    const document = await as(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: space,
        title: 'Pump manual',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const recorded = await recordVersion(trx, {
        artifactId: created.version.artifactId,
        openedFrom: created.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(created.version.content as OutlineDocument), nodes: [node] },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    return { step, node, document };
  };

  const override = (step: StoredVersion, block = 'p1') => ({
    block,
    against: step.id,
    text: [text('Open the north drain.')],
  });

  const set = (document: StoredVersion, node: string, overrides: unknown[]) =>
    as((trx) =>
      editOutline(trx, {
        artifactId: document.artifactId,
        openedFrom: document.id,
        author: ada,
        operation: { operation: 'set', node, overrides } as never,
      }),
    );

  const request = (document: StoredVersion) =>
    as(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: document.artifactId,
        version: document.id,
        formats: ['pdf'],
        requester: ada,
        kind: 'preview',
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      const row = await trx
        .selectFrom('publication_request')
        .select('failures')
        .where('id', '=', asked.request.id)
        .executeTakeFirstOrThrow();
      return { id: asked.request.id, failures: row.failures };
    });

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
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: randomUUID(),
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      space = (await createSpace(trx, 'Shared')).id;
      for (const role of ['Author', 'Publisher']) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: ada },
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

  it('REU-011 REU-012 sets an override on the reference, the component untouched, and publishes it applied', async () => {
    const { step, node, document } = await placed();
    const answer = await set(document, node.id, [override(step)]);
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    expect((answer.version.content as OutlineDocument).nodes[0]).toMatchObject({
      overrides: [override(step)],
    });

    const asked = await request(answer.version);
    expect(asked.failures).toEqual([]);
    const inputs = (await as((trx) => publicationInputs(trx, asked.id)))!;
    const shown = inputs.occurrences.get(node.id)!.content.content;
    expect(shown[0]).toMatchObject({ id: 'p1', content: [text('Open the north drain.')] });
    expect(shown[1]).toMatchObject({ id: 'p2', content: [text('Close the valve.')] });
    // The component itself is as it was.
    expect((step.content as ContentDocument).content[0]).toMatchObject({
      content: [text('Open the drain.')],
    });
  });

  it('REU-015 fails the publish by name where the overridden paragraph has changed since', async () => {
    const { step, node, document } = await placed();
    const answer = await set(document, node.id, [override(step)]);
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    // Another paragraph changing leaves it standing; its own changing does not.
    await revise(step, 'Open both drains.');

    const asked = await request(answer.version);
    expect(asked.failures).toEqual([
      { stage: 'resolve', code: 'override_stale', node: node.id, block: 'p1', detail: null },
    ]);
  });

  it('refuses an override of what is not a paragraph of the component as it stood, and clears them all', async () => {
    const { step, node, document } = await placed();
    expect(await set(document, node.id, [override(step, 'c1')])).toMatchObject({
      answer: 'outline.invalid',
    });
    expect(
      await set(document, node.id, [{ ...override(step), against: document.id }]),
    ).toMatchObject({
      answer: 'outline.invalid',
    });
    const answer = await set(document, node.id, [override(step)]);
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    const cleared = await set(answer.version, node.id, []);
    if (cleared.answer !== 'recorded') throw new Error(cleared.answer);
    expect((cleared.version.content as OutlineDocument).nodes[0]).not.toHaveProperty('overrides');
  });

  it('REU-013 marks an overridden reference in where-used', async () => {
    const { step, node, document } = await placed();
    await set(document, node.id, [override(step)]);
    const uses = await as((trx) => componentUses(trx, ada, step.artifactId));
    expect(uses.documents[0]!.references).toEqual([
      { node: node.id, mode: 'latest', version: null, overridden: true },
    ]);
  });
});
