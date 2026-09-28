import { fileURLToPath } from 'node:url';

/**
 * The Chromium the browser suite drives, pinned as the worker's Typst is (the W13 plan's B-E): Chrome
 * for Testing's `chrome-headless-shell`, at the build the installed `playwright-core` names in its own
 * `browsers.json` - `chromium-release.test.ts` holds the two equal, so a Playwright bump without a new
 * pin fails by name. Each hash was taken by `fetch-chromium --print-hashes` from the archive itself.
 */
export const CHROMIUM_RELEASE = {
  version: '153.0.8010.12',
  /** Playwright's own number for the same build, which its `browsers.json` names beside it. */
  revision: '1243',
  assets: {
    'linux-x64': {
      platform: 'linux64',
      sha256: 'a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d',
    },
    'win32-x64': {
      platform: 'win64',
      sha256: '7aec872f3090e639c4237467624ea863c20fe2878914c93a6556bdbb52aa6c4c',
    },
    'darwin-arm64': {
      platform: 'mac-arm64',
      sha256: '89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2',
    },
    'darwin-x64': {
      platform: 'mac-x64',
      sha256: '5c2eaa1aad62111bb5a70dd0889dd3093f3142277b8f78957a238257ee85f009',
    },
  },
} as const;

export type ChromiumPlatform = keyof typeof CHROMIUM_RELEASE.assets;

/** Google's public Chrome for Testing bucket, which every build it publishes is served from. */
const BUCKET = 'https://storage.googleapis.com/chrome-for-testing-public';

/** The archive's name for one platform, as Chrome for Testing publishes it. */
export function archiveName(platform: ChromiumPlatform): string {
  return `chrome-headless-shell-${CHROMIUM_RELEASE.assets[platform].platform}.zip`;
}

/** Where one platform's archive is downloaded from. */
export function archiveUrl(platform: ChromiumPlatform): string {
  const { platform: named } = CHROMIUM_RELEASE.assets[platform];
  return `${BUCKET}/${CHROMIUM_RELEASE.version}/${named}/${archiveName(platform)}`;
}

/** This machine, as the pin names it. */
export function currentPlatform(): ChromiumPlatform {
  const platform = `${process.platform}-${process.arch}`;
  if (platform in CHROMIUM_RELEASE.assets) return platform as ChromiumPlatform;
  throw new Error(`Chromium ${CHROMIUM_RELEASE.version} is not pinned for ${platform}`);
}

/** Where `fetch-chromium` unpacks the build, beneath the workspace's `.tools/`. */
export function fetchedHome(root: URL): string {
  // fileURLToPath, never the URL's pathname: on Windows that would be `/C:/...`.
  return fileURLToPath(new URL(`.tools/chromium-${CHROMIUM_RELEASE.version}/`, root));
}

/** The executable `fetch-chromium` leaves, and the one the suite launches. */
export function fetchedExecutable(
  root: URL,
  platform: ChromiumPlatform = currentPlatform(),
): string {
  const { platform: named } = CHROMIUM_RELEASE.assets[platform];
  const name = platform === 'win32-x64' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  return fileURLToPath(
    new URL(
      `.tools/chromium-${CHROMIUM_RELEASE.version}/chrome-headless-shell-${named}/${name}`,
      root,
    ),
  );
}
