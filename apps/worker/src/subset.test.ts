import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as hb from 'harfbuzzjs';
import { describe, expect, it } from 'vitest';

import { FONT_DIRECTORY } from './fonts.js';
import { loadSubsetter } from './subset.js';

const subset = await loadSubsetter();
const face = (file: string) => readFile(join(FONT_DIRECTORY, file));
const points = (text: string) => [...new Set([...text].map((each) => each.codePointAt(0)!))].sort((a, b) => a - b);

/** The tables a face file holds, by tag, from its table directory. */
function tables(bytes: Uint8Array): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  const tags = new Set<string>();
  for (let at = 0; at < count; at += 1) {
    tags.add(String.fromCharCode(...bytes.subarray(12 + at * 16, 16 + at * 16)));
  }
  return tags;
}

/** The outlines a face draws `text` with, as HarfBuzz shapes it: what a reader sees, glyph by glyph. */
function drawn(bytes: Uint8Array, text: string): string[] {
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  return buffer.getGlyphInfos().map((glyph) => font.glyphToPath(glyph.codepoint));
}

describe("an HTML output's faces, each subset by HarfBuzz (the HT plan, HT-B)", () => {
  it("keeps an Arabic paragraph's Naskh shaping: its GSUB, and every joining form drawn as before", async () => {
    const naskh = await face('NotoNaskhArabic-Regular.ttf');
    // Ada's name and a word of three joining letters, in Arabic: each letter's initial, medial and
    // final form is a substitution GSUB makes.
    const words = 'آدا محمد لا';
    const kept = subset(naskh, points(words));
    expect(kept.length).toBeLessThan(naskh.length / 10);
    expect(tables(kept)).toContain('GSUB');
    const before = drawn(naskh, words);
    expect(new Set(before).size).toBeGreaterThan(4);
    expect(drawn(kept, words)).toEqual(before);
  });

  it("keeps a maths face's MATH table, so a stretched fence and a large operator are still drawn", async () => {
    const maths = await face('STIXTwoMath-Regular.otf');
    const kept = subset(maths, points('x+1=∑(∫)'));
    expect(tables(kept)).toContain('MATH');
    expect(kept.length).toBeLessThan(maths.length / 4);
    expect(drawn(kept, '∑x')).toEqual(drawn(maths, '∑x'));
  });
});
