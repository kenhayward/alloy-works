import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const OTHER = 'dev.acme.alloy.test';
const UNKNOWN = '11111111-1111-4111-8111-111111111111';
const NODE = /^[a-z2-7]{26}$/;

type Json = Record<string, unknown>;

/** What the routes answer for a document, as far as these tests read it. */
interface DocumentBody {
  id: string;
  space: { id: string; name: string };
  version: { id: string; number: string; author: string };
  outline: {
    title: string;
    nodes: { id: string; type: string; title?: { value: string }[]; children: unknown[] }[];
  };
  mayEdit: boolean;
}

const text = (value: string) => [{ type: 'text', value, marks: [] }];

describe('documents through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let elsewhere: Tenant;
  let general: string;
  let quality: string;
  let elsewhereSpace: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** Creates a document titled so, in English, left to right - the preflight's own helper (S18). */
  const create = (as: string, space: string, title: string) =>
    call(as, 'POST', `/v1/spaces/${space}/documents`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    });

  /** One structural act on a document, from the version the caller opened. */
  const act = (as: string, document: string, openedFrom: string, operation: Json) =>
    call(as, 'POST', `/v1/documents/${document}/outline`, { openedFrom, operation });

  /** A section, inserted at the top of the outline, from the version the caller holds. */
  const addSection = (
    document: { id: string; version: { id: string } },
    title: string,
    as = 'ada',
  ) =>
    act(as, document.id, document.version.id, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text(title) },
    });

  const chainOf = (document: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', document)
        .orderBy('version_no')
        .execute(),
    );

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
    const organisation = { id: 'acme', name: 'Acme' };
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    elsewhere = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [OTHER],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
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
      quality = (await createSpace(trx, 'Quality')).id;
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      // The seed gives Ada Author on General and nothing else, so she could not read Quality at all.
      // Administrator at the tenant lets her read it, and carries no `create` - which is the
      // read-but-not-create case the refusals below need.
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    elsewhereSpace = await tenantDb.withTenant(elsewhere, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('STR-061 makes a document a named, versioned artifact in exactly one space, with its own title', async () => {
    const made = await create('ada', general, 'The dosing report');
    expect(made.statusCode).toBe(200);
    const body = made.json<DocumentBody>();
    // Versioned: it exists at 0.1, cut by whoever created it.
    expect(body.version.number).toBe('0.1');
    expect(body.version.author).toBe(ids.ada);
    expect(body.space).toEqual({ id: general, name: 'General' });
    // Named: the title is inside the versioned content, so the listing and the page read one title.
    expect(body.outline.title).toBe('The dosing report');
    const listed = await call('ada', 'GET', '/v1/documents');
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({ id: body.id, title: 'The dosing report' }),
    );
    const opened = await call('ada', 'GET', `/v1/documents/${body.id}`);
    expect(opened.json<DocumentBody>().outline.title).toBe('The dosing report');
    // An artifact of its own kind, in exactly the one space it was created in.
    const row = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact')
        .select(['kind', 'space_id'])
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ kind: 'document', space_id: general });
  });

  it('STR-054 gives an outline an implicit root and lets it hold no nodes at all', async () => {
    const made = await create('ada', general, 'Front matter only');
    const body = made.json<DocumentBody>();
    expect(body.outline.nodes).toEqual([]);
    // Created, read and listed with no nodes, and no error anywhere. The root the deep link would
    // address is the document itself, which is the id the route is named by.
    const opened = await call('ada', 'GET', `/v1/documents/${body.id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<DocumentBody>()).toMatchObject({
      id: body.id,
      outline: { nodes: [] },
    });
    expect(
      (await call('ada', 'GET', '/v1/documents'))
        .json<{ items: { id: string }[] }>()
        .items.map((i) => i.id),
    ).toContain(body.id);
  });

  it('keeps a section inside the document that declares it, with no identity to reach it by alone', async () => {
    const made = await create('ada', general, 'Owning its sections');
    const doc = made.json<DocumentBody>();
    const inserted = await addSection(doc, 'Introduction');
    const node = inserted.json<DocumentBody>().outline.nodes[0]!;
    // A node identifier is 26 base32 characters, so it cannot name an artifact row at all.
    expect(node.id).toMatch(NODE);
    const artifacts = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('artifact').select('id').where('space_id', '=', general).execute(),
    );
    expect(artifacts.map((each) => each.id)).not.toContain(node.id);
    expect((await call('ada', 'GET', `/v1/documents/${node.id}`)).statusCode).toBe(400);
  });

  it('restructures an outline one act and one version at a time', async () => {
    let doc = (await create('ada', general, 'The dosing report')).json<DocumentBody>();
    const step = async (operation: Json) => {
      const answer = await act('ada', doc.id, doc.version.id, operation);
      expect(answer.statusCode, answer.body).toBe(200);
      doc = answer.json<DocumentBody>();
      return doc;
    };

    await step({ operation: 'insert', parent: null, position: 0, node: section('Results') });
    expect(doc.version.number).toBe('0.2');
    const results = doc.outline.nodes[0]!.id;
    expect(results).toMatch(NODE);
    await step({ operation: 'insert', parent: null, position: 0, node: section('Method') });
    expect(doc.version.number).toBe('0.3');
    const method = doc.outline.nodes[0]!.id;
    expect(method).toMatch(NODE);
    expect(method).not.toBe(results);

    await step({ operation: 'move', node: results, parent: method, position: 0 });
    expect(doc.version.number).toBe('0.4');
    expect(doc.outline.nodes.map((node) => node.id)).toEqual([method]);
    expect(doc.outline.nodes[0]!.children).toMatchObject([{ id: results }]);

    await step({ operation: 'retitle', node: method, title: text('Introduction') });
    expect(doc.version.number).toBe('0.5');
    expect(doc.outline.nodes[0]!.title).toMatchObject([{ value: 'Introduction' }]);

    await step({ operation: 'set', node: method, pageBreak: 'page' });
    expect(doc.version.number).toBe('0.6');
    expect(doc.outline.nodes[0]).toMatchObject({ pageBreak: 'page' });

    await step({ operation: 'remove', node: results });
    expect(doc.version.number).toBe('0.7');
    expect(doc.outline.nodes[0]!.children).toEqual([]);

    expect(await chainOf(doc.id)).toHaveLength(7);
    const opened = await call('ada', 'GET', `/v1/documents/${doc.id}`);
    expect(opened.json<DocumentBody>()).toEqual(doc);
  });

  it('answers an act that changes nothing as the version it already was, keeping no row for it', async () => {
    const made = (await create('ada', general, 'Put back')).json<DocumentBody>();
    const one = (await addSection(made, 'Introduction')).json<DocumentBody>();
    const node = one.outline.nodes[0]!.id;
    const answer = await act('ada', one.id, one.version.id, {
      operation: 'move',
      node,
      parent: null,
      position: 0,
    });
    // Decision K: putting something back where it was is not an error.
    expect(answer.statusCode).toBe(200);
    expect(answer.json<DocumentBody>().version).toEqual(one.version);
    expect(await chainOf(one.id)).toHaveLength(2);
  });

  it('refuses an operation that does not apply to the outline it was opened from', async () => {
    const made = (await create('ada', general, 'Inside itself')).json<DocumentBody>();
    const parent = (await addSection(made, 'Method')).json<DocumentBody>();
    const method = parent.outline.nodes[0]!.id;
    const child = (
      await act('ada', parent.id, parent.version.id, {
        operation: 'insert',
        parent: method,
        position: 0,
        node: section('Results'),
      })
    ).json<DocumentBody>();
    const results = child.outline.nodes[0]!.children as { id: string }[];

    const refused = await act('ada', child.id, child.version.id, {
      operation: 'move',
      node: method,
      parent: results[0]!.id,
      position: 0,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'outline_invalid',
      message: 'This change does not apply to the outline as it stands.',
      reason: 'A node cannot be moved inside its own subtree',
    });
    expect(await chainOf(child.id)).toHaveLength(3);
  });

  it('tells a caller opened from an older version that it is stale, even when its act would not apply there', async () => {
    // The act removes a node the caller's version never held: invalid against what they opened, and
    // valid against what now stands. Told only "invalid", they would have nothing to recover from;
    // told "stale" with the outline as it stands, they can look again and act on that.
    const first = (await create('ada', general, 'Two people')).json<DocumentBody>();
    const second = (await addSection(first, 'Introduction')).json<DocumentBody>();
    const introduction = second.outline.nodes[0]!.id;

    const stale = await act('ada', first.id, first.version.id, {
      operation: 'remove',
      node: introduction,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      current: { version: second.version, outline: { nodes: [{ id: introduction }] } },
    });
    // And from the outline that came back, the same act lands.
    const current = stale.json<{ current: DocumentBody }>().current;
    const again = await act('ada', first.id, current.version.id, {
      operation: 'remove',
      node: introduction,
    });
    expect(again.statusCode).toBe(200);
    expect(await chainOf(first.id)).toHaveLength(3);
  });

  it('answers an opened-from version that is not one of this document as stale, with the outline as it stands', async () => {
    const mine = (await create('ada', general, 'Mine')).json<DocumentBody>();
    const theirs = (await create('ada', general, 'Theirs')).json<DocumentBody>();
    for (const openedFrom of [theirs.version.id, UNKNOWN]) {
      const answer = await act('ada', mine.id, openedFrom, {
        operation: 'insert',
        parent: null,
        position: 0,
        node: section('Introduction'),
      });
      expect(answer.statusCode).toBe(409);
      expect(answer.json()).toMatchObject({
        code: 'version_precondition',
        current: { id: mine.id, version: mine.version },
      });
    }
    expect(await chainOf(mine.id)).toHaveLength(1);
    expect(await chainOf(theirs.id)).toHaveLength(1);
  });

  it('STR-059 refuses the second of two acts from one version against the current outline, never overwriting the first', async () => {
    const doc = (await create('ada', general, 'Raced')).json<DocumentBody>();
    const [first, second] = await Promise.all([
      addSection(doc, 'First'),
      addSection(doc, 'Second'),
    ]);
    // The version precondition governs the two: both name 0.1, and only one can still be at it.
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const refused = first.statusCode === 409 ? first : second;
    const recorded = (first.statusCode === 409 ? second : first).json<DocumentBody>();
    expect(refused.json()).toMatchObject({ code: 'version_precondition' });
    // Refused against the current outline: the refusal carries the winner's outline as it now stands.
    expect(refused.json<{ current: DocumentBody }>().current).toEqual(recorded);
    // And nothing was overwritten: the chain holds 0.1 and the winner's version only, and the
    // document reads the winner's one section, the loser's title nowhere in it.
    expect((await chainOf(doc.id)).map((each) => each.id)).toEqual([
      doc.version.id,
      recorded.version.id,
    ]);
    const opened = (await call('ada', 'GET', `/v1/documents/${doc.id}`)).json<DocumentBody>();
    expect(opened).toEqual(recorded);
    const winner = recorded.outline.nodes[0]!.title![0]!.value;
    const loser = winner === 'First' ? 'Second' : 'First';
    expect(opened.outline.nodes).toHaveLength(1);
    expect(JSON.stringify(opened.outline)).not.toContain(loser);
    // And no document-level lock is introduced: none can be claimed on a document through the one
    // route that claims locks. `component_lock` refuses a document by its check constraint too, which
    // packages/db's documents.test.ts shows at the database.
    const claimed = await call('ada', 'POST', `/v1/components/${doc.id}/lock`, {
      session: '33333333-3333-4333-8333-333333333333',
    });
    expect(claimed.statusCode).toBe(404);
  });

  it('refuses creating where the caller may read but not create, and answers nothing for the rest', async () => {
    const readOnly = await create('alice', general, 'Not mine');
    expect(readOnly.statusCode).toBe(403);
    expect(readOnly.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the create permission.',
    });
    expect((await create('alice', quality, 'Not mine')).statusCode).toBe(404);
    // Ada administers the tenant, so she may read Quality - and `administer` carries no `create`.
    expect((await create('ada', quality, 'Not mine')).statusCode).toBe(403);
    expect((await create('ada', elsewhereSpace, 'Not mine')).statusCode).toBe(404);
    expect((await create('ada', UNKNOWN, 'Not mine')).statusCode).toBe(404);
    expect((await call(undefined, 'GET', '/v1/documents')).statusCode).toBe(401);
  });

  it('opens a document to a reader who may not edit it, and refuses their edit', async () => {
    const doc = (await create('ada', general, 'Read only')).json<DocumentBody>();
    const opened = await call('alice', 'GET', `/v1/documents/${doc.id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<DocumentBody>().mayEdit).toBe(false);
    expect((await call('ada', 'GET', `/v1/documents/${doc.id}`)).json<DocumentBody>().mayEdit).toBe(
      true,
    );
    expect(
      (await call('alice', 'GET', '/v1/documents')).json<{ items: { id: string }[] }>().items,
    ).toContainEqual(expect.objectContaining({ id: doc.id }));

    const edited = await addSection(doc, 'Introduction', 'alice');
    expect(edited.statusCode).toBe(403);
    expect(edited.json()).toMatchObject({ code: 'forbidden' });
    expect(await chainOf(doc.id)).toHaveLength(1);
  });

  it("keeps components and documents apart: each one's id is nothing on the other's routes", async () => {
    const component = await call('ada', 'POST', `/v1/spaces/${general}/components`, {
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
    });
    const { id, version } = component.json<{ id: string; version: { id: string } }>();
    const insert = {
      operation: 'insert',
      parent: null,
      position: 0,
      node: section('Introduction'),
    };
    expect((await call('ada', 'GET', `/v1/documents/${id}`)).statusCode).toBe(404);
    expect((await act('ada', id, version.id, insert)).statusCode).toBe(404);
    // `authorise` decides `edit` before the handler looks at the kind, so a reader who may not edit
    // the component is refused as forbidden - which tells them nothing they could not already read.
    expect((await act('alice', id, version.id, insert)).statusCode).toBe(403);
    expect(
      (await call('ada', 'GET', '/v1/documents'))
        .json<{ items: { id: string }[] }>()
        .items.map((i) => i.id),
    ).not.toContain(id);

    // And the other way round: a document's id is no component.
    const doc = (await create('ada', general, 'Not a component')).json<DocumentBody>();
    expect((await call('ada', 'GET', `/v1/components/${doc.id}`)).statusCode).toBe(404);
    expect(
      (await call('ada', 'GET', '/v1/components?limit=100'))
        .json<{ items: { id: string }[] }>()
        .items.map((i) => i.id),
    ).not.toContain(doc.id);
  });

  it('refuses a body carrying a member it does not declare, and an uppercase id anywhere', async () => {
    const doc = (await create('ada', general, 'Strict')).json<DocumentBody>();
    expect(
      (
        await call('ada', 'POST', `/v1/spaces/${general}/documents`, {
          title: 'Strict',
          language: 'en-GB',
          direction: 'ltr',
          nodes: [],
        })
      ).statusCode,
    ).toBe(400);
    expect((await create('ada', general, '')).statusCode).toBe(400);
    expect(
      (
        await call('ada', 'POST', `/v1/documents/${doc.id}/outline`, {
          openedFrom: doc.version.id,
          operation: { operation: 'remove', node: 'a'.repeat(26) },
          note: 'extra',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await act('ada', doc.id, doc.version.id, {
          operation: 'remove',
          node: 'a'.repeat(26),
          x: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('ada', 'GET', `/v1/documents/${doc.id.toUpperCase()}`)).statusCode).toBe(
      400,
    );
    expect(
      (
        await act('ada', doc.id, doc.version.id.toUpperCase(), {
          operation: 'remove',
          node: 'a'.repeat(26),
        })
      ).statusCode,
    ).toBe(400);
    expect((await create('ada', general.toUpperCase(), 'Uppercase space')).statusCode).toBe(400);
    expect(await chainOf(doc.id)).toHaveLength(1);
  });

  it("refuses a title that trims to nothing with the store's own content_invalid", async () => {
    const whitespace = await create('ada', general, '   ');
    expect(whitespace.statusCode).toBe(400);
    expect(whitespace.json()).toMatchObject({ code: 'content_invalid' });
  });

  it('refuses a section title the store could not keep: blank, unstorable, or a footnote holding anything but paragraphs', async () => {
    const NUL = String.fromCharCode(0);
    const HALF = String.fromCharCode(0xd800);
    for (const title of [`The ${NUL}dosing report`, `The dosing report ${HALF}`]) {
      const refused = await create('ada', general, title);
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ code: 'content_invalid' });
    }
    const doc = (await create('ada', general, 'Titles')).json<DocumentBody>();
    const added = (await addSection(doc, 'Method')).json<DocumentBody>();
    const node = added.outline.nodes[0]!.id;
    const footnote = (content: unknown) => ({
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content,
    });
    const paragraph = {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: text('At the bench.'),
    };
    for (const title of [
      [],
      text('   '),
      text(`Me${NUL}thod`),
      text(`Method ${HALF}`),
      [...text('Method'), footnote([{ script: '<x>' }, 42])],
      [...text('Method'), footnote([])],
    ]) {
      const retitled = await act('ada', doc.id, added.version.id, {
        operation: 'retitle',
        node,
        title,
      });
      expect(retitled.statusCode).toBe(400);
      expect(retitled.json()).toMatchObject({ code: 'invalid_request' });
      const inserted = await act('ada', doc.id, added.version.id, {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title },
      });
      expect(inserted.statusCode).toBe(400);
      expect(inserted.json()).toMatchObject({ code: 'invalid_request' });
    }
    expect(await chainOf(doc.id)).toHaveLength(2);
    // What the content model admits in a heading is admitted: a footnote of paragraphs.
    const footnoted = await act('ada', doc.id, added.version.id, {
      operation: 'retitle',
      node,
      title: [...text('Method'), footnote([paragraph])],
    });
    expect(footnoted.statusCode).toBe(200);
    expect(await chainOf(doc.id)).toHaveLength(3);
  });

  describe('a reference to a component the caller may not read', () => {
    /**
     * A component in Quality, which Ada may read (Administrator at the tenant) and Grace may not. Made
     * through the store, because nobody here may create in Quality - which is the point of it.
     */
    const hiddenComponent = () =>
      tenantDb.withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId: quality,
          title: 'Calibrate the balance',
          language: 'en-GB',
          direction: 'ltr',
          author: ids.ada!,
        });
        if (made.answer !== 'created') throw new Error('Expected a component');
        return { id: made.version.artifactId, version: { id: made.version.id } };
      });
    const reference = (component: string, mode: Json = { kind: 'latest' }) => ({
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component, mode },
    });
    type Node = { type: string; component?: string | null; mode?: Json };
    const referenceIn = (body: DocumentBody) =>
      (body.outline.nodes as unknown as Node[]).find((node) => node.type === 'reference');

    it('shows no component id and no pinned version on any answer carrying the outline', async () => {
      const hidden = await hiddenComponent();
      const doc = (await create('ada', general, 'Withheld')).json<DocumentBody>();
      const pinned = await act('ada', doc.id, doc.version.id, {
        ...reference(hidden.id, { kind: 'pinned', version: hidden.version.id }),
      });
      expect(pinned.statusCode).toBe(200);
      const referenced = pinned.json<DocumentBody>();
      // Ada may read it, and is shown it.
      expect(referenceIn(referenced)).toMatchObject({
        component: hidden.id,
        mode: { kind: 'pinned', version: hidden.version.id },
      });

      const withheld = (body: DocumentBody) => {
        expect(referenceIn(body)).toMatchObject({
          type: 'reference',
          component: null,
          mode: { kind: 'pinned', version: null },
        });
        expect(JSON.stringify(body)).not.toContain(hidden.id);
        expect(JSON.stringify(body)).not.toContain(hidden.version.id);
      };
      // Opened.
      const opened = await call('grace', 'GET', `/v1/documents/${doc.id}`);
      expect(opened.statusCode).toBe(200);
      withheld(opened.json<DocumentBody>());
      // Restructured: the success answer.
      const edited = await addSection(referenced, 'Method', 'grace');
      expect(edited.statusCode).toBe(200);
      withheld(edited.json<DocumentBody>());
      // Refused as stale: the 409 carries the document as it now stands.
      const stale = await addSection(referenced, 'Results', 'grace');
      expect(stale.statusCode).toBe(409);
      withheld(stale.json<{ current: DocumentBody }>().current);

      // Only the view: the stored outline still names the component, and Ada is still shown it.
      const stored = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select('content')
          .where('artifact_id', '=', doc.id)
          .orderBy('version_no', 'desc')
          .executeTakeFirstOrThrow(),
      );
      expect(JSON.stringify(stored.content)).toContain(hidden.id);
      expect(JSON.stringify(stored.content)).toContain(hidden.version.id);
      const again = await call('ada', 'GET', `/v1/documents/${doc.id}`);
      expect(referenceIn(again.json<DocumentBody>())).toMatchObject({ component: hidden.id });
    });

    it('refuses referencing one exactly as it refuses an id that names nothing', async () => {
      const hidden = await hiddenComponent();
      const doc = (await create('grace', general, 'Unreachable')).json<DocumentBody>();
      const unreadable = await act('grace', doc.id, doc.version.id, reference(hidden.id));
      const nothing = await act('grace', doc.id, doc.version.id, reference(UNKNOWN));
      expect(unreadable.statusCode).toBe(400);
      expect(unreadable.json()).toMatchObject({
        code: 'outline_invalid',
        reason: 'The component is not one this outline can reference',
      });
      const untraced = (body: Json) => ({ ...body, traceId: undefined });
      expect(untraced(unreadable.json())).toEqual(untraced(nothing.json()));
      expect(await chainOf(doc.id)).toHaveLength(1);
    });
  });

  it('answers a stored outline that no longer reads as a failure on our side, saying nothing of it', async () => {
    const doc = (await create('ada', general, 'Broken')).json<DocumentBody>();
    // A version the store would never write, put there by hand: a title the schema refuses.
    const broken = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('artifact_version')
        .values({
          artifact_id: doc.id,
          kind: 'document',
          revision_no: 0,
          version_no: 2,
          author_id: ids.ada!,
          note: null,
          schema_version: 1,
          content: JSON.stringify({ ...doc.outline, title: '' }),
          content_hash: 'a'.repeat(64),
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: 'b'.repeat(64),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    const answer = await act('ada', doc.id, broken.id, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: section('Method'),
    });
    expect(answer.statusCode).toBe(500);
    expect(answer.json()).toEqual({
      code: 'internal',
      message: 'Something went wrong on our side. Quote the trace id if you report it.',
      traceId: expect.any(String),
    });
    expect(answer.body).not.toContain(doc.id);
    expect(answer.body).not.toContain('does not read');
    expect(await chainOf(doc.id)).toHaveLength(2);
    // Opened, it is shown as nothing at all rather than as stored: what cannot be read cannot have a
    // reference withheld from it either, and the page says it could not be read.
    const opened = await call('ada', 'GET', `/v1/documents/${doc.id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<{ outline: unknown }>().outline).toEqual({});
  });
});

function section(title: string) {
  return { type: 'section', title: text(title) };
}
