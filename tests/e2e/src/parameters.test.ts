import { beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

/**
 * Template parameters over the whole system (the TP1 plan, task 5): a template declaring a required
 * date, a choice and a changeable text seeding the Reviewer field, made over development's Report; a
 * document made from it with their values, refused without one; the changeable one changed, a fixed
 * one refused; and the history read back.
 */

type Json = Record<string, unknown>;

describe('template parameters over the whole system', () => {
  let cookie = '';
  let general = '';
  let template = '';
  let reviewerField = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };
  const make = (parameters: Json) =>
    call('POST', `/v1/spaces/${general}/documents`, {
      title: `Parameters ${Date.now()}`,
      language: 'en-GB',
      direction: 'ltr',
      template,
      parameters,
    });

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = ok(await call('GET', '/v1/spaces'));
    general = (spaces['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
    // Development's Report, for its theme, layout and Review schema, and the field its reviewer seeds.
    const templates = ok(await call('GET', '/v1/templates?limit=100'));
    const report = (templates['items'] as { id: string; name: string }[]).find(
      (each) => each.name === 'Report',
    )!;
    const definition = ok(await call('GET', `/v1/templates/${report.id}`))['definition'] as Json;
    const seeded = (definition['parameters'] as { name: string; feeds: { field: string } }[]).find(
      (each) => each.name === 'reviewer',
    )!;
    reviewerField = seeded.feeds.field;
    const made = ok(
      await call('POST', `/v1/spaces/${general}/templates`, {
        definition: {
          ...definition,
          name: `Inspection ${Date.now()}`,
          parameters: [
            {
              name: 'due',
              type: { base: 'date' },
              required: true,
              list: false,
              changeable: false,
              feeds: { arguments: true },
            },
            {
              name: 'region',
              type: { base: 'text' },
              required: true,
              list: false,
              permitted: { values: ['North', 'South'] },
              changeable: false,
              feeds: { arguments: true },
            },
            {
              name: 'reviewer',
              type: { base: 'text' },
              required: false,
              list: false,
              changeable: true,
              feeds: { field: reviewerField, arguments: false },
            },
          ],
        },
      }),
    );
    template = made['id'] as string;
  }, 180_000);

  it('TPL-026 makes a document from a template with its parameters over the whole system, recording them and seeding the field one feeds', async () => {
    const document = ok(await make({ due: '2026-10-31', region: 'North', reviewer: 'Grace' }));
    expect(document['parameters']).toEqual({
      due: '2026-10-31',
      region: 'North',
      reviewer: 'Grace',
    });
    expect((document['values'] as Json)[reviewerField]).toBe('Grace');
  });

  it('TPL-018 refuses a document without a required parameter, naming it, over the whole system', async () => {
    const refused = await make({ region: 'West' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: 'parameter_invalid',
      problems: expect.arrayContaining([
        expect.objectContaining({ parameter: 'due', rule: 'required' }),
        expect.objectContaining({ parameter: 'region', rule: 'permitted', value: 'West' }),
      ]),
    });
  });

  it('TPL-021 TPL-020 changes the changeable parameter, refuses a fixed one, and answers each change with who made it', async () => {
    const document = ok(await make({ due: '2026-10-31', region: 'North', reviewer: 'Grace' }));
    const id = document['id'] as string;
    const first = (document['version'] as { id: string }).id;
    const changed = ok(
      await call('PUT', `/v1/documents/${id}/parameters`, {
        openedFrom: first,
        parameters: { due: '2026-10-31', region: 'North', reviewer: 'Ada' },
      }),
    );
    const second = (changed['version'] as { id: string }).id;
    expect(second).not.toBe(first);
    expect(changed['parameters']).toMatchObject({ reviewer: 'Ada' });
    // Seeded once: the field is the author's from then on.
    expect((changed['values'] as Json)[reviewerField]).toBe('Grace');

    const fixed = await call('PUT', `/v1/documents/${id}/parameters`, {
      openedFrom: second,
      parameters: { due: '2026-10-31', region: 'South', reviewer: 'Ada' },
    });
    expect(fixed.status).toBe(400);
    expect(fixed.body).toMatchObject({
      code: 'parameter_fixed',
      parameters: [{ parameter: 'region' }],
    });

    const read = ok(await call('GET', `/v1/documents/${id}/parameters`));
    const history = read['history'] as {
      version: { id: string };
      changed: string[];
      author: { name: string | null } | null;
    }[];
    expect(history.map((each) => [each.version.id, [...each.changed].sort()])).toEqual([
      [second, ['reviewer']],
      [first, ['due', 'region', 'reviewer']],
    ]);
    expect(history.every((each) => each.author !== null)).toBe(true);
    expect(read['parameters']).toEqual({ due: '2026-10-31', region: 'North', reviewer: 'Ada' });
  });
});
