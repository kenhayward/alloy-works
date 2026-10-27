import { randomUUID } from 'node:crypto';
import {
  SEED_DOCUMENT_WORKFLOW,
  type OutlineDocument,
  type WorkflowBody,
} from '@alloy-works/domain';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { makeBaseline } from './baselines.js';
import { createDocument, editOutline } from './documents.js';
import { publicationInputs } from './publishing.js';
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
import type { StoredVersion } from './versions.js';
import { defineWorkflow, moveArtifact, newestDefinition, workflowStanding } from './workflow.js';
import { decideGate } from './workflow-gates.js';

/** The document seed with its gate publishing as `publication` says. */
const publishing = (publication: 'none' | 'permitted' | 'required'): WorkflowBody => ({
  ...SEED_DOCUMENT_WORKFLOW,
  transitions: SEED_DOCUMENT_WORKFLOW.transitions.map((each) =>
    each.gate === undefined ? each : { ...each, gate: { ...each.gate, publication } },
  ),
});

describe('a baseline and a publication at a gate (workflow.md; the WF2 plan, Task 2)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';
  let elsewhere = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const document = (title = 'Dosing record') =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const submit = (version: StoredVersion) =>
    as((trx) =>
      moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'document',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      }),
    );

  const approve = (version: StoredVersion, publish = false) =>
    as((trx) =>
      decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'document',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        publish,
        may: () => true,
      }),
    );

  const baselines = (documentId: string) =>
    as((trx) =>
      trx
        .selectFrom('baseline')
        .select(['id', 'name', 'gate', 'document_version_id', 'made_by'])
        .where('document_id', '=', documentId)
        .execute(),
    );

  const requests = (documentId: string) =>
    as((trx) =>
      trx
        .selectFrom('publication_request')
        .select(['baseline_id', 'requested_by', 'formats'])
        .where('document_id', '=', documentId)
        .execute(),
    );

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
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      elsewhere = (await createSpace(trx, `Elsewhere ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      for (const [who, role, where] of [
        [ada, 'Author', space],
        [ada, 'Author', elsewhere],
        [grace, 'Approver', space],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: where },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterEach(() =>
    as((trx) => defineWorkflow(trx, { kind: 'document', body: SEED_DOCUMENT_WORKFLOW, by: ada })),
  );

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("seeds the document workflow's version 3, whose gate takes a baseline its approver may publish", async () => {
    expect(await as((trx) => newestDefinition(trx, 'document'))).toMatchObject({
      version: 3,
      body: SEED_DOCUMENT_WORKFLOW,
    });
  });

  it('VER-059 LIF-013 takes a baseline as a document gate passes, named for the revision it designates and naming its gate', async () => {
    const made = await document();
    await submit(made);
    const passed = await approve(made);
    expect(passed).toMatchObject({ answer: 'passed', revision: 1 });
    expect(await baselines(made.artifactId)).toEqual([
      {
        id: expect.any(String),
        name: 'Revision 1',
        gate: 'approve',
        document_version_id: made.id,
        made_by: grace,
      },
    ]);
    expect(await requests(made.artifactId)).toEqual([]);
  });

  it('passes a gate again on an unchanged version, reusing the baseline it took, and names a new one past a name taken', async () => {
    const made = await document('Approved twice');
    await submit(made);
    await approve(made);
    await as((trx) =>
      moveArtifact(trx, {
        artifactId: made.artifactId,
        kind: 'document',
        transition: 'reopen',
        from: 'approved',
        reason: 'One more look.',
        by: ada,
        may: () => true,
      }),
    );
    await submit(made);
    expect(await approve(made)).toMatchObject({ answer: 'passed', revision: 1 });
    expect((await baselines(made.artifactId)).map((each) => each.name)).toEqual(['Revision 1']);

    // A person's baseline holding the name the gate would give: the gate's takes the next.
    const other = await document('Named first');
    await as((trx) =>
      makeBaseline(trx, {
        documentId: other.artifactId,
        version: other.id,
        name: 'Revision 1',
        maker: ada,
      }),
    );
    await submit(other);
    expect(await approve(other)).toMatchObject({ answer: 'passed' });
    expect(
      (await baselines(other.artifactId)).map((each) => [each.name, each.gate]).sort(),
    ).toEqual([
      ['Revision 1 (2)', 'approve'],
      ['Revision 1', null],
    ]);
  });

  it('PUB-089 lists for the approval page the approvals of the round that passed alone, each by its display name', async () => {
    await as((trx) =>
      defineWorkflow(trx, {
        kind: 'document',
        body: {
          ...publishing('required'),
          transitions: publishing('required').transitions.map((each) =>
            each.gate === undefined
              ? each
              : { ...each, gate: { ...each.gate, approvals: 2, notAuthor: false } },
          ),
        },
        by: ada,
      }),
    );
    const made = await document('Two rounds');
    const decide = (by: string, decision: 'approved' | 'rejected') =>
      as((trx) =>
        decideGate(trx, {
          artifactId: made.artifactId,
          kind: 'document',
          transition: 'approve',
          version: made.id,
          decision,
          ...(decision === 'rejected' ? { reason: 'Not yet.' } : {}),
          by,
          may: () => true,
        }),
      );
    await submit(made);
    await decide(grace, 'approved');
    await decide(ada, 'rejected');
    await submit(made);
    await decide(ada, 'approved');
    expect(await decide(grace, 'approved')).toMatchObject({ answer: 'passed' });
    const [request] = await as((trx) =>
      trx
        .selectFrom('publication_request')
        .select('id')
        .where('document_id', '=', made.artifactId)
        .execute(),
    );
    const inputs = await as((trx) => publicationInputs(trx, request!.id));
    expect(inputs?.approved?.approvals.map((each) => each.by)).toEqual(['Ada', 'Grace']);
  });

  it('refuses the approval that would pass a gate whose baseline cannot be made, recording nothing', async () => {
    const hidden = await as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: elsewhere,
        title: 'Withheld dose',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    const made = await document('Dosing with a withheld part');
    const placed = await as(async (trx) => {
      const edited = await editOutline(trx, {
        artifactId: made.artifactId,
        openedFrom: made.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: hidden.artifactId, mode: { kind: 'latest' } },
        },
      });
      if (edited.answer !== 'recorded') throw new Error(edited.answer);
      return edited.version;
    });
    expect((placed.content as OutlineDocument).nodes).toHaveLength(1);
    await submit(placed);
    expect(await approve(placed)).toMatchObject({ answer: 'baseline.refused' });
    expect(await baselines(made.artifactId)).toEqual([]);
    const standing = await as((trx) => workflowStanding(trx, made.artifactId));
    expect(standing).toMatchObject({ state: { key: 'in_review' }, revision: null });
    expect(standing?.gates).toMatchObject([{ count: 0 }]);
  });

  it('LIF-050 requests a publication from the baseline as a gate requiring one passes, and where one permits it on asking alone', async () => {
    await as((trx) =>
      defineWorkflow(trx, { kind: 'document', body: publishing('required'), by: ada }),
    );
    const required = await document('Required');
    await submit(required);
    await approve(required);
    const [baseline] = await baselines(required.artifactId);
    // The paged formats its layout makes, never HTML, which the default's 0.13 makes too (HT-G): a
    // page reference stores no form without pages by default, so a gate's publication would fail
    // for a format nobody chose.
    expect(await requests(required.artifactId)).toEqual([
      { baseline_id: baseline!.id, requested_by: grace, formats: ['pdf', 'docx'] },
    ]);

    await as((trx) =>
      defineWorkflow(trx, { kind: 'document', body: publishing('permitted'), by: ada }),
    );
    const quiet = await document('Not asked');
    await submit(quiet);
    await approve(quiet);
    expect(await requests(quiet.artifactId)).toEqual([]);
    const asked = await document('Asked');
    await submit(asked);
    await approve(asked, true);
    expect(await requests(asked.artifactId)).toHaveLength(1);
  });
});
