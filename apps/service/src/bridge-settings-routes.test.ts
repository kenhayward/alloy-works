import { randomUUID } from 'node:crypto';
import type { BridgeSettingsView } from '@alloy-works/api-contract';
import {
  createArtifact,
  createSpace,
  createTemplate,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  STARTER_COMPONENT_TYPE_ID,
  usableCredentialOf,
} from '@alloy-works/db';
import { auditEvents, queryAs } from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

/** The throwaway Postgres of the CS plan; the delivery store's database in it is made below. */
const OWNER_URL = 'postgres://postgres:postgres@127.0.0.1:5436/delivered_test';

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
  const events = (kind: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx.selectFrom('audit_event').select('detail').where('kind', '=', kind).execute(),
    );

  beforeAll(async () => {
    // The delivery store's database: owned by the throwaway Postgres' superuser, as the real one is.
    const server = OWNER_URL.replace('delivered_test', 'postgres');
    const found = await queryAs(
      server,
      "select 1 from pg_database where datname = 'delivered_test'",
    );
    if (found.rowCount === 0) await queryAs(server, 'create database delivered_test');

    h = await startHarness({ secrets: { SECRET_DELIVERED_URL: OWNER_URL } });
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
    expect(answer.json()).toEqual({ ...off, connection: null });
  });

  it("API-071 stores a space's component type, template and property map, and records the change", async () => {
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

    // Sealed by the connector, once, from a password nobody was told.
    const [password] = sealedFor(view.connection!);
    expect(password).toMatch(/^[0-9a-f]{48}$/);
    const sealed = await credentialOf(view.connection!);
    expect(sealed).toMatch(/^v1\./);

    // The password is in no response seen so far, nor in the sealed value, nor the audit log; nor is
    // the store's URL.
    const audit = await h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx));
    for (const text of [...seen, JSON.stringify(audit), ...h.lines]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(OWNER_URL);
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

  it('turning data on again makes a new password and seals it onto the connection it has', async () => {
    const before = (await h.call('ada', 'GET', settingsUrl(h.general))).json<BridgeSettingsView>();
    const first = await credentialOf(before.connection!);
    const answer = await put(h.general, {
      componentType: null,
      template,
      propertyMap: PROPERTY_MAP,
      data: true,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<BridgeSettingsView>().connection).toBe(before.connection);
    const passwords = sealedFor(before.connection!);
    expect(passwords.length).toBeGreaterThanOrEqual(2);
    expect(new Set(passwords).size).toBe(passwords.length);
    expect(await credentialOf(before.connection!)).not.toBe(first);
    for (const password of passwords) {
      for (const text of seen) expect(text).not.toContain(password);
    }
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
    expect(read.json()).toEqual({ ...off, connection: null });
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
});
