import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * An organisation's console in Chromium, against the whole system (the TL plan, TLe): the walk that
 * shares a provider, asks for a tenant and sees the steward's own container make it, since nothing else
 * runs that process in the real stack.
 */
const ORGANISATION = SERVICE.replace('//dev.acme.', '//org.acme.');

describe("an organisation's console, in Chromium (the TL plan, TLe)", () => {
  it('IAM-068 shares a provider, asks for a tenant, and the steward makes it', async ({ task }) => {
    // Asking who is signed in before anybody is; and a new tenant that does not yet answer.
    allowPageNoise(/status of 401 \(Unauthorized\)/, /status of 404 \(Not Found\)/);
    await withPage(
      async (page) => {
        await page.goto(ORGANISATION);
        await page.getByRole('link', { name: 'Sign in', exact: true }).click();
        await page.getByRole('link', { name: /^Ada / }).click();
        const title = page.getByRole('heading', { name: "Your organisation's tenants" });
        await title.waitFor();
        await checkAxe(page, "an organisation's console", task.meta, { shows: title });

        // Anything here but the console is refused, so the shell never appears.
        await page.getByRole('link', { name: 'Sign-in' }).click();
        const provider = page.getByRole('row', { name: /Stand-in|Your organisation/ }).first();
        await provider.waitFor();
        await checkAxe(page, 'sign-in, at an organisation', task.meta, { shows: provider });
        if ((await provider.getByText('Shared with your tenants').count()) === 0) {
          await provider.getByRole('button', { name: /More|Actions/ }).click();
          await page.getByRole('menuitem', { name: 'Share with your tenants' }).click();
          await provider.getByText('Shared with your tenants').waitFor();
        }
        await page.goBack();
        await title.waitFor();

        const label = `t${randomUUID().slice(0, 8)}`;
        await page.getByLabel('Name', { exact: true }).fill(`Walk ${label}`);
        await page.getByLabel('Address', { exact: true }).fill(label);
        await page.getByLabel(/First administrator/).fill('ada@example.com');
        await page.getByRole('button', { name: 'Create the tenant' }).click();

        // Within the steward's poll and the time to migrate a tenant, it stops being a request.
        const row = page.getByRole('row', { name: new RegExp(`Walk ${label}`) });
        await vi.waitFor(
          async () => {
            await page.reload();
            await title.waitFor();
            expect(await row.count()).toBe(1);
          },
          { timeout: 180_000, interval: 5_000 },
        );
        await checkAxe(page, "an organisation's console, with a new tenant", task.meta, {
          shows: row,
        });
        // Through the browser, which resolves any `*.localhost`, as Node here need not.
        const answer = await page.goto(`${ORGANISATION.replace('//org.', `//${label}.`)}/v1/me`);
        expect(answer?.status()).toBe(401);
      },
      { signedIn: false },
    );
  }, 300_000);
});
