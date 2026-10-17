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
  createDefinition,
  createSpace,
  readVersion,
  recordVersion,
  substanceOf,
  createTenant,
  findRole,
  grant,
  migrate,
  startThread,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  DEFINITION_SCHEMA_VERSION,
  SEED_DOCUMENT_WORKFLOW,
  SEED_WORKFLOW,
  SEED_WORKFLOW_1,
} from '@alloy-works/domain';
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
      ['queryDefinition', 1],
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

  it('LIF-042 LIF-043 LIF-047 sets the scope a next revision is effective for on edit, refuses an undeclared value or a party who may not read it, shows it and what waits on acceptance in the view, and answers what was effective where and when', async () => {
    await tenantDb.withTenant(tenant, async (trx) => {
      const axis = await createDefinition(trx, {
        kind: 'conditionAxis',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Market',
          key: 'market',
          values: ['us', 'eu'].map((key) => ({ key, label: key.toUpperCase() })),
        },
        author: ids.ada!,
      });
      if (axis.answer !== 'created') throw new Error(axis.answer);
    });
    const created = await made('components', 'Scoped dose');
    const scope = (who: string, body: object) =>
      call('PUT', `/v1/components/${created.id}/scope`, who, body);
    const set = await scope('ada', {
      scope: [{ axis: 'market', value: 'us', party: { kind: 'principal', id: ids.grace } }],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({
      scope: [
        {
          axis: 'market',
          value: 'us',
          party: { kind: 'principal', id: ids.grace, name: expect.any(String) },
        },
      ],
      pending: [],
    });
    expect((await scope('ivy', { scope: [] })).statusCode).toBe(403);
    const unknown = await scope('ada', {
      scope: [{ axis: 'market', value: 'mars', party: null }],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: 'scope_unknown' });
    const stranger = await scope('ada', {
      scope: [
        {
          axis: 'market',
          value: 'eu',
          party: { kind: 'principal', id: '00000000-0000-4000-8000-000000000001' },
        },
      ],
    });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json()).toMatchObject({ code: 'party_invalid' });
    expect((await component(created.id, 'ivy')).scope).toEqual(set.json());

    // Approved, the revision waits on Grace in the US market; Ivy may not accept for her.
    expect(
      (await move('components', created.id, 'ada', { transition: 'submit', from: 'draft' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await approve('components', created.id, 'grace', {
          transition: 'approve',
          version: created.version.id,
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(200);
    const accept = (who: string, value: string) =>
      call('POST', `/v1/components/${created.id}/acceptance`, who, {
        revision: 1,
        axis: 'market',
        value,
      });
    // Pending in the US, said to every reader, and offered to Grace alone to accept.
    const pending = {
      revision: 1,
      axis: 'market',
      value: 'us',
      party: { kind: 'principal', id: ids.grace, name: expect.any(String) },
    };
    expect((await component(created.id, 'ivy')).scope.pending).toEqual([
      { ...pending, mayAccept: false },
    ]);
    expect((await component(created.id, 'grace')).scope.pending).toEqual([
      { ...pending, mayAccept: true },
    ]);
    const notTheParty = await accept('ivy', 'us');
    expect(notTheParty.statusCode).toBe(403);
    expect(notTheParty.json()).toMatchObject({ code: 'acceptance_not_party' });
    expect((await accept('grace', 'eu')).statusCode).toBe(404);
    const accepted = await accept('grace', 'us');
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ revision: 1, axis: 'market', value: 'us', accepted: true });
    expect((await component(created.id, 'grace')).scope.pending).toEqual([]);

    // What was effective, asked by any reader: in the US, revision 1 scoped there; elsewhere, none.
    const effective = (query: string) =>
      call('GET', `/v1/components/${created.id}/effective${query}`, 'ivy');
    const inUs = await effective('?scope=market:us');
    expect(inUs.statusCode, inUs.body).toBe(200);
    expect(inUs.json()).toMatchObject({
      scope: { axis: 'market', value: 'us' },
      revision: { number: 1, version: created.version.id },
      why: 'scoped',
    });
    expect((await effective('?scope=market:eu')).json()).toMatchObject({
      revision: null,
      why: 'none',
    });
    expect((await effective('?scope=market:us&at=2000-01-01T00:00:00Z')).json()).toMatchObject({
      revision: null,
      why: 'none',
    });
    expect((await effective('?scope=Market')).statusCode).toBe(400);
  });

  it('LIF-044 begins a divergent line from a designated revision, by whoever may edit, each name once, and opens and moves it apart, saying which line is read', async () => {
    const created = await made('components', 'Diverging dose');
    expect(
      (await move('components', created.id, 'ada', { transition: 'submit', from: 'draft' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await approve('components', created.id, 'grace', {
          transition: 'approve',
          version: created.version.id,
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(200);
    const diverge = (who: string, body: object) =>
      call('POST', `/v1/components/${created.id}/lines`, who, body);
    const begun = await diverge('ada', { revision: 1, name: 'US' });
    expect(begun.statusCode, begun.body).toBe(200);
    expect(begun.json()).toEqual({
      id: expect.any(String),
      name: 'US',
      divergedFrom: { revision: 1, version: created.version.id },
      at: expect.any(String),
      closed: false,
    });
    expect((await diverge('ada', { revision: 1, name: 'us' })).json()).toMatchObject({
      code: 'line_name_taken',
    });
    expect((await diverge('ada', { revision: 9, name: 'EU' })).statusCode).toBe(404);
    expect((await diverge('ivy', { revision: 1, name: 'EU' })).statusCode).toBe(403);
    // Any reader sees its lines, what each diverged from and when.
    const listed = await call('GET', `/v1/components/${created.id}/lines`, 'ivy');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual({ lines: [begun.json()] });

    // Opened on its line, the view says which line it is on and its own state, and names every line.
    const lineId = begun.json<{ id: string }>().id;
    const onLine = await call('GET', `/v1/components/${created.id}?line=${lineId}`, 'ivy');
    expect(onLine.statusCode, onLine.body).toBe(200);
    expect(onLine.json()).toMatchObject({
      line: { id: lineId, name: 'US' },
      lines: [begun.json()],
      version: { id: created.version.id },
      state: { key: 'draft' },
    });
    expect((await component(created.id, 'ivy')) as unknown).toMatchObject({
      line: null,
      state: { key: 'approved' },
    });
    expect(
      (await call('GET', `/v1/components/${created.id}?line=${created.version.id}`, 'ivy'))
        .statusCode,
    ).toBe(404);
    // Its moves are its own.
    const submitted = await move('components', created.id, 'ada', {
      transition: 'submit',
      from: 'draft',
      line: lineId,
    } as never);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect((await component(created.id, 'ivy')).state.key).toBe('approved');

    // Given its own version, effective in the US, and approved there, a document read in the US says so.
    const usVersion = await tenantDb.withTenant(tenant, async (trx) => {
      const base = (await readVersion(trx, created.version.id))!;
      const recorded = await recordVersion(trx, {
        artifactId: created.id,
        openedFrom: created.version.id,
        author: ids.ada!,
        line: lineId,
        substance: substanceOf(base),
      });
      // Content unchanged: a line's first version differs by its line alone, so record a word.
      if (recorded.answer === 'recorded') return recorded.version.id;
      const substance = substanceOf(base);
      if (substance.kind !== 'component') throw new Error('not a component');
      const changed = await recordVersion(trx, {
        artifactId: created.id,
        openedFrom: created.version.id,
        author: ids.ada!,
        line: lineId,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: 'US wording', marks: [] }],
              },
            ],
          },
        },
      });
      if (changed.answer !== 'recorded') throw new Error(changed.answer);
      return changed.version.id;
    });
    expect(
      (
        await call('PUT', `/v1/components/${created.id}/scope`, 'ada', {
          scope: [{ axis: 'market', value: 'us', party: null }],
          line: lineId,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await approve('components', created.id, 'grace', {
          transition: 'approve',
          version: usVersion,
          decision: 'approved',
          line: lineId,
        } as never)
      ).statusCode,
    ).toBe(200);
    const document = await made('documents', 'Diverged in the US');
    const placed = await call('POST', `/v1/documents/${document.id}/outline`, 'ada', {
      openedFrom: document.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: created.id, mode: { kind: 'approved' } },
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const profiled = await call('PUT', `/v1/documents/${document.id}/profile`, 'ada', {
      openedFrom: placed.json<{ version: { id: string } }>().version.id,
      profile: { values: { market: ['us'] } },
    });
    expect(profiled.statusCode, profiled.body).toBe(200);
    const texts = (await call('GET', `/v1/documents/${document.id}/texts`, 'ivy')).json<{
      occurrences: { version: string; line?: { name: string } }[];
      versions: { id: string; number: string }[];
    }>();
    expect(texts.occurrences[0]).toMatchObject({
      version: usVersion,
      line: { id: lineId, name: 'US' },
    });
    expect(texts.versions.find((each) => each.id === usVersion)?.number).toBe('US 2.1');
  });

  it('LIF-015 LIF-016 LIF-018 sets dates on edit, refuses an owner who may not read it, and shows past review in the view, the list and every document placing it', async () => {
    const created = await made('components', 'Dated dose');
    const dates = (who: string, body: object) =>
      call('PUT', `/v1/components/${created.id}/dates`, who, body);
    const set = await dates('ada', {
      effectiveAt: '2030-01-01T09:00:00+01:00',
      reviewBy: '2020-01-01',
      owner: ids.grace,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({
      effectiveAt: '2030-01-01T09:00:00.000+01:00',
      reviewBy: '2020-01-01',
      owner: { id: ids.grace, name: expect.any(String) },
      pastReview: true,
      effectiveFrom: null,
    });
    // A reader may not set them; an owner is somebody who may read it.
    expect(
      (await dates('ivy', { effectiveAt: null, reviewBy: null, owner: null })).statusCode,
    ).toBe(403);
    const stranger = await dates('ada', {
      effectiveAt: null,
      reviewBy: null,
      owner: '00000000-0000-4000-8000-000000000001',
    });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json()).toMatchObject({ code: 'owner_invalid' });

    expect((await component(created.id, 'ivy')).dates).toMatchObject({
      reviewBy: '2020-01-01',
      pastReview: true,
    });
    const listed = (await call('GET', '/v1/components', 'ivy')).json<ComponentList>();
    expect(listed.items.find((each) => each.id === created.id)?.pastReview).toBe(true);

    const document = await made('documents', 'Placing the dose');
    const placed = await call('POST', `/v1/documents/${document.id}/outline`, 'ada', {
      openedFrom: document.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: created.id, mode: { kind: 'latest' } },
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const texts = (await call('GET', `/v1/documents/${document.id}/texts`, 'ivy')).json<{
      occurrences: { pastReview?: boolean }[];
    }>();
    expect(texts.occurrences[0]?.pastReview).toBe(true);
  });

  it('LIF-004 saves a transition requiring conditions, refuses one its kind cannot, and refuses taking it while one is unmet, saying what', async () => {
    const requiring = (requires: string[]) => ({
      kind: 'component',
      ...SEED_WORKFLOW,
      transitions: SEED_WORKFLOW.transitions.map((each) =>
        each.key === 'submit' ? { ...each, requires } : each,
      ),
    });
    const wrong = await call('POST', '/v1/workflows', 'ada', requiring(['sections']));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({
      problems: [{ rule: 'condition_kind', path: 'transitions.0.requires.0' }],
    });
    const saved = await call('POST', '/v1/workflows', 'ada', requiring(['threads']));
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      saved.json<WorkflowDefinitionView>().body.transitions.find((each) => each.key === 'submit'),
    ).toMatchObject({ requires: ['threads'] });
    try {
      const created = await made('components', 'Threaded dose');
      const thread = await tenantDb.withTenant(tenant, (trx) =>
        startThread(trx, {
          on: created.id,
          version: created.version.id,
          anchor: { kind: 'component' },
          parts: [{ text: 'Which tray?' }],
          author: ids.grace!,
        }),
      );
      expect(thread.answer).toBe('done');
      const held = await move('components', created.id, 'ada', {
        transition: 'submit',
        from: 'draft',
      });
      expect(held.statusCode).toBe(409);
      expect(held.json()).toMatchObject({
        code: 'conditions_unmet',
        rule: 'LIF-004',
        message: 'Not yet: 1 open thread.',
        unmet: [{ condition: 'threads', count: 1, names: [], unreadable: 0 }],
      });
    } finally {
      await call('POST', '/v1/workflows', 'ada', { kind: 'component', ...SEED_WORKFLOW });
    }
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
