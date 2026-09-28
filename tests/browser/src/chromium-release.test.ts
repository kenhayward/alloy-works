import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveUrl, CHROMIUM_RELEASE, type ChromiumPlatform } from './chromium-release.js';

/** What the installed `playwright-core` says it drives, read from its own `browsers.json`. */
function playwrightsHeadlessShell(): { revision: string; browserVersion: string } {
  // Not among the package's exports, so it is found beside the manifest, which is.
  const require = createRequire(import.meta.url);
  const file = join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json');
  const { browsers } = JSON.parse(readFileSync(file, 'utf8')) as {
    browsers: { name: string; revision: string; browserVersion?: string }[];
  };
  const shell = browsers.find((browser) => browser.name === 'chromium-headless-shell');
  if (!shell?.browserVersion) throw new Error('playwright-core names no chromium-headless-shell');
  return { revision: shell.revision, browserVersion: shell.browserVersion };
}

describe('the pinned Chromium', () => {
  it('is the build the installed playwright-core names, so a Playwright bump needs a new pin', () => {
    const named = playwrightsHeadlessShell();
    expect({ version: CHROMIUM_RELEASE.version, revision: CHROMIUM_RELEASE.revision }).toEqual({
      version: named.browserVersion,
      revision: named.revision,
    });
  });

  it('holds a sha256 for every platform it names, taken from the archive', () => {
    for (const asset of Object.values(CHROMIUM_RELEASE.assets)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is fetched from Chrome for Testing's public bucket, under the pinned version", () => {
    const platforms = Object.keys(CHROMIUM_RELEASE.assets) as ChromiumPlatform[];
    expect(platforms.map(archiveUrl)).toEqual(
      ['linux64', 'win64', 'mac-arm64', 'mac-x64'].map(
        (platform) =>
          `https://storage.googleapis.com/chrome-for-testing-public/${CHROMIUM_RELEASE.version}/` +
          `${platform}/chrome-headless-shell-${platform}.zip`,
      ),
    );
  });
});
