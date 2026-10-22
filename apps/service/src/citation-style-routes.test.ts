import { findRole } from '@alloy-works/db';
import { DEFAULT_CITATION_STYLE } from '@alloy-works/domain';
import { SEEDED_STYLE_FILES } from '@alloy-works/domain/citations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

/** Harvard renamed: a style an administrator uploads, as any published CSL style is. */
const coastal = SEEDED_STYLE_FILES['harvard-cite-them-right'].replace(
  /<title>[^<]*<\/title>/,
  '<title>Journal of Coastal Studies</title>',
);

const style = (csl = coastal, requires: Record<string, string[]> = { book: ['title'] }) => ({
  schemaVersion: 1,
  name: 'Coastal Studies',
  csl,
  requires,
});

interface View {
  id: string;
  version: { id: string; number: string };
  style: { name: string; requires: Record<string, string[]> };
  seeded: boolean;
  mayEdit: boolean;
}

describe('the citation style routes (the CI plan, CI-D)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    // Ada designs across the environment.
    const designer = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Designer'));
    await h.allow(h.ids.ada!, designer!.id, { kind: 'tenant' });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('CNT-102 lists the three every environment is given, read by those who read the environment', async () => {
    const listed = await h.call('ada', 'GET', '/v1/citation-styles');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(
      listed
        .json<{ items: { name: string; seeded: boolean }[] }>()
        .items.filter((each) => each.seeded),
    ).toMatchObject([
      { name: 'CSE', version: { number: '0.1' } },
      { name: 'Harvard', version: { number: '0.1' } },
      { name: 'Vancouver', version: { number: '0.1' } },
    ]);
    const harvard = await h.call('ada', 'GET', `/v1/citation-styles/${DEFAULT_CITATION_STYLE.id}`);
    expect(harvard.json<View>()).toMatchObject({ seeded: true, mayEdit: true });
    // The environment's, as a theme is: not read by a reader of one space.
    expect((await h.call('grace', 'GET', '/v1/citation-styles')).statusCode).toBe(403);
  });

  it('STY-023 API-032 uploads a style as a CSL file and versions it, no release', async () => {
    expect(
      (await h.call('grace', 'POST', '/v1/citation-styles', { style: style() })).statusCode,
    ).toBe(403);
    const made = await h.call('ada', 'POST', '/v1/citation-styles', { style: style() });
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<View>();
    expect(view).toMatchObject({ version: { number: '0.1' }, seeded: false, mayEdit: true });

    const next = await h.call('ada', 'POST', `/v1/citation-styles/${view.id}/versions`, {
      openedFrom: view.version.id,
      style: style(coastal, { book: ['title', 'publisher'] }),
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json<View>()).toMatchObject({
      version: { number: '0.2' },
      style: { requires: { book: ['title', 'publisher'] } },
    });
    const stale = await h.call('ada', 'POST', `/v1/citation-styles/${view.id}/versions`, {
      openedFrom: view.version.id,
      style: style(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      current: { version: { number: '0.2' } },
    });
  });

  it('STY-020 refuses a file that is not CSL with both forms, each problem named', async () => {
    const refused = await h.call('ada', 'POST', '/v1/citation-styles', {
      style: style(coastal.replace(/<citation[\s\S]*<\/citation>/, '')),
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'style_invalid',
      problems: [{ path: 'csl', message: 'The style declares no citation form' }],
    });
    // No `requires`, refused at the door.
    const unrequired: Record<string, unknown> = style();
    delete unrequired['requires'];
    expect(
      (await h.call('ada', 'POST', '/v1/citation-styles', { style: unrequired })).statusCode,
    ).toBe(400);
  });

  it('previews the sample entries in a file before it is kept, and proposes what it requires', async () => {
    const preview = await h.call('ada', 'POST', '/v1/citation-styles/preview', {
      csl: coastal,
      language: 'en-GB',
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json<{
      title: string;
      problems: unknown[];
      proposed: Record<string, string[]>;
      sample: { citations: { text: string }[][]; bibliography: { entry: string }[] };
    }>();
    expect(body.title).toBe('Journal of Coastal Studies');
    expect(body.problems).toEqual([]);
    expect(body.proposed.book).toEqual(['page', 'publisher', 'title']);
    expect(body.sample.citations[0]!.map((run) => run.text).join('')).toBe(
      '(Penhallow and Ferreira, 2018, p. 112)',
    );
    expect(body.sample.bibliography).toHaveLength(4);

    const broken = await h.call('ada', 'POST', '/v1/citation-styles/preview', { csl: 'not CSL' });
    expect(broken.json()).toMatchObject({
      problems: [{ rule: 'style_invalid' }],
      sample: null,
    });
  });
});
