import { describe, expect, it } from 'vitest';
import { createTypst, TypstFailed, typstBinaryPath, TYPST_RELEASE } from './typst.js';

const typst = createTypst({ binary: typstBinaryPath() });
const data = { environment: 'Development', requestedAt: '2026-09-11T00:00:00.000Z' };
const at = new Date('2026-09-11T00:00:00.000Z');

describe('the pinned Typst', () => {
  it('is the version this worker was built against', async () => {
    expect(await typst.version()).toBe(TYPST_RELEASE.version);
  });

  it('renders the sample as a PDF', async () => {
    const pdf = await typst.render(data, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).toContain('Development');
  });

  it('treats the data as data, whatever it looks like (ADR-0013)', async () => {
    // As Typst source this would stop the render; as data it is a name with odd punctuation.
    const pdf = await typst.render({ ...data, environment: '#panic("injected") *bold*' }, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the same bytes for the same input', async () => {
    const [once, again] = [await typst.render(data, at), await typst.render(data, at)];
    expect(once.equals(again)).toBe(true);
  });

  it('says plainly when the binary is not there', async () => {
    const missing = createTypst({ binary: 'typst-that-is-not-installed' });
    await expect(missing.render(data, at)).rejects.toThrow(TypstFailed);
  });
});
