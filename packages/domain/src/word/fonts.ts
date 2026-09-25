/**
 * A face embedded in a Word document (Word 1, ruling R10; measured, M10): its file, obfuscated as
 * ECMA-376 Part 1 17.8.1 says, under a key the font table names beside it.
 */

/**
 * The key a face is obfuscated under, written as the font table writes a GUID: **the first 128 bits of
 * the file's own SHA-256**, rather than random ones. The standard asks only that the table and the
 * part agree; a random key would make every publication of one document different bytes, where the
 * writer's are the same for the same inputs (R6). The key hides nothing - it stands in the same
 * package as the file it unlocks - so taking it from the hash gives nothing away.
 */
export function fontKey(sha256: string): string {
  const hex = sha256.slice(0, 32).toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}

/**
 * The file as the package holds it: its first 32 bytes XORed with the key's 16, taken from the last
 * pair of hex digits of the key's written form to the first - the byte order Word reads, measured
 * (M10). A copy: the caller's bytes are left as they were. Its own inverse, which is how a test reads
 * a face back.
 */
export function obfuscateFont(bytes: Uint8Array, key: string): Uint8Array {
  const hex = key.replace(/[{}-]/g, '');
  const reversed = Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(30 - 2 * index, 32 - 2 * index), 16),
  );
  const out = new Uint8Array(bytes);
  for (let index = 0; index < Math.min(32, out.length); index++) {
    out[index]! ^= reversed[index % 16]!;
  }
  return out;
}
