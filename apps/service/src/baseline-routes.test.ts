import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  recordVersion,
  substanceOf,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { ContentDocument, OutlineDocument, OutlineNode } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const NODE = 'q'.repeat(26);

describe('baselines over HTTP (baselines.md)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });

  /** A document in Clinical, by Ada, at a second version holding these nodes, or at 0.1 holding none. */
  const documentWith = (nodes: OutlineNode[] = []) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: `Report ${Math.random()}`,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (nodes.length === 0) return made.version;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.ada!,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const make = (document: { artifactId: string; id: string }, name: string, who = 'ada') =>
    call('POST', `/v1/documents/${document.artifactId}/baselines`, who, {
      version: document.id,
      name,
    });

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
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const role = async (name: string) => (await findRole(trx, name))!.id;
      // Ada authors and publishes Clinical; Grace reads it, and authors Quality, which Ada may not read.
      for (const [who, name, space] of [
        ['ada', 'Author', clinical],
        ['ada', 'Publisher', clinical],
        ['grace', 'Reader', clinical],
        ['grace', 'Author', quality],
        // Ivy reads both and publishes Clinical: a baseline a reader of only one is shown part of.
        ['ivy', 'Publisher', clinical],
        ['ivy', 'Reader', quality],
      ] as const) {
        await grant(trx, {
          roleId: await role(name),
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('VER-017 makes a baseline by an explicit call, lists it, and reads what it pins', async () => {
    const document = await documentWith();
    const made = await make(document, 'As approved');
    expect(made.statusCode, made.body).toBe(200);
    const baseline = made.json<{ id: string; digest: string }>();
    expect(made.json()).toMatchObject({
      document: document.artifactId,
      name: 'As approved',
      madeBy: { id: ids.ada, name: 'Ada' },
      superseded: null,
    });

    const listed = await call('GET', `/v1/documents/${document.artifactId}/baselines`, 'grace');
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ baselines: { id: string }[] }>().baselines.map((each) => each.id)).toEqual(
      [baseline.id],
    );
    const read = await call('GET', `/v1/baselines/${baseline.id}`, 'grace');
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      id: baseline.id,
      digest: baseline.digest,
      pins: { document: { version: document.id }, occurrences: [], template: null },
      withheld: { nodes: [], assets: 0 },
    });
  });

  it('VER-046 refuses a name taken in the document, whatever its case, and one it cannot store, each in words', async () => {
    const document = await documentWith();
    expect((await make(document, 'Issue 1')).statusCode).toBe(200);
    const taken = await make(document, 'issue 1');
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'name_taken', rule: 'VER-046' });
    const invalid = await make(document, 'Issue 2 ');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'name_invalid',
      message: 'A name has no space before or after it.',
    });
  });

  it('refuses a baseline to whoever may read the document but not publish it, and one of a version not the latest', async () => {
    const document = await documentWith();
    expect((await make(document, 'Grace’s', 'grace')).statusCode).toBe(403);
    const stale = await call('POST', `/v1/documents/${document.artifactId}/baselines`, 'ada', {
      version: '00000000-0000-4000-8000-000000000000',
      name: 'Stale',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_precondition' });
  });

  it('refuses a baseline of a place its maker may not read, by its node alone', async () => {
    const secret = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: quality,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    const document = await documentWith([
      {
        type: 'reference',
        id: NODE,
        component: secret.artifactId,
        mode: { kind: 'latest' },
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        values: {},
        children: [],
      },
    ]);
    const refused = await make(document, 'Partial');
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'baseline_unresolved',
      places: [{ code: 'occurrence_unreadable', node: NODE, block: null, detail: null }],
    });
    expect(refused.body).not.toContain(secret.artifactId);
  });

  it('PUB-046 publishes a baseline, as a request named by the baseline, and refuses whoever may not publish it', async () => {
    const document = await documentWith();
    const baseline = (await make(document, 'To publish')).json<{ id: string }>().id;
    const asked = await call('POST', `/v1/baselines/${baseline}/publications`, 'ada', {
      formats: ['pdf'],
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json()).toMatchObject({ state: 'queued' });
    const row = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication_request')
        .select(['baseline_id', 'document_version_id'])
        .where('id', '=', asked.json<{ id: string }>().id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ baseline_id: baseline, document_version_id: document.id });
    expect(
      (
        await call('POST', `/v1/baselines/${baseline}/publications`, 'grace', {
          formats: ['pdf'],
        })
      ).statusCode,
    ).toBe(403);
    const unsupported = await call('POST', `/v1/baselines/${baseline}/publications`, 'ada', {
      formats: ['epub'],
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: 'format_unsupported' });
  });

  it('STR-047 shows the document as a baseline holds it, after the document has moved on, withholding what the reader may not read', async () => {
    const [open, secret] = await tenantDb.withTenant(tenant, async (trx) => {
      const made = [];
      for (const [space, author, title] of [
        [clinical, ids.ada!, 'Install the printer'],
        [quality, ids.grace!, 'Calibration'],
      ] as const) {
        const component = await createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author,
        });
        if (component.answer !== 'created') throw new Error(component.answer);
        made.push(component.version);
      }
      return made;
    });
    const reference = (id: string, component: string): OutlineNode => ({
      type: 'reference',
      id,
      component,
      mode: { kind: 'latest' },
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    });
    const SHOWN = 's'.repeat(26);
    const document = await documentWith([
      reference(SHOWN, open!.artifactId),
      reference(NODE, secret!.artifactId),
    ]);
    const baseline = (await make(document, 'As approved', 'ivy')).json<{ id: string }>().id;
    // The document moves on: a node removed.
    await tenantDb.withTenant(tenant, (trx) =>
      recordVersion(trx, {
        artifactId: document.artifactId,
        openedFrom: document.id,
        author: ids.ada!,
        substance: {
          kind: 'document',
          content: { ...(document.content as OutlineDocument), nodes: [] },
        },
      }),
    );

    const view = await call('GET', `/v1/baselines/${baseline}/view`, 'ada');
    expect(view.statusCode, view.body).toBe(200);
    const body = view.json<{
      version: { id: string };
      outline: { nodes: { id: string; component: string | null }[] };
      texts: { node: string; title: string; version: { id: string } }[];
    }>();
    expect(body.version.id).toBe(document.id);
    expect(body.outline.nodes.map((node) => [node.id, node.component])).toEqual([
      [SHOWN, open!.artifactId],
      [NODE, null],
    ]);
    expect(body.texts).toEqual([
      expect.objectContaining({
        node: SHOWN,
        title: 'Install the printer',
        version: expect.objectContaining({ id: open!.id }),
      }),
    ]);
    expect(view.body).not.toContain(secret!.artifactId);
  });

  /** A component in a space, at a second version saying `text`. */
  const componentSaying = (space: string, author: string, title: string, text: string) =>
    tenantDb
      .withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version;
      })
      .then((version) => reviseTo(version, author, text));
  const reviseTo = (version: StoredVersion, author: string, text: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content: ContentDocument = {
        ...substance.content,
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: text, marks: [] }],
          },
        ],
      };
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author,
        substance: { ...substance, content },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
  const referenceTo = (id: string, component: string): OutlineNode => ({
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  });
  /** A next version of a document, its outline these nodes. */
  const outlineTo = (document: StoredVersion, author: string, nodes: OutlineNode[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const next = await recordVersion(trx, {
        artifactId: document.artifactId,
        openedFrom: document.id,
        author,
        substance: {
          kind: 'document',
          content: { ...(document.content as OutlineDocument), nodes },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  it('VER-025 CNT-112 compares two versions of a component word by word, and refuses a version of another', async () => {
    const first = await componentSaying(clinical, ids.ada!, 'Printer', 'Set the tray, then wait.');
    const second = await reviseTo(first, ids.ada!, 'Set the new tray, then wait.');
    const answer = await call(
      'GET',
      `/v1/components/${first.artifactId}/comparison?from=${first.id}&to=${second.id}`,
      'grace',
    );
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{
      from: { number: string };
      changes: { change: string; newer?: string; edited?: unknown }[];
    }>();
    expect(body.from.number).toBe(`${first.revision}.${first.version}`);
    expect(body.changes).toEqual([
      expect.objectContaining({
        change: 'matched',
        newer: 'p1',
        edited: { ops: expect.arrayContaining([{ op: 'insert', text: 'new ' }]) },
      }),
    ]);
    const other = await componentSaying(clinical, ids.ada!, 'Other', 'Elsewhere.');
    expect(
      (
        await call(
          'GET',
          `/v1/components/${first.artifactId}/comparison?from=${first.id}&to=${other.id}`,
          'grace',
        )
      ).statusCode,
    ).toBe(404);
  });

  it('VER-024 VER-025 compares a baseline with a later one and with the document now: the outline, and each component whose version differs', async () => {
    const printer = await componentSaying(clinical, ids.ada!, 'Printer', 'Set the tray.');
    const tray = await componentSaying(clinical, ids.ada!, 'Tray', 'Load the tray.');
    const one = await outlineTo(await documentWith(), ids.ada!, [
      referenceTo('a'.repeat(26), printer.artifactId),
    ]);
    const first = (await make(one, 'Issue 1')).json<{ id: string }>().id;
    await reviseTo(printer, ids.ada!, 'Set the tray firmly.');
    const two = await outlineTo(one, ids.ada!, [
      referenceTo('a'.repeat(26), printer.artifactId),
      referenceTo('b'.repeat(26), tray.artifactId),
    ]);
    const second = (await make(two, 'Issue 2')).json<{ id: string }>().id;

    const compared = await call('GET', `/v1/baselines/${first}/comparison?with=${second}`, 'grace');
    expect(compared.statusCode, compared.body).toBe(200);
    const body = compared.json<{
      newer: { baseline: { name: string } };
      structure: { change: string; newer?: string }[];
      components: { node: string; changes: { change: string; edited: unknown }[] }[];
    }>();
    expect(body.newer.baseline.name).toBe('Issue 2');
    expect(body.structure).toContainEqual(
      expect.objectContaining({ change: 'inserted', newer: 'b'.repeat(26) }),
    );
    expect(body.components.map((each) => each.node)).toEqual(['a'.repeat(26)]);
    expect(body.components[0]!.changes[0]).toMatchObject({
      change: 'matched',
      edited: { ops: expect.any(Array) },
    });

    // With the document now: the outline as it is, each reference resolved as the caller reads it.
    const now = await call('GET', `/v1/baselines/${first}/comparison?with=now`, 'grace');
    expect(now.statusCode, now.body).toBe(200);
    expect(now.json<{ newer: { baseline: null; version: { id: string } } }>().newer).toMatchObject({
      baseline: null,
      version: { id: two.id },
    });
    // A baseline of another document is none of this one's.
    const elsewhere = (await make(await documentWith(), 'Elsewhere')).json<{ id: string }>().id;
    expect(
      (await call('GET', `/v1/baselines/${first}/comparison?with=${elsewhere}`, 'grace'))
        .statusCode,
    ).toBe(404);
  });

  it('VER-050 shows a component the reader may not read where it stands in the outline, never whether it changed', async () => {
    const open = await componentSaying(clinical, ids.ivy!, 'Open', 'Shared text.');
    const secret = await componentSaying(quality, ids.grace!, 'Secret', 'Calibrate at five.');
    const nodes = [
      referenceTo('c'.repeat(26), open.artifactId),
      referenceTo('d'.repeat(26), secret.artifactId),
    ];
    const one = await outlineTo(await documentWith(), ids.ada!, nodes);
    const first = (await make(one, 'Before', 'ivy')).json<{ id: string }>().id;
    await reviseTo(secret, ids.grace!, 'Calibrate at seven.');
    const two = await outlineTo(one, ids.ada!, [...nodes].reverse());
    const second = (await make(two, 'After', 'ivy')).json<{ id: string }>().id;

    const compared = await call('GET', `/v1/baselines/${first}/comparison?with=${second}`, 'ada');
    expect(compared.statusCode, compared.body).toBe(200);
    expect(compared.body).not.toContain(secret.artifactId);
    expect(compared.body).not.toContain('Calibrate');
    const body = compared.json<{
      structure: { change: string; newer?: string; edited?: unknown; changed?: string[] }[];
      components: unknown[];
    }>();
    expect(body.components).toEqual([]);
    const withheld = body.structure.find((each) => each.newer === 'd'.repeat(26))!;
    expect(withheld).toMatchObject({ change: 'matched', edited: null, changed: [] });
  });

  it('VER-049 marks a baseline superseded by a later one, keeps it readable, and lists by state', async () => {
    const document = await documentWith();
    const first = (await make(document, 'Issue 1')).json<{ id: string }>().id;
    const second = (await make(document, 'Issue 2')).json<{ id: string }>().id;

    expect(
      (await call('POST', `/v1/baselines/${first}/supersession`, 'grace', { by: second }))
        .statusCode,
    ).toBe(403);
    const backwards = await call('POST', `/v1/baselines/${second}/supersession`, 'ada', {
      by: first,
    });
    expect(backwards.statusCode).toBe(400);
    expect(backwards.json()).toMatchObject({ code: 'superseder_invalid' });
    const done = await call('POST', `/v1/baselines/${first}/supersession`, 'ada', { by: second });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({
      id: first,
      superseded: { by: second, principal: ids.ada },
    });
    const again = await call('POST', `/v1/baselines/${first}/supersession`, 'ada', { by: second });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'superseded_already' });

    const names = async (query: string) =>
      (await call('GET', `/v1/documents/${document.artifactId}/baselines${query}`, 'grace'))
        .json<{ baselines: { name: string }[] }>()
        .baselines.map((each) => each.name);
    expect(await names('')).toEqual(['Issue 2', 'Issue 1']);
    expect(await names('?state=current')).toEqual(['Issue 2']);
    expect(await names('?state=superseded')).toEqual(['Issue 1']);
    expect((await call('GET', `/v1/baselines/${first}`, 'grace')).statusCode).toBe(200);
  });
});
