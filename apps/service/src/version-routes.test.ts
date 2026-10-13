import { randomBytes } from 'node:crypto';
import type {
  ComponentVersionView,
  DocumentVersionView,
  SearchAnswerView,
} from '@alloy-works/api-contract';
import {
  archiveArtifact,
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  deleteArtifact,
  ERASED_NAME,
  erasePerson,
  findRole,
  grant,
  makeBaseline,
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
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

describe('earlier versions read and searched over HTTP (the SV plan, Task 1)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const get = (url: string, who: string) =>
    app.inject({ method: 'GET', url, headers: { host: HOST, cookie: cookies[who]! } });
  const as = <T>(work: Parameters<TenantDatabase['withTenant']>[1]) =>
    tenantDb.withTenant(tenant, work) as Promise<T>;

  /** A component in `space` by `author`, then a version saying each of `texts` in turn. */
  const component = (space: string, author: string, title: string, ...texts: string[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const versions: StoredVersion[] = [made.version];
      for (const text of texts) {
        const substance = substanceOf(versions[versions.length - 1]!);
        if (substance.kind !== 'component') throw new Error('not a component');
        const next = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: versions[versions.length - 1]!.id,
          author,
          substance: {
            ...substance,
            content: {
              ...substance.content,
              content: [
                {
                  type: 'paragraph',
                  id: 'p1',
                  style: 'body',
                  content: [{ type: 'text', value: text, marks: [] }],
                },
              ],
            } as ContentDocument,
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        versions.push(next.version);
      }
      return versions;
    });

  /** A document in Clinical by Grace, then a version placing these components. */
  const document = (title: string, components: string[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const nodes: OutlineNode[] = components.map((component) => ({
        type: 'reference',
        id: blockIdentifierFrom(randomBytes(16)),
        component,
        mode: { kind: 'latest' },
        ...base,
        children: [],
      }));
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.grace!,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return [made.version, next.version] as const;
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
    for (const who of ['ada', 'grace', 'ivy', 'alice']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await get('/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada and Grace author Clinical, Grace Quality too; Ivy reads nothing.
      for (const [who, space] of [
        ['ada', clinical],
        ['grace', clinical],
        ['grace', quality],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
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
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it("SCH-058 SCH-003 finds a word in an earlier version and reads that version's words there, naming the latest", async () => {
    const [, second, third] = await component(
      clinical,
      ids.ada!,
      'Pump checks',
      'Prime the quokka valve',
      'Prime the main valve',
    );
    const latest = (await get('/v1/search?q=quokka', 'ada')).json<SearchAnswerView>();
    expect(latest).toMatchObject({ outcome: 'results', count: 0 });
    const every = (await get('/v1/search?q=quokka&versions=all', 'ada')).json<SearchAnswerView>();
    if (every.outcome !== 'results') throw new Error(every.outcome);
    expect(every.items).toMatchObject([
      {
        artifactId: second!.artifactId,
        place: 'block:p1',
        version: { id: second!.id, number: '0.2', latest: false },
        baseline: null,
      },
    ]);

    const response = await get(
      `/v1/components/${second!.artifactId}/versions/${second!.id}`,
      'ada',
    );
    expect(response.statusCode).toBe(200);
    const view = response.json<ComponentVersionView>();
    expect(view).toMatchObject({
      component: second!.artifactId,
      title: 'Pump checks',
      version: { id: second!.id, number: '0.2', author: { id: ids.ada, name: expect.any(String) } },
      latest: { id: third!.id, number: '0.3' },
      archived: false,
    });
    expect(JSON.stringify(view.content)).toContain('Prime the quokka valve');
  });

  it('refuses every version and a baseline together, and a baseline the caller may not read', async () => {
    const [placed] = [await component(clinical, ids.grace!, 'Labels', 'The numbat label')];
    const [, version] = await document('Label report', [placed![0]!.artifactId]);
    const made = await as<{ answer: string; baseline: string }>((trx) =>
      makeBaseline(trx, {
        documentId: version.artifactId,
        version: version.id,
        name: 'Approved',
        maker: ids.grace!,
      }),
    );
    expect(made.answer).toBe('made');

    const both = await get(`/v1/search?q=numbat&versions=all&baseline=${made.baseline}`, 'ada');
    expect(both.statusCode).toBe(400);
    expect(both.json()).toMatchObject({ code: 'invalid_request' });
    // The latest named with a baseline is the baseline alone.
    expect(
      (await get(`/v1/search?q=numbat&versions=latest&baseline=${made.baseline}`, 'ada'))
        .statusCode,
    ).toBe(200);
    for (const [who, baseline] of [
      ['ivy', made.baseline],
      ['ada', 'not-a-baseline'],
      ['ada', '00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const refused = await get(`/v1/search?q=numbat&baseline=${baseline}`, who);
      expect(refused.statusCode, `${who} ${baseline}`).toBe(404);
      expect(refused.json()).toMatchObject({ code: 'baseline_not_found' });
    }
    const found = (
      await get(`/v1/search?q=numbat&baseline=${made.baseline}`, 'ada')
    ).json<SearchAnswerView>();
    if (found.outcome !== 'results') throw new Error(found.outcome);
    expect(found.items).toMatchObject([
      {
        artifactId: placed![0]!.artifactId,
        baseline: { id: made.baseline, name: 'Approved', document: version.artifactId },
      },
    ]);
  });

  it("reads a document's version, withholding a component the caller may not read", async () => {
    const [shown] = await component(clinical, ids.grace!, 'Shown');
    const [hidden] = await component(quality, ids.grace!, 'Hidden');
    const [first, second] = await document('Withholding', [shown!.artifactId, hidden!.artifactId]);
    const response = await get(`/v1/documents/${second.artifactId}/versions/${second.id}`, 'ada');
    expect(response.statusCode).toBe(200);
    const view = response.json<DocumentVersionView>();
    expect(view).toMatchObject({
      document: second.artifactId,
      title: 'Withholding',
      version: { id: second.id, number: '0.2' },
      latest: { id: second.id, number: '0.2' },
    });
    const nodes = (view.outline as { nodes: { component: string | null }[] }).nodes;
    expect(nodes.map((node) => node.component)).toEqual([shown!.artifactId, null]);
    expect(view.titles.map((each) => each.title)).toEqual(['Shown']);
    // The first version, earlier, names the second as the latest.
    expect(
      (await get(`/v1/documents/${first.artifactId}/versions/${first.id}`, 'ada')).json(),
    ).toMatchObject({ version: { id: first.id }, latest: { id: second.id } });
  });

  it('answers a version not its own, or an artifact the caller may not read, as not found; a deleted one as gone; an archived one as it was', async () => {
    const [first] = await component(clinical, ids.ada!, 'Own');
    const [other] = await component(clinical, ids.ada!, 'Other');
    const [secret] = await component(quality, ids.grace!, 'Secret');
    const [, version] = await document('Read', [other!.artifactId]);
    for (const [url, who] of [
      [`/v1/components/${first!.artifactId}/versions/${other!.id}`, 'ada'],
      [`/v1/components/${secret!.artifactId}/versions/${secret!.id}`, 'ada'],
      [`/v1/components/${first!.artifactId}/versions/${first!.id}`, 'ivy'],
      [`/v1/documents/${version.artifactId}/versions/${version.id}`, 'ivy'],
      [`/v1/documents/${version.artifactId}/versions/${first!.id}`, 'ada'],
      // A component's version through the document route, and the other way round.
      [`/v1/documents/${first!.artifactId}/versions/${first!.id}`, 'ada'],
      [`/v1/components/${version.artifactId}/versions/${version.id}`, 'ada'],
    ] as const) {
      const response = await get(url, who);
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toMatchObject({ code: 'not_found' });
    }
    await as((trx) => archiveArtifact(trx, other!.artifactId, ids.ada!));
    const archived = await get(`/v1/components/${other!.artifactId}/versions/${other!.id}`, 'ada');
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ archived: true });
    await as((trx) => deleteArtifact(trx, first!.artifactId, ids.ada!));
    const gone = await get(`/v1/components/${first!.artifactId}/versions/${first!.id}`, 'ada');
    expect(gone.statusCode).toBe(410);
    expect(gone.json()).toMatchObject({ code: 'artifact_deleted' });
  });

  it("names an erased author by the erased label on a version's page", async () => {
    const [first] = await component(clinical, ids.alice!, 'By Alice');
    await as((trx) => erasePerson(trx, ids.alice!, ids.ada!));
    const view = (
      await get(`/v1/components/${first!.artifactId}/versions/${first!.id}`, 'ada')
    ).json<ComponentVersionView>();
    expect(view.version.author).toEqual({ id: ids.alice, name: ERASED_NAME });
  });
});
