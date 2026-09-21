import { inflateSync } from 'node:zlib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One bookmark and those beneath it. */
export interface Bookmark {
  readonly title: string;
  readonly items: readonly Bookmark[];
}

/**
 * A run of tagged text whose marked content declares a language of its own, and the language it
 * declares. This is what a screen reader changes voice for, and it is **not** a structure element:
 * a run in another language has no role of its own, so nothing in `roles` or in `taggedText` moves
 * when a writer stops setting it.
 */
export interface TaggedLanguage {
  readonly language: string;
  /** The text the run covers, as the extraction gives it back. */
  readonly runs: readonly string[];
}

/**
 * A PDF as a reader and assistive technology meet it, read by pdf.js rather than by our own code: its
 * bookmarks; per page, the text inside artifacts (running heads and feet, which assistive technology
 * skips), the text in tagged content, the addresses its link annotations take a reader to and the
 * runs that declare a language of their own; the structure roles in document order after the role map,
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
  /**
   * Every link annotation, per page, as a reader's viewer would follow it. A link into the document
   * itself - a contents entry - carries a destination rather than an address and is not one of
   * these; its role is in `roles`, where a contents is read for its `Link` elements.
   *
   * An address pdf.js will not open itself arrives as `unsafeUrl` rather than `url`, and it is taken
   * just the same: pdf.js's idea of a safe scheme is not the content model's `allowedLinkSchemes`,
   * and a link an author can write must never go missing from this list, which would leave an
   * assertion about the links on a page passing beside an annotation nothing had looked at.
   */
  readonly links: readonly (readonly string[])[];
  /** Every run of a page's tagged text that declares a language of its own, in the page's order. */
  readonly languages: readonly (readonly TaggedLanguage[])[];
  readonly roles: readonly string[];
  readonly marked: boolean;
  readonly pdfuaPart: string | null;
  readonly title: string | null;
  readonly language: string | null;
  readonly pageLabels: readonly string[] | null;
  readonly pageSizes: readonly (readonly [number, number])[];
  readonly textLeft: readonly (number | null)[];
  readonly textBaselines: readonly ({ readonly top: number; readonly bottom: number } | null)[];
  /**
   * Every run of tagged text with where it stands: its page, its start from the left edge, its
   * baseline from the bottom edge and its width, all in points. For a column to be asserted by
   * position rather than parsed out of a page's text in the test (editor 5, task 9).
   */
  readonly items: readonly TextItem[];
}

export interface TextItem {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

interface StructNode {
  readonly role?: string;
  readonly children?: readonly StructNode[];
}

/** A page's own object, as pdf.js names it. */
interface PageRef {
  readonly num: number;
  readonly gen: number;
}

/**
 * The language each of a page's marked-content sequences declares, by its MCID, read from the page's
 * own content stream. pdf.js carries a marked-content property dictionary no further than its tag and
 * its MCID, and a `/Lang` there is not a structure element and is on no annotation, so the content
 * stream is the one place it can be seen at all.
 *
 * The page's object is the one pdf.js named, and the pinned Typst writes every object on its own
 * rather than inside an object stream, so the definition is found by its number. Anything this cannot
 * read throws: a reader that quietly found nothing would leave every assertion about a language
 * passing over a document that declares none.
 */
function markedLanguages(bytes: Buffer, text: string, ref: PageRef): Map<number, string> {
  // A latin-1 view is one character per byte, so an index into it is an index into the bytes.
  const definition = (num: number, gen: number) => {
    const found = new RegExp(`(?:^|[^0-9])${num} ${gen} obj\\b`).exec(text);
    if (found === null) throw new Error(`The PDF has no object ${num} ${gen}`);
    return found.index + found[0].length;
  };
  const page = definition(ref.num, ref.gen);
  const dictionary = text.slice(page, text.indexOf('endobj', page));
  const contents = /\/Contents\s*(?:(\d+)\s+(\d+)\s*R|\[([^\]]*)\])/.exec(dictionary);
  if (contents === null) throw new Error(`Page object ${ref.num} declares no contents`);
  const refs =
    contents[1] === undefined
      ? [...(contents[3] ?? '').matchAll(/(\d+)\s+(\d+)\s*R/g)].map(
          (each) => [Number(each[1]), Number(each[2])] as const,
        )
      : [[Number(contents[1]), Number(contents[2])] as const];

