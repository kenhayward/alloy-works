import { randomUUID } from 'node:crypto';
import type { BridgeSettingsView } from '@alloy-works/api-contract';
import {
  createArtifact,
  createSpace,
  createTemplate,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  archiveSpace,
  recordUnlisted,
  STARTER_COMPONENT_TYPE_ID,
  usableCredentialOf,
} from '@alloy-works/db';
import { auditEvents, queryAs } from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';
import { DELIVERED_URL, ensureDeliveredDatabase } from './test/delivered.js';

const TITLE_FIELD = 'b9a10000-0000-4000-8000-000000000001';
const SCHEMA = 'b9a10000-0000-4000-8000-000000000003';
const PROPERTY_MAP = { Title: TITLE_FIELD };

const settingsUrl = (space: string) => `/v1/spaces/${space}/bridge-settings`;
const off = {
  componentType: null,
  template: null,
  propertyMap: {},
  data: false,
};

describe('bridge settings through the service', () => {
  let h: Harness;
  let bare: Harness;
  let template: string;
  let other: string;
  let third: string;

  /** What the service answered or recorded, to be searched for a password. */
  const seen: string[] = [];
  const put = async (space: string, body: unknown, as = 'ada') => {
    const answer = await h.call(as, 'PUT', settingsUrl(space), body);
    seen.push(answer.body);
    return answer;
  };
  /** The password the connector was last asked to seal for a connection. */
  const sealedFor = (connection: string) =>
    h.connector.asked
      .filter((each) => each.path === '/v1/seal')
      .map((each) => each.body as { connection: string; secret: string })
      .filter((body) => body.connection === connection)
      .map((body) => body.secret);
  const credentialOf = async (connection: string) => {
    const usable = await h.tenantDb.withTenant(h.tenant, (trx) =>
      usableCredentialOf(trx, connection),
    );
    return usable.answer === 'usable' ? usable.sealed : undefined;
  };
  /** Signs in to the delivery store as a connection's account with a password: throws if refused. */
  const signInAs = (account: string, password: string) => {
    const url = new URL(DELIVERED_URL);
    url.username = account;
    url.password = password;
    return queryAs(url.toString(), 'select 1 as ok');
  };
  const accountOf = async (connection: string) =>
    (
      (await h.call('ada', 'GET', `/v1/connections/${connection}`)).json() as {
        settings: { source: { account: string } };
      }
    ).settings.source.account;
  const seals = () =>
    h.connector.asked
      .filter((each) => each.path === '/v1/seal')
      .map(
        (each) =>
          each.body as {
            connection: string;
            secret: string;
            settings: { source: { host: string } };
          },
      );
  const events = (kind: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx.selectFrom('audit_event').select('detail').where('kind', '=', kind).execute(),
    );

  beforeAll(async () => {
    await ensureDeliveredDatabase();

    h = await startHarness({ secrets: { SECRET_DELIVERED_URL: DELIVERED_URL } });
    bare = await startHarness();
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      other = (await createSpace(trx, 'Other')).id;
      third = (await createSpace(trx, 'Third')).id;
      await createArtifact(trx, {
        author: h.ids.ada!,
        substance: {
          kind: 'field',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: TITLE_FIELD,
            name: 'Title',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      await createArtifact(trx, {
        author: h.ids.ada!,
        substance: {
          kind: 'metadataSchema',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: SCHEMA,
            name: 'Report',
            entries: [{ field: TITLE_FIELD, required: false, fixed: false }],
          },
        },
      });
      const made = await createTemplate(trx, {
        spaceId: h.general,
        author: h.ids.ada!,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [{ schema: SCHEMA, level: 'document', requires: [] }],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      template = made.template.id;
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
    await bare?.close();
  });

  it('answers the empty settings, data delivery off, for a space never set up', async () => {
    const answer = await h.call('ada', 'GET', settingsUrl(h.general));
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({ ...off, connection: null, unlisted: [] });
  });

  it("stores a space's component type, template and property map, and records the change", async () => {
    const answer = await put(h.general, {
      componentType: STARTER_COMPONENT_TYPE_ID,
      template,
      propertyMap: PROPERTY_MAP,
      data: false,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({
      componentType: STARTER_COMPONENT_TYPE_ID,
      template,
      propertyMap: PROPERTY_MAP,
      data: false,
      connection: null,
      unlisted: [],
    });
    const read = await h.call('ada', 'GET', settingsUrl(h.general));
    expect(read.json()).toEqual(answer.json());
    expect(await events('bridge.settings_changed')).toContainEqual({
      detail: { changed: ['componentType', 'template', 'propertyMap'] },
    });
  });

  it('a property mapped to a field not in the template is refused', async () => {
    const stranger = randomUUID();
    const answer = await put(h.general, {
      componentType: null,
      template,
      propertyMap: { Title: TITLE_FIELD, Author: stranger },
      data: false,
    });
    expect(answer.statusCode, answer.body).toBe(422);
    expect(answer.json()).toMatchObject({
      code: 'bridge_settings_invalid',
      problems: [{ path: 'propertyMap.Author', reason: 'field_not_in_template' }],
    });
    // With no template, every property is unmapped, so any mapping is refused too.
    const blank = await put(h.general, {
      componentType: null,
      template: null,
      propertyMap: PROPERTY_MAP,
      data: false,
    });
    expect(blank.statusCode, blank.body).toBe(422);
    // Nothing was changed by either.
    const read = await h.call('ada', 'GET', settingsUrl(h.general));
    expect(read.json()).toMatchObject({ template, propertyMap: PROPERTY_MAP });
  });

  it('refuses a component type or template that is not here, or is the wrong kind', async () => {
    const missingType = await put(h.general, { ...off, componentType: randomUUID() });
    expect(missingType.statusCode, missingType.body).toBe(422);
    expect(missingType.json()).toMatchObject({
      problems: [{ path: 'componentType', reason: 'component_type_missing' }],
    });
    // A field is a definition but not a component type; a field is not a template either.
    const wrongType = await put(h.general, { ...off, componentType: TITLE_FIELD });
    expect(wrongType.statusCode, wrongType.body).toBe(422);
    const wrongTemplate = await put(h.general, { ...off, template: TITLE_FIELD });
    expect(wrongTemplate.statusCode, wrongTemplate.body).toBe(422);
    expect(wrongTemplate.json()).toMatchObject({
      problems: [{ path: 'template', reason: 'template_missing' }],
    });
  });

  it("is an administrator's: another caller is refused, and one with no read is told nothing", async () => {
    const reader = await h.call('alice', 'PUT', settingsUrl(h.general), off);
    expect(reader.statusCode).toBe(403);
    const author = await h.call('grace', 'GET', settingsUrl(h.general));
    expect(author.statusCode).toBe(403);
    const stranger = await h.call('ivy', 'PUT', settingsUrl(h.general), off);
    expect(stranger.statusCode).toBe(404);
  });

  it('API-072 turning data on makes a connection whose credential no response shows', async () => {
    const answer = await put(h.general, {
      componentType: null,
      template,
      propertyMap: PROPERTY_MAP,
      data: true,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const view = answer.json<BridgeSettingsView>();
    expect(view).toMatchObject({ data: true, template, propertyMap: PROPERTY_MAP });
    expect(view.connection).toMatch(/^[0-9a-f-]{36}$/);

    // The connection is the delivery store's, signed in as the tenant's read account, TLS required.
    const connection = await h.call('ada', 'GET', `/v1/connections/${view.connection}`);
    expect(connection.statusCode, connection.body).toBe(200);
    seen.push(connection.body);
    const body = connection.json<{
      settings: { type: string; identity: unknown; source: Record<string, unknown> };
      credential: { set: boolean };
    }>();
    expect(body.settings).toMatchObject({
      type: 'postgres',
      identity: { kind: 'service' },
      source: { host: 'delivered-postgres', tls: 'require', database: 'delivered' },
    });
    expect(body.settings.source.account).toMatch(/_read$/);
    expect(body.credential.set).toBe(true);

    // Sealed by the connector, once, for the delivery store and no other host, from a password
    // nobody was told.
    expect(seals()).toHaveLength(1);
    expect(seals()[0]!.settings.source.host).toBe('delivered-postgres');
    const [password] = sealedFor(view.connection!);
    expect(password).toMatch(/^[0-9a-f]{48}$/);
    const sealed = await credentialOf(view.connection!);
    expect(sealed).toMatch(/^v1\./);

    // The password is in no response seen so far, nor in the sealed value, nor the audit log; nor is
    // the store's URL.
    const audit = await h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx));
    for (const text of [...seen, JSON.stringify(audit), ...h.lines]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(DELIVERED_URL);
      expect(text).not.toContain('postgres:postgres');
    }
    expect(sealed).not.toContain(password);
    expect((await h.call('ada', 'GET', settingsUrl(h.general))).body).not.toContain(password!);
    // Recorded as the connection made, its credential set, and the settings changed.
    expect((await events('bridge.settings_changed')).map((row) => row.detail)).toContainEqual({
      changed: ['componentType', 'connection', 'tableSchema'],
    });
    expect((await events('connection.made')).length).toBeGreaterThan(0);
    expect((await events('connection.credential_set')).length).toBeGreaterThan(0);
  });

  it('turning data on again with data already on, to change a mapping, rotates and seals nothing', async () => {
    const before = (await h.call('ada', 'GET', settingsUrl(h.general))).json<BridgeSettingsView>();
    const first = await credentialOf(before.connection!);
    const asked = seals().length;
    const password = sealedFor(before.connection!).at(-1)!;
    const account = await accountOf(before.connection!);
    const answer = await put(h.general, {
      componentType: null,
      template,
      propertyMap: {},
      data: true,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<BridgeSettingsView>()).toMatchObject({
      connection: before.connection,
      data: true,
      propertyMap: {},
    });
    expect(seals()).toHaveLength(asked);
    expect(await credentialOf(before.connection!)).toBe(first);
    // The password the connection holds still signs in.
    await signInAs(account, password);
    // Put the mapping back for the tests that follow.
    await put(h.general, { componentType: null, template, propertyMap: PROPERTY_MAP, data: true });
  });

  it('a second space reuses the schema, gets a connection of its own, and the first keeps working', async () => {
    const first = (await h.call('ada', 'GET', settingsUrl(h.general))).json<BridgeSettingsView>();
    const credentialBefore = await credentialOf(first.connection!);
    await h.allow(h.ids.ada!, h.roles.Administrator!, { kind: 'space', id: other });
    const answer = await put(other, { ...off, data: true });
    expect(answer.statusCode, answer.body).toBe(200);
    const second = answer.json<BridgeSettingsView>();
    expect(second.data).toBe(true);
    expect(second.connection).not.toBe(first.connection);
    // One account for the tenant, so both connections were sealed with the one new password.
    const [newest] = sealedFor(second.connection!);
    expect(sealedFor(first.connection!).at(-1)).toBe(newest);
    expect(await credentialOf(first.connection!)).not.toBe(credentialBefore);
    const one = await h.call('ada', 'GET', `/v1/connections/${first.connection}`);
    const two = await h.call('ada', 'GET', `/v1/connections/${second.connection}`);
    expect((one.json() as { settings: { source: unknown } }).settings.source).toEqual(
      (two.json() as { settings: { source: unknown } }).settings.source,
    );
  });

  it('turning data off keeps the connection and the tables, and names no schema', async () => {
    const before = (await h.call('ada', 'GET', settingsUrl(h.general))).json<BridgeSettingsView>();
    const answer = await put(h.general, {
      componentType: null,
      template,
      propertyMap: PROPERTY_MAP,
      data: false,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({ data: false, connection: before.connection });
    const row = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('bridge_settings')
        .select(['connection_id', 'table_schema'])
        .where('space_id', '=', h.general)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ connection_id: before.connection, table_schema: null });
    // The connection is still there, and its credential still set.
    expect(await credentialOf(before.connection!)).toMatch(/^v1\./);
    // On again, it is the same connection.
    const again = await put(h.general, { ...off, data: true });
    expect(again.json<BridgeSettingsView>().connection).toBe(before.connection);
  });

  it('turning data on with no delivery store is refused 503, not a failure, and changes nothing', async () => {
    const answer = await bare.call('ada', 'PUT', settingsUrl(bare.general), { ...off, data: true });
    expect(answer.statusCode, answer.body).toBe(503);
    expect(answer.json()).toMatchObject({ code: 'delivery_store_unavailable' });
    const read = await bare.call('ada', 'GET', settingsUrl(bare.general));
    expect(read.json()).toEqual({ ...off, connection: null, unlisted: [] });
  });

  it('a connector that does not answer refuses turning data on 503 and stores nothing', async () => {
    h.connector.mode = 'unreachable';
    try {
      const answer = await put(third, { ...off, data: true });
      expect(answer.statusCode, answer.body).toBe(503);
      expect(answer.json()).toMatchObject({ code: 'connector_unavailable' });
      const read = await h.call('ada', 'GET', settingsUrl(third));
      expect(read.json()).toMatchObject({ data: false, connection: null });
    } finally {
      h.connector.mode = 'answer';
    }
  });

  it('a seal that fails leaves the old password working and the old credential in place', async () => {
    const before = (await h.call('ada', 'GET', settingsUrl(h.general))).json<BridgeSettingsView>();
    const account = await accountOf(before.connection!);
    const password = sealedFor(before.connection!).at(-1)!;
    const credential = await credentialOf(before.connection!);
    await put(h.general, { componentType: null, template, propertyMap: PROPERTY_MAP, data: false });
    h.connector.mode = 'unreachable';
    try {
      const answer = await put(h.general, {
        componentType: null,
        template,
        propertyMap: PROPERTY_MAP,
        data: true,
      });
      expect(answer.statusCode, answer.body).toBe(503);
    } finally {
      h.connector.mode = 'answer';
    }
    await signInAs(account, password);
    expect(await credentialOf(before.connection!)).toBe(credential);
    const read = await h.call('ada', 'GET', settingsUrl(h.general));
    expect(read.json()).toMatchObject({ data: false, connection: before.connection });
    // And on, once the connector answers, rotates and signs in with the new one.
    const on = await put(h.general, {
      componentType: null,
      template,
      propertyMap: PROPERTY_MAP,
      data: true,
    });
    expect(on.statusCode, on.body).toBe(200);
    const fresh = sealedFor(before.connection!).at(-1)!;
    expect(fresh).not.toBe(password);
    await signInAs(account, fresh);
  });

  it('a delivery connection edited to point elsewhere is never sealed for, and the space gets a new one', async () => {
    const fourth = (await h.tenantDb.withTenant(h.tenant, (trx) => createSpace(trx, 'Fourth'))).id;
    await h.allow(h.ids.ada!, h.roles.Administrator!, { kind: 'space', id: fourth });
    const made = (await put(fourth, { ...off, data: true })).json<BridgeSettingsView>();
    const view = (await h.call('ada', 'GET', `/v1/connections/${made.connection}`)).json<{
      version: { id: string };
      settings: { source: Record<string, unknown> };
    }>();
    const edited = await h.call('ada', 'POST', `/v1/connections/${made.connection}/versions`, {
      openedFrom: view.version.id,
      settings: {
        ...view.settings,
        source: { ...view.settings.source, host: 'elsewhere.example.test' },
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const asked = seals().length;
    // Turning it on again (its connection no longer points at the store), here and in another space.
    const again = (await put(fourth, { ...off, data: true })).json<BridgeSettingsView>();
    expect(again.connection).not.toBe(made.connection);
    const elsewhere = (await put(third, { ...off, data: true })).json<BridgeSettingsView>();
    expect(elsewhere.data).toBe(true);
    const after = seals().slice(asked);
    expect(after.length).toBeGreaterThan(0);
    for (const each of after) {
      expect(each.settings.source.host).toBe('delivered-postgres');
      expect(each.connection).not.toBe(made.connection);
    }
  });

  it('a delivery store that is set but does not answer is refused 503, naming neither it nor its URL', async () => {
    const url = 'postgres://owner:hunter2-canary@127.0.0.1:1/delivered_test';
    const down = await startHarness({ secrets: { SECRET_DELIVERED_URL: url } });
    try {
      const answer = await down.call('ada', 'PUT', settingsUrl(down.general), {
        ...off,
        data: true,
      });
      expect(answer.statusCode, answer.body).toBe(503);
      expect(answer.json()).toMatchObject({ code: 'delivery_store_unavailable' });
      for (const text of [answer.body, ...down.lines]) {
        expect(text).not.toContain('hunter2-canary');
        expect(text).not.toContain('127.0.0.1:1');
      }
      const read = await down.call('ada', 'GET', settingsUrl(down.general));
      expect(read.json()).toEqual({ ...off, connection: null, unlisted: [] });
    } finally {
      await down.close();
    }
  });

  it('turning data on in an archived space is refused 409 space_archived', async () => {
    const archived = (await h.tenantDb.withTenant(h.tenant, (trx) => createSpace(trx, 'Old'))).id;
    await h.tenantDb.withTenant(h.tenant, (trx) => archiveSpace(trx, archived, h.ids.ada!));
    const answer = await h.call('ada', 'PUT', settingsUrl(archived), { ...off, data: true });
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'space_archived' });
  });

  it('no password the connector was asked to seal is in any response, the audit log or the logs', async () => {
    const passwords = new Set(seals().map((each) => each.secret));
    expect(passwords.size).toBeGreaterThan(3);
    const audit = JSON.stringify(await h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx)));
    for (const password of passwords) {
      for (const text of [...seen, audit, ...h.lines]) expect(text).not.toContain(password);
    }
  });

  it('API-076 a property mapped to null is stored and read back as ignored', async () => {
    const answer = await put(h.general, {
      componentType: null,
      template: null,
      propertyMap: { Draft: null },
      data: false,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const read = await h.call('ada', 'GET', settingsUrl(h.general));
    expect(read.json()).toMatchObject({ propertyMap: { Draft: null } });
  });

  it('API-076 the settings view lists unlisted properties and saving a mapping drops them', async () => {
    const at = new Date('2026-10-30T09:00:00Z');
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordUnlisted(trx, h.general, ['Owner', 'Draft'], at),
    );
    const read = await h.call('ada', 'GET', settingsUrl(h.general));
    expect((read.json() as BridgeSettingsView).unlisted).toEqual([
      {
        name: 'Draft',
        firstDelivered: at.toISOString(),
        lastDelivered: at.toISOString(),
        deliveries: 1,
      },
      {
        name: 'Owner',
        firstDelivered: at.toISOString(),
        lastDelivered: at.toISOString(),
        deliveries: 1,
      },
    ]);
    const saved = await put(h.general, {
      componentType: null,
      template: null,
      propertyMap: { Owner: null },
      data: false,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as BridgeSettingsView).unlisted.map((each) => each.name)).toEqual([
      'Draft',
    ]);
  });
});
