import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// A broken icon reference fails silently - the browser just shows its default and nobody
// notices for months. These tests read the real files, so a rename or a missed copy fails here.
const root = process.cwd();
const publicDir = join(root, 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Every root-relative asset URL the document references. */
function referencedAssets(): string[] {
  return [...html.matchAll(/(?:href|content)="(\/[^"]+\.[a-z0-9]+)"/g)].map((m) => m[1] ?? '');
}

describe('the document head', () => {
  it('declares an ICO favicon for browsers that want one', () => {
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/favicon\.ico"/);
  });

  it('declares an SVG favicon, which browsers prefer when they support it', () => {
    expect(html).toMatch(
      /<link rel="icon"[^>]*type="image\/svg\+xml"[^>]*href="\/mark-light\.svg"/,
    );
  });

  it('declares an apple-touch-icon, which iOS uses for the home screen', () => {
    expect(html).toMatch(/<link rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
  });

  it('links the web app manifest', () => {
    expect(html).toMatch(/<link rel="manifest"[^>]*href="\/site\.webmanifest"/);
  });

  it('sets a theme colour for each scheme, which colours mobile browser chrome', () => {
    expect(html).toMatch(/<meta name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"/);
    expect(html).toMatch(/<meta name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/);
  });

  it('references only files that exist', () => {
    const missing = referencedAssets().filter((url) => !existsSync(join(publicDir, url)));

    expect(missing).toEqual([]);
  });
});

describe('the web app manifest', () => {
  const manifest: {
    name?: string;
    icons?: { src: string; sizes: string; type: string; purpose?: string }[];
  } = JSON.parse(readFileSync(join(publicDir, 'site.webmanifest'), 'utf8'));

  it('names the app', () => {
    expect(manifest.name).toBe('Alloy Works');
  });

  it('offers the two sizes an installed app is asked for', () => {
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);

    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  // Without a maskable icon Android letterboxes the icon inside a white circle rather than
  // filling the shape it wants.
  it('offers a maskable icon', () => {
    const maskable = (manifest.icons ?? []).filter((icon) => icon.purpose === 'maskable');

    expect(maskable.length).toBeGreaterThan(0);
  });

  it('references only files that exist', () => {
    const missing = (manifest.icons ?? [])
      .map((icon) => icon.src)
      .filter((src) => !existsSync(join(publicDir, src)));

    expect(missing).toEqual([]);
  });
});
