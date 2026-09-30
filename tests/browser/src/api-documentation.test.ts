import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttp } from '../../../apps/service/src/http.js';
import { registerDocs } from '../../../apps/service/src/docs.js';
import { withPage } from './testing/page.js';

describe('the API reference', () => {
  const app = createHttp({ logLevel: 'silent' });
  let origin: string;
  const requests: { authorization: string | undefined; cookie: string | undefined }[] = [];
  const uploads: Buffer[] = [];

  beforeAll(async () => {
    registerDocs(app, async () => ({ id: 'browser-test' }));
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    app.get('/v1/me', async (request, reply) => {
      requests.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      });
      if (request.headers.authorization !== `Bearer awt_${'a'.repeat(43)}`) {
        return reply
          .status(401)
          .send({ code: 'unauthenticated', message: 'Token required', traceId: request.id });
      }
      return {
        id: 'test',
        displayName: 'Ada',
        email: 'ada@example.com',
        environment: 'Browser test',
      };
    });
    app.put('/v1/asset-uploads/:id/bytes', async (request) => {
      uploads.push(request.body as Buffer);
      return { id: 'upload', state: 'processing' };
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    origin = address;
  });

  afterAll(async () => {
    await app.close();
  });

  it('API-062 executes a token-enabled operation only with the token entered for this environment', async () => {
    await withPage(
      async (page) => {
        await page
          .context()
          .addCookies([{ name: 'test_session', value: 'signed-in', url: origin }]);
        await page.goto(`${origin}/docs/v1/`);
        await page.locator('#operation option').first().waitFor({ state: 'attached' });
        const meOption = page.locator('#operation option', { hasText: 'GET /v1/me' });
        await page
          .locator('#operation')
          .selectOption({ label: (await meOption.textContent()) ?? '' });
        expect(await page.locator('#body').isVisible()).toBe(false);
        expect(await page.locator('#operation option').allTextContents()).not.toContainEqual(
          expect.stringContaining('/v1/sign-out'),
        );
        await page.locator('#execute').click();
        await expect
          .poll(() => page.locator('#answer').textContent())
          .toContain('Enter a personal API token');
        expect(requests).toHaveLength(0);
        await page.locator('#token').fill(`awt_${'a'.repeat(43)}`);
        await page.locator('#execute').click();
        await expect.poll(() => page.locator('#answer').textContent()).toContain('Ada');
        expect(requests).toEqual([
          { authorization: `Bearer awt_${'a'.repeat(43)}`, cookie: undefined },
        ]);
        await page.reload();
        expect(await page.locator('#token').inputValue()).toBe('');
        expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
        expect(await page.locator('#reference').textContent()).toContain('Alloy Works');
      },
      { signedIn: false },
    );
  });

  it('API-062 sends a binary upload as bytes rather than JSON', async () => {
    await withPage(
      async (page) => {
        await page.goto(`${origin}/docs/v1/`);
        await page.locator('#operation option').first().waitFor({ state: 'attached' });
        const option = page.locator('#operation option', {
          hasText: 'PUT /v1/asset-uploads/{id}/bytes',
        });
        await page
          .locator('#operation')
          .selectOption({ label: (await option.textContent()) ?? '' });
        await page.locator('#token').fill(`awt_${'a'.repeat(43)}`);
        await page
          .locator('#fields input[data-location="path"]')
          .fill('00000000-0000-4000-8000-000000000001');
        await page.locator('#file').setInputFiles({
          name: 'pixel.png',
          mimeType: 'image/png',
          buffer: Buffer.from([1, 2, 3]),
        });
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#execute').click();
        await expect.poll(() => uploads.length).toBe(1);
        expect(uploads[0]).toEqual(Buffer.from([1, 2, 3]));
      },
      { signedIn: false },
    );
  });
});
