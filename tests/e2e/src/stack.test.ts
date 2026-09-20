import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApiClient, followStream } from '@alloy-works/api-client';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readPdf, spoken } from './pdf.js';

/**
 * The whole system, as a person's browser would meet it: the service, a worker, the database, the
 * object store and the sign-in provider, all in containers. Addressed as 127.0.0.1 rather than
 * `dev.acme.localhost`, because how a machine resolves `*.localhost` is not this test's business.
 */
const SERVICE = process.env.ALLOY_E2E_SERVICE ?? 'http://127.0.0.1:8088';
/** What the provider calls itself, which is what the service sends the browser to. */
const IDP_ISSUER = process.env.ALLOY_E2E_IDP_ISSUER ?? 'http://idp.localhost:9090';
/** Where it actually answers, so this suite needs no opinion about resolving `*.localhost`. */
const IDP = process.env.ALLOY_E2E_IDP ?? 'http://127.0.0.1:9090';
/** Where the object store actually answers; the name it signs by is a browser's business. */
const STORE_AT = process.env.ALLOY_E2E_STORE_AT ?? '127.0.0.1';

/**
 * Follows a link the object store signed. The store's own name is part of what was signed, so it
 * stays in the `Host` header exactly as it was; only where the socket goes is changed, which is
 * what keeps this suite from having an opinion about how a machine resolves `*.localhost`.
 */
