import { fileURLToPath } from 'node:url';

/**
 * The Typst the worker runs, pinned: the version a publication records must be the version that
 * made it (ADR-0019). Each hash was checked against the digest GitHub publishes for that asset.
 */
export const TYPST_RELEASE = {
  version: '0.15.1',
  assets: {
    'win32-x64': {
      name: 'typst-x86_64-pc-windows-msvc.zip',
      sha256: '19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736',
    },
    'linux-x64': {
      name: 'typst-x86_64-unknown-linux-musl.tar.xz',
      sha256: 'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c',
    },
    'linux-arm64': {
      name: 'typst-aarch64-unknown-linux-musl.tar.xz',
      sha256: '5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee',
    },
    'darwin-x64': {
      name: 'typst-x86_64-apple-darwin.tar.xz',
      sha256: '7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa',
    },
    'darwin-arm64': {
      name: 'typst-aarch64-apple-darwin.tar.xz',
      sha256: '48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a',
    },
  },
} as const;

export type TypstPlatform = keyof typeof TYPST_RELEASE.assets;

/** This machine, as the release names it. */
export function currentPlatform(): TypstPlatform {
  const platform = `${process.platform}-${process.arch}`;
  if (platform in TYPST_RELEASE.assets) return platform as TypstPlatform;
  throw new Error(`Typst ${TYPST_RELEASE.version} is not pinned for ${platform}`);
}

/** Where `fetch-typst` puts it, and where the worker looks. */
export function fetchedBinary(root: URL): string {
  const name = process.platform === 'win32' ? 'typst.exe' : 'typst';
  // fileURLToPath, never the URL's pathname: on Windows that would be `/C:/...`.
  return fileURLToPath(new URL(`.tools/typst-${TYPST_RELEASE.version}/${name}`, root));
}
