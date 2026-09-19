import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createSpace,
  createTenant,
  createTenantDatabase,
  DEFAULT_LAYOUT_ID,
  defaultLayout,
  findRole,
  grant,
  migrate,
  recordVersion,
  seedDevelopmentContent,
  substanceOf,
  type StoredVersion,
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
const UNKNOWN = '11111111-1111-4111-8111-111111111111';

type Json = Record<string, unknown>;

interface Entry {
  node: string;
  block: string | null;
  sequence: string;
  matter: string;
  sections: number[];
  value: number | null;
  restartedAt: string | null;
  number: string | null;
  label: string | null;
}

/** What the numbering route answers, as far as these tests read it. */
interface Numbering {
  document: string;
  version: { id: string; number: string };
  scheme: string;
  layout: { id: string; version: { id: string; number: string } };
  occurrences: { node: string; version: string | null }[];
  entries: Entry[];
}

interface DocumentBody {
  id: string;
  version: { id: string };
  outline: { nodes: { id: string; children: { id: string; children: { id: string }[] }[] }[] };
}

const text = (value: string) => [{ type: 'text', value, marks: [] }];

const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>a</mi></math>';

const figure = (id: string) => ({
  type: 'figure',
  id,
  asset: 'asset',
  imageStyle: 'wide',
  caption: 'A caption',
  alternative: { kind: 'decorative' },
});

const table = (id: string) => ({
  type: 'table',
  id,
  caption: 'Parts',
  headerRows: 0,
  headerColumns: 0,
  rows: [
    {
      cells: [
        { content: [{ type: 'paragraph', id: `${id}c`, content: [{ type: 'text', value: 'A' }] }] },
      ],
    },
  ],
});

const equation = (id: string) => ({ type: 'equation', id, mathml: MATHML, numbered: true });

/** A paragraph holding one footnote, whose identifier is `id`. */
const footnoted = (id: string) => ({
  type: 'paragraph',
  id: `${id}p`,
  content: [
    { type: 'text', value: 'Unpack it.' },
    {
      type: 'footnote',
      id,
      anchor: { kind: 'span' },
      content: [{ type: 'paragraph', id: `${id}n`, content: [{ type: 'text', value: 'A note' }] }],
    },
  ],
});

