import { failRangePreview, readRangePreview, recordRangePages } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

const SESSION = '44444444-4444-4444-8444-444444444444';
/** The eight bytes every PNG begins with, and enough after them to stand for a page. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

describe('the warm range preview through the service (the R22 plan)', () => {
  let h: Harness;
  let document: { id: string; version: string; nodes: string[] };
  let range = '';

  beforeAll(async () => {
    h = await startHarness();
    const component = await h.component(h.general, 'Pump care');
    document = await h.documentReferencing([component.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const view = (as = 'ada') =>
    h.call(as, 'GET', `/v1/documents/${document.id}/range-previews/${range}`);

  it('PUB-080 says on every page, and on screen, that a range preview is untagged, and names the tagged PDF as the accessible path', async () => {
    const asked = await h.call('ada', 'POST', `/v1/documents/${document.id}/range-previews`, {
      version: document.version,
      node: document.nodes[0],
      session: SESSION,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    range = asked.json<{ id: string }>().id;
    expect(asked.json()).toMatchObject({ state: 'waiting', images: [] });

    // Drawn as the worker draws it: pages 1 to 2 of 2.
    const held = (await h.tenantDb.withTenant(h.tenant, (trx) => readRangePreview(trx, range)))!;
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordRangePages(trx, {
        id: range,
        made: held.wanted,
        sequence: null,
        pages: 2,
        range: { from: 1, to: 2 },
        images: [
          { page: 1, png: PNG },
          { page: 2, png: PNG },
        ],
      }),
    );
    const shown = (await view()).json<{
      state: string;
      images: { page: number; alternative: string }[];
      untagged: string;
    }>();
    expect(shown.state).toBe('ready');
    expect(shown.images.map((each) => each.page)).toEqual([1, 2]);
    for (const image of shown.images) {
      expect(image.alternative).toMatch(/untagged/);
      expect(image.alternative).toMatch(/Preview, which makes the tagged PDF/);
    }
    expect(shown.untagged).toMatch(/untagged/);
    expect(shown.untagged).toMatch(/tagged PDF/);
    // No dash in what a reader is told.
    expect(JSON.stringify(shown)).not.toMatch(/[–—]/);

    const page = await h.call(
      'ada',
      'GET',
      `/v1/documents/${document.id}/range-previews/${range}/pages/1`,
    );
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('image/png');
    expect(page.rawPayload.equals(PNG)).toBe(true);
  });

  it('CNT-186 refreshes a range preview after each save, for its asker alone', async () => {
    const refreshed = await h.call(
      'ada',
      'POST',
      `/v1/documents/${document.id}/range-previews/${range}/refresh`,
    );
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({ state: 'waiting' });
    // Anybody else is answered as if there were none, Alice who reads the document among them.
    expect((await view('alice')).statusCode).toBe(404);
    expect(
      (await h.call('alice', 'GET', `/v1/documents/${document.id}/range-previews/${range}/pages/1`))
        .statusCode,
    ).toBe(404);
    // A node the version places nothing at is refused by name.
    const nowhere = await h.call('ada', 'POST', `/v1/documents/${document.id}/range-previews`, {
      version: document.version,
      node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      session: SESSION,
    });
    expect(nowhere.statusCode).toBe(400);
    expect(nowhere.json()).toMatchObject({ code: 'node_missing' });
  });

  it('CNT-186 draws a save asked for after one that failed, and says it failed only when none is waiting', async () => {
    const refresh = () =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/range-previews/${range}/refresh`);
    await refresh();
    const asked = (await h.tenantDb.withTenant(h.tenant, (trx) => readRangePreview(trx, range)))!;
    // The refresh before this one's last attempt failed: this one still waits, and then is drawn.
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      failRangePreview(trx, asked.requestId, 'failed', asked.wanted - 1),
    );
    expect((await view()).json()).toMatchObject({ state: 'waiting' });
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      failRangePreview(trx, asked.requestId, 'failed', asked.wanted),
    );
    expect((await view()).json()).toMatchObject({ state: 'failed' });
    await refresh();
    const again = (await h.tenantDb.withTenant(h.tenant, (trx) => readRangePreview(trx, range)))!;
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordRangePages(trx, {
        id: range,
        made: again.wanted,
        sequence: 2,
        pages: 2,
        range: { from: 1, to: 2 },
        images: [{ page: 1, png: PNG }],
      }),
    );
    expect((await view()).json()).toMatchObject({ state: 'ready', sequence: 2, failure: null });
  });
});
