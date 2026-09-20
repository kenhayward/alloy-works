import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One bookmark and those beneath it. */
export interface Bookmark {
  readonly title: string;
  readonly items: readonly Bookmark[];
}

/**
 * A PDF as a reader and assistive technology meet it, read by pdf.js rather than by our own code: its
 * bookmarks; per page, the text inside artifacts (running heads and feet, which assistive technology
 * skips) and the text in tagged content; the structure roles in document order after the role map,
 * which is what a screen reader is told; whether it is marked tagged; and its PDF/UA part. And the
 * page as it is set: each page's label, as a reader's page box shows it (null where the PDF declares
 * none); each page's width and height in points, as it is turned; and the least x of each page's
 * tagged text, in points from the page's left edge (null on a page with none), which is where its
 * left margin ends; and the greatest and least baseline of each page's tagged text, in points up from
 * the page's bottom edge (null on a page with none), which lie inside its top and bottom margins.
 */
export interface ReadPdf {
  readonly pages: number;
  readonly bookmarks: readonly Bookmark[];
  readonly artifactText: readonly (readonly string[])[];
  readonly taggedText: readonly (readonly string[])[];
  readonly roles: readonly string[];
  readonly marked: boolean;
  readonly pdfuaPart: string | null;
  readonly title: string | null;
  readonly language: string | null;
  readonly pageLabels: readonly string[] | null;
  readonly pageSizes: readonly (readonly [number, number])[];
  readonly textLeft: readonly (number | null)[];
  readonly textBaselines: readonly ({ readonly top: number; readonly bottom: number } | null)[];
}

interface StructNode {
  readonly role?: string;
  readonly children?: readonly StructNode[];
}

export async function readPdf(bytes: Buffer): Promise<ReadPdf> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const outline = (await pdf.getOutline()) ?? [];
    const bookmarks = (items: readonly { title: string; items: unknown[] }[]): Bookmark[] =>
      items.map((item) => ({
        title: item.title,
        items: bookmarks(item.items as { title: string; items: unknown[] }[]),
      }));
    const artifactText: string[][] = [];
    const taggedText: string[][] = [];
    const roles: string[] = [];
    const pageSizes: (readonly [number, number])[] = [];
    const textLeft: (number | null)[] = [];
    const textBaselines: ({ top: number; bottom: number } | null)[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const open: string[] = [];
      const artifacts: string[] = [];
      const tagged: string[] = [];
      let left: number | null = null;
      let baselines: { top: number; bottom: number } | null = null;
      for (const item of content.items) {
        if ('type' in item) {
          if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
            // pdf.js carries the tag at run time and leaves it out of the type.
            open.push((item as { tag?: string }).tag ?? '');
          } else if (item.type === 'endMarkedContent') {
            open.pop();
          }
        } else if (item.str.trim() !== '') {
          if (open.includes('Artifact')) {
            artifacts.push(item.str);
          } else {
            tagged.push(item.str);
            // The text matrix's horizontal translation: where the run starts, from the left edge.
            const x = item.transform[4] as number;
            left = left === null ? x : Math.min(left, x);
            // And its vertical translation: the run's baseline, from the bottom edge.
            const y = item.transform[5] as number;
            baselines =
              baselines === null
                ? { top: y, bottom: y }
                : { top: Math.max(baselines.top, y), bottom: Math.min(baselines.bottom, y) };
          }
        }
      }
      artifactText.push(artifacts);
      taggedText.push(tagged);
      textLeft.push(left);
      textBaselines.push(baselines);
      // The MediaBox as the PDF writes it, [x1, y1, x2, y2]: Typst turns a landscape page by writing
      // its box wide, not by a /Rotate, which this would not apply.
      const [x1, y1, x2, y2] = page.view as [number, number, number, number];
      pageSizes.push([x2 - x1, y2 - y1]);
      const visit = (node: StructNode) => {
        if (node.role !== undefined && node.role !== 'Root') roles.push(node.role);
        for (const child of node.children ?? []) visit(child);
      };
      const tree = (await page.getStructTree()) as StructNode | null;
      if (tree) visit(tree);
    }
    const pageLabels = (await pdf.getPageLabels()) as string[] | null;
    const metadata = await pdf.getMetadata();
    const info = metadata.info as { Title?: string; Language?: string };
    // pdf.js answers the MarkInfo dictionary as a Map.
    const markInfo = (await pdf.getMarkInfo()) as Map<string, unknown> | null;
    return {
      pages: pdf.numPages,
      bookmarks: bookmarks(outline as { title: string; items: unknown[] }[]),
      artifactText,
      taggedText,
      roles,
      marked: markInfo?.get('Marked') === true,
      pdfuaPart: metadata.metadata?.get('pdfuaid:part') ?? null,
      title: info.Title ?? null,
      language: info.Language ?? null,
      pageLabels,
      pageSizes,
      textLeft,
      textBaselines,
    };
  } finally {
    // The loading task, not the document: in pdf.js 6 it is the task that owns the worker.
    await task.destroy();
  }
}
