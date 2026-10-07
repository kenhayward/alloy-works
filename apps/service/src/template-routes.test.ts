import {
  bootstrapCluster,
  createArtifact,
  createSpace,
  createTenant,
  createTenantDatabase,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  findRole,
  grant,
  latestVersion,
  migrate,
  recordVersion,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-00000000dead';
const SIGN_OFF = '5c4e0000-0000-4000-8000-00000000519f';
const APPROVER = 'f1e1d000-0000-4000-8000-00000000a99e';
// Development's seeded Review schema and the Reviewer field it groups (dev-content.ts).
const REVIEW_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e3';
const REVIEWER = '0d5e7a11-0000-4000-8000-00000000f1e1';
// And its Sign-off schema, with the Due date field it groups beside Owner.
const SIGN_OFF_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e4';
const DUE = '0d5e7a11-0000-4000-8000-00000000f1e3';

type Json = Record<string, unknown>;

/** What the routes answer for a template, as far as these tests read it. */
interface TemplateBody {
  id: string;
  space: { id: string; name: string };
  version: { id: string; number: string };
  definition: { name: string };
  mayDesign: boolean;
}

const text = (value: string) => [{ type: 'text', value, marks: [] }];
const definition = (name = 'Report', over: Json = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name,
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [],
  outline: {
    sections: [
      {
        key: 'introduction',
        title: text('Introduction'),
        required: true,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      },
    ],
  },
  changes: { add: true, remove: true, reorder: true },
  ...over,
});

