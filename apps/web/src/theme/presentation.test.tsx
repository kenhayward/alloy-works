import { createApiClient } from '@alloy-works/api-client';
import { DEFAULT_CATALOGUES_BY_VERSION, DEFAULT_THEME } from '@alloy-works/domain';
import { PINNED_FONT_FILES } from '@alloy-works/fonts';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { faceUrl } from './faces.js';
import { PresentationProvider, usePresentation } from './presentation.js';

const DOCUMENT = '0b4fd1a5-9a8e-4a55-9f6e-2f1f33c6d7a1';

/** The environment's default theme and layout, as `GET /v1/presentation` answers them. */
const DEFAULT_PRESENTATION = {
  theme: {
    versionId: 'theme-version',
    number: '0.3',
    content: DEFAULT_THEME,
    catalogues: [...DEFAULT_CATALOGUES_BY_VERSION].map(([versionId, content]) => ({
      versionId,
      content,
    })),
  },
  frame: { measure: 451.28, textHeight: 697.89 },
};

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
    expect(faces().match(/@font-face/g)).toHaveLength(files.length);
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
