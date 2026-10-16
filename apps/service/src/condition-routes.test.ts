import { createDefinition } from '@alloy-works/db';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

/** A document's profile and a publish's, through the service (the R6 plan, R6-B, R6-F). */
describe('profiles, through the service', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ development: true });
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const made = await createDefinition(trx, {
        kind: 'conditionAxis',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Audience',
          key: 'audience',
          values: [
            { key: 'regulator', label: 'Regulator' },
            { key: 'internal', label: 'Internal' },
          ],
        },
        author: h.ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
    });
  });

  afterAll(async () => {
    await h?.close();
  });

  const latest = async (document: string) =>
    (await h.call('ada', 'GET', `/v1/documents/${document}`)).json<{
      version: { id: string };
      outline: { profile?: unknown };
    }>();

  it("writes a document's profile whole, refusing what no axis declares by name", async () => {
    const component = await h.component(h.general, 'Notice');
    const document = await h.documentReferencing([component.id]);
    const write = async (profile: unknown) =>
      h.call('ada', 'PUT', `/v1/documents/${document.id}/profile`, {
        openedFrom: (await latest(document.id)).version.id,
        profile,
      });

    const unknown = await write({ values: { audience: ['public'], tone: ['plain'] } });
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect(unknown.json()).toMatchObject({
      code: 'profile_invalid',
      unknown: ['audience.public', 'tone'],
    });

    const written = await write({ values: { audience: ['regulator'] }, excludeUnset: true });
    expect(written.statusCode, written.body).toBe(200);
    expect((await latest(document.id)).outline.profile).toEqual({
      values: { audience: ['regulator'] },
      excludeUnset: true,
    });

    const cleared = await write(null);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((await latest(document.id)).outline).not.toHaveProperty('profile');
  });

  it('publishes under a profile named in place of the document own, refusing one no axis declares', async () => {
    const component = await h.component(h.general, 'Notice');
    const document = await h.documentReferencing([component.id]);
    const publish = async (profile: unknown) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/publications`, {
        version: (await latest(document.id)).version.id,
        formats: ['pdf'],
        profile,
      });
    const refused = await publish({ values: { audience: ['public'] } });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({ code: 'profile_invalid', unknown: ['audience.public'] });
    const asked = await publish({ values: { audience: ['internal'] } });
    expect(asked.statusCode, asked.body).toBe(200);
  });
});
