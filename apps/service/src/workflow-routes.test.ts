import { randomUUID } from 'node:crypto';
import type {
  ComponentList,
  ComponentView,
  DocumentList,
  DocumentView,
  SearchAnswerView,
  ApprovalsView,
  TransitionAnswer,
  WorkflowDefinitionView,
  WorkflowsView,
} from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { SEED_DOCUMENT_WORKFLOW, SEED_WORKFLOW, SEED_WORKFLOW_1 } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const SESSION = '00000000-0000-4000-8000-0000000000aa';

describe('workflow over HTTP (the WF1 plan, Task 1)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who] ?? '' },
      ...(payload ? { payload } : {}),
    });

  const made = async (kind: 'components' | 'documents', title: string) => {
    const answer = await call('POST', `/v1/spaces/${clinical}/${kind}`, 'ada', {
      title,
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ id: string; version: { id: string } }>();
  };

  const move = (
    kind: 'components' | 'documents',
    id: string,
    who: string,
    body: { transition: string; from: string; reason?: string },
  ) => call('POST', `/v1/${kind}/${id}/transitions`, who, body);

  const approve = (
    kind: 'components' | 'documents',
    id: string,
    who: string,
    body: { transition: string; version: string; decision: string; reason?: string },
  ) => call('POST', `/v1/${kind}/${id}/approvals`, who, body);

  const component = (id: string, who: string) =>
    call('GET', `/v1/components/${id}`, who).then((answer) => answer.json<ComponentView>());

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const who of ['ada', 'grace', 'ivy']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    // Ada authors Clinical and administers the environment; Grace approves in it; Ivy reads it.
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      for (const [who, name] of [
        ['ada', 'Author'],
        ['grace', 'Approver'],
        ['ivy', 'Reader'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it("LIF-001 LIF-002 lists each kind's seeded workflow to an administrator, and nobody else", async () => {
    const listed = await call('GET', '/v1/workflows', 'ada');
    expect(listed.statusCode, listed.body).toBe(200);
    const { workflows } = listed.json<WorkflowsView>();
    expect(workflows.map((each) => [each.definition.kind, each.definition.version])).toEqual([
      ['component', 2],
      ['document', 3],
    ]);
    expect(workflows[0]!.definition).toMatchObject({ body: SEED_WORKFLOW, by: null });
    expect(workflows[1]!.definition).toMatchObject({ body: SEED_DOCUMENT_WORKFLOW, by: null });
    expect((await call('GET', '/v1/workflows', 'grace')).statusCode).toBe(403);
  });

  it('LIF-001 LIF-054 saves a definition as a new version, refuses one that does not validate by name, and keeps every version', async () => {
    const invalid = await call('POST', '/v1/workflows', 'ada', {
      kind: 'document',
      states: [{ key: 'draft', name: 'Draft' }],
      transitions: [],
    });
    expect(invalid.statusCode).toBe(400);
    const behind = await call('POST', '/v1/workflows', 'ada', {
      kind: 'document',
      basedOn: 999,
      ...SEED_WORKFLOW,
    });
    expect(behind.statusCode).toBe(409);
    expect(behind.json()).toMatchObject({ code: 'workflow_behind' });
    expect(invalid.json()).toMatchObject({
      code: 'workflow_invalid',
      problems: [{ rule: 'initial_not_one', path: 'states' }],
    });
    const renamed = {
      ...SEED_WORKFLOW,
      states: SEED_WORKFLOW.states.map((each) =>
        each.key === 'in_review' ? { ...each, name: 'With reviewers' } : each,
      ),
    };
    const saved = await call('POST', '/v1/workflows', 'ada', { kind: 'document', ...renamed });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<WorkflowDefinitionView>()).toMatchObject({
      kind: 'document',
      version: 4,
      by: { id: ids.ada },
    });
    const first = await call('GET', '/v1/workflows/document/versions/1', 'ada');
    expect(first.json<WorkflowDefinitionView>()).toMatchObject({
      version: 1,
      body: SEED_WORKFLOW_1,
    });
    expect((await call('GET', '/v1/workflows/document/versions/9', 'ada')).statusCode).toBe(404);
    expect(
      (await call('POST', '/v1/workflows', 'grace', { kind: 'document', ...renamed })).statusCode,
    ).toBe(403);
    // Back to the seed, as version 5.
    expect(
      (await call('POST', '/v1/workflows', 'ada', { kind: 'document', ...SEED_DOCUMENT_WORKFLOW }))
        .statusCode,
    ).toBe(200);
  });

  it('LIF-002 LIF-061 offers, and takes, only the transitions the reader may: submit to whoever edits, the gate to whoever approves, a reason asked for', async () => {
    const created = await made('components', 'Dosing');
    const { id } = created;
    expect(await component(id, 'ada')).toMatchObject({
      state: { key: 'draft', name: 'Draft' },
      transitions: [{ key: 'submit', name: 'Submit', to: { key: 'in_review', name: 'In review' } }],
      gates: [],
      revision: null,
    });
    expect((await component(id, 'grace')).transitions).toEqual([]);
    expect((await component(id, 'ivy')).transitions).toEqual([]);

    const refused = await move('components', id, 'ivy', { transition: 'submit', from: 'draft' });
    expect(refused.statusCode).toBe(403);
    const submitted = await move('components', id, 'ada', { transition: 'submit', from: 'draft' });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const gate = {
      key: 'approve',
      name: 'Approve',
      to: { key: 'approved', name: 'Approved' },
      reject: { name: 'Return', to: { key: 'draft', name: 'Draft' } },
      publication: 'none',
      mayPublish: false,
      count: 0,
      required: 1,
      approvedByCaller: false,
    };
    expect(submitted.json<TransitionAnswer>()).toEqual({
      state: { key: 'in_review', name: 'In review', approved: false },
      transitions: [],
      gates: [{ ...gate, mayDecide: false }],
      revision: null,
    });
    expect((await component(id, 'grace')).gates).toEqual([{ ...gate, mayDecide: true }]);
    const gated = await move('components', id, 'grace', {
      transition: 'approve',
      from: 'in_review',
    });
    expect(gated.statusCode).toBe(409);
    expect(gated.json()).toMatchObject({ code: 'transition_gated' });
    const stale = await move('components', id, 'grace', { transition: 'submit', from: 'draft' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'state_moved',
      state: { key: 'in_review', name: 'In review' },
    });
    expect(
      (
        await approve('components', id, 'grace', {
          transition: 'approve',
          version: created.version.id,
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(200);

    const bare = await move('components', id, 'ada', { transition: 'reopen', from: 'approved' });
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ code: 'reason_required', rule: 'LIF-061' });
    const long = await move('components', id, 'ada', {
      transition: 'reopen',
      from: 'approved',
      reason: 'x'.repeat(2001),
    });
    expect(long.statusCode).toBe(400);
    const reopened = await move('components', id, 'ada', {
      transition: 'reopen',
      from: 'approved',
      reason: 'Name the dose.',
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    const kept = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('workflow_transition')
        .select(['reason', 'by'])
        .where('artifact_id', '=', id)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow(),
    );
    expect(kept).toEqual({ reason: 'Name the dose.', by: ids.ada });
  });

  it('LIF-008 LIF-010 approves at a gate by an approver who is not its author, designating a revision, and lists who decided what', async () => {
    const created = await made('documents', 'Dosing record');
    await move('documents', created.id, 'ada', { transition: 'submit', from: 'draft' });
    const decision = {
      transition: 'approve',
      version: created.version.id,
      decision: 'approved',
    } as const;
    // Ada, its author, may not approve it; grant her Approver to show it is the author rule.
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Approver'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      }),
    );
    const own = await approve('documents', created.id, 'ada', decision);
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ code: 'approval_author', rule: 'LIF-010' });
    expect((await approve('documents', created.id, 'ivy', decision)).statusCode).toBe(403);
    const passed = await approve('documents', created.id, 'grace', decision);
    expect(passed.statusCode, passed.body).toBe(200);
    expect(passed.json<TransitionAnswer>()).toMatchObject({
      state: { key: 'approved', name: 'Approved', approved: true },
      gates: [],
      revision: { number: 1, versionId: created.version.id },
    });
    const listed = await call('GET', `/v1/documents/${created.id}/approvals`, 'ivy');
    expect(listed.statusCode).toBe(200);
    expect(listed.json<ApprovalsView>().approvals).toEqual([
      {
        transition: 'approve',
        decision: 'approved',
        reason: null,
        by: { id: ids.grace, name: expect.any(String) },
        at: expect.any(String),
        versionId: created.version.id,
      },
    ]);
  });

  it('LIF-050 VER-059 approves a document at a gate taking its baseline, and publishes it where the approver asks and may publish', async () => {
    const created = await made('documents', 'Dosing summary');
    await move('documents', created.id, 'ada', { transition: 'submit', from: 'draft' });
    const decision = {
      transition: 'approve',
      version: created.version.id,
      decision: 'approved',
      publish: true,
    } as const;
    // Grace approves and may not publish: asking to is refused, and nothing is approved.
    expect((await approve('documents', created.id, 'grace', decision)).statusCode).toBe(403);
    expect(
      (
        await call('GET', `/v1/documents/${created.id}`, 'grace').then((answer) =>
          answer.json<DocumentView>(),
        )
      ).gates,
    ).toMatchObject([{ key: 'approve', publication: 'permitted', mayPublish: false, count: 0 }]);
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Publisher'))!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      }),
    );
    const passed = await approve('documents', created.id, 'grace', decision);
    expect(passed.statusCode, passed.body).toBe(200);
    const taken = await tenantDb.withTenant(tenant, async (trx) => ({
      baselines: await trx
        .selectFrom('baseline')
        .select(['id', 'name', 'gate'])
        .where('document_id', '=', created.id)
        .execute(),
      requests: await trx
        .selectFrom('publication_request')
        .select(['baseline_id', 'requested_by'])
        .where('document_id', '=', created.id)
        .execute(),
    }));
    expect(taken.baselines).toEqual([
      { id: expect.any(String), name: 'Revision 1', gate: 'approve' },
    ]);
    expect(taken.requests).toEqual([
      { baseline_id: taken.baselines[0]!.id, requested_by: ids.grace },
    ]);
  });

  it('LIF-051 LIF-052 rejects at a gate with a reason, back to its declared state, and refuses a decision on a replaced version', async () => {
    const created = await made('components', 'Dose by weight');
    await move('components', created.id, 'ada', { transition: 'submit', from: 'draft' });
    const stale = await approve('components', created.id, 'grace', {
      transition: 'approve',
      version: randomUUID(),
      decision: 'approved',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_moved' });
    const bare = await approve('components', created.id, 'grace', {
      transition: 'approve',
      version: created.version.id,
      decision: 'rejected',
    });
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ code: 'reason_required' });
    const rejected = await approve('components', created.id, 'grace', {
      transition: 'approve',
      version: created.version.id,
      decision: 'rejected',
      reason: 'Give the weight bands.',
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json<TransitionAnswer>().state.key).toBe('draft');
    const listed = await call('GET', `/v1/components/${created.id}/approvals`, 'ada');
    expect(listed.json<ApprovalsView>().approvals).toMatchObject([
      { decision: 'rejected', reason: 'Give the weight bands.', by: { id: ids.grace } },
    ]);
  });

  it('answers a document at the component route as absent, and refuses moving an archived one', async () => {
    const document = await made('documents', 'Dosing guide');
    expect(
      (await move('components', document.id, 'ada', { transition: 'submit', from: 'draft' }))
        .statusCode,
    ).toBe(404);
    const { id } = await made('components', 'Shelved dose');
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      }),
    );
    expect((await call('POST', `/v1/components/${id}/archive`, 'ada')).statusCode).toBe(200);
    expect((await component(id, 'ada')).transitions).toEqual([]);
    const archived = await move('components', id, 'ada', { transition: 'submit', from: 'draft' });
    expect(archived.statusCode).toBe(409);
    expect(archived.json()).toMatchObject({ code: 'artifact_archived' });
  });

  it('moves an approved component saved in the editor back to draft, audited', async () => {
    const created = await made('components', 'Approved dose');
    await move('components', created.id, 'ada', { transition: 'submit', from: 'draft' });
    await approve('components', created.id, 'grace', {
      transition: 'approve',
      version: created.version.id,
      decision: 'approved',
    });
    const opened = await component(created.id, 'ada');
    // Its view says it is approved, for the editor to say a save starts a draft (WF-F).
    expect(opened.state).toEqual({ key: 'approved', name: 'Approved', approved: true });
    expect(
      (await call('POST', `/v1/components/${created.id}/lock`, 'ada', { session: SESSION }))
        .statusCode,
    ).toBe(200);
    const iteration = await call(
      'PUT',
      `/v1/components/${created.id}/iterations/${SESSION}/1`,
      'ada',
      {
        openedFrom: opened.version.id,
        content: {
          ...opened.content,
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value: 'Take one.', marks: [] }],
            },
          ],
        },
      },
    );
    expect(iteration.statusCode, iteration.body).toBe(200);
    const cut = await call('POST', `/v1/components/${created.id}/versions`, 'ada', {
      session: SESSION,
      openedFrom: opened.version.id,
    });
    expect(cut.statusCode, cut.body).toBe(200);
    expect((await component(created.id, 'ada')).state).toEqual({
      key: 'draft',
      name: 'Draft',
      approved: false,
    });
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('subject', '=', created.id)
        .where('kind', '=', 'workflow.transitioned')
        .orderBy('sequence')
        .execute(),
    );
    expect(events.at(-1)?.detail).toMatchObject({
      transition: null,
      from: 'approved',
      to: 'draft',
      approved: opened.version.id,
    });
  });

  it('shows the state in both lists and on a document, and narrows search by it', async () => {
    const word = `numbat${randomUUID().slice(0, 8)}`;
    const component = await made('components', `${word} card`);
    const document = await made('documents', `${word} guide`);
    await move('documents', document.id, 'ada', { transition: 'submit', from: 'draft' });

    const opened = await call('GET', `/v1/documents/${document.id}`, 'grace');
    expect(opened.json<DocumentView>()).toMatchObject({
      state: { key: 'in_review', name: 'In review' },
      transitions: [],
      gates: [{ key: 'approve', mayDecide: true }],
    });
    const components = (
      await call('GET', `/v1/components?spaces=${clinical}&limit=100`, 'ada')
    ).json<ComponentList>();
    expect(components.items.find((each) => each.id === component.id)?.state).toEqual({
      key: 'draft',
      name: 'Draft',
    });
    const documents = (
      await call('GET', `/v1/documents?spaces=${clinical}&limit=100`, 'ada')
    ).json<DocumentList>();
    expect(documents.items.find((each) => each.id === document.id)?.state).toEqual({
      key: 'in_review',
      name: 'In review',
    });

    const all = (await call('GET', `/v1/search?q=${word}`, 'ada')).json<SearchAnswerView>();
    if (all.outcome !== 'results') throw new Error(all.outcome);
    expect(all.facets.states).toEqual([
      { value: 'draft', label: 'Draft', count: 1, capped: false },
      { value: 'in_review', label: 'In review', count: 1, capped: false },
    ]);
    const narrowed = (
      await call('GET', `/v1/search?q=${word}&state=in_review`, 'ada')
    ).json<SearchAnswerView>();
    if (narrowed.outcome !== 'results') throw new Error(narrowed.outcome);
    expect(narrowed.items.map((each) => [each.artifactId, each.state])).toEqual([
      [document.id, { key: 'in_review', name: 'In review' }],
    ]);
  });
});
