import { leaked } from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * A PDF's text as a reader's extractor finds it (REU-048; the R6 plan, R6-G): every page's text, its
 * document information and its XMP metadata, so a passage hidden in either is found.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const said: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) if ('str' in item) said.push(item.str);
    }
    const { info, metadata } = await pdf.getMetadata();
    said.push(...Object.values((info ?? {}) as Record<string, unknown>).map(String));
    // The XMP packet whole, its markup stripped: every property it holds is read.
    if (metadata) said.push(xmlText(String(metadata.getRaw())));
    return said.join(' ');
  } finally {
    await task.destroy();
  }
}

/** XML's character data as text: its five entities and its character references read (R6-G). */
export function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) =>
      name === 'lt'
        ? '<'
        : name === 'gt'
          ? '>'
          : name === 'quot'
            ? '"'
            : name === 'apos'
              ? "'"
              : '&',
    );
}

/** A Word document's text: every XML part's character data, its body and its properties alike. */
export function docxText(bytes: Uint8Array): string {
  const parts = unzipSync(bytes, { filter: (file) => file.name.endsWith('.xml') });
  return Object.values(parts)
    .map((part) => xmlText(strFromU8(part)))
    .join(' ');
}

/** The probes an output holds: what was excluded and reached it anyway. */
export async function leakedFrom(
  probes: readonly string[],
  format: 'pdf' | 'docx',
  bytes: Uint8Array,
): Promise<string[]> {
  if (probes.length === 0) return [];
  return leaked(probes, format === 'pdf' ? await pdfText(bytes) : docxText(bytes));
}