describe('a document numbered through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A component as these tests hold it: its id, and the version it is at. */
  interface Held {
    id: string;
    version: string;
    stored: StoredVersion;
  }

  /** A new version of a component holding these blocks, recorded through the store. */
  const revise = (component: Pick<Held, 'id' | 'stored'>, blocks: unknown[]) =>
    tenantDb.withTenant(tenant, async (trx): Promise<Held> => {
      const substance = substanceOf(component.stored);
      if (substance.kind !== 'component') throw new Error('not a component');
      const recorded = await recordVersion(trx, {
        artifactId: component.id,
        openedFrom: component.stored.id,
        author: ids.grace!,
        substance: { ...substance, content: { ...substance.content, content: blocks } as never },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { id: component.id, version: recorded.version.id, stored: recorded.version };
    });

  /** A component at 0.2 holding these blocks, made through the store: the editor writes none yet. */
  const componentWith = async (space: string, title: string, blocks: unknown[]) => {
    const made = await tenantDb.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return revise({ id: made.version.artifactId, stored: made.version }, blocks);
  };

  const create = (title: string) =>
    call('grace', 'POST', `/v1/spaces/${general}/documents`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    }).then((made) => made.json<DocumentBody>());

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
      const author = await findRole(trx, 'Author');
      // Alice reads General; Grace authors in General and in Quality. The seed gives Ada Author on
      // General and nothing else, so neither Ada nor Alice may read Quality.
      for (const [role, principal, space] of [
        [reader!, ids.alice!, general],
        [author!, ids.grace!, general],
        [author!, ids.grace!, quality],
      ] as const) {
        await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('IAM-073 shows a reader no number a component they may not read could have moved, and nothing of what it holds', async () => {
    // One of each kind a component contributes, in this order: figure, table, equation, footnote,
    // figure. The default scheme restarts figures and tables with each chapter and never restarts
    // equations or footnotes.
    const shared = await componentWith(general, 'Install the printer', [
      figure('f1'),
      table('t1'),
      equation('e1'),
      footnoted('n1'),
      figure('f2'),
    ]);
    const secret = await componentWith(quality, 'Calibration', [figure('s1')]);
    let doc = await create('The dosing report');
    const act = async (operation: Json) => {
      const answer = await call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation,
      });
      expect(answer.statusCode, answer.body).toBe(200);
      doc = answer.json<DocumentBody>();
    };
    const reference = (component: string) => ({
      type: 'reference',
      component,
      mode: { kind: 'latest' },
    });
    for (const [position, title] of ['Introduction', 'Method'].entries()) {
      await act({
        operation: 'insert',
        parent: null,
        position,
        node: { type: 'section', title: text(title) },
      });
    }
    const [introduction, method] = doc.outline.nodes.map((node) => node.id);
    for (const [position, component] of [shared.id, secret.id, shared.id].entries()) {
      await act({
        operation: 'insert',
        parent: introduction,
        position,
        node: reference(component),
      });
    }
    await act({ operation: 'insert', parent: method, position: 0, node: reference(shared.id) });
    const [first, hidden, again] = doc.outline.nodes[0]!.children.map((child) => child.id);
    const later = doc.outline.nodes[1]!.children[0]!.id;
    const numbering = (as: string) => call(as, 'GET', `/v1/documents/${doc.id}/numbering`);
    const labels = (body: Numbering) =>
      body.entries
        .filter((entry) => entry.sequence !== 'section')
        .map((entry) => [entry.node, entry.block, entry.label]);

    // Grace may read both components, so every number is known to her.
    const forGrace = await numbering('grace');
    expect(forGrace.statusCode, forGrace.body).toBe(200);
    const full = forGrace.json<Numbering>();
    expect(full).toMatchObject({
      document: doc.id,
      version: { id: doc.version.id },
      scheme: 'default/1',
      occurrences: [
        { node: first, version: shared.version },
        { node: hidden, version: secret.version },
        { node: again, version: shared.version },
        { node: later, version: shared.version },
      ],
    });
    expect(labels(full)).toEqual([
      [first, 'f1', 'Figure 1.1'],
      [first, 't1', 'Table 1.1'],
      [first, 'e1', 'Equation 1'],
      [first, 'n1', '1'],
      [first, 'f2', 'Figure 1.2'],
      [hidden, 's1', 'Figure 1.3'],
      [again, 'f1', 'Figure 1.4'],
      [again, 't1', 'Table 1.2'],
      [again, 'e1', 'Equation 2'],
      [again, 'n1', '2'],
      [again, 'f2', 'Figure 1.5'],
      [later, 'f1', 'Figure 2.1'],
      [later, 't1', 'Table 2.1'],
      [later, 'e1', 'Equation 3'],
      [later, 'n1', '3'],
      [later, 'f2', 'Figure 2.2'],
    ]);

    // Ada and Alice may read the document and `shared`, but not `secret`.
    const restricted: Record<string, string> = {};
    for (const reader of ['alice', 'ada']) {
      const answer = await numbering(reader);
      expect(answer.statusCode, answer.body).toBe(200);
      restricted[reader] = answer.body;
      const body = answer.json<Numbering>();
      expect(body.occurrences).toEqual([
        { node: first, version: shared.version },
        { node: hidden, version: null },
        { node: again, version: shared.version },
        { node: later, version: shared.version },
      ]);
      // Nothing of the component they may not read: not its block, its version or its identity.
      expect(answer.body).not.toContain('"s1"');
      expect(answer.body).not.toContain(secret.version);
      expect(answer.body).not.toContain(secret.id);
      // Every number `hidden` could have moved is null: the rest of its chapter, and the equations
      // and footnotes to the end of the document, which never restart. The next chapter restarts
      // figures and tables, so theirs are shown again.
      expect(labels(body)).toEqual([
        [first, 'f1', 'Figure 1.1'],
        [first, 't1', 'Table 1.1'],
        [first, 'e1', 'Equation 1'],
        [first, 'n1', '1'],
        [first, 'f2', 'Figure 1.2'],
        [again, 'f1', null],
        [again, 't1', null],
        [again, 'e1', null],
        [again, 'n1', null],
        [again, 'f2', null],
        [later, 'f1', 'Figure 2.1'],
        [later, 't1', 'Table 2.1'],
        [later, 'e1', null],
        [later, 'n1', null],
        [later, 'f2', 'Figure 2.2'],
      ]);
      // Against the full reader's table: the same entries less `hidden`'s own, and every number
      // shown is the one the full reader is shown - none is a guess, and none differs.
      const withoutHidden = full.entries.filter((entry) => entry.node !== hidden || !entry.block);
      expect(body.entries).toHaveLength(withoutHidden.length);
      body.entries.forEach((entry, index) => {
        const theirs = withoutHidden[index]!;
        expect(entry).toEqual(
          entry.number === null ? { ...theirs, value: null, number: null, label: null } : theirs,
        );
      });
      // Every section number is shown, because none depends on what a component holds.
      expect(
        body.entries.filter((entry) => entry.sequence === 'section').map((entry) => entry.number),
      ).toEqual(['1', '1.1', '1.2', '1.3', '2', '2.1']);
    }

    // A new version of `secret` holding one more of every kind. Nothing is cached, so Grace's numbers
    // move at once, the document unchanged; the others' answers do not move by a byte, because
    // nothing in them was ever computed from what `secret` holds.
    const revised = await revise(secret, [
      figure('s1'),
      figure('s2'),
      table('s3'),
      equation('s4'),
      footnoted('s5'),
    ]);
    const moved = (await numbering('grace')).json<Numbering>();
    expect(moved.version.id).toBe(doc.version.id);
    expect(moved.occurrences[1]).toEqual({ node: hidden, version: revised.version });
    expect(labels(moved)).toEqual([
      [first, 'f1', 'Figure 1.1'],
      [first, 't1', 'Table 1.1'],
      [first, 'e1', 'Equation 1'],
      [first, 'n1', '1'],
      [first, 'f2', 'Figure 1.2'],
      [hidden, 's1', 'Figure 1.3'],
      [hidden, 's2', 'Figure 1.4'],
      [hidden, 's3', 'Table 1.2'],
      [hidden, 's4', 'Equation 2'],
      [hidden, 's5', '2'],
      [again, 'f1', 'Figure 1.5'],
      [again, 't1', 'Table 1.3'],
      [again, 'e1', 'Equation 3'],
      [again, 'n1', '3'],
      [again, 'f2', 'Figure 1.6'],
      [later, 'f1', 'Figure 2.1'],
      [later, 't1', 'Table 2.1'],
      [later, 'e1', 'Equation 4'],
      [later, 'n1', '4'],
      [later, 'f2', 'Figure 2.2'],
    ]);
    for (const reader of ['alice', 'ada']) {
      const answer = await numbering(reader);
      expect(answer.statusCode, answer.body).toBe(200);
      expect(answer.body).toBe(restricted[reader]);
    }
  });

  it('answers every mode and switch the outline stores with the numbers the domain gives them', async () => {
    const shared = await componentWith(general, 'Install the printer', [
      figure('f1'),
      figure('f2'),
    ]);
    // `older` is pinned at 0.2, which holds one figure; its head holds two, and is not what is read.
    const older = await componentWith(general, 'Calibration', [figure('p1')]);
    await revise(older, [figure('p1'), figure('p2')]);
    let doc = await create('The dosing report');
    const act = async (operation: Json) => {
      const answer = await call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation,
      });
      expect(answer.statusCode, answer.body).toBe(200);
      doc = answer.json<DocumentBody>();
    };
    const section = (title: string) => ({ type: 'section', title: text(title) });
    const latest = { type: 'reference', component: shared.id, mode: { kind: 'latest' } };
    const top = () => doc.outline.nodes.map((node) => node.id);
    const childrenOf = (index: number) => doc.outline.nodes[index]!.children.map((node) => node.id);

    // Glossary (an unnumbered leading appendix), Introduction, Results, Appendix.
    for (const [position, title] of ['Glossary', 'Introduction', 'Results', 'Appendix'].entries()) {
      await act({ operation: 'insert', parent: null, position, node: section(title) });
    }
    const [glossary, introduction, results, appendix] = top();
    await act({ operation: 'set', node: glossary, matter: 'appendix', numbered: false });
    await act({ operation: 'set', node: appendix, matter: 'appendix' });
    await act({ operation: 'insert', parent: glossary, position: 0, node: latest });
    // Introduction: a pinned placement, an unnumbered aside holding a placement, an `approved`
    // placement, and a placement after it.
    await act({
      operation: 'insert',
      parent: introduction,
      position: 0,
      node: {
        type: 'reference',
        component: older.id,
        mode: { kind: 'pinned', version: older.version },
      },
    });
    await act({ operation: 'insert', parent: introduction, position: 1, node: section('Aside') });
    await act({
      operation: 'insert',
      parent: introduction,
      position: 2,
      node: { type: 'reference', component: shared.id, mode: { kind: 'approved' } },
    });
    await act({ operation: 'insert', parent: introduction, position: 3, node: latest });
    const [pinned, aside, approved, after] = childrenOf(1);
    await act({ operation: 'set', node: aside!, numbered: false });
    await act({ operation: 'insert', parent: aside, position: 0, node: latest });
    await act({ operation: 'insert', parent: results, position: 0, node: latest });
    await act({ operation: 'insert', parent: appendix, position: 0, node: latest });
    const [inGlossary] = childrenOf(0);
    const [inAside] = doc.outline.nodes[1]!.children[1]!.children.map((node) => node.id);
    const [inResults] = childrenOf(2);
    const [inAppendix] = childrenOf(3);

    const answers: string[] = [];
    // Alice reads General, so she is shown exactly what Grace is: `approved` withholds for everyone.
    for (const reader of ['grace', 'alice']) {
      const answer = await call(reader, 'GET', `/v1/documents/${doc.id}/numbering`);
      expect(answer.statusCode, answer.body).toBe(200);
      answers.push(answer.body);
      const body = answer.json<Numbering>();
      expect(body.occurrences).toEqual([
        { node: inGlossary, version: shared.version },
        { node: pinned, version: older.version },
        { node: inAside, version: shared.version },
        { node: approved, version: null },
        { node: after, version: shared.version },
        { node: inResults, version: shared.version },
        { node: inAppendix, version: shared.version },
      ]);
      expect(
        body.entries
          .filter((entry) => entry.sequence === 'section')
          .map((entry) => [entry.node, entry.number]),
      ).toEqual([
        [introduction, '1'],
        [pinned, '1.1'],
        [approved, '1.2'],
        [after, '1.3'],
        [results, '2'],
        [inResults, '2.1'],
        [appendix, 'A'],
        [inAppendix, 'A.1'],
      ]);
      expect(
        body.entries
          .filter((entry) => entry.sequence === 'figure')
          .map((entry) => [entry.node, entry.block, entry.matter, entry.label]),
      ).toEqual([
        // No chapter to number against yet, so the leading appendix's captions are withheld.
        [inGlossary, 'f1', 'appendix', null],
        [inGlossary, 'f2', 'appendix', null],
        // The pinned version's one figure, not the head's two.
        [pinned, 'p1', 'body', 'Figure 1.1'],
        // Beneath an unnumbered node: no section number, and its figures carry on the chapter's.
        [inAside, 'f1', 'body', 'Figure 1.2'],
        [inAside, 'f2', 'body', 'Figure 1.3'],
        // After `approved`, which nobody can number yet, until the next chapter restarts.
        [after, 'f1', 'body', null],
        [after, 'f2', 'body', null],
        [inResults, 'f1', 'body', 'Figure 2.1'],
        [inResults, 'f2', 'body', 'Figure 2.2'],
        [inAppendix, 'f1', 'appendix', 'Figure A.1'],
        [inAppendix, 'f2', 'appendix', 'Figure A.2'],
      ]);
    }
    expect(answers[1]).toBe(answers[0]);
  });

  it('numbers a document with no nodes as nothing at all, without an error', async () => {
    const doc = await create('Front matter only');
    const answer = await call('alice', 'GET', `/v1/documents/${doc.id}/numbering`);
    expect(answer.statusCode).toBe(200);
    expect(answer.json<Numbering>()).toMatchObject({ occurrences: [], entries: [] });
  });

  it('numbers with the scheme of the layout the document is published under, and names it', async () => {
    const record = (content: unknown, openedFrom: string) =>
      tenantDb.withTenant(tenant, async (trx) => {
        const recorded = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom,
          author: ids.grace!,
          substance: { kind: 'layout', content } as never,
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        return recorded.version;
      });

    const declared = await tenantDb.withTenant(tenant, (trx) => defaultLayout(trx));
    const section = declared.layout.scheme.sequences['section']!;
    // Version 0.2 of the environment's layout, numbering the body's sections in upper roman. Its
    // scheme is named apart from the default's, because STR-031 keys a numbering by that id.
    const upperRoman = {
      ...declared.layout,
      scheme: {
        id: 'upper-roman/1',
        sequences: {
          ...declared.layout.scheme.sequences,
          section: { ...section, body: { ...section.body, format: ['upperRoman', 'decimal'] } },
        },
      },
    };
    const next = await record(upperRoman, declared.versionId);
    try {
      let doc = await create('The dosing report');
      const act = async (operation: Json) => {
        const answer = await call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
          openedFrom: doc.version.id,
          operation,
        });
        expect(answer.statusCode, answer.body).toBe(200);
        doc = answer.json<DocumentBody>();
      };
      await act({
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title: text('Introduction') },
      });
      const [introduction] = doc.outline.nodes.map((node) => node.id);
      await act({
        operation: 'insert',
        parent: introduction,
        position: 0,
        node: { type: 'section', title: text('Scope') },
      });
      const [scope] = doc.outline.nodes[0]!.children.map((child) => child.id);

      const answer = await call('grace', 'GET', `/v1/documents/${doc.id}/numbering`);
      expect(answer.statusCode, answer.body).toBe(200);
      const body = answer.json<Numbering>();
      // The scheme numbered against is the layout's, named by its own id, and the layout is named
      // beside it at the version the numbers were taken from.
      expect(body.scheme).toBe('upper-roman/1');
      expect(body.layout).toEqual({
        id: DEFAULT_LAYOUT_ID,
        version: { id: next.id, number: '0.2' },
      });
      expect(
        body.entries
          .filter((entry) => entry.sequence === 'section')
          .map((entry) => [entry.node, entry.number]),
      ).toEqual([
        [introduction, 'I'],
        [scope, 'I.1'],
      ]);
    } finally {
      // The environment's layout goes back to what the rest of this suite numbers against.
      await record(declared.layout, next.id);
    }
  });

  it('answers what is not a document here as absent, and a caller with no session as unknown', async () => {
    expect((await call('alice', 'GET', `/v1/documents/${UNKNOWN}/numbering`)).statusCode).toBe(404);
    const component = await componentWith(general, 'Not a document', [figure('x1')]);
    expect((await call('grace', 'GET', `/v1/documents/${component.id}/numbering`)).statusCode).toBe(
      404,
    );
    const doc = await create('Nobody signed in');
    expect((await call(undefined, 'GET', `/v1/documents/${doc.id}/numbering`)).statusCode).toBe(
      401,
    );
    expect(
      (await call('grace', 'GET', `/v1/documents/${doc.id.toUpperCase()}/numbering`)).statusCode,
    ).toBe(400);
  });
});
