import {
  bootstrapCluster,
  createTenant,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

type Json = Record<string, unknown>;
interface VocabularyBody {
  id: string;
  version: { id: string; number: string };
  vocabulary: { name: string; key: string; values: { id: string; state: string }[] };
}
interface ImportBody {
  answer: string;
  vocabulary: VocabularyBody;
  kept: string[];
  notRepresented: string[];
  notRepresentedTotal: number;
}

const value = (id: string, label: string, state = 'active') => ({
  id,
  labels: [{ language: 'en', text: label }],
  descriptions: [],
  state,
});
const vocabulary = (name: string, key: string, values: Json[]) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  key,
  base: 'en',
  order: 'declared',
  values,
});

const TURTLE = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <https://example.org/route/> .
ex:scheme a skos:ConceptScheme ; skos:notation "route" ; skos:prefLabel "Route of administration"@en .
ex:oral a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "oral" ;
  skos:prefLabel "Oral"@en , "Orale"@fr ; skos:altLabel "By mouth"@en .
ex:topical a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "topical" ;
  skos:prefLabel "Topical"@en .
ex:other a skos:Concept ; skos:prefLabel "No notation"@en .
`;

describe('vocabularies through the service (the VO plan, VO-A, VO-I)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | null, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as === null ? {} : { cookie: cookies[as]! }) },
      ...(payload ? { payload } : {}),
    });
  const make = async (definition: Json) => {
    const made = await call('grace', 'POST', '/v1/definitions', {
      kind: 'vocabulary',
      definition,
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
  };
  const importing = (as: string, format: string, text: string) =>
    call(as, 'POST', '/v1/vocabularies/import', { format, text });

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
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    // Grace manages definitions; Ada holds roles in General and nothing at the tenant.
    await tenantDb.withTenant(tenant, async (trx) => {
      const manager = await findRole(trx, 'Definitions manager');
      await grant(trx, {
        roleId: manager!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('LIB-065 lets anyone signed in read a vocabulary, though they may not read the definitions', async () => {
    const id = await make(
      vocabulary('Dosage form', 'dosage_form', [
        value('tablet', 'Tablet'),
        value('capsule', 'Capsule'),
      ]),
    );
    // Ada has no read at the tenant: the definitions are refused her, the vocabulary is not.
    expect((await call('ada', 'GET', '/v1/definitions')).statusCode).toBe(403);
    const listed = await call('ada', 'GET', '/v1/vocabularies');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toContainEqual({
      id,
      key: 'dosage_form',
      name: 'Dosage form',
      version: { id: expect.any(String), number: '0.1' },
      values: 2,
    });
    const one = await call('ada', 'GET', `/v1/vocabularies/${id}`);
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json<VocabularyBody>()).toMatchObject({
      id,
      version: { number: '0.1' },
      vocabulary: { key: 'dosage_form', values: [{ id: 'tablet' }, { id: 'capsule' }] },
    });
    // Nobody unsigned; and a definition of another kind is no vocabulary.
    expect((await call(null, 'GET', '/v1/vocabularies')).statusCode).toBe(401);
    const field = await call('grace', 'POST', '/v1/definitions', {
      kind: 'field',
      definition: {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Dose',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
    });
    const fieldId = field.json<{ id: string }>().id;
    expect((await call('ada', 'GET', `/v1/vocabularies/${fieldId}`)).statusCode).toBe(404);
    expect((await call('ada', 'GET', `/v1/vocabularies/${fieldId}/export`)).statusCode).toBe(404);
  });

  it('LIB-061 exports a vocabulary as SKOS that imports back as the same vocabulary', async () => {
    const id = await make(
      vocabulary('Trial arm', 'trial_arm', [
        value('placebo', 'Placebo'),
        value('active', 'Active'),
        { ...value('sham', 'Sham', 'deprecated'), replacedBy: 'placebo' },
        value('crossover', 'Crossover', 'retired'),
      ]),
    );
    const exported = await call('ada', 'GET', `/v1/vocabularies/${id}/export`);
    expect(exported.statusCode, exported.body).toBe(200);
    const { format, text } = exported.json<{ format: string; text: string }>();
    expect(format).toBe('json-ld');
    const back = await importing('grace', 'json-ld', text);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json<ImportBody>()).toMatchObject({
      answer: 'unchanged',
      vocabulary: { id, version: { number: '0.1' } },
      kept: [],
      notRepresented: [],
    });
    const before = (await call('ada', 'GET', `/v1/vocabularies/${id}`)).json<VocabularyBody>();
    expect(back.json<ImportBody>().vocabulary).toEqual(before);
    // Changed in the file, it records the next version of the same vocabulary.
    const changed = await importing('grace', 'json-ld', text.replace('"Active"', '"Active drug"'));
    expect(changed.json<ImportBody>()).toMatchObject({
      answer: 'recorded',
      vocabulary: { id, version: { number: '0.2' } },
    });
  });

  it('IMP-051 imports a concept scheme from Turtle as a vocabulary, never removing a value and reporting what it cannot represent', async () => {
    expect((await importing('ada', 'turtle', TURTLE)).statusCode).toBe(403);
    const made = await importing('grace', 'turtle', TURTLE);
    expect(made.statusCode, made.body).toBe(200);
    const first = made.json<ImportBody>();
    expect(first).toMatchObject({
      answer: 'created',
      vocabulary: {
        version: { number: '0.1' },
        vocabulary: {
          name: 'Route of administration',
          key: 'route',
          base: 'en',
          values: [
            {
              id: 'oral',
              labels: [
                { language: 'en', text: 'Oral' },
                { language: 'fr', text: 'Orale' },
              ],
            },
            { id: 'topical' },
          ],
        },
      },
      kept: [],
      notRepresented: [
        'https://example.org/route/oral: http://www.w3.org/2004/02/skos/core#altLabel, which a value does not hold',
        'https://example.org/route/other: no notation, which a value takes as its id',
      ],
      notRepresentedTotal: 2,
    });
    // A later file without a value keeps it, and says so.
    const fewer = await importing(
      'grace',
      'turtle',
      TURTLE.replace(/ex:topical a[^.]*\.\n/u, '').replace('"Oral"@en', '"Oral route"@en'),
    );
    expect(fewer.statusCode, fewer.body).toBe(200);
    expect(fewer.json<ImportBody>()).toMatchObject({
      answer: 'recorded',
      vocabulary: {
        id: first.vocabulary.id,
        version: { number: '0.2' },
        vocabulary: { values: [{ id: 'oral' }, { id: 'topical', state: 'active' }] },
      },
      kept: ['topical'],
    });
  });

  it('refuses text it cannot read, and a vocabulary /v1/definitions would refuse', async () => {
    expect((await importing('grace', 'turtle', 'not turtle at all')).json()).toMatchObject({
      code: 'import_unreadable',
    });
    expect(
      (
        await importing(
          'grace',
          'turtle',
          '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n<urn:a> a skos:Concept .',
        )
      ).json(),
    ).toMatchObject({ code: 'import_unreadable' });
    await make(vocabulary('Sex', 'sex', [value('female', 'Female')]));
    const taken = await importing(
      'grace',
      'turtle',
      TURTLE.replace('"route"', '"another_sex"').replace('"Route of administration"', '"Sex"'),
    );
    expect(taken.statusCode).toBe(400);
    expect(taken.json()).toMatchObject({ code: 'definition_name_taken' });
  });
});
