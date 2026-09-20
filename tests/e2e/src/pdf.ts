import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * A PDF as a reader and assistive technology meet it, read by pdf.js rather than by our own code -
 * trimmed to what this suite asserts: each page's label (structure.md's numbering, set per matter,
 * PUB-009), and, per page, the text inside artifacts (running heads and feet, and the draft notice,
 * which assistive technology skips) and the text tagged as content (headings, paragraphs, the
 * contents entries).
 *
 * `apps/worker/src/testing/pdf.ts` reads a publication the same way, for the worker's own suite,
 * with more besides (bookmarks, struct roles, margins) this suite has no need of; `tests/e2e` cannot
 * import an app's internal source, so this is a second, smaller reader rather than that one reused.
 */
export interface ReadPdf {
  readonly pages: number;
  readonly pageLabels: readonly string[] | null;
  readonly artifactText: readonly (readonly string[])[];
  readonly taggedText: readonly (readonly string[])[];
}

export async function readPdf(bytes: Buffer): Promise<ReadPdf> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const artifactText: string[][] = [];
    const taggedText: string[][] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const open: string[] = [];
      const artifacts: string[] = [];
      const tagged: string[] = [];
      for (const item of content.items) {
        if ('type' in item) {
          if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
            // pdf.js carries the tag at run time and leaves it out of the type.
            open.push((item as { tag?: string }).tag ?? '');
          } else if (item.type === 'endMarkedContent') {
            open.pop();
          }
        } else if (item.str.trim() !== '') {
          (open.includes('Artifact') ? artifacts : tagged).push(item.str);
        }
      }
      artifactText.push(artifacts);
      taggedText.push(tagged);
    }
    const pageLabels = (await pdf.getPageLabels()) as string[] | null;
    return { pages: pdf.numPages, pageLabels, artifactText, taggedText };
  } finally {
    // The loading task, not the document: in pdf.js 6 it is the task that owns the worker.
    await task.destroy();
  }
}

/** What a page's runs read as one string, whitespace-normalised - `apps/worker`'s `spoken`. */
export function spoken(runs: readonly string[]): string {
  return runs.join(' ').replace(/\s+/g, ' ').trim();
}
