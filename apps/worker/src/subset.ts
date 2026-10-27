import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** HarfBuzz's subsetter's own C entry points, as `harfbuzz-subset.wasm` exports them. */
interface Subsetter {
  readonly memory: { readonly buffer: ArrayBuffer };
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codePoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

/** The runtime's WebAssembly, which this project's `lib` does not declare. */
const { WebAssembly: wasmRuntime } = globalThis as unknown as {
  readonly WebAssembly: {
    instantiate(bytes: Uint8Array): Promise<{ readonly instance: { readonly exports: unknown } }>;
  };
};

/** `HB_MEMORY_MODE_WRITABLE`: HarfBuzz may use the bytes where they are, which are ours to give. */
const WRITABLE = 2;

/**
 * **A face file kept to the characters a document sets in it** (the HT plan, HT-B): HarfBuzz's own
 * subsetter, pinned in `harfbuzzjs` 1.6.3, which closes over each character's shaping - an Arabic
 * letter's joining forms and ligatures through GSUB - and keeps a maths face's MATH table, its
 * variants and assembly parts with it, so the face sets in the browser what it set in the PDF. What
 * the HTML writer is given as `subset`; the subset is embedded as the PDF embeds its own (ADR-0010,
 * OFL 1.1). Throws where HarfBuzz cannot read the file, which a pinned face never is.
 */
export async function loadSubsetter(): Promise<
  (bytes: Uint8Array, codePoints: readonly number[]) => Uint8Array
> {
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const { instance } = await wasmRuntime.instantiate(wasm);
  const hb = instance.exports as unknown as Subsetter;
  return (bytes, codePoints) => {
    const at = hb.malloc(bytes.length);
    new Uint8Array(hb.memory.buffer).set(bytes, at);
    const blob = hb.hb_blob_create(at, bytes.length, WRITABLE, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    const input = hb.hb_subset_input_create_or_fail();
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const codePoint of codePoints) hb.hb_set_add(unicodes, codePoint);
    const subset = hb.hb_subset_or_fail(face, input);
    hb.hb_subset_input_destroy(input);
    try {
      if (subset === 0) throw new Error('HarfBuzz could not subset the face');
      const result = hb.hb_face_reference_blob(subset);
      const data = hb.hb_blob_get_data(result, 0);
      const length = hb.hb_blob_get_length(result);
      const kept = new Uint8Array(hb.memory.buffer, data, length).slice();
      hb.hb_blob_destroy(result);
      if (length === 0) throw new Error('HarfBuzz subset the face to nothing');
      return kept;
    } finally {
      if (subset !== 0) hb.hb_face_destroy(subset);
      hb.hb_face_destroy(face);
      hb.free(at);
    }
  };
}
