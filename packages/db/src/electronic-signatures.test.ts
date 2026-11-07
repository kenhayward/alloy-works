import { randomUUID } from 'node:crypto';
import { SEED_DOCUMENT_WORKFLOW, type WorkflowBody } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { defineWorkflow, moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

/** The document seed, its gate signed under `roles`. */
const signed = (roles: readonly string[]): WorkflowBody => ({
  ...SEED_DOCUMENT_WORKFLOW,
  transitions: SEED_DOCUMENT_WORKFLOW.transitions.map((each) =>
    each.gate === undefined
      ? each
      : {
          ...each,
          gate: {
            ...each.gate,
            approvals: roles.length,
            signature: {
              meaning: { approve: 'I approve this document.', disapprove: 'I do not approve it.' },
              roles: [...roles],
            },
          },
        },
  ),
});

describe('electronic signatures, declared and kept (the ES plan, ESa)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

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
      for (const [name, permissions] of [
        ['Quality', ['read', 'approve']],
        ['Technical', ['read', 'comment', 'approve']],
        ['Approving alone', ['approve']],
        ['Commenting', ['read', 'comment']],
      ] as const) {
        const made = await createRole(trx, name, permissions);
        if (!('role' in made)) throw new Error(JSON.stringify(made));
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('saves a signed gate naming roles that may approve, keeping its meanings verbatim', async () => {
    const answer = await as((trx) =>
      defineWorkflow(trx, { kind: 'document', body: signed(['Technical', 'Quality']), by: ada }),
    );
    expect(answer.answer).toBe('defined');
    if (answer.answer !== 'defined') return;
    expect(answer.definition.body.transitions[1]!.gate!.signature).toEqual({
      meaning: { approve: 'I approve this document.', disapprove: 'I do not approve it.' },
      roles: ['Technical', 'Quality'],
    });
  });

  it('refuses a signed gate naming a role that does not exist, or one that does not hold approve and read, by name', async () => {
    const answer = await as((trx) =>
      defineWorkflow(trx, {
        kind: 'document',
        body: signed(['Quality', 'Nobody', 'Approving alone', 'Commenting']),
        by: ada,
      }),
    );
    expect(answer).toEqual({
      answer: 'invalid',
      problems: [
        {
          rule: 'signature_role_unknown',
          path: 'transitions.1.gate.signature.roles.1',
          message: 'No role is named Nobody',
        },
        {
          rule: 'signature_role_holds',
          path: 'transitions.1.gate.signature.roles.2',
          message:
            'The role Approving alone does not hold approve and read, so nobody could sign under it',
        },
        {
          rule: 'signature_role_holds',
          path: 'transitions.1.gate.signature.roles.3',
          message:
            'The role Commenting does not hold approve and read, so nobody could sign under it',
        },
      ],
    });
  });

  it('refuses an approval or a rejection at a signed gate made without a signature, recording nothing', async () => {
    await as((trx) =>
      defineWorkflow(trx, { kind: 'document', body: signed(['Quality']), by: ada }),
    );
    try {
      const made = await as(async (trx) => {
        const created = await createDocument(trx, {
          spaceId: space,
          title: 'Signed record',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (created.answer !== 'created') throw new Error(created.answer);
        await moveArtifact(trx, {
          artifactId: created.version.artifactId,
          kind: 'document',
          transition: 'submit',
          from: 'draft',
          by: ada,
          may: () => true,
        });
        return created.version;
      });
      for (const decision of ['approved', 'rejected'] as const) {
        const answer = await as((trx) =>
          decideGate(trx, {
            artifactId: made.artifactId,
            kind: 'document',
            transition: 'approve',
            version: made.id,
            decision,
            reason: 'Not yet.',
            by: grace,
            may: () => true,
          }),
        );
        expect(answer).toEqual({ answer: 'signature.required' });
      }
      const recorded = await as((trx) =>
        trx
          .selectFrom('workflow_approval')
          .select('id')
          .where('artifact_id', '=', made.artifactId)
          .execute(),
      );
      expect(recorded).toEqual([]);
    } finally {
      await as((trx) =>
        defineWorkflow(trx, { kind: 'document', body: SEED_DOCUMENT_WORKFLOW, by: ada }),
      );
    }
  });

  describe('the electronic_signature row', () => {
    let row: Record<string, unknown> = {};

    beforeAll(async () => {
      await as((trx) =>
        defineWorkflow(trx, { kind: 'document', body: SEED_DOCUMENT_WORKFLOW, by: ada }),
      );
      const made = await as(async (trx) => {
        const created = await createDocument(trx, {
          spaceId: space,
          title: 'Dosing record',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (created.answer !== 'created') throw new Error(created.answer);
        return created.version;
      });
      await as((trx) =>
        moveArtifact(trx, {
          artifactId: made.artifactId,
          kind: 'document',
          transition: 'submit',
          from: 'draft',
          by: ada,
          may: () => true,
        }),
      );
      const passed = await as((trx) =>
        decideGate(trx, {
          artifactId: made.artifactId,
          kind: 'document',
          transition: 'approve',
          version: made.id,
          decision: 'approved',
          by: grace,
          may: () => true,
        }),
      );
      expect(passed).toMatchObject({ answer: 'passed' });
      row = await as(async (trx) => {
        const approval = await trx
          .selectFrom('workflow_approval')
          .selectAll()
          .where('artifact_id', '=', made.artifactId)
          .executeTakeFirstOrThrow();
        const baseline = await trx
          .selectFrom('baseline')
          .select(['id', 'digest', 'name'])
          .where('document_id', '=', made.artifactId)
          .executeTakeFirstOrThrow();
        return {
          document_id: made.artifactId,
          baseline_id: baseline.id,
          baseline_digest: baseline.digest,
          version_id: made.id,
          approval_id: approval.id,
          round: approval.round,
          definition_id: approval.definition_id,
          transition: 'approve',
          principal_id: grace,
          issuer: 'https://idp.example',
          subject: 'grace-1',
          provider_key: null,
          signer_name: 'Grace',
          signer_address: 'grace@example.com',
          role_name: 'Quality',
          title: 'Dosing record',
          baseline_name: baseline.name,
          decision: 'approved',
          meaning: 'I approve this document.',
          reason: null,
          signed_at: new Date('2026-11-07T13:30:00.123Z'),
          offset_minutes: 60,
          signing_attempt: randomUUID(),
          digest: 'd'.repeat(64),
          mac: 'e'.repeat(64),
        };
      });
    });

    const insert = (values: Record<string, unknown>) =>
      as((trx) =>
        trx
          .insertInto('electronic_signature')
          .values(values as never)
          .returning('id')
          .executeTakeFirstOrThrow(),
      );

    it('refuses a baseline digest that is not its baseline’s, and an approval that is another’s', async () => {
      await expect(insert({ ...row, baseline_digest: 'f'.repeat(64) })).rejects.toThrow(
        /baseline digest is not its baseline's/u,
      );
      await expect(insert({ ...row, principal_id: ada })).rejects.toThrow(
        /approval is not this signature's/u,
      );
      await expect(insert({ ...row, decision: 'rejected', reason: 'No.' })).rejects.toThrow(
        /approval is not this signature's/u,
      );
    });

    it('is inserted once for its approval, and never changed or removed', async () => {
      const { id } = await insert(row);
      await expect(insert({ ...row, signing_attempt: randomUUID() })).rejects.toThrow(
        /electronic_signature_approval_id_key/u,
      );
      await expect(
        as((trx) =>
          trx
            .updateTable('electronic_signature')
            .set({ meaning: 'Something else.' } as never)
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toThrow(/permission denied/u);
      await expect(
        as((trx) => trx.deleteFrom('electronic_signature').where('id', '=', id).execute()),
      ).rejects.toThrow(/permission denied/u);
      await expect(as((trx) => sql`truncate electronic_signature`.execute(trx))).rejects.toThrow(
        /permission denied/u,
      );
      const kept = await as((trx) =>
        trx
          .selectFrom('electronic_signature')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow(),
      );
      expect(kept).toMatchObject({ meaning: 'I approve this document.', offset_minutes: 60 });
      expect(kept.signed_at.toISOString()).toBe('2026-11-07T13:30:00.123Z');
    });
  });
});
