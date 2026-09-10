import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APP_USER_MODEL_ID,
  assetRoot,
  rendererIndexHtml,
  resolveTrayVariant,
  trayIconPath,
  windowIconPath,
} from './icons.js';

const root = process.cwd();

describe('resolveTrayVariant', () => {
  // macOS inverts a template image itself, so there is one file and no theme to read.
  it('always uses the template image on macOS', () => {
    expect(resolveTrayVariant('darwin', true)).toBe('template');
    expect(resolveTrayVariant('darwin', false)).toBe('template');
  });

  // Windows and Linux have no template concept, so the glyph has to be swapped by hand:
  // a dark glyph disappears on a dark taskbar.
  it('uses the light glyph on dark chrome', () => {
    expect(resolveTrayVariant('win32', true)).toBe('white');
    expect(resolveTrayVariant('linux', true)).toBe('white');
  });

  it('uses the dark glyph on light chrome', () => {
    expect(resolveTrayVariant('win32', false)).toBe('black');
    expect(resolveTrayVariant('linux', false)).toBe('black');
  });
});

describe('assetRoot', () => {
  // Found by packaging the app and looking: the tray icon simply did not appear, with no error.
  // Electron's native image loader is not asar-aware even though Node's fs is, so a path inside
  // the archive reads fine from JavaScript and produces nothing when handed to new Tray().
  it('reads images from beside the archive, not inside it', () => {
    expect(assetRoot('/Applications/Alloy Works.app/Contents/Resources/app.asar')).toBe(
      '/Applications/Alloy Works.app/Contents/Resources/app.asar.unpacked',
    );
  });

  it('leaves an unpackaged path alone, because there is no archive', () => {
    expect(assetRoot('/repo/apps/desktop')).toBe('/repo/apps/desktop');
  });

  it('is applied by every path that feeds a native image loader', () => {
    expect(trayIconPath('/app/app.asar', 'black')).toContain('app.asar.unpacked');
    expect(windowIconPath('/app/app.asar')).toContain('app.asar.unpacked');
  });

  // The renderer is loaded with loadFile, which does go through the asar-aware path, so
  // unpacking it would bloat the install for nothing.
  it('is NOT applied to the renderer, which Electron can read from inside the archive', () => {
    expect(rendererIndexHtml('/app/app.asar', true)).not.toContain('unpacked');
  });
});

describe('trayIconPath', () => {
  it('names the 1x file, so Electron can find the @2x sibling itself', () => {
    expect(trayIconPath(root, 'black')).toMatch(/tray-black\.png$/);
    expect(trayIconPath(root, 'white')).toMatch(/tray-white\.png$/);
  });

  // Electron treats a file whose name ends in Template as a template image automatically.
  it('uses the Template suffix macOS looks for', () => {
    expect(trayIconPath(root, 'template')).toMatch(/trayTemplate\.png$/);
  });

  it('points at files that exist, for every variant', () => {
    for (const variant of ['template', 'black', 'white'] as const) {
      expect(existsSync(trayIconPath(root, variant))).toBe(true);
    }
  });

  it('ships the @2x companion for every variant, or retina trays render blurred', () => {
    for (const variant of ['template', 'black', 'white'] as const) {
      const retina = trayIconPath(root, variant).replace(/\.png$/, '@2x.png');
      expect(existsSync(retina)).toBe(true);
    }
  });
});

describe('windowIconPath', () => {
  it('points at a file that exists', () => {
    expect(existsSync(windowIconPath(root))).toBe(true);
  });
});

describe('APP_USER_MODEL_ID', () => {
  // Windows groups taskbar buttons, jump lists and toast notifications by this id. Left unset,
  // the app inherits Electron's own identity and shows Electron's icon however the window and
  // installer icons are configured.
  it('matches the electron-builder appId, or installed and running are two identities', () => {
    const config = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
    const appId = /^appId:\s*(\S+)/m.exec(config);

    expect(appId?.[1]).toBe(APP_USER_MODEL_ID);
  });
});

describe('the packaging config', () => {
  const config = readFileSync(join(root, 'electron-builder.yml'), 'utf8');

  // Every icon path electron-builder is pointed at, checked against the disk. A missing one is
  // not a build error - electron-builder quietly falls back to the Electron icon.
  it('points every icon at a file that exists', () => {
    const icons = [
      ...config.matchAll(/^\s*(?:installer|uninstaller|installerHeader)?[Ii]con:\s*(\S+)/gm),
    ]
      .map((m) => m[1] ?? '')
      .filter((value) => value.startsWith('build/'));

    expect(icons.length).toBeGreaterThan(0);
    expect(icons.filter((icon) => !existsSync(join(root, icon)))).toEqual([]);
  });

  // Without this the tray icon is silently absent in the packaged app while working perfectly
  // in development, which is the worst kind of difference between the two.
  it('unpacks the assets Electron cannot read from inside the archive', () => {
    expect(config).toContain('asarUnpack:');
    expect(config).toContain('- assets/tray/*');
    expect(config).toContain('- assets/icon.png');
  });

  // The renderer lives in a sibling workspace that is not in the bundle, so it has to be copied
  // in under the name rendererIndexHtml looks for.
  it('copies the renderer build in under the name the shell expects', () => {
    expect(config).toMatch(/from:\s*\.\.\/web\/dist/);
    expect(config).toMatch(/to:\s*renderer/);
  });
});

describe('rendererIndexHtml', () => {
  // apps/web does not exist inside the bundle, so the packaged app reads the copy
  // electron-builder placed at renderer/. Getting this wrong is a blank window in the installed
  // app only - the dev path never touches it.
  it('reads the copy inside the bundle once packaged', () => {
    expect(rendererIndexHtml('/app.asar', true)).toBe(join('/app.asar', 'renderer', 'index.html'));
  });

  it('reads the sibling workspace build when unpackaged', () => {
    expect(rendererIndexHtml('/repo/apps/desktop', false)).toBe(
      join('/repo/apps/desktop', '..', 'web', 'dist', 'index.html'),
    );
  });
});
