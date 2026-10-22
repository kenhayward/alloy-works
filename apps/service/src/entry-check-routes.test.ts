import { readReferenceAnswer, type ReferenceRequest } from '@alloy-works/domain';
import {
  crossrefMarshRetraction,
  crossrefUpdates,
  crossrefWork,
} from '@alloy-works/domain/sources-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

/**
 * Re-checks through the API (the XR plan, XR-E to XR-H): Check now, the status beside the entry, the
 * flags on each citation and in the document's Review, the owner told, and the warning at publish.
 * Ada administers; Grace authors General; Ivy reads nothing until given Quality.
 */
describe('re-checking an entry against its source (the XR plan, XRb)', () => {
  let h: Harness;
  let retracted = true;

  /** The fake source: the marsh, retracted while `retracted`, else current. */
  const answering = (request: ReferenceRequest) => {
    const updates = crossrefUpdates(retracted ? [crossrefMarshRetraction] : []);
    const results = readReferenceAnswer('crossref', request.op, crossrefWork(), updates) ?? [];
    return {
      type: 'found' as const,
      results: results.filter((each) => each.identifier === request.identifier),
    };
  };

  beforeAll(async () => {
    h = await startHarness();
    h.connector.referenceFor = answering;
    // Ada makes the document in Quality.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const obtained = async () => {
    const made = await h.call(
      'grace',
      'POST',
      `/v1/spaces/${h.general}/bibliography-entries/from-source`,
      { source: 'crossref', identifier: '10.5555/marsh.2021.017', despiteMatches: true },
    );
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ entry: { id: string } }>().entry.id;
  };
  const check = (as: string, entry: string) =>
    h.call(as, 'POST', `/v1/bibliography-entries/${entry}/check`);

  it('LIB-036 checks an entry against its source as an editor of it, its status recorded beside it and never a version', async () => {
    const entry = await obtained();
    // Alice reads General and edits nothing: she may not write a status.
    const reader = await check('alice', entry);
    expect(reader.statusCode).toBe(403);
    const checked = await check('grace', entry);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json()).toMatchObject({
      source: 'crossref',
      outcome: 'retracted',
      differs: [],
      notice: { kind: 'retraction', identifier: '10.5555/marsh.2021.017.retraction' },
    });
    // The identifier alone was sent.
    expect(h.connector.asked.at(-1)?.body).toMatchObject({
      source: 'crossref',
      op: 'check',
      identifier: '10.5555/marsh.2021.017',
    });
    const read = await h.call('alice', 'GET', `/v1/bibliography-entries/${entry}`);
    expect(read.json()).toMatchObject({
      version: { number: '0.1' },
      status: { outcome: 'retracted' },
    });
    // Ivy reads nothing of it.
    expect((await check('ivy', entry)).statusCode).toBe(404);
  });

  it('checks an entry at most once a minute, asking nothing the second time', async () => {
    const entry = await obtained();
    expect((await check('grace', entry)).statusCode).toBe(200);
    const asked = h.connector.asked.length;
    const again = await check('grace', entry);
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'entry_checked_recently' });
    expect(h.connector.asked.length).toBe(asked);
  });

  it('refuses an entry made by hand, and a source switched off, asking nothing', async () => {
    const byHand = await h.call('grace', 'POST', `/v1/spaces/${h.general}/bibliography-entries`, {
      entry: { csl: { type: 'book', title: 'Wombat Ways' } },
      despiteMatches: true,
    });
    const id = byHand.json<{ entry: { id: string } }>().entry.id;
    const asked = h.connector.asked.length;
    const refused = await check('grace', id);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ code: 'entry_not_obtained' });
    const entry = await obtained();
    await h.call('ada', 'PUT', '/v1/reference-sources', { source: 'crossref', enabled: false });
    try {
      const off = await check('grace', entry);
      expect(off.statusCode).toBe(409);
      expect(off.json()).toMatchObject({ code: 'reference_source_off' });
    } finally {
      await h.call('ada', 'PUT', '/v1/reference-sources', { source: 'crossref', enabled: true });
    }
    expect(h.connector.asked.length).toBe(asked + 1);
  });

  it('LIB-036 flags each citation, in the editor, the dialog and the Review, the flag alone to one who may not read the entry; tells the owner; warns at publish', async () => {
    retracted = true;
    const entry = await obtained();
    const component = await h.component(h.general, 'The marsh section');
    await h.place(component, { type: 'citation', entry });
    const document = await h.documentReferencing([component.id], h.quality);
    expect((await check('grace', entry)).json()).toMatchObject({ outcome: 'retracted' });

    // The editor's preview flags it.
    const preview = await h.call(
      'grace',
      'POST',
      `/v1/components/${component.id}/citations/preview`,
      {
        citations: [{ entry }],
      },
    );
    expect(preview.json()).toMatchObject({ flags: ['retracted'] });
    // The Cite dialog's list flags it.
    const listed = await h.call('grace', 'GET', `/v1/spaces/${h.general}/bibliography-entries`);
    expect(
      listed
        .json<{ items: { id: string; flag: string | null }[] }>()
        .items.find((each) => each.id === entry)?.flag,
    ).toBe('retracted');

    // The document's Review lists it, named to Ada.
    const flagged = await h.call('ada', 'GET', `/v1/documents/${document.id}/flagged-sources`);
    expect(flagged.statusCode, flagged.body).toBe(200);
    expect(flagged.json()).toEqual({
      items: [
        {
          flag: 'retracted',
          entry: { id: entry, key: expect.any(String), title: expect.any(String) },
          // Its title at its latest version: the harness's placed content titles it Readings.
          components: [{ id: component.id, title: 'Readings' }],
          unreadable: false,
        },
      ],
    });
    // Ivy, given Quality alone, reads the document: the flag, and nothing of the entry.
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'space', id: h.quality });
    const alone = await h.call('ivy', 'GET', `/v1/documents/${document.id}/flagged-sources`);
    expect(alone.json()).toEqual({
      items: [{ flag: 'retracted', entry: null, components: [], unreadable: true }],
    });
    expect(alone.body).not.toContain('Salt Marsh');

    // Ada made the document and owns none of its review, so she is told, once.
    const inbox = await h.call('ada', 'GET', '/v1/inbox');
    const told = inbox
      .json<{ notifications: { kind: string; on: { id: string } | null; reference: unknown }[] }>()
      .notifications.filter((each) => each.kind === 'reference');
    expect(told).toEqual([
      expect.objectContaining({
        on: expect.objectContaining({ id: document.id }),
        reference: { entry, outcome: 'retracted' },
      }),
    ]);

    // A publication's request is warned, not stopped: a preview's, which Ada may ask for, as any.
    const published = await h.call('ada', 'POST', `/v1/documents/${document.id}/previews`, {
      version: document.version,
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({
      warnings: [{ code: 'source_retracted', count: 1 }],
    });
  });
});
