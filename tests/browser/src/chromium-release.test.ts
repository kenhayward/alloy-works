import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveUrl,
  checkArchive,
  CHROMIUM_RELEASE,
  fetchedExecutable,
  isFetched,
  markerPath,
  type ChromiumPlatform,
} from './chromium-release.js';

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

  it('refuses an archive whose hash is not the pinned one, naming both hashes', () => {
    const archive = Buffer.from('not the archive Chrome for Testing publishes');
    const hash = createHash('sha256').update(archive).digest('hex');

    expect(() => checkArchive(archive, 'linux-x64')).toThrow(
      new RegExp(`${hash}.*${CHROMIUM_RELEASE.assets['linux-x64'].sha256}`),
    );
  });

  it("answers the verified hash for an archive that is the pinned one's", () => {
    // No real archive is at hand without a download, so the pin is stood in for by a hash taken here.
    const archive = Buffer.from('an archive');
    const hash = createHash('sha256').update(archive).digest('hex');

    expect(checkArchive(archive, 'linux-x64', hash)).toBe(hash);
  });

  describe('an existing fetch, trusted only while its marker names the pinned hash', () => {
    let root: URL;
    const platform: ChromiumPlatform = 'linux-x64';
    beforeEach(async () => {
      root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'alloy-chromium-'))}/`);
    });
    afterEach(async () => {
      await rm(fileURLToPath(root), { recursive: true, force: true });
    });
    const executable = async () => {
      const path = fetchedExecutable(root, platform);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '');
    };

    it('is not trusted with no executable', () => {
      expect(isFetched(root, platform)).toBe(false);
    });

    it('is not trusted with an executable and no marker, as a cache from before the marker has', async () => {
      await executable();
      expect(isFetched(root, platform)).toBe(false);
    });

    it('is not trusted when the marker names another hash, as after the pin moves', async () => {
      await executable();
      await writeFile(markerPath(root), 'f'.repeat(64));
      expect(isFetched(root, platform)).toBe(false);
    });

    it('is trusted when the executable is there and the marker names the pinned hash', async () => {
      await executable();
      await writeFile(markerPath(root), CHROMIUM_RELEASE.assets[platform].sha256);
      expect(isFetched(root, platform)).toBe(true);
    });
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
