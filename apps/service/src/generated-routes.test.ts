import {
  endRun,
  findRole,
  listModelEndpoints,
  makeCreationProposal,
  makeProposal,
  publicationGenerated,
  readVersion,
  recordPublication,
  requestPublication,
  startRun,
} from '@alloy-works/db';
import { SEED_DOCUMENT_WORKFLOW, type ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

describe('generated content reaching publishing (the G3 plan)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
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
    await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
    // Ada publishes in General too.
    const publisher = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Publisher'));
    await h.allow(h.ids.ada!, publisher!.id, { kind: 'space', id: h.general });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** A part placed in a new document, its paragraph p1 saying `text`. */
  const placed = async (title: string, text: string) => {
    const component = await h.component(h.general, title);
    await h.place(component, { type: 'text', value: text, marks: [] });
    const document = await h.documentReferencing([component.id]);
    return { component, document };
  };

  /**
   * A proposal of a run of Ada's, ended, that the component's p1 say `text`, against its latest version;
   * as the assistant makes one (G2-E).
   */
  const proposal = async (
    component: { id: string; version: string },
    text: string,
    document: string,
    by = 'ada',
  ) =>
    h.tenantDb.withTenant(h.tenant, async (trx) => {
      const endpoint = (await listModelEndpoints(trx)).find((each) => each.name === 'Drafting')!;
      const run = await startRun(trx, {
        purpose: 'drafting',
        endpoint,
        parameters: { instructions: 'assistant-1' },
        contextDigest: 'd'.repeat(64),
        by: h.ids[by]!,
        documentId: document,
      });
      await endRun(trx, run, {
        outcome: 'finished',
        model: 'stand-in-1-20260101',
        usage: { in: 1, out: 1 },
      });
      const current = (await readVersion(trx, component.version))!;
      const content = current.content as ContentDocument;
      const proposed = {
        ...content,
        content: content.content.map((block) =>
          block.id === 'p1' && block.type === 'paragraph'
            ? { ...block, content: [{ type: 'text', value: text, marks: [] }] }
            : block,
        ),
      } as ContentDocument;
      return makeProposal(trx, {
        run,
        component: component.id,
        against: component.version,
        proposed,
      });
    });
  const act = async (id: string, how: 'acceptance' | 'keeping' | 'discarding', as = 'ada') => {
    const done = await h.call(as, 'POST', `/v1/assistant/proposals/${id}/${how}`);
    expect(done.statusCode, done.body).toBe(200);
    return done.json<{ proposal: { suggestion: string | null } }>().proposal.suggestion;
  };
  const publish = async (document: { id: string; version: string }) =>
    h.call('ada', 'POST', `/v1/documents/${document.id}/publications`, {
      version: document.version,
      formats: ['pdf'],
    });
  const latestDocument = async (id: string) =>
    (await h.call('ada', 'GET', `/v1/documents/${id}`)).json<{
      id: string;
      version: { id: string };
    }>();

  /** A publication of the document's version, recorded as a worker records one. */
  const recorded = (document: string, version: string) =>
    h.tenantDb.withTenant(h.tenant, async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: document,
        version,
        formats: ['pdf'],
        requester: h.ids.ada!,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      const id = await recordPublication(trx, {
        requestId: asked.request.id,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: 'default/1', entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${h.tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1,
          },
        ],
      });
      if (id === undefined) throw new Error('not recorded');
      return id;
    });
  /** The component's latest version, by id. */
  const latestOf = async (component: string) =>
    (
      await h.tenantDb.withTenant(h.tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', component)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .executeTakeFirstOrThrow(),
      )
    ).id;

  it('GEN-025 refuses a publish and a baseline while a generated suggestion waits, and never a preview', async () => {
    const { component, document } = await placed('Waiting', 'The weir floods.');
    const made = await proposal(component, 'The weir floods each spring.', document.id);
    await act(made.id, 'keeping');
    const asked = await publish(document);
    expect(asked.body).toContain('generated_unaccepted');
    expect(asked.json()).toMatchObject({
      failures: [
        expect.objectContaining({
          code: 'generated_unaccepted',
          node: document.nodes[0],
          detail: '1',
        }),
      ],
    });
    const baseline = await h.call('ada', 'POST', `/v1/documents/${document.id}/baselines`, {
      name: 'Waiting baseline',
      version: document.version,
    });
    expect(baseline.statusCode).toBe(400);
    expect(baseline.body).toContain('generated_unaccepted');
    const preview = await h.call('ada', 'POST', `/v1/documents/${document.id}/previews`, {
      version: document.version,
    });
    expect(preview.statusCode, preview.body).toBeLessThan(300);
    expect(preview.body).not.toContain('generated_unaccepted');
  });

  it('GEN-042 blocks nothing with a generated suggestion rejected or a proposal discarded', async () => {
    const { component, document } = await placed('Settled', 'The dam holds.');
    const rejected = await proposal(component, 'The dam leaks.', document.id);
    const suggestion = await act(rejected.id, 'keeping');
    expect(
      (await h.call('ada', 'POST', `/v1/suggestions/${suggestion}/rejection`)).statusCode,
    ).toBe(200);
    const discarded = await proposal(component, 'The dam fails.', document.id);
    await act(discarded.id, 'discarding');
    // A proposal still open is its requester's draft, not the document's content.
    await proposal(component, 'The dam is fine.', document.id);
    const asked = await publish(document);
    expect(asked.statusCode, asked.body).toBeLessThan(300);
    expect(asked.json<{ failures: unknown[] }>().failures).toEqual([]);
  });

  it('publishes a baseline made before a generated suggestion was, its content fixed', async () => {
    const { component, document } = await placed('Fixed', 'The sluice is shut.');
    const baseline = await h.call('ada', 'POST', `/v1/documents/${document.id}/baselines`, {
      name: 'Before',
      version: document.version,
    });
    expect(baseline.statusCode, baseline.body).toBe(200);
    const made = await proposal(component, 'The sluice is open.', document.id);
    await act(made.id, 'keeping');
    const id = baseline.json<{ id: string }>().id;
    const published = await h.call('ada', 'POST', `/v1/baselines/${id}/publications`, {
      formats: ['pdf'],
    });
    expect(published.statusCode, published.body).toBeLessThan(300);
    expect(published.body).not.toContain('generated_unaccepted');
  });

  it('GEN-025 lets a gate require that no generated content waits', async () => {
    const { component, document } = await placed('Gated', 'The gate is closed.');
    const gated = {
      ...SEED_DOCUMENT_WORKFLOW,
      transitions: SEED_DOCUMENT_WORKFLOW.transitions.map((each) =>
        each.key === 'submit' ? { ...each, requires: ['generated'] } : each,
      ),
    };
    const defined = await h.call('ada', 'POST', '/v1/workflows', { kind: 'document', ...gated });
    expect(defined.statusCode, defined.body).toBe(200);
    try {
      const made = await proposal(component, 'The gate is open.', document.id);
      await act(made.id, 'keeping');
      const refused = await h.call('ada', 'POST', `/v1/documents/${document.id}/transitions`, {
        transition: 'submit',
        from: 'draft',
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.body).toContain('generated suggestion waiting to be accepted');
    } finally {
      await h.call('ada', 'POST', '/v1/workflows', { kind: 'document', ...SEED_DOCUMENT_WORKFLOW });
    }
  });

  it('GEN-026 GEN-041 reports which of a document came from a model: accepted, open, rejected and discarded, with run, model and digest', async () => {
    const { component, document } = await placed('Reported', 'The north weir floods.');
    const accepted = await proposal(component, 'The north weir floods yearly.', document.id);
    await act(accepted.id, 'acceptance');
    const now = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', component.id)
        .orderBy('revision_no', 'desc')
        .orderBy('version_no', 'desc')
        .executeTakeFirstOrThrow(),
    );
    const later = { id: component.id, version: now.id };
    const discarded = await proposal(later, 'The north weir is dry.', document.id);
    await act(discarded.id, 'discarding');
    const open = await proposal(later, 'The north weir is wet.', document.id);
    await act(open.id, 'keeping');
    const report = (await h.call('alice', 'GET', `/v1/documents/${document.id}/generated`)).json<{
      placements: { component: string; items: Json[] }[];
      unreadable: number;
    }>();
    expect(report.unreadable).toBe(0);
    const items = report.placements.find((each) => each.component === component.id)!.items;
    expect(items.map((each) => [each.kind, each.state])).toEqual(
      expect.arrayContaining([
        ['suggestion', 'accepted'],
        ['proposal', 'discarded'],
        ['suggestion', 'open'],
      ]),
    );
    const acceptance = items.find((each) => each.state === 'accepted')!;
    expect(acceptance).toMatchObject({
      askedBy: { id: h.ids.ada },
      actedBy: { id: h.ids.ada },
      acceptedInto: { inPlaced: true },
      run: {
        model: 'stand-in-1-20260101',
        endpoint: 'Drafting',
        instructions: 'assistant-1',
        contextDigest: 'd'.repeat(64),
      },
    });
    expect(items.find((each) => each.state === 'discarded')).toMatchObject({
      actedBy: { id: h.ids.ada },
    });
  });

  it('reports what a publication printed from a model as it recorded it, a later acceptance not in it', async () => {
    const { component, document } = await placed('Published', 'The lock is shut.');
    const first = await proposal(component, 'The lock is sealed.', document.id);
    await act(first.id, 'acceptance');
    const at = await latestDocument(document.id);
    const publication = await recorded(document.id, at.version.id);
    const after = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', component.id)
        .orderBy('revision_no', 'desc')
        .orderBy('version_no', 'desc')
        .executeTakeFirstOrThrow(),
    );
    const second = await proposal(
      { id: component.id, version: after.id },
      'The lock is welded.',
      document.id,
    );
    await act(second.id, 'acceptance');
    const report = (await h.call('ada', 'GET', `/v1/publications/${publication}/generated`)).json<{
      placements: {
        component: string;
        items: { id: string; acceptedInto: { inPlaced: boolean } | null }[];
      }[];
    }>();
    const items = report.placements.find((each) => each.component === component.id)!.items;
    expect(items.map((each) => each.acceptedInto?.inPlaced)).toEqual([true, false]);
  });

  it('PUB-082 lists in a publication the accepted generated content it printed, as it was published', async () => {
    const { component, document: first } = await placed('Listed', 'The east lock is shut.');
    // Accepted into a version before the one printed, and into the one printed.
    const earlier = await proposal(component, 'The east lock is sealed.', first.id);
    const earlierSuggestion = await act(earlier.id, 'acceptance');
    const placedVersion = { id: component.id, version: await latestOf(component.id) };
    const latest = await proposal(placedVersion, 'The east lock is welded.', first.id);
    const latestSuggestion = await act(latest.id, 'acceptance');
    // A component a model made, accepted.
    const creation = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const run = await startRun(trx, {
        purpose: 'drafting',
        endpoint: (await listModelEndpoints(trx)).find((each) => each.name === 'Drafting')!,
        parameters: { instructions: 'assistant-1' },
        contextDigest: 'e'.repeat(64),
        by: h.ids.ada!,
        documentId: first.id,
      });
      await endRun(trx, run, {
        outcome: 'finished',
        model: 'stand-in-1',
        usage: { in: 1, out: 1 },
      });
      return makeCreationProposal(trx, {
        run,
        creates: { space: h.general, title: 'East lock', language: 'en-GB', direction: 'ltr' },
        proposed: {
          schemaVersion: 1,
          title: 'East lock',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [{ type: 'text', value: 'The east lock holds.', marks: [] }],
            },
          ],
        } as ContentDocument,
      });
    });
    const made = await h.call('ada', 'POST', `/v1/assistant/proposals/${creation.id}/acceptance`);
    expect(made.statusCode, made.body).toBe(200);
    const madeComponent = made.json<{ proposal: { component: string } }>().proposal.component;
    const document = await h.documentReferencing([component.id, madeComponent]);
    const publication = await recorded(document.id, document.version);
    // Accepted after it was published: never in it.
    const after = await proposal(
      { id: component.id, version: await latestOf(component.id) },
      'The east lock is gone.',
      document.id,
    );
    await act(after.id, 'acceptance');

    const listed = await h.tenantDb.withTenant(h.tenant, (trx) =>
      publicationGenerated(trx, publication),
    );
    const printed = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('publication_input')
        .select(['node', 'version_id'])
        .where('publication_id', '=', publication)
        .execute(),
    );
    const at = (node: string) => printed.find((each) => each.node === node)!.version_id;
    expect(listed).toEqual(
      expect.arrayContaining([
        {
          node: document.nodes[0],
          version: at(document.nodes[0]!),
          kind: 'suggestion',
          suggestion: earlierSuggestion,
          proposal: earlier.id,
          run: earlier.runId,
        },
        {
          node: document.nodes[0],
          version: at(document.nodes[0]!),
          kind: 'suggestion',
          suggestion: latestSuggestion,
          proposal: latest.id,
          run: latest.runId,
        },
        {
          node: document.nodes[1],
          version: at(document.nodes[1]!),
          kind: 'creation',
          suggestion: null,
          proposal: creation.id,
          run: creation.runId,
        },
      ]),
    );
    expect(listed).toHaveLength(3);
    // Its report reads the list: the later acceptance is not in what was placed.
    const report = (await h.call('ada', 'GET', `/v1/publications/${publication}/generated`)).json<{
      placements: { items: { kind: string; acceptedInto: { inPlaced: boolean } | null }[] }[];
    }>();
    expect(
      report.placements.flatMap((each) =>
        each.items.map((item) => [item.kind, item.acceptedInto?.inPlaced]),
      ),
    ).toEqual(
      expect.arrayContaining([
        ['suggestion', true],
        ['suggestion', true],
        ['suggestion', false],
        ['creation', true],
      ]),
    );
  });

  it('GEN-046 keeps the report answering once the person who asked and accepted is erased', async () => {
    const { component, document } = await placed('Kept', 'The canal is full.');
    // Ivy authors here for this alone; her grant is removed, as an erasure asks, before she is erased.
    const grant = await h.allow(h.ids.ivy!, h.roles.Author!, { kind: 'space', id: h.general });
    const made = await proposal(component, 'The canal is brimming.', document.id, 'ivy');
    await act(made.id, 'acceptance', 'ivy');
    expect((await h.call('ada', 'DELETE', `/v1/grants/${grant}`)).statusCode).toBeLessThan(300);
    const erased = await h.call('ada', 'POST', `/v1/principals/${h.ids.ivy}/erase`);
    expect(erased.statusCode, erased.body).toBe(200);
    const report = (await h.call('ada', 'GET', `/v1/documents/${document.id}/generated`)).json<{
      placements: { component: string; items: Json[] }[];
    }>();
    expect(report.placements.find((each) => each.component === component.id)!.items).toEqual([
      expect.objectContaining({
        state: 'accepted',
        askedBy: { id: h.ids.ivy, name: 'Erased person' },
        actedBy: { id: h.ids.ivy, name: 'Erased person' },
        run: expect.objectContaining({ contextDigest: 'd'.repeat(64) }),
      }),
    ]);
  });
});