  const declared = new Map<number, string>();
  for (const [num, gen] of refs) {
    const at = definition(num, gen);
    const opens = text.indexOf('stream', at);
    if (opens < 0) throw new Error(`Content object ${num} holds no stream`);
    const header = text.slice(at, opens);
    // `stream` is followed by a line ending, which is not part of the data.
    const from = opens + 'stream'.length + (text[opens + 'stream'.length] === '\r' ? 2 : 1);
    const length = /\/Length\s+(\d+)/.exec(header);
    const to = length === null ? text.indexOf('endstream', from) : from + Number(length[1]);
    const raw = bytes.subarray(from, to);
    const content = (header.includes('/FlateDecode') ? inflateSync(raw) : raw).toString('latin1');
    // Every `/Lang` in a content stream is in the property dictionary of a marked-content sequence;
    // a page's text is written as glyph indices of an embedded subset, never as words, so nothing
    // an author typed can look like one of these.
    for (const marked of content.matchAll(/<<([^>]*)>>\s*BDC/g)) {
      const properties = marked[1] ?? '';
      const mcid = /\/MCID\s+(\d+)/.exec(properties);
      const language = /\/Lang\s*\(([^)]*)\)/.exec(properties);
      if (mcid !== null && language !== null) declared.set(Number(mcid[1]), language[1] ?? '');
    }
  }
  return declared;
}

export async function readPdf(bytes: Buffer): Promise<ReadPdf> {
  // The file as one character per byte, for the one thing pdf.js does not answer: see below.
  const text = bytes.toString('latin1');
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
    const links: string[][] = [];
    const languages: TaggedLanguage[][] = [];
    const roles: string[] = [];
    const pageSizes: (readonly [number, number])[] = [];
    const textLeft: (number | null)[] = [];
    const textBaselines: ({ top: number; bottom: number } | null)[] = [];
    const items: TextItem[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      // Which marked-content sequences on this page declare a language, by their MCID.
      const declared = markedLanguages(bytes, text, page.ref as PageRef);
      const open: { tag: string; mcid: number | null }[] = [];
      const artifacts: string[] = [];
      const tagged: string[] = [];
      const spoken: TaggedLanguage[] = [];
      const said = new Map<number, string[]>();
      let left: number | null = null;
      let baselines: { top: number; bottom: number } | null = null;
      for (const item of content.items) {
        if ('type' in item) {
          if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
            // pdf.js carries the tag and the MCID at run time and leaves both out of the type. The
            // identifier it makes ends in the MCID, which is what the content stream keys a `/Lang`
            // by, and is null where the sequence has none.
            const marked = item as { tag?: string; id?: string | null };
            const mcid = /_mc(\d+)$/.exec(marked.id ?? '');
            open.push({ tag: marked.tag ?? '', mcid: mcid === null ? null : Number(mcid[1]) });
          } else if (item.type === 'endMarkedContent') {
            open.pop();
          }
        } else if (item.str.trim() !== '') {
          if (open.some((each) => each.tag === 'Artifact')) {
            artifacts.push(item.str);
          } else {
            tagged.push(item.str);
            // The innermost sequence around this text that declares a language of its own, if any.
            const inner = open.findLast(
              (each) => each.mcid !== null && declared.has(each.mcid),
            )?.mcid;
            if (inner !== undefined && inner !== null) {
              let runs = said.get(inner);
              if (runs === undefined) {
                runs = [];
                said.set(inner, runs);
                spoken.push({ language: declared.get(inner)!, runs });
              }
              runs.push(item.str);
            }
            // The text matrix's horizontal translation: where the run starts, from the left edge.
            const x = item.transform[4] as number;
            left = left === null ? x : Math.min(left, x);
            // And its vertical translation: the run's baseline, from the bottom edge.
            const y = item.transform[5] as number;
            items.push({ page: number, text: item.str, x, y, width: item.width });
            baselines =
              baselines === null
                ? { top: y, bottom: y }
                : { top: Math.max(baselines.top, y), bottom: Math.min(baselines.bottom, y) };
          }
        }
      }
      artifactText.push(artifacts);
      taggedText.push(tagged);
      languages.push(spoken);
      // pdf.js reads a link annotation's URI action into `url`, or into `unsafeUrl` where the scheme
      // is one it would not open itself; an annotation taking a reader somewhere inside the document
      // has neither, and a destination instead.
      const annotations = (await page.getAnnotations()) as {
        subtype?: string;
        url?: string;
        unsafeUrl?: string;
        dest?: unknown;
      }[];
      links.push(
        annotations
          .filter(
            (annotation) =>
              annotation.subtype === 'Link' &&
              (annotation.dest === undefined || annotation.dest === null),
          )
          .map((annotation) => annotation.url ?? annotation.unsafeUrl ?? ''),
      );
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
      links,
      languages,
      roles,
      marked: markInfo?.get('Marked') === true,
      pdfuaPart: metadata.metadata?.get('pdfuaid:part') ?? null,
      title: info.Title ?? null,
      language: info.Language ?? null,
      pageLabels,
      pageSizes,
      textLeft,
      textBaselines,
      items,
    };
  } finally {
    // The loading task, not the document: in pdf.js 6 it is the task that owns the worker.
    await task.destroy();
  }
}
