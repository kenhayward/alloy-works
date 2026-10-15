import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { deleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
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
import { publish } from './testing/every-kind.js';
import { componentUses } from './uses.js';
import { latestVersion, recordVersion, type StoredVersion } from './versions.js';
import { moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (
  component: string,
  mode: ReferenceNode['mode'] = { kind: 'latest' },
): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode,
  ...base,
  children: [],
});

describe('where a component is used (relationships.md; the R1 plan, R1-B and R1-C)', () => {
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

  const allow = async (trx: TenantTransaction, who: string, space: string) => {
    for (const name of ['Author', 'Publisher']) {
      await grant(trx, {
        roleId: (await findRole(trx, name))!.id,
        subject: { principal: who },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: who,
      });
    }
  };

  /** A space Ada and Grace author, and a second only Grace reads. */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const elsewhere = (await createSpace(trx, `Elsewhere ${randomUUID()}`)).id;
      const ada = await person(trx, 'Ada');
      const grace = await person(trx, 'Grace');
      await allow(trx, ada, space);
      await allow(trx, grace, space);
      await allow(trx, grace, elsewhere);
      return { space, elsewhere, ada, grace };
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
      return made.version;
    });

  const document = (space: string, author: string, title: string, nodes: OutlineNode[]) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return nodes.length === 0 ? made.version : outlined(trx, made.version, author, nodes);
    });

  const outlined = async (
    trx: TenantTransaction,
    version: StoredVersion,
    author: string,
    nodes: OutlineNode[],
  ) => {
    const outline: OutlineDocument = { ...(version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const uses = (id: string, by: string) => as((trx) => componentUses(trx, by, id));

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

  it('REU-007 lists each document placing a component, each reference with how it follows it', async () => {
    const { space, ada } = await fresh();
    const step = await component(space, ada, 'Calibrate the pump');
    const floating = reference(step.artifactId);
    const tracking = reference(step.artifactId, { kind: 'approved' });
    const pinned = reference(step.artifactId, { kind: 'pinned', version: step.id });
    const report = await document(space, ada, 'Pump report', [floating, tracking]);
    const manual = await document(space, ada, 'Pump manual', [pinned]);
    await document(space, ada, 'Unrelated', []);

    expect(await uses(step.artifactId, ada)).toEqual({
      documents: [
        {
          id: manual.artifactId,
          title: 'Pump manual',
          state: { key: 'draft', name: 'Draft', approved: false },
          references: [
            { node: pinned.id, mode: 'pinned', version: { id: step.id, number: '0.1' } },
          ],
        },
        {
          id: report.artifactId,
          title: 'Pump report',
          state: { key: 'draft', name: 'Draft', approved: false },
          references: [
            { node: floating.id, mode: 'latest', version: null },
            { node: tracking.id, mode: 'approved', version: null },
          ],
        },
      ],
      unreadableDocuments: false,
      baselines: { named: [], unreadable: false },
      publications: { named: [], unreadable: false },
    });
  });

  it('REU-009 says which documents placing it are approved and which are drafts', async () => {
    const { space, ada, grace } = await fresh();
    const step = await component(space, ada, 'Flush the line');
    const approved = await document(space, ada, 'Approved procedure', [reference(step.artifactId)]);
    await document(space, ada, 'Draft procedure', [reference(step.artifactId)]);
    await as(async (trx) => {
      const submitted = await moveArtifact(trx, {
        artifactId: approved.artifactId,
        kind: 'document',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      if (submitted.answer !== 'moved') throw new Error(submitted.answer);
      const decided = await decideGate(trx, {
        artifactId: approved.artifactId,
        kind: 'document',
        transition: 'approve',
        version: approved.id,
        decision: 'approved',
        by: grace,
        publish: false,
        may: () => true,
      });
      if (decided.answer !== 'passed') throw new Error(decided.answer);
    });

    const { documents } = await uses(step.artifactId, ada);
    expect(documents.map((each) => [each.title, each.state?.approved])).toEqual([
      ['Approved procedure', true],
      ['Draft procedure', false],
    ]);
  });

  it('REU-010 names only the documents the reader may read, and says there are more', async () => {
    const { space, elsewhere, ada, grace } = await fresh();
    const step = await component(space, ada, 'Drain the tank');
    await document(space, ada, 'Seen report', [reference(step.artifactId)]);
    await document(elsewhere, grace, 'Unseen report', [reference(step.artifactId)]);

    const seen = await uses(step.artifactId, ada);
    expect(seen.documents.map((each) => each.title)).toEqual(['Seen report']);
    expect(seen.unreadableDocuments).toBe(true);
    const all = await uses(step.artifactId, grace);
    expect(all.documents.map((each) => each.title)).toEqual(['Seen report', 'Unseen report']);
    expect(all.unreadableDocuments).toBe(false);
  });

  it('lists a document by its latest version alone, and never a deleted one by name', async () => {
    const { space, ada } = await fresh();
    const step = await component(space, ada, 'Purge the air');
    const dropped = await document(space, ada, 'Dropped it', [reference(step.artifactId)]);
    await as((trx) => outlined(trx, dropped, ada, []));
    const gone = await document(space, ada, 'Gone report', [reference(step.artifactId)]);
    await as(async (trx) => {
      await outlined(trx, gone, ada, []);
      const answer = await deleteArtifact(trx, gone.artifactId, ada);
      if (answer?.answer !== 'deleted') throw new Error(answer?.answer);
      // Its latest version placing it again cannot happen once deleted; its earlier did, and is no use.
    });

    expect(await uses(step.artifactId, ada)).toMatchObject({
      documents: [],
      unreadableDocuments: false,
    });
  });

  it('lists the baselines and publications pinning a version of it apart from the live references', async () => {
    const { space, ada } = await fresh();
    const step = await component(space, ada, 'Prime the pump');
    const report = await document(space, ada, 'Primed report', [reference(step.artifactId)]);
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
    const publication = await as((trx) =>
      publish(trx, { document: report, author: ada, role: tenant.role }),
    );
    // Taken out of the latest, it is pinned still and referenced no longer.
    await as(async (trx) => outlined(trx, (await latestVersion(trx, report.artifactId))!, ada, []));

    expect(await uses(step.artifactId, ada)).toEqual({
      documents: [],
      unreadableDocuments: false,
      baselines: {
        named: [{ id: issue, name: 'Issue 1', document: report.artifactId }],
        unreadable: false,
      },
      publications: { named: [{ id: publication, title: 'Primed report' }], unreadable: false },
    });
  });
});