function followSignedLink(link: URL): Promise<{
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const asked = httpRequest(
      {
        host: STORE_AT,
        port: link.port,
        path: `${link.pathname}${link.search}`,
        headers: { host: link.host },
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('error', reject);
        answer.on('end', () =>
          resolve({
            status: answer.statusCode ?? 0,
            contentType: answer.headers['content-type'],
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    asked.on('error', reject);
    asked.end();
  });
}

async function untilReady(within = 120_000): Promise<void> {
  const stop = Date.now() + within;
  for (;;) {
    try {
      const response = await fetch(`${SERVICE}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > stop) throw new Error(`${SERVICE} never came up`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Signs in as the stand-in's Ada, and returns the cookie the session travels in. */
async function signIn(): Promise<string> {
  const started = await fetch(`${SERVICE}/v1/sign-in/organisation`, { redirect: 'manual' });
  const attempt = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_signin='));
  const sentTo = started.headers.get('location');
  if (!attempt || !sentTo) throw new Error(`signing in did not start: ${started.status}`);
  const back = await completeAtStandIn(sentTo, 'ada', IDP_ISSUER, IDP);
  const finished = await fetch(`${SERVICE}${back.pathname}${back.search}`, {
    headers: { cookie: attempt },
    redirect: 'manual',
  });
  const session = finished.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_session='));
  if (!session) throw new Error(`signing in did not finish: ${finished.status}`);
  return session;
}

describe('the whole system', () => {
  let cookie = '';
  /** The sample the third test makes, which the fourth fetches again. */
  let made = '';

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn();
  }, 180_000);

  // The client hands fetch a whole Request, whose headers - a JSON body's content type among them -
  // an `init.headers` would replace outright. So the cookie is added to the request, never swapped in.
  const asTheSignedIn = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    request.headers.set('cookie', cookie);
    return fetch(request);
  }) as typeof fetch;

  const client = () => createApiClient({ baseUrl: SERVICE, fetch: asTheSignedIn });

  it('serves the renderer at its own address', async () => {
    const page = await fetch(SERVICE);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
  });

  it('knows who signed in, and which environment this is', async () => {
    const { data } = await client().GET('/v1/me');
    expect(data).toMatchObject({ displayName: 'Ada', environment: 'Development' });
  });

  it('makes a sample, says so on the stream, and hands back a PDF', async () => {
    const heard: string[] = [];
    const stop = followStream({
      url: `${SERVICE}/v1/stream`,
      onSnapshot: () => {},
      onSample: (sample) => heard.push(`${sample.id}:${sample.state}`),
      fetch: asTheSignedIn,
    });
    try {
      const asked = await client().POST('/v1/samples');
      expect(asked.response.status).toBe(202);
      const id = asked.data!.id;
      // The worker renders it, and the stream says so without anybody asking again.
      await vi.waitFor(() => expect(heard).toContain(`${id}:done`), {
        timeout: 60_000,
        interval: 250,
      });

      made = id;
      const { data } = await client().GET('/v1/samples/{sampleId}', {
        params: { path: { sampleId: id } },
      });
      expect(data?.state).toBe('done');
      const pdf = await followSignedLink(new URL(data!.download!));
      expect(pdf.status).toBe(200);
      expect(pdf.contentType).toBe('application/pdf');
      expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      stop();
    }
  }, 120_000);

  it('hands out documents by signed link only', async () => {
    const { data } = await client().GET('/v1/samples/{sampleId}', {
      params: { path: { sampleId: made } },
    });
    const link = new URL(data!.download!);
    expect((await followSignedLink(link)).status).toBe(200);
    // The same object without what signs for it: the store answers to nobody else.
    const unsigned = new URL(link);
    unsigned.search = '';
    expect((await followSignedLink(unsigned)).status).toBe(403);
  });

  it('publishes a document to a PDF set in the pinned face, and keeps it', async () => {
    const api = client();
    const { data: spaces } = await api.GET('/v1/spaces');
    const general = spaces!.items.find((space) => space.name === 'General')!;
    const { data: components } = await api.GET('/v1/components');
    const printer = components!.items.find(
      (component) => component.title === 'Install the printer',
    );
    if (!printer) throw new Error('The seeded component "Install the printer" was not found.');
    const { data: made } = await api.POST('/v1/spaces/{space}/documents', {
      params: { path: { space: general.id } },
      body: { title: 'The dosing report', language: 'en-GB', direction: 'ltr' },
    });
    const { data: placed } = await api.POST('/v1/documents/{id}/outline', {
      params: { path: { id: made!.id } },
      body: {
        openedFrom: made!.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: printer.id, mode: { kind: 'latest' } },
        },
      },
    });
    expect(placed?.mayPublish).toBe(true);

    const { data: asked } = await api.POST('/v1/documents/{id}/publications', {
      params: { path: { id: made!.id } },
      body: { version: placed!.version.id, formats: ['pdf'] },
    });
    let publication: string | null = null;
    // The job takes seconds; this bounds the wait rather than asserting a particular duration - the
    // veraPDF check that would take longer is not part of the job, only of the worker's own suite.
    await vi.waitFor(
      async () => {
        const { data } = await api.GET('/v1/publication-requests/{id}', {
          params: { path: { id: asked!.id } },
        });
        expect(data?.failures).toEqual([]);
        expect(data?.state).toBe('done');
        publication = data!.publication;
      },
      { timeout: 60_000, interval: 250 },
    );

    const { data: listed } = await api.GET('/v1/documents/{id}/publications', {
      params: { path: { id: made!.id } },
    });
    expect(listed?.items.map((item) => item.id)).toContain(publication);

    const { data: kept } = await api.GET('/v1/publications/{id}', {
      params: { path: { id: publication! } },
    });
    expect(kept).toMatchObject({ approval: 'none', engine: { name: 'typst', version: '0.15.1' } });
    const pdf = await followSignedLink(new URL(kept!.outputs[0]!.download));
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(createHash('sha256').update(pdf.body).digest('hex')).toBe(kept!.outputs[0]!.sha256);
    // The image carries the pinned faces and the template: a publication set in anything else, or
    // in nothing, is the failure this test exists for (#145).
    expect(pdf.body.toString('latin1')).toContain('LiberationSerif');
  }, 120_000);

  it('publishes under the layout: its cover, its own front matter, the contents, running heads and the notice', async () => {
    const api = client();
    const { data: spaces } = await api.GET('/v1/spaces');
    const general = spaces!.items.find((space) => space.name === 'General')!;
    const { data: components } = await api.GET('/v1/components');
    const printer = components!.items.find(
      (component) => component.title === 'Install the printer',
    );
    if (!printer) throw new Error('The seeded component "Install the printer" was not found.');

    const { data: created } = await api.POST('/v1/spaces/{space}/documents', {
      params: { path: { space: general.id } },
      body: { title: 'The maintenance handbook', language: 'en-GB', direction: 'ltr' },
    });

    // A front-matter section - a preface - ahead of the body, so the layout's own front numbering
    // (lower roman, PUB-009) and its running head (PUB-008) have something of the document's own to
    // show, alongside the cover and the contents the layout generates by itself (PUB-088).
    const { data: sectioned } = await api.POST('/v1/documents/{id}/outline', {
      params: { path: { id: created!.id } },
      body: {
        openedFrom: created!.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'section', title: [{ type: 'text', value: 'Preface', marks: [] }] },
        },
      },
    });
    const preface = (sectioned!.outline as unknown as { nodes: { id: string }[] }).nodes[0]!.id;

    const { data: fronted } = await api.POST('/v1/documents/{id}/outline', {
      params: { path: { id: created!.id } },
      body: {
        openedFrom: sectioned!.version.id,
        operation: { operation: 'set', node: preface, matter: 'front', numbered: false },
      },
    });

    const { data: filled } = await api.POST('/v1/documents/{id}/outline', {
      params: { path: { id: created!.id } },
      body: {
        openedFrom: fronted!.version.id,
        operation: {
          operation: 'insert',
          parent: preface,
          position: 0,
          node: { type: 'reference', component: printer.id, mode: { kind: 'latest' } },
        },
      },
    });

    const { data: placed } = await api.POST('/v1/documents/{id}/outline', {
      params: { path: { id: created!.id } },
      body: {
        openedFrom: filled!.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 1,
          node: { type: 'reference', component: printer.id, mode: { kind: 'latest' } },
        },
      },
    });
    expect(placed?.mayPublish).toBe(true);

    const { data: asked } = await api.POST('/v1/documents/{id}/publications', {
      params: { path: { id: created!.id } },
      body: { version: placed!.version.id, formats: ['pdf'] },
    });
    let publication: string | null = null;
    await vi.waitFor(
      async () => {
        const { data } = await api.GET('/v1/publication-requests/{id}', {
          params: { path: { id: asked!.id } },
        });
        expect(data?.failures).toEqual([]);
        expect(data?.state).toBe('done');
        publication = data!.publication;
      },
      { timeout: 60_000, interval: 250 },
    );

    const { data: kept } = await api.GET('/v1/publications/{id}', {
      params: { path: { id: publication! } },
    });
    // The API exposes no field naming the layout's own version directly; a template above 1 is set
    // only for a request made under a layout (`publication_layout`), so the publication carries the
    // layout's record the one way this suite can read from outside the database - and every
    // assertion below is only reachable through that template's own composition. The version is the
    // newest template, which moves whenever the published schema does: it was 2 until a run could
    // carry marks, and `PUBLICATION_TEMPLATE` in `apps/worker/src/template.ts` is where it is set.
    expect(kept).toMatchObject({ template: { name: 'publication', version: 3 } });

    const pdf = await followSignedLink(new URL(kept!.outputs[0]!.download));
    expect(pdf.status).toBe(200);
    const read = await readPdf(pdf.body);
    expect(read.pageLabels).not.toBeNull();
    const labels = read.pageLabels!;

    // The cover, unlabelled, then the layout's own contents at `i` (decision in preflight I11).
    expect(labels[0]).toBe('');
    expect(labels[1]).toBe('i');

    // A change of matter always starts a page of its own (main.typ), so the preface and the body
    // each open one: the first lower-roman page after the contents, then the first page labelled `1`.
    const frontPage = labels.findIndex((label, index) => index > 1 && /^[ivxlcdm]+$/i.test(label));
    const bodyPage = labels.findIndex((label) => label === '1');
    expect(frontPage).toBeGreaterThan(1);
    expect(bodyPage).toBeGreaterThan(frontPage);

    // The running head names the section the page is in (PUB-008): the preface's own, then the
    // body's.
    expect(spoken(read.artifactText[frontPage]!)).toContain('Preface');
    expect(spoken(read.artifactText[bodyPage]!)).toContain('Install the printer');

    // The notice is the template's, on every page - no layout may remove it (task 7a).
    for (let page = 0; page < read.pages; page += 1) {
      expect(spoken(read.artifactText[page]!), `page ${page + 1}`).toContain('Not approved');
    }

    // The contents page names itself and lists the preface it made a page of (PUB-037).
    expect(spoken(read.taggedText[1]!)).toContain('Contents');
    expect(spoken(read.taggedText[1]!)).toContain('Preface');
  }, 120_000);
});