describe('templates through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const document = (as: string, template?: string, space = general) =>
    call(as, 'POST', `/v1/spaces/${space}/documents`, {
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      ...(template === undefined ? {} : { template }),
    });
  const call = (as: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[as]! },
      ...(payload ? { payload } : {}),
    });
  const make = (as: string, over: Json = {}, name = 'Report', space = general) =>
    call(as, 'POST', `/v1/spaces/${space}/templates`, { definition: definition(name, over) });
  const version = (
    as: string,
    template: TemplateBody,
    name: string,
    openedFrom = template.version.id,
  ) =>
    call(as, 'POST', `/v1/templates/${template.id}/versions`, {
      openedFrom,
      definition: definition(name),
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
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      // Ada is a Designer on General by the seed, and here on Quality too, where nobody else holds
      // anything. Alice is an Author on General, which gives create and edit and not design.
      quality = (await createSpace(trx, 'Quality')).id;
      const designer = await findRole(trx, 'Designer');
      await grant(trx, {
        roleId: designer!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general },
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

  it('TPL-006 decides a template by design, not by create or edit', async () => {
    // An Author may create and edit documents in General, and may not make a template there.
    const byAuthor = await make('alice');
    expect(byAuthor.statusCode).toBe(403);
    expect(byAuthor.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the design permission.',
    });
    // A Designer may.
    const made = await make('ada');
    expect(made.statusCode, made.body).toBe(200);
    const template = made.json<TemplateBody>();
    expect(template.mayDesign).toBe(true);
    // And changing one is design too: the Author may read it, and not change it.
    const read = await call('alice', 'GET', `/v1/templates/${template.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json<TemplateBody>().mayDesign).toBe(false);
    expect((await version('alice', template, 'Annual report')).statusCode).toBe(403);
    const changed = await version('ada', template, 'Annual report');
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<TemplateBody>()).toMatchObject({
      definition: { name: 'Annual report' },
      version: { number: '0.2' },
    });
  });

  it('IAM-018 decides a template by a grant made on the template itself', async () => {
    const template = (await make('ada', {}, 'Inspection', quality)).json<TemplateBody>();
    // Grace holds nothing on Quality: she may not read the template, let alone change it.
    expect((await call('grace', 'GET', `/v1/templates/${template.id}`)).statusCode).toBe(404);
    const designer = await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Designer'));
    await tenantDb.withTenant(tenant, (trx) =>
      grant(trx, {
        roleId: designer!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'artifact', id: template.id },
        effect: 'allow',
        grantedBy: ids.alice!,
      }),
    );
    // A grant on the one template: she reads it and changes it, and it reaches nothing else of the
    // space - she makes no template there.
    const read = await call('grace', 'GET', `/v1/templates/${template.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json<TemplateBody>().mayDesign).toBe(true);
    expect((await version('grace', template, 'Site inspection')).statusCode).toBe(200);
    expect((await make('grace', {}, 'Another', quality)).statusCode).toBe(404);
  });

  it('refuses a template whose references do not resolve, naming each and the rule', async () => {
    const answer = await make('ada', { layout: MISSING });
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({
      code: 'template_unresolved',
      rule: 'TPL-004',
      unresolved: [{ reference: 'layout', id: MISSING }],
    });
  });

  it('refuses a version made from one that is no longer the latest, naming the latest', async () => {
    const template = (await make('ada', {}, 'Handbook')).json<TemplateBody>();
    const next = (await version('ada', template, 'Staff handbook')).json<TemplateBody>();
    const stale = await version('ada', template, 'Old handbook');
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      rule: 'API-037',
      current: { version: { id: next.version.id, number: '0.2' } },
    });
  });

  it('lists the templates the caller may read, with their names and spaces', async () => {
    await make('ada', {}, 'Minutes', quality);
    const listed = (await call('ada', 'GET', '/v1/templates')).json<{
      items: { name: string; space: { name: string } }[];
    }>();
    expect(listed.items.find((each) => each.name === 'Minutes')?.space.name).toBe('Quality');
    // Alice may read General and not Quality, so she is shown General's templates and not this one.
    const alices = (await call('alice', 'GET', '/v1/templates')).json<{
      items: { name: string; space: { name: string } }[];
    }>();
    expect(alices.items.map((each) => each.name)).not.toContain('Minutes');
    expect(alices.items.every((each) => each.space.name === 'General')).toBe(true);
  });

  it('makes a document from a template the caller may read, and shows which on the document', async () => {
    const template = (await make('ada', {}, 'Protocol')).json<TemplateBody>();
    // Alice may create in General and read its templates, though she may not design one.
    const made = await document('alice', template.id);
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<{
      id: string;
      outline: { nodes: { origin?: string }[] };
      template: unknown;
    }>();
    expect(view.outline.nodes.map((node) => node.origin)).toEqual(['introduction']);
    const shown = {
      id: template.id,
      name: 'Protocol',
      version: { id: template.version.id, number: '0.1' },
    };
    expect(view.template).toEqual(shown);
    const opened = await call('alice', 'GET', `/v1/documents/${view.id}`);
    expect(opened.json<{ template: unknown }>().template).toEqual(shown);
    // A blank document shows none.
    expect((await document('alice')).json<{ template: unknown }>().template).toBeNull();
  });

  it('shows and numbers a document under the layout its template binds', async () => {
    // A second layout, a copy of the environment's under an artifact of its own, row by row because
    // nothing yet makes one.
    const layout = await tenantDb.withTenant(tenant, async (trx) => {
      const original = await latestVersion(trx, DEFAULT_LAYOUT_ID);
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'layout', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          kind: 'layout',
          revision_no: 0,
          version_no: 1,
          author_id: ids.ada!,
          note: null,
          schema_version: original!.schemaVersion,
          content: JSON.stringify(original!.content),
          content_hash: original!.contentHash,
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: original!.versionDigest,
        })
        .execute();
      return artifact.id;
    });
    const template = (await make('ada', { layout }, 'Specification')).json<TemplateBody>();
    const made = (await document('alice', template.id)).json<{
      id: string;
      layout: { id: string };
    }>();
    expect(made.layout.id).toBe(layout);
    const numbering = await call('alice', 'GET', `/v1/documents/${made.id}/numbering`);
    expect(numbering.json<{ layout: { id: string } }>().layout.id).toBe(layout);
    // A blank document is still shown under the environment's.
    expect((await document('alice')).json<{ layout: { id: string } }>().layout.id).toBe(
      DEFAULT_LAYOUT_ID,
    );
  });

  it("refuses a section added where the document's template forbids it, saying why", async () => {
    const template = (
      await make('ada', { changes: { add: false, remove: true, reorder: true } }, 'Fixed form')
    ).json<TemplateBody>();
    const made = (await document('alice', template.id)).json<{
      id: string;
      version: { id: string };
    }>();
    const answer = await call('alice', 'POST', `/v1/documents/${made.id}/outline`, {
      openedFrom: made.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 1,
        node: { type: 'section', title: [{ type: 'text', value: 'Results', marks: [] }] },
      },
    });
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({
      code: 'outline_invalid',
      reason: "This document's template does not allow sections to be added",
    });
  });

  it('shows the fields its template applies to the document and to its sections, and none for a blank one', async () => {
    const template = (
      await make('ada', {
        schemas: [
          { schema: REVIEW_SCHEMA, level: 'document', requires: [REVIEWER] },
          { schema: REVIEW_SCHEMA, level: 'section', requires: [] },
        ],
      })
    ).json<TemplateBody>();
    const view = (await document('alice', template.id)).json<{
      fields: {
        document: { id: string; name: string; required: boolean }[];
        section: { id: string; name: string; required: boolean }[];
      };
      schemas: { id: string; name: string }[];
    }>();
    expect(view.fields).toMatchObject({
      document: [{ id: REVIEWER, name: 'Reviewer', required: true }],
      section: [{ id: REVIEWER, name: 'Reviewer', required: false }],
    });
    expect(view.schemas).toEqual([{ id: REVIEW_SCHEMA, name: 'Review' }]);
    const blank = (await document('alice')).json<{ fields: unknown; schemas: unknown }>();
    expect(blank).toMatchObject({ fields: { document: [], section: [] }, schemas: [] });
  });

  it("writes a document's values and a section's, refusing by name what does not fit", async () => {
    const template = (
      await make('ada', {
        schemas: [
          { schema: REVIEW_SCHEMA, level: 'document', requires: [] },
          { schema: REVIEW_SCHEMA, level: 'section', requires: [] },
        ],
      })
    ).json<TemplateBody>();
    const made = (await document('alice', template.id)).json<{
      id: string;
      version: { id: string };
      outline: { nodes: { id: string }[] };
    }>();
    const values = (openedFrom: string, written: Json) =>
      call('alice', 'PUT', `/v1/documents/${made.id}/values`, { openedFrom, values: written });

    const written = await values(made.version.id, { [REVIEWER]: 'Ada' });
    expect(written.statusCode, written.body).toBe(200);
    const view = written.json<{ version: { id: string; number: string }; values: Json }>();
    expect(view).toMatchObject({ version: { number: '0.2' }, values: { [REVIEWER]: 'Ada' } });
    // From the version before, stale; and a field the document has not, refused by name.
    expect((await values(made.version.id, { [REVIEWER]: 'Grace' })).statusCode).toBe(409);
    const refusedValues = await values(view.version.id, { [MISSING]: 'x' });
    expect(refusedValues.statusCode).toBe(400);
    expect(refusedValues.json()).toMatchObject({
      code: 'values_invalid',
      failures: [{ field: MISSING, rule: 'unknown' }],
    });
    // A section's values go through the outline act's set, refused the same way.
    const section = await call('alice', 'POST', `/v1/documents/${made.id}/outline`, {
      openedFrom: view.version.id,
      operation: { operation: 'set', node: made.outline.nodes[0]!.id, values: { [MISSING]: 'x' } },
    });
    expect(section.statusCode).toBe(400);
    expect(section.json()).toMatchObject({
      code: 'values_invalid',
      failures: [{ field: MISSING, rule: 'unknown' }],
    });
    // An Author may write them, as they may restructure the outline.
    expect((await values(view.version.id, { [REVIEWER]: 'Grace' })).statusCode).toBe(200);
  });

  it('refuses to publish, with the rule, a document missing a required section or a required value', async () => {
    const template = (
      await make(
        'ada',
        {
          schemas: [
            { schema: REVIEW_SCHEMA, level: 'document', requires: [REVIEWER] },
            { schema: REVIEW_SCHEMA, level: 'section', requires: [] },
          ],
          outline: {
            sections: [
              { ...definition().outline.sections[0]!, required: true },
              {
                ...definition().outline.sections[0]!,
                key: 'method',
                required: false,
                title: [{ type: 'text', value: 'Method', marks: [] }],
              },
            ],
          },
        },
        'Audited',
      )
    ).json<TemplateBody>();
    const made = (await document('ada', template.id)).json<{
      id: string;
      version: { id: string };
      outline: { nodes: { id: string }[] };
    }>();
    const publish = (version: string) =>
      call('ada', 'POST', `/v1/documents/${made.id}/publications`, { version, formats: ['pdf'] });

    // The Introduction taken out: refused first for the section, by its title.
    const removed = (
      await call('ada', 'POST', `/v1/documents/${made.id}/outline`, {
        openedFrom: made.version.id,
        operation: { operation: 'remove', node: made.outline.nodes[0]!.id },
      })
    ).json<{ version: { id: string } }>();
    const missing = await publish(removed.version.id);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      code: 'section_required',
      rule: 'TPL-013',
      message: 'This document is missing a section its template requires: Introduction.',
      sections: [{ key: 'introduction', title: 'Introduction' }],
    });

    // A document with every section and no reviewer: refused for the value, by the field's name.
    const whole = (await document('ada', template.id)).json<{
      id: string;
      version: { id: string };
    }>();
    const unfilled = await call('ada', 'POST', `/v1/documents/${whole.id}/publications`, {
      version: whole.version.id,
      formats: ['pdf'],
    });
    expect(unfilled.statusCode).toBe(400);
    expect(unfilled.json()).toMatchObject({
      code: 'metadata_invalid',
      rule: 'TPL-055',
      message: "This document's values do not satisfy its template: Reviewer is required.",
      failures: [{ node: null, field: REVIEWER, rule: 'required' }],
    });
  });

  it('answers a template the caller may not read as not found, and makes nothing', async () => {
    const template = (await make('ada', {}, 'Audit', quality)).json<TemplateBody>();
    const listed = async () =>
      (await call('alice', 'GET', '/v1/documents')).json<{ items: unknown[] }>().items.length;
    const before = await listed();
    for (const id of [template.id, MISSING]) {
      const answer = await document('alice', id);
      expect(answer.statusCode).toBe(404);
      expect(answer.json()).toMatchObject({ code: 'not_found' });
    }
    expect(await listed()).toBe(before);
  });

  // Last, because it versions a schema no other test here assigns.
  it('refuses a document from a template that no longer resolves, naming each and the rule', async () => {
    const identity = (id: string) =>
      ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id }) as const;
    await tenantDb.withTenant(tenant, async (trx) => {
      await createArtifact(trx, {
        author: ids.ada!,
        substance: {
          kind: 'field',
          content: { ...identity(APPROVER), dataType: 'text', multiplicity: 'one', validation: {} },
        },
      });
      await createArtifact(trx, {
        author: ids.ada!,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...identity(SIGN_OFF),
            entries: [{ field: APPROVER, required: false, fixed: false }],
          },
        },
      });
    });
    const template = (
      await make('ada', {
        schemas: [{ schema: SIGN_OFF, level: 'document', requires: [APPROVER] }],
      })
    ).json<TemplateBody>();
    // The schema's next version no longer groups the approver the template requires.
    await tenantDb.withTenant(tenant, async (trx) => {
      const answer = await recordVersion(trx, {
        artifactId: SIGN_OFF,
        openedFrom: (await latestVersion(trx, SIGN_OFF))!.id,
        author: ids.ada!,
        substance: { kind: 'metadataSchema', content: { ...identity(SIGN_OFF), entries: [] } },
      });
      expect(answer.answer).toBe('recorded');
    });
    const answer = await document('alice', template.id);
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({
      code: 'template_unresolved',
      rule: 'TPL-004',
      unresolved: [{ reference: 'requires', id: SIGN_OFF, field: APPROVER }],
    });
  });

  describe("a template's parameters", () => {
    const site = {
      name: 'site',
      type: { base: 'text' },
      required: true,
      list: false,
      permitted: { values: ['Leeds', 'York'] },
      changeable: false,
      feeds: { field: REVIEWER, arguments: true },
    };
    const quarter = {
      name: 'quarter',
      type: { base: 'integer' },
      required: false,
      list: false,
      permitted: { minimum: '1', maximum: '4' },
      changeable: true,
      feeds: { arguments: true },
    };
    const reviewed = { schemas: [{ schema: REVIEW_SCHEMA, level: 'document', requires: [] }] };

    it('TPL-017 declares each name, type, whether required and its permitted values or range, read back from the API', async () => {
      const made = await make('ada', { ...reviewed, parameters: [site, quarter] }, 'Site report');
      expect(made.statusCode, made.body).toBe(200);
      const read = await call('alice', 'GET', `/v1/templates/${made.json<TemplateBody>().id}`);
      expect(read.json<{ definition: { parameters: unknown } }>().definition.parameters).toEqual([
        site,
        quarter,
      ]);
    });

    it('TPL-068 names what each parameter feeds, and refuses one feeding nothing, parameter_unused', async () => {
      const unused = await make('ada', {
        ...reviewed,
        parameters: [site, { ...quarter, feeds: { arguments: false } }],
      });
      expect(unused.statusCode).toBe(400);
      expect(unused.json()).toMatchObject({
        code: 'parameter_unused',
        rule: 'TPL-068',
        parameters: [{ parameter: 'quarter' }],
      });
      // A version cut with one is refused the same way, and nothing is written.
      const template = (
        await make('ada', { ...reviewed, parameters: [site] }, 'Audit')
      ).json<TemplateBody>();
      const next = await call('ada', 'POST', `/v1/templates/${template.id}/versions`, {
        openedFrom: template.version.id,
        definition: definition('Audit', {
          ...reviewed,
          parameters: [{ ...site, feeds: { arguments: false } }],
        }),
      });
      expect(next.json()).toMatchObject({ code: 'parameter_unused' });
      const kept = await call('ada', 'GET', `/v1/templates/${template.id}`);
      expect(kept.json<TemplateBody>().version.number).toBe('0.1');
    });

    it('refuses a seeded field the document level does not hold, or one that cannot take its type, parameter_field', async () => {
      const section = await make('ada', {
        schemas: [{ schema: REVIEW_SCHEMA, level: 'section', requires: [] }],
        parameters: [site],
      });
      expect(section.statusCode).toBe(400);
      expect(section.json()).toMatchObject({
        code: 'parameter_field',
        parameters: [{ parameter: 'site', field: REVIEWER }],
      });
      expect(section.json<{ rule?: string }>().rule).toBeUndefined();
      const typed = await make('ada', {
        schemas: [{ schema: SIGN_OFF_SCHEMA, level: 'document', requires: [] }],
        parameters: [{ ...quarter, feeds: { field: DUE, arguments: false } }],
      });
      expect(typed.json()).toMatchObject({
        code: 'parameter_field',
        parameters: [{ parameter: 'quarter', field: DUE }],
      });
    });

    it('refuses a variation by the shape the contract parses', async () => {
      const answer = await make('ada', {
        parameters: [{ ...site, variation: [{ key: 'a', sql: 'select 1' }] }],
      });
      expect(answer.statusCode).toBe(400);
      expect(answer.json<{ code: string }>().code).not.toBe('parameter_unused');
    });
  });
});
