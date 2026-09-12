import { request as httpRequest } from 'node:http';
import { createApiClient, followStream } from '@alloy-works/api-client';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The whole system, as a person's browser would meet it: the service, a worker, the database, the
 * object store and the sign-in provider, all in containers. Addressed as 127.0.0.1 rather than
 * `dev.acme.localhost`, because how a machine resolves `*.localhost` is not this test's business.
 */
const SERVICE = process.env.ALLOY_E2E_SERVICE ?? 'http://127.0.0.1:8080';
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

  const asTheSignedIn = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, { ...init, headers: { ...init?.headers, cookie } })) as typeof fetch;

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
});
