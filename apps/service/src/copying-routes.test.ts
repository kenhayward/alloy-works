import {
  archiveSpace,
  bootstrapCluster,
  COPY_MAX,
  createComponent,
  createDocument,
  createRole,
  createTemplate,
  createTenant,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
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
import { TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const node = () =>
  Array.from(
    { length: 26 },
    () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');

describe('copying content, over HTTP (the RM plan)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let open = '';
  let closed = '';
  let hidden = '';
  let old = '';
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  const call = (headers: Record<string, string>, url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, ...headers }, payload });
  const as = (who: string) => ({ cookie: cookies[who]! });
  const copying = (who: string, id: string, payload: Record<string, unknown>) =>
    call(as(who), `/v1/artifacts/${id}/copy`, payload);
  const previewing = (who: string, id: string, payload: Record<string, unknown>) =>
    call(as(who), `/v1/artifacts/${id}/copy/preview`, payload);

  /** A component in a space, made by Ada. */
  const component = async (space = open, title = 'A part') => {
    const made = await call(as('ada'), `/v1/spaces/${space}/components`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
      markdown: 'Set the tray, then wait.',
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
  };

  /** A document in the open space placing these components at their latest, made by Ada. */
  const document = (components: readonly string[], title = 'The report') =>
    tenantDb.withTenant(
      production,
      async (trx) => {
        const made = await createDocument(trx, {
          spaceId: open,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ids['ada']!,
          nodes: components.map((component) => ({
            type: 'reference' as const,
            id: node(),
            component,
            mode: { kind: 'latest' as const },
            ...base,
            children: [],
          })),
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version.artifactId;
      },
      { actorKind: 'person', actor: ids['ada']! },
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const users = ['ada', 'grace', 'ivy', 'nell', 'dora'];
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
      users: users.map((id) => ({ id, name: id, email: `${id}@example.com` })),
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, production, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const user of users) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (
        await app.inject({ method: 'GET', url: '/v1/me', headers: { host: HOST, ...as(user) } })
      ).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(production, async (trx) => {
      open = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      const space = async (name: string) =>
        (await trx.insertInto('space').values({ name }).returning('id').executeTakeFirstOrThrow())
          .id;
      closed = await space('Closed');
      hidden = await space('Hidden');
      old = await space('Old');
      const author = (await findRole(trx, 'Author'))!;
      const allow = (who: string, roleId: string, id: string) =>
        grant(trx, {
          subject: { principal: ids[who]! },
          roleId,
          level: { kind: 'space', id },
          effect: 'allow',
          grantedBy: ids['ada']!,
        });
      const reader = await createRole(trx, 'Looks', ['read']);
      if (!('role' in reader)) throw new Error(reader.refused);
      const designer = await createRole(trx, 'Designs', ['read', 'design']);
      if (!('role' in designer)) throw new Error(designer.refused);
      // Ada authors in every space but designs in none; Grace only reads the open space; Ivy authors
      // in the open one and cannot read the hidden one; Dora reads the open one and designs in the
      // closed one; Nell holds nothing.
      for (const each of [open, closed, hidden, old]) await allow('ada', author.id, each);
      await allow('grace', reader.role.id, open);
      await allow('ivy', author.id, open);
      await allow('dora', reader.role.id, open);
      await allow('dora', designer.role.id, closed);
      await archiveSpace(trx, old, ids['ada']!);
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('REU-057 previews how many it would copy, then copies its own components at once', async () => {
    const own = await component();
    const shared = await component();
    await document([shared], 'Elsewhere');
    const original = await document([own, shared]);
    const preview = await previewing('ada', original, { to: closed, title: 'Copied' });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      kind: 'document',
      copied: 1,
      reused: 1,
      limit: COPY_MAX,
      titleInUse: false,
      consequences: { citations: 0, terms: 0, imagesStaying: 0, bound: 0 },
    });
    const copied = await copying('ada', original, { to: closed, title: 'Copied' });
    expect(copied.statusCode, copied.body).toBe(200);
    const answer = copied.json<{
      id: string;
      components: { from: string; copy: string }[];
    }>();
    expect(answer).toMatchObject({ kind: 'document', copied: 1, reused: 1 });
    expect(answer.components.map((each) => each.from)).toEqual([own]);
    const read = await app.inject({
      method: 'GET',
      url: `/v1/documents/${answer.id}`,
      headers: { host: HOST, ...as('ada') },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      space: { id: closed },
      outline: { title: 'Copied' },
    });
  });

  it('REU-056 answers a title in use there, and copies anyway', async () => {
    const original = await document([], 'Calibration');
    const preview = await previewing('ada', original, { to: open, title: 'Calibration' });
    expect(preview.json()).toMatchObject({ titleInUse: true, consequences: null });
    const copied = await copying('ada', original, { to: open, title: 'Calibration' });
    expect(copied.statusCode, copied.body).toBe(200);
    expect(copied.json()).toMatchObject({ titleInUse: true });
  });

  it('REU-056 refuses one who may not create there, and hides what the caller may not read', async () => {
    const original = await document([]);
    const reading = await copying('grace', original, { to: open, title: 'Mine' });
    expect(reading.statusCode, reading.body).toBe(403);
    const unread = await copying('nell', original, { to: open, title: 'Mine' });
    expect(unread.statusCode, unread.body).toBe(404);
    const elsewhere = await copying('ivy', original, { to: hidden, title: 'Mine' });
    expect(elsewhere.statusCode, elsewhere.body).toBe(404);
    const archived = await copying('ada', original, { to: old, title: 'Mine' });
    expect(archived.statusCode, archived.body).toBe(409);
    expect(archived.json()).toMatchObject({ code: 'space_archived' });
  });

  it('REU-057 reuses a component its copier may not read, unnamed, and refuses copying it or one not placed', async () => {
    const unseen = await component(hidden);
    const original = await document([unseen]);
    const preview = await previewing('ivy', original, {
      to: open,
      title: 'Mine',
      components: 'all',
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      copied: 0,
      unreadable: 1,
      components: [
        { component: unseen, title: null, placed: 'unreadable', others: null, outcome: 'reuse' },
      ],
    });
    const copied = await copying('ivy', original, { to: open, title: 'Mine', components: 'all' });
    expect(copied.statusCode, copied.body).toBe(200);
    const fixed = await copying('ivy', original, {
      to: open,
      title: 'Mine',
      exceptions: [{ component: unseen, as: 'copy' }],
    });
    expect(fixed.statusCode, fixed.body).toBe(400);
    expect(fixed.json()).toMatchObject({ code: 'exception_fixed', component: unseen });
    const stranger = await component();
    const unknown = await previewing('ivy', original, {
      to: open,
      title: 'Mine',
      exceptions: [{ component: stranger, as: 'reuse' }],
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect(unknown.json()).toMatchObject({ code: 'exception_unknown', component: stranger });
  });

  it('REU-068 copies with exceptions, leaving its rewordings behind when asked, and audits both', async () => {
    const own = await component();
    const shared = await component();
    await document([shared], 'Elsewhere');
    const original = await document([own, shared]);
    const body = {
      to: closed,
      title: 'Chosen',
      exceptions: [{ component: shared, as: 'copy' }],
      rewordings: 'drop',
    };
    const preview = await previewing('ada', original, body);
    expect(preview.json()).toMatchObject({
      copied: 2,
      overrides: 0,
      components: [{ outcome: 'copy' }, { placed: 'shared', others: 1, outcome: 'copy' }],
    });
    const copied = await copying('ada', original, body);
    expect(copied.statusCode, copied.body).toBe(200);
    const { id } = copied.json<{ id: string }>();
    const events = await tenantDb.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'artifact.copied')
        .where('subject', '=', id)
        .execute(),
    );
    expect(events[0]!.detail).toEqual({
      from: original,
      components: 'own',
      exceptions: [{ component: shared, as: 'copy' }],
      rewordings: 'drop',
    });
  });

  it('REU-057 refuses a copy of more than COPY_MAX components', async () => {
    const parts = await tenantDb.withTenant(
      production,
      async (trx) => {
        const made: string[] = [];
        for (let each = 0; each <= COPY_MAX; each += 1) {
          const answer = await createComponent(trx, {
            spaceId: open,
            title: `Part ${each}`,
            language: 'en-GB',
            direction: 'ltr',
            author: ids['ada']!,
          });
          if (answer.answer !== 'created') throw new Error(answer.answer);
          made.push(answer.version.artifactId);
        }
        return made;
      },
      { actorKind: 'person', actor: ids['ada']! },
    );
    const large = await document(parts);
    const tooLarge = await copying('ada', large, { to: open, title: 'Mine' });
    expect(tooLarge.statusCode, tooLarge.body).toBe(400);
    expect(tooLarge.json()).toMatchObject({ code: 'copy_too_large', limit: COPY_MAX });
  });

  it('REU-056 copies a component, and a template where its copier may design', async () => {
    const part = await component(open, 'Original');
    const copied = await copying('ada', part, { to: closed, title: 'Its copy' });
    expect(copied.statusCode, copied.body).toBe(200);
    expect(copied.json()).toMatchObject({ kind: 'component', copied: 0 });

    const template = await tenantDb.withTenant(production, async (trx) => {
      const made = await createTemplate(trx, {
        spaceId: open,
        author: ids['ada']!,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Letter',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.template.id;
    });
    const authoring = await copying('ada', template, { to: closed, title: 'Letter, short' });
    expect(authoring.statusCode, authoring.body).toBe(403);
    const designing = await copying('dora', template, { to: closed, title: 'Letter, short' });
    expect(designing.statusCode, designing.body).toBe(200);
    expect(designing.json()).toMatchObject({ kind: 'template' });
    const spaces = await app.inject({
      method: 'GET',
      url: '/v1/spaces?limit=100',
      headers: { host: HOST, ...as('dora') },
    });
    const items = spaces.json<{ items: { id: string; mayDesign: boolean }[] }>().items;
    expect(items.find((each) => each.id === closed)?.mayDesign).toBe(true);
    expect(items.find((each) => each.id === open)?.mayDesign).toBe(false);
  });

  it('LIF-079 records artifact.copied in the tenant log: who, the copy at its version, and what it was made from', async () => {
    const original = await document([]);
    const copied = await copying('ada', original, { to: closed, title: 'Audited' });
    expect(copied.statusCode, copied.body).toBe(200);
    const { id, version } = copied.json<{ id: string; version: string }>();
    const events = await tenantDb.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['actor', 'subject', 'subject_version', 'space', 'detail', 'at'])
        .where('kind', '=', 'artifact.copied')
        .where('subject', '=', id)
        .execute(),
    );
    expect(events).toMatchObject([
      {
        actor: ids['ada'],
        subject: id,
        subject_version: version,
        space: closed,
        detail: { from: original },
      },
    ]);
    expect(events[0]!.at).toBeInstanceOf(Date);
  });
});
