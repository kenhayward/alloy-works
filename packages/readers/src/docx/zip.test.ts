import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readZip, ZIP_CAPS } from './zip.js';

const MB = 1024 * 1024;
const all = () => true;

/** A zip built entry by entry, so a test can write what `zipSync` would not: a name twice. */
function zipOf(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, bytes] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

describe('readZip', () => {
  it('reads the parts asked for, and only those', () => {
    const bytes = zipSync({
      'word/document.xml': strToU8('<w:document/>'),
      'word/media/image1.png': strToU8('not read'),
    });
    const read = readZip(bytes, (name) => name === 'word/document.xml');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.names).toEqual(['word/document.xml', 'word/media/image1.png']);
    expect([...read.parts.keys()]).toEqual(['word/document.xml']);
    expect(new TextDecoder().decode(read.parts.get('word/document.xml'))).toBe('<w:document/>');
  });

  it('refuses a zip bomb as it inflates, past 20 MB in a part', () => {
    // 21 MB of zeros deflates to a few kilobytes: the declared sizes are never trusted.
    const bytes = zipSync({ 'word/document.xml': new Uint8Array(21 * MB) }, { level: 9 });
    expect(bytes.length).toBeLessThan(100_000);
    const read = readZip(bytes, all);
    expect(read).toMatchObject({ ok: false, refusal: 'inflated' });
  });

  it('refuses more inflated bytes in all than the cap, across parts', () => {
    const part = new Uint8Array(3 * MB);
    const bytes = zipSync({ a: part, b: part, c: part }, { level: 9 });
    const read = readZip(bytes, all, { ...ZIP_CAPS, inflated: 8 * MB });
    expect(read).toMatchObject({ ok: false, refusal: 'inflated' });
  });

  it('refuses an entry whose name climbs out, is absolute or uses a backslash', () => {
    const backslash = `word${String.fromCharCode(92)}evil.xml`;
    for (const name of ['../evil.xml', 'word/../../evil.xml', '/etc/evil', backslash, 'C:/evil']) {
      const read = readZip(zipOf([[name, strToU8('x')]]), all);
      expect(read, name).toMatchObject({ ok: false, refusal: 'entryName' });
    }
  });

  it('refuses a name that appears twice, in any case', () => {
    const twice = zipOf([
      ['word/document.xml', strToU8('<a/>')],
      ['Word/Document.xml', strToU8('<b/>')],
    ]);
    expect(readZip(twice, all)).toMatchObject({ ok: false, refusal: 'entryName' });
  });

  it('refuses more than 1,000 entries', () => {
    const many = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [`e${index}`, new Uint8Array()]),
    );
    expect(readZip(zipSync(many), () => false)).toMatchObject({ ok: false, refusal: 'entries' });
  });

  it('refuses what is not a zip, or is cut short', () => {
    expect(readZip(strToU8('plain text'), all)).toMatchObject({ ok: false, refusal: 'unreadable' });
    const whole = zipOf([['word/document.xml', new Uint8Array(4096).fill(65)]]);
    const cut = whole.subarray(0, 2000);
    expect(readZip(cut, all)).toMatchObject({ ok: false, refusal: 'unreadable' });
  });

  it('reads a deflated part streamed in pieces', () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((_, chunk) => chunks.push(chunk));
    const entry = new ZipDeflate('word/document.xml', { level: 6 });
    zip.add(entry);
    const text = 'Ada '.repeat(50_000);
    entry.push(strToU8(text), true);
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    const read = readZip(bytes, all);
    expect(read.ok && new TextDecoder().decode(read.parts.get('word/document.xml'))).toBe(text);
  });
});
