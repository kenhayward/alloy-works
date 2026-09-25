import { describe, expect, it } from 'vitest';

import { fontKey, obfuscateFont } from './fonts.js';

const SHA = '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74';

describe('an embedded face, obfuscated as ECMA-376 says (Word 1, ruling R10)', () => {
  it("takes its key from the file's own hash, so the same face makes the same bytes every time", () => {
    expect(fontKey(SHA)).toBe('{058EA808-64AE-F09A-23F4-5CBEC2BB5400}');
    expect(fontKey(SHA)).toBe(fontKey(SHA));
    expect(fontKey('f'.repeat(64))).not.toBe(fontKey(SHA));
  });

  it("XORs the first 32 bytes with the key's 16 bytes, read from the end of its written form, and leaves the rest", () => {
    // The key M10 measured Word to read, and what it does to 40 bytes of nothing.
    const key = '{3F2504E0-4F89-11D3-9A0C-0305E82C3301}';
    const reversed = [
      0x01, 0x33, 0x2c, 0xe8, 0x05, 0x03, 0x0c, 0x9a, 0xd3, 0x11, 0x89, 0x4f, 0xe0, 0x04, 0x25,
      0x3f,
    ];
    const zeros = new Uint8Array(40);
    const hidden = obfuscateFont(zeros, key);
    expect([...hidden.slice(0, 16)]).toEqual(reversed);
    expect([...hidden.slice(16, 32)]).toEqual(reversed);
    expect([...hidden.slice(32)]).toEqual(Array(8).fill(0));
    // The file handed in is left as it was: the worker reads it again for the PDF.
    expect([...zeros]).toEqual(Array(40).fill(0));
  });

  it('is undone by the same key, as Word undoes it', () => {
    const face = Uint8Array.from({ length: 100 }, (_, index) => (index * 37) % 256);
    const key = fontKey(SHA);
    expect(obfuscateFont(obfuscateFont(face, key), key)).toEqual(face);
    expect(obfuscateFont(face, key)).not.toEqual(face);
  });
});
