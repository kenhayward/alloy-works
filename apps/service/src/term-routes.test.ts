import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findRole } from '@alloy-works/db';
import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

interface View {
  id: string;
  version: { id: string; number: string };
  term: Json;
  deprecated: boolean;
  state: { key: string };
  gates: { key: string }[];
  transitions: { key: string }[];
}

const term = (preferred: string, more: Json = {}) => ({
  schemaVersion: 1,
  base: 'en',
  labels: [{ language: 'en', preferred, alternatives: [] }],
  definition: [],
  broader: [],
  narrower: [],
  related: [],
  ...more,
});

describe('the term routes (the TM plan, TM-A, TM-J)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    // Ada approves in General, as Grace, who makes the terms, may not.
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = (by: string, body: Json) =>
    h.call(by, 'POST', `/v1/spaces/${h.general}/terms`, { term: body });

  it('LIB-013 LIB-049 makes a term in draft, approves it at a gate and deprecates it', async () => {
    const made = await make(
      'grace',
      term('Fat-tailed dunnart', {
        labels: [
          {
            language: 'en',
            preferred: 'Fat-tailed dunnart',
            alternatives: ['Dunnart'],
            abbreviation: 'FTD',
          },
        ],
        definition: [{ language: 'en', text: 'A small carnivorous marsupial.' }],
      }),
    );
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<View>();
    expect(view).toMatchObject({ version: { number: '0.1' }, state: { key: 'draft' } });
    expect(view.gates.map((each) => each.key)).toEqual(['approve']);
    // A reader reads it and makes none; nobody else sees it.
    expect((await h.call('alice', 'GET', `/v1/terms/${view.id}`)).statusCode).toBe(200);
    expect((await make('alice', term('Quoll'))).statusCode).toBe(403);
    expect((await h.call('ivy', 'GET', `/v1/terms/${view.id}`)).statusCode).toBe(404);

    // Grace made it, so Ada approves it, then deprecates it with a reason.
    const approved = await h.call('ada', 'POST', `/v1/terms/${view.id}/approvals`, {
      transition: 'approve',
      version: view.version.id,
      decision: 'approved',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ state: { key: 'approved' } });
    const deprecated = await h.call('ada', 'POST', `/v1/terms/${view.id}/transitions`, {
      transition: 'deprecate',
      from: 'approved',
      reason: 'Say dunnart',
    });
    expect(deprecated.statusCode, deprecated.body).toBe(200);
    expect((await h.call('alice', 'GET', `/v1/terms/${view.id}`)).json()).toMatchObject({
      deprecated: true,
      state: { key: 'deprecated' },
    });
    const listed = await h.call('alice', 'GET', `/v1/spaces/${h.general}/terms`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toMatchObject([
      {
        id: view.id,
        label: 'Fat-tailed dunnart',
        abbreviation: 'FTD',
        state: { key: 'deprecated' },
      },
    ]);
  });

  it('LIB-025 refuses a relation to no term of the space by name, and cuts a version stating one', async () => {
    const marsupial = (await make('grace', term('Marsupial'))).json<View>();
    const refused = await make('grace', term('Quoll', { broader: [h.general] }));
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'term_invalid',
      problems: [{ rule: 'term_invalid', path: 'broader.0' }],
    });
    const quoll = (await make('grace', term('Quoll'))).json<View>();
    const next = await h.call('grace', 'POST', `/v1/terms/${quoll.id}/versions`, {
      openedFrom: quoll.version.id,
      term: term('Quoll', { broader: [marsupial.id] }),
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json()).toMatchObject({
      version: { number: '0.2' },
      term: { broader: [marsupial.id] },
    });
    // Nothing uses it, so Ada archives it; it leaves the listing.
    expect((await h.call('ada', 'GET', `/v1/terms/${quoll.id}/uses`)).json()).toEqual({
      named: [],
      unreadable: false,
    });
    expect((await h.call('ada', 'POST', `/v1/terms/${quoll.id}/archive`)).json()).toEqual({
      archived: true,
    });
  });

  it('LIB-028 IMP-015 LIB-029 imports Turtle, reporting what it could not hold, and exports JSON-LD', async () => {
    const imported = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms/import`, {
      format: 'turtle',
      text: [
        '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
        '<urn:x:numbat> a skos:Concept ; skos:prefLabel "Numbat"@en ;',
        '  skos:altLabel "Banded anteater"@en ; skos:scopeNote "Western Australia"@en ;',
        '  skos:broader <urn:x:marsupial> , <urn:x:elsewhere> .',
        '<urn:x:marsupial> a skos:Concept ; skos:prefLabel "marsupial"@en .',
      ].join('\n'),
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({
      concepts: [
        { key: 'urn:x:numbat', outcome: 'created', term: { label: 'Numbat' } },
        // The marsupial made above, matched by its label, case aside; given nothing, as the file
        // states no narrower term of it.
        { key: 'urn:x:marsupial', outcome: 'merged', merged: [] },
      ],
      unrepresented: [
        {
          concept: 'urn:x:numbat',
          what: 'predicate',
          detail: 'http://www.w3.org/2004/02/skos/core#scopeNote',
        },
        { concept: 'urn:x:numbat', what: 'relation' },
      ],
      unrepresentedTotal: 2,
    });
    // A body up to 5 MiB is read, one larger refused before it is.
    const concept = {
      '@id': 'urn:x:mulgara',
      '@type': 'skos:Concept',
      prefLabel: { en: 'Mulgara' },
    };
    const padded = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms/import`, {
      format: 'json-ld',
      text: JSON.stringify({ '@graph': [concept] }) + ' '.repeat(2_000_000),
    });
    expect(padded.statusCode, padded.body).toBe(200);
    const large = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms/import`, {
      format: 'json-ld',
      text: JSON.stringify({ '@graph': [{ ...concept, '@id': `urn:x:${'é'.repeat(3_000_000)}` }] }),
    });
    expect(large.statusCode).toBe(413);
    const unreadable = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms/import`, {
      format: 'turtle',
      text: 'not <turtle',
    });
    expect(unreadable.json()).toMatchObject({ code: 'import_unreadable' });

    const exported = await h.call('alice', 'GET', `/v1/spaces/${h.general}/terms/export`);
    expect(exported.statusCode, exported.body).toBe(200);
    const graph = JSON.parse(exported.json<{ text: string }>().text) as { '@graph': Json[] };
    expect(graph['@graph'].map((each) => each['prefLabel'])).toContainEqual({ en: 'Numbat' });
  });
});
