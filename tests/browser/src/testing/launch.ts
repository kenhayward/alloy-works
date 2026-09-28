import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { CHROMIUM_RELEASE, fetchedExecutable } from '../chromium-release.js';

/** The workspace's root, beneath which `fetch-chromium` leaves the build in `.tools/`. */
const ROOT = new URL('../../', import.meta.url);

/**
 * The pinned Chromium, headless, by its path: never a browser the machine happens to have, and never
 * one Playwright fetched for itself (the W13 plan's B-E). Hinting is off, so a measurement does not
 * move with the platform's font hinting.
 */
export async function launchPinned(): Promise<Browser> {
  const executablePath = fetchedExecutable(ROOT);
  if (!existsSync(executablePath)) {
    throw new Error(
      `Chromium ${CHROMIUM_RELEASE.version} is not at ${executablePath}. ` +
        'Run pnpm --filter @alloy-works/browser fetch-chromium first.',
    );
  }
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--font-render-hinting=none'],
  });
}
