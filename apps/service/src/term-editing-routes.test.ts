import { randomUUID } from 'node:crypto';
import {
  endRun,
  findRole,
  grant,
  listModelEndpoints,
  makeCreationProposal,
  readVersion,
  recordVersion,
  startRun,
  substanceOf,
} from '@alloy-works/db';
import type { ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

const termBody = (preferred: string, abbreviation: string, more: Json = {}) => ({
  schemaVersion: 1,
  base: 'en',
  labels: [{ language: 'en', preferred, alternatives: [], abbreviation }],
  definition: [],
  broader: [],
  narrower: [],
  related: [],
  ...more,
});

/**
 * Terms in the editor (the TM plan, TMc, TM-K): a save, a suggestion or a restore refusing a new term
 * mark naming no term of the component's space its author may read, and each used term's standing
 * for the editor's flags. Ada reads everything and approves in General; Grace authors General alone;
 * Ivy reads nothing.
 */
describe('terms in the editor (the TM plan, TMc)', () => {
  let h: Harness;
  let approved: string;
  let draft: string;
  let deprecated: string;
  let quality: string;

  const make = async (space: string, body: Json) => {
    const made = await h.call('ada', 'POST', `/v1/spaces/${space}/terms`, { term: body });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string; version: { id: string } }>();
  };
  const approve = async (term: { id: string; version: { id: string } }) => {
    const done = await h.call('ada', 'POST', `/v1/terms/${term.id}/approvals`, {
      transition: 'approve',
      version: term.version.id,
      decision: 'approved',
    });
    expect(done.statusCode, done.body).toBe(200);
  };

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
    // Grace makes General's terms, so Ada, not their author, approves them.
    const madeBy = async (body: Json) => {
      const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms`, { term: body });
      expect(made.statusCode, made.body).toBe(200);
      return made.json<{ id: string; version: { id: string } }>();
    };
    const healthy = await madeBy(termBody('World Health Organization', 'WHO'));
    await approve(healthy);
    approved = healthy.id;
    draft = (await madeBy(termBody('Sea level', 'SL'))).id;
    const old = await madeBy(termBody('Mean tide', 'MT', { replacedBy: approved }));
    await approve(old);
    const moved = await h.call('ada', 'POST', `/v1/terms/${old.id}/transitions`, {
      transition: 'deprecate',
      from: 'approved',
      reason: 'Say the other',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    deprecated = old.id;
    quality = (await make(h.quality, termBody('Salt marsh', 'SM'))).id;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const termed = (term: string, value = 'WHO') => ({
    type: 'text',
    value,
    marks: [{ type: 'definedTerm', id: 'd1', term }],
  });
  const contentOf = (inlines: unknown[]) => ({
    schemaVersion: 1,
    title: 'Readings',
    language: 'en-GB',
    direction: 'ltr',
    content: [{ type: 'paragraph', id: 'p1', style: 'body', content: inlines }],
  });

  /** Saves one paragraph of these inlines as `as`, from the component's version, and answers it. */
  const save = async (
    as: string,
    component: { id: string; version: string },
    inlines: unknown[],
  ) => {
    const session = randomUUID();
    const claimed = await h.call(as, 'POST', `/v1/components/${component.id}/lock`, {
      session,
      move: true,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const saved = await h.call(
      as,
      'PUT',
      `/v1/components/${component.id}/iterations/${session}/1`,
      { openedFrom: component.version, content: contentOf(inlines) },
    );
    const released = await h.call(
      as,
      'DELETE',
      `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version}`,
    );
    if (saved.statusCode === 200) {
      component.version = released.json<{ version: { id: string } }>().version.id;
    }
    return saved;
  };

  /** Cuts a version holding these inlines directly, as a component carried in from elsewhere. */
  const cut = (component: { id: string }, from: string, inlines: unknown[]) =>
    h.tenantDb.withTenant(h.tenant, async (trx) => {
      const opened = (await readVersion(trx, from))!;
      const substance = substanceOf(opened);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content = { ...substance.content, ...contentOf(inlines) } as ContentDocument;
      const next = await recordVersion(trx, {
        artifactId: component.id,
        openedFrom: opened.id,
        author: h.ids.ada!,
        substance: { ...substance, content },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version.id;
    });

  it("refuses a save whose new term names no term of the component's space its author may read", async () => {
    const component = await h.component(h.general, 'The health section');
    expect((await save('grace', component, [termed(approved)])).statusCode).toBe(200);
    for (const each of [termed(quality), termed('00000000-0000-4000-8000-0000000000aa')]) {
      const refused = await save('grace', component, [each]);
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).toMatchObject({ code: 'term_unreadable' });
      expect(refused.body).not.toContain('Salt marsh');
    }
    // Ada reads Quality, and is still refused one of its terms in a General component.
    expect((await save('ada', component, [termed(quality)])).statusCode).toBe(400);
  });

  it('leaves a term the version it opened from already used alone, readable or not', async () => {
    const component = await h.component(h.general, 'The marsh section');
    component.version = await cut(component, component.version, [termed(quality, 'SM')]);
    const saved = await save('grace', component, [
      { type: 'text', value: 'Marshes ', marks: [] },
      termed(quality, 'SM'),
    ]);
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it('refuses a suggestion, and a restore, using a term its maker may not read', async () => {
    const component = await h.component(h.general, 'The suggested section');
    const suggested = await h.call('grace', 'POST', `/v1/components/${component.id}/suggestions`, {
      version: component.version,
      content: contentOf([termed(quality)]),
    });
    expect(suggested.statusCode, suggested.body).toBe(400);
    expect(suggested.json()).toMatchObject({ code: 'term_unreadable' });

    const used = await cut(component, component.version, [termed(quality)]);
    const latest = await cut(component, used, [{ type: 'text', value: 'Plain', marks: [] }]);
    const path = `/v1/components/${component.id}/versions/${used}`;
    const previewed = await h.call('grace', 'GET', `${path}/restoration`);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.json()).toMatchObject({ refusals: [{ code: 'term_unreadable' }] });
    const restored = await h.call('grace', 'POST', `${path}/restore`, { latest });
    expect(restored.statusCode, restored.body).toBe(400);
    expect(restored.json()).toMatchObject({ code: 'term_unreadable' });
  });

  it("LIB-018 answers each used term's standing for the editor, its replacement named, and nothing of one its reader may not read", async () => {
    const component = await h.component(h.general, 'The flagged section');
    const asked = {
      terms: [approved, draft, deprecated, quality, '00000000-0000-4000-8000-0000000000aa'],
    };
    const shown = await h.call(
      'grace',
      'POST',
      `/v1/components/${component.id}/terms/preview`,
      asked,
    );
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.json()).toEqual({
      terms: [
        { standing: 'approved', label: 'World Health Organization', replacedBy: null },
        { standing: 'draft', label: 'Sea level', replacedBy: null },
        {
          standing: 'deprecated',
          label: 'Mean tide',
          replacedBy: { id: approved, label: 'World Health Organization' },
        },
        { standing: 'unavailable', label: null, replacedBy: null },
        { standing: 'unavailable', label: null, replacedBy: null },
      ],
    });
    expect(shown.body).not.toContain('Salt marsh');
    const ivy = await h.call('ivy', 'POST', `/v1/components/${component.id}/terms/preview`, asked);
    expect(ivy.statusCode).toBe(404);
  });

  it('names no replacement its reader may not read', async () => {
    const hidden = await make(h.general, termBody('Low water', 'LW'));
    // Grace's, so Ada approves it.
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms`, {
      term: termBody('Ebb', 'EB', { replacedBy: hidden.id }),
    });
    expect(made.statusCode, made.body).toBe(200);
    const old = made.json<{ id: string; version: { id: string } }>();
    await approve(old);
    const reader = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Reader'));
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      grant(trx, {
        roleId: reader!.id,
        subject: { principal: h.ids.grace! },
        level: { kind: 'artifact', id: hidden.id },
        effect: 'deny',
        grantedBy: h.ids.ada!,
      }),
    );
    const moved = await h.call('ada', 'POST', `/v1/terms/${old.id}/transitions`, {
      transition: 'deprecate',
      from: 'approved',
      reason: 'Say the other',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const component = await h.component(h.general, 'The ebb section');
    const shown = await h.call('grace', 'POST', `/v1/components/${component.id}/terms/preview`, {
      terms: [old.id],
    });
    expect(shown.json()).toEqual({
      terms: [{ standing: 'deprecated', label: 'Ebb', replacedBy: null }],
    });
  });

  it('refuses a proposal accepted to make a component that uses a term or cites an entry its acceptor may not read', async () => {
    const made = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Drafting',
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-1',
        contextWindow: 200_000,
        priceIn: 3,
        priceOut: 15,
        currency: 'USD',
        boundary: 'outside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint;
    expect(made.id).toBeDefined();
    const entry = await h.call('ada', 'POST', `/v1/spaces/${h.quality}/bibliography-entries`, {
      entry: {
        csl: {
          type: 'book',
          title: 'Tides of Quality',
          author: [{ family: 'Hopper', given: 'Grace' }],
          issued: { 'date-parts': [[2021]] },
        },
      },
    });
    expect(entry.statusCode, entry.body).toBe(200);
    const entryId = entry.json<{ entry: { id: string } }>().entry.id;
    const proposing = (inlines: unknown[]) =>
      h.tenantDb.withTenant(h.tenant, async (trx) => {
        const endpoint = (await listModelEndpoints(trx)).find((each) => each.name === 'Drafting')!;
        const run = await startRun(trx, {
          purpose: 'drafting',
          endpoint,
          parameters: { instructions: 'assistant-1' },
          contextDigest: 'f'.repeat(64),
          by: h.ids.grace!,
        });
        await endRun(trx, run, {
          outcome: 'finished',
          model: 'stand-in-1',
          usage: { in: 1, out: 1 },
        });
        return makeCreationProposal(trx, {
          run,
          creates: { space: h.general, title: 'Tides', language: 'en-GB', direction: 'ltr' },
          proposed: contentOf(inlines) as ContentDocument,
        });
      });
    const accept = (id: string) =>
      h.call('grace', 'POST', `/v1/assistant/proposals/${id}/acceptance`);
    const unreadableTerm = await accept((await proposing([termed(quality)])).id);
    expect(unreadableTerm.statusCode, unreadableTerm.body).toBe(400);
    expect(unreadableTerm.json()).toMatchObject({ code: 'term_unreadable' });
    const unreadableEntry = await accept(
      (await proposing([{ type: 'citation', entry: entryId }])).id,
    );
    expect(unreadableEntry.statusCode, unreadableEntry.body).toBe(400);
    expect(unreadableEntry.json()).toMatchObject({ code: 'citation_unreadable' });
    const readable = await accept((await proposing([termed(approved)])).id);
    expect(readable.statusCode, readable.body).toBe(200);
  });
});
