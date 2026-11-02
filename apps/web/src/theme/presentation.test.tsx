import { createApiClient } from '@alloy-works/api-client';
import { DEFAULT_THEME } from '@alloy-works/domain';
import { PINNED_FONT_FILES } from '@alloy-works/fonts';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { capHeight, faceUrl } from './faces.js';
import { marginLabelRules, PresentationProvider, usePresentation } from './presentation.js';
import { DEFAULT_PRESENTATION } from './presentation.fixture.js';

const DOCUMENT = '0b4fd1a5-9a8e-4a55-9f6e-2f1f33c6d7a1';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(answers: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    asked.push(route);
    return answers[route]?.() ?? json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, asked };
}

/** What a page inside the provider is told. */
function Shown() {
  const presentation = usePresentation();
  return (
    <p>
      {presentation?.state === 'ready'
        ? `ready, ${presentation.theme.name}, ${presentation.frame.measure}pt`
        : (presentation?.state ?? 'none')}
    </p>
  );
}

const faces = () => document.querySelector('style[data-aw-faces]')?.textContent ?? '';

describe("the labels in a sheet's margin (ADR-0075)", () => {
  const theme = {
    paragraphStyles: new Map([
      ['note', { id: 'note', name: 'Note' }],
      ['odd', { id: 'odd', name: 'Say "odd"' }],
    ]),
    characterStyles: new Proxy({}, { get: () => ({ properties: {} }) }),
  } as unknown as Parameters<typeof marginLabelRules>[0];

  it("CNT-190 says a paragraph's style and a heading's role in generated content, which is in no text and no copy", () => {
    const rules = marginLabelRules(theme);
    expect(rules).toContain('[data-style="note"]::before { content: "Note" / ""; }');
    expect(rules).toContain('[data-style="odd"]::before { content: "Say \\"odd\\"" / ""; }');
    expect(rules).toMatch(
      /\[data-role="heading1"\]:not\(:has\([^{]*::before \{ content: "H1" \/ ""; \}/,
    );
    expect(rules).toMatch(
      /\[data-role="heading6"\]:not\(:has\([^{]*::before \{ content: "H6" \/ ""; \}/,
    );
    // Every rule hangs off the class the sheet takes off to turn them off, and a pseudo-element: no rule
    // writes into the document's own elements.
    for (const rule of rules.split('\n')) expect(rule).toMatch(/^\.aw-labels .*::before \{ /);
    // And not on a paragraph in a list or a cell, which stands away from the margin.
    expect(rules).toContain(':not(li, td, th, [data-role]) > p');
  });

  it('CNT-190 stands a label out of the flow, so the measure stays as it was', async () => {
    expect(marginLabelRules(theme).split('\n')[0]).toContain('position: absolute');
  });

  it('CNT-190 labels no paragraph whose lines the theme holds open with its own pseudo-elements', () => {
    expect(marginLabelRules(theme)).toContain(':not(:has(.aw-inline-image-holder');
  });

  it('declares the labels from the theme a page is set in', async () => {
    const { client } = service({ 'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION) });
    render(
      <PresentationProvider client={client}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText(/^ready/);
    expect(faces()).toMatch(/\[data-role="heading2"\][^{]*::before \{ content: "H2" \/ ""; \}/);
    expect(faces()).toMatch(/\[data-style="body"\]::before \{ content: "[^"]+" \/ ""; \}/);
  });
});

describe("the presentation a page's text is set in", () => {
  it("STY-039 declares every face of the environment's theme from the renderer's own copy of the worker's pinned files", async () => {
    const { client } = service({ 'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION) });
    render(
      <PresentationProvider client={client}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText(/^ready/);
    const files = DEFAULT_THEME.typefaces.flatMap((typeface) => typeface.files);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // The file the theme names by its hash is the pinned file of that hash, bundled.
      const pinned = PINNED_FONT_FILES.find((each) => each.sha256 === file.sha256);
      expect(pinned, file.sha256).toBeDefined();
      const url = faceUrl(file.sha256);
      expect(url, pinned!.file).toContain(pinned!.file.replace(/\.(ttf|otf)$/, ''));
      expect(faces()).toContain(`src: url("${url}")`);
    }
    // And the maths face's one upright file again under italic, and the Naskh's two, as a face with
    // none is (UF-F).
    expect(faces().match(/@font-face/g)).toHaveLength(files.length + 3);
  });

  it("places each block's baseline from its face's cap height, which the renderer's copy of the pinned files states", async () => {
    const { client } = service({ 'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION) });
    render(
      <PresentationProvider client={client}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText(/^ready/);
    // The body is in Liberation Serif, whose cap height is 1341/2048 of its em: 11pt on 14.35pt puts
    // its first baseline 14.35 - (443 + 1341) / 2048 x 11 = 4.768pt below the trimmed line's top.
    expect(faces()).toContain('@supports (text-box: trim-both cap alphabetic) {');
    expect(faces()).toContain(
      'padding-block: calc(var(--aw-before) + calc(4.768pt * var(--aw-zoom)))',
    );
    expect(capHeight(DEFAULT_THEME.typefaces[0]!)).toBe(1341 / 2048);
    expect(capHeight({ ...DEFAULT_THEME.typefaces[0]!, files: [] })).toBeUndefined();
  });

  it("leaves room either side of the measure for a table's outer rule, which the canvas's sideways scrolling would clip", async () => {
    const { client } = service({ 'GET /v1/presentation': () => json(200, DEFAULT_PRESENTATION) });
    render(
      <PresentationProvider client={client}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText(/^ready/);
    // Half of the widest rule a table style may draw, 12pt, at the zoom; the measure itself is the
    // text's content box, so it is unchanged.
    expect(faces()).toContain(
      '.aw-canvas { overflow-x: auto; padding-inline: calc(6pt * var(--aw-zoom)); }',
    );
    expect(faces()).toContain(
      '.aw-canvas .aw-text, .aw-canvas.aw-text { box-sizing: content-box; ' +
        'width: calc(var(--aw-measure) * var(--aw-zoom));',
    );
  });

  it("reads a document's presentation from the document's own route", async () => {
    const { client, asked } = service({
      [`GET /v1/documents/${DOCUMENT}/presentation`]: () => json(200, DEFAULT_PRESENTATION),
    });
    render(
      <PresentationProvider client={client} document={DOCUMENT}>
        <Shown />
      </PresentationProvider>,
    );
    expect(await screen.findByText(/^ready/)).toHaveTextContent('451.28pt');
    expect(asked).toEqual([`GET /v1/documents/${DOCUMENT}/presentation`]);
  });

  it('says it has none where the service does not answer, or answers a theme that does not read', async () => {
    const { client } = service({});
    const { unmount } = render(
      <PresentationProvider client={client}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText('failed');
    unmount();

    const broken = {
      ...DEFAULT_PRESENTATION,
      theme: { ...DEFAULT_PRESENTATION.theme, catalogues: [] },
    };
    const { client: other } = service({ 'GET /v1/presentation': () => json(200, broken) });
    render(
      <PresentationProvider client={other}>
        <Shown />
      </PresentationProvider>,
    );
    await screen.findByText('failed');
    await waitFor(() => expect(faces()).toBe(''));
  });
});
