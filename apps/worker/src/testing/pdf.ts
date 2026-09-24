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
 * skips), the text in tagged content, the addresses its link annotations take a reader to, the pages
 * its links inside the document take a reader to, and the runs that declare a language of their own; the structure roles in document order after the role map,
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
  /**
   * Every link annotation, per page, that takes a reader somewhere inside the document - a contents
   * entry, a footnote's mark, a cross-reference - with where it stands and the page it takes them to
   * (cross-references 2). A destination this cannot follow to a page throws, as `markedLanguages`
   * does: a link quietly left out would leave an assertion that a page holds no link passing.
   */
  readonly destinations: readonly (readonly InternalLink[])[];
  /** Every run of a page's tagged text that declares a language of its own, in the page's order. */
  readonly languages: readonly (readonly TaggedLanguage[])[];
  readonly roles: readonly string[];
  /**
   * Every structure element in the file, counted once, by its structure type as the file writes it
   * (before the role map). `roles` is read a page at a time, since that is how pdf.js answers, so an
   * element whose content crosses a page - a table, and every ancestor of it - is in `roles` once for
   * each page it reaches. Where the question is how many elements a reader is told there are, such
   * as whether a header repeated on a second page is a new row, this is the count to ask.
   */
  readonly elements: Readonly<Record<string, number>>;
  /**
   * Every `Figure` structure element in the file, in the order it is written: its `/Alt`, its
   * `/Lang` where it declares one of its own (the engine writes none where the language is its
   * parent's), and its layout box, `[left, bottom, right, top]` in points on its page.
   */
  readonly figures: readonly TaggedFigure[];
  /**
   * Every `Note` structure element in the file - a footnote at the foot of its page - in the order it
   * is written, with the language a reader is told it is in, read up the tree as a figure's is.
   */
  readonly notes: readonly { readonly spoken: string | null }[];
  /**
   * Every `Formula` structure element - an equation, inline or a block - page by page in the order the
   * page's tree holds them, as pdf.js reads the tree (equations 2): with its `/Alt`, its language, the
   * text its own marked content holds, and the element set straight after it, where a numbered
   * equation's number stands.
   */
  readonly formulas: readonly TaggedFormula[];
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

export interface TaggedFigure {
  readonly alt: string | null;
  readonly lang: string | null;
  readonly box: readonly [number, number, number, number] | null;
  /** The structure type of the element it stands in - a `P`, a `TD` - or null where it names none. */
  readonly parent: string | null;
  /**
   * The language a reader is told it is in: its own `/Lang`, or the nearest ancestor's, or null where
   * none declares one and the document's own stands. The engine hoists a `/Lang` to an ancestor where
   * that is shorter - a table row whose first cell is in German says so once - so an element's own
   * `/Lang` alone does not say what it is read in.
   */
  readonly spoken: string | null;
}

export interface TaggedFormula {
  /** The page it is set on, counted from 0 as `taggedText` is. */
  readonly page: number;
  readonly alt: string | null;
  /** Its own `/Lang`, where it declares one. */
  readonly lang: string | null;
  /** The language a reader is told it is in, read up the tree as a figure's is. */
  readonly spoken: string | null;
  /**
   * The structure types of the elements it stands in, the nearest first - a `P` in a `TH` in a `TR` -
   * up to the root.
   */
  readonly ancestors: readonly string[];
  /** Every string its marked content holds, joined: what the engine drew for it, as extracted. */
  readonly text: string;
  /**
   * The element straight after it among its parent's, with the text that element holds, or null where
   * it is the last. A numbered block equation's number is a `Span` here.
   */
  readonly next: { readonly role: string; readonly text: string } | null;
}

export interface InternalLink {
  /** Where the link stands on its page, `[left, bottom, right, top]` in points from its bottom left. */
  readonly rect: readonly [number, number, number, number];
  /** The page it takes a reader to, counted from 0 as `taggedText` is. */
  readonly to: number;
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
  /** Where it is a page's marked content rather than an element: `content`, and its identifier. */
  readonly type?: string;
  readonly id?: string;
  readonly alt?: string;
  readonly lang?: string;
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

/**
 * Every structure element's type, counted, read from the objects themselves: the pinned Typst writes
 * every object on its own rather than inside an object stream (see `markedLanguages`), and a
 * structure element is a dictionary, never a stream, so each is found by its `/Type /StructElem`.
 * Throws where it finds none, since a count of nothing would pass any assertion that something is
 * absent.
 */
function structureElements(text: string): Record<string, number> {
  const counted: Record<string, number> = {};
  let found = 0;
  for (const object of text.matchAll(/\sobj\b([\s\S]*?)\bendobj\b/g)) {
    const body = object[1] ?? '';
    if (!/\/Type\s*\/StructElem\b/.test(body)) continue;
    const type = /\/S\s*\/([^\s/<>[\]()]+)/.exec(body);
    if (type === null) throw new Error('A structure element declares no type');
    counted[type[1]!] = (counted[type[1]!] ?? 0) + 1;
    found += 1;
  }
  if (found === 0) throw new Error('The PDF has no structure elements');
  return counted;
}

/**
 * A PDF string as its characters: a literal `(...)` read to its balancing parenthesis with its
 * escapes, or a hex `<...>`; UTF-16BE where it opens with the byte order mark, and PDFDocEncoding -
 * read as Latin-1, which it matches in every character a test writes - otherwise. `at` is where the
 * string opens; the answer is null where there is none there.
 */
function pdfString(text: string, at: number): string | null {
  let bytes = '';
  if (text[at] === '<') {
    const end = text.indexOf('>', at);
    const hex = text.slice(at + 1, end).replace(/\s+/g, '');
    for (let i = 0; i < hex.length; i += 2)
      bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
  } else if (text[at] === '(') {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      const c = text[i]!;
      // An end of line in a literal string is one newline, however the file spells it (ISO 32000-1,
      // 7.3.4.2), and a backslash before one continues the string on the next line and says nothing.
      if (c === '\r') {
        bytes += '\n';
        if (text[i + 1] === '\n') i += 1;
        continue;
      }
      if (c === '\\' && (text[i + 1] === '\r' || text[i + 1] === '\n')) {
        i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 2 : 1;
        continue;
      }
      if (c === '\\') {
        const next = text[i + 1]!;
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (/[0-7]/.test(next)) {
          const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1))![0];
          bytes += String.fromCharCode(parseInt(octal, 8));
          i += octal.length;
        } else {
          bytes += escapes[next] ?? next;
          i += 1;
        }
        continue;
      }
      if (c === '(') {
        depth += 1;
        if (depth === 1) continue;
      } else if (c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      bytes += c;
    }
  } else {
    return null;
  }
  if (bytes.startsWith('\u00fe\u00ff')) {
    let decoded = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      decoded += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
    }
    return decoded;
  }
  return bytes;
}

/** Every object by its number, so an element's `/P` can be followed to the element it stands in. */
function objectsOf(text: string): Map<string, string> {
  const objects = new Map<string, string>();
  for (const object of text.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj\b/g)) {
    objects.set(object[1]!, object[2] ?? '');
  }
  return objects;
}

/**
 * The language a reader is told an element is in: its own `/Lang`, or the nearest ancestor's, or null
 * where none declares one and the document's own stands.
 */
function spokenOf(body: string, objects: ReadonlyMap<string, string>): string | null {
  let at: string | undefined = body;
  for (let depth = 0; at !== undefined && depth < 64; depth += 1) {
    const declared = /\/Lang\s*([(<])/.exec(at);
    if (declared !== null) return pdfString(at, declared.index + declared[0].length - 1);
    const held = /\/P\s+(\d+)\s+0\s+R/.exec(at);
    at = held === null ? undefined : objects.get(held[1]!);
  }
  return null;
}

/** Every `Note` structure element, with the language it is read in (footnotes 2). */
function taggedNotes(text: string): { spoken: string | null }[] {
  const objects = objectsOf(text);
  return [...objects.values()]
    .filter((body) => /\/Type\s*\/StructElem\b/.test(body) && /\/S\s*\/Note\b/.test(body))
    .map((body) => ({ spoken: spokenOf(body, objects) }));
}

/** Every `Figure` structure element, read from the objects themselves as `structureElements` reads. */
function taggedFigures(text: string): TaggedFigure[] {
  const figures: TaggedFigure[] = [];
  const objects = objectsOf(text);
  for (const body of objects.values()) {
    if (!/\/Type\s*\/StructElem\b/.test(body) || !/\/S\s*\/Figure\b/.test(body)) continue;
    const valueOf = (key: string) => {
      const found = new RegExp(`/${key}\\s*([(<])`).exec(body);
      return found === null ? null : pdfString(body, found.index + found[0].length - 1);
    };
    const box = /\/BBox\s*\[([^\]]*)\]/.exec(body);
    const corners = box === null ? null : box[1]!.trim().split(/\s+/).map(Number);
    figures.push({
      alt: valueOf('Alt'),
      lang: valueOf('Lang'),
      box: corners?.length === 4 ? (corners as [number, number, number, number]) : null,
      spoken: spokenOf(body, objects),
      parent: (() => {
        const held = /\/P\s+(\d+)\s+0\s+R/.exec(body);
        const above = held === null ? undefined : objects.get(held[1]!);
        return above === undefined ? null : (/\/S\s*\/([^\s/<>[\]()]+)/.exec(above)?.[1] ?? null);
      })(),
    });
  }
  return figures;
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
    const destinations: InternalLink[][] = [];
    // A destination is named, and looked up, or explicit; either way its first member is the page, as
    // its object or, rarely, its index.
    const pageTo = async (dest: unknown): Promise<number> => {
      const explicit: unknown = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      const page: unknown = Array.isArray(explicit) ? explicit[0] : undefined;
      if (typeof page === 'number') return page;
      if (page !== null && typeof page === 'object') return pdf.getPageIndex(page as PageRef);
      throw new Error(`A link's destination names no page: ${JSON.stringify(dest)}`);
    };
    const languages: TaggedLanguage[][] = [];
    const roles: string[] = [];
    const pageSizes: (readonly [number, number])[] = [];
    const textLeft: (number | null)[] = [];
    const textBaselines: ({ top: number; bottom: number } | null)[] = [];
    const items: TextItem[] = [];
    const formulas: TaggedFormula[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      // Which marked-content sequences on this page declare a language, by their MCID.
      const declared = markedLanguages(bytes, text, page.ref as PageRef);
      const open: { tag: string; mcid: number | null; id: string | null }[] = [];
      // Every string of the page by the marked-content sequence it stands in, keyed as the structure
      // tree names its content, so an element's text can be read from the tree.
      const held = new Map<string, string>();
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
            open.push({
              tag: marked.tag ?? '',
              mcid: mcid === null ? null : Number(mcid[1]),
              id: marked.id ?? null,
            });
          } else if (item.type === 'endMarkedContent') {
            open.pop();
          }
        } else {
          const inner = open.at(-1)?.id;
          if (inner !== undefined && inner !== null) {
            held.set(inner, (held.get(inner) ?? '') + item.str);
          }
          if (item.str.trim() === '') continue;
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
        rect?: number[];
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
      destinations.push(
        await Promise.all(
          annotations
            .filter(
              (annotation) =>
                annotation.subtype === 'Link' &&
                annotation.dest !== undefined &&
                annotation.dest !== null,
            )
            .map(async (annotation) => ({
              rect: annotation.rect as unknown as [number, number, number, number],
              to: await pageTo(annotation.dest),
            })),
        ),
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
      const textOf = (node: StructNode): string =>
        node.type === 'content'
          ? (held.get(node.id ?? '') ?? '')
          : (node.children ?? []).map(textOf).join('');
      const formulasIn = (node: StructNode, above: readonly StructNode[]) => {
        const children = node.children ?? [];
        children.forEach((child, index) => {
          if (child.role === 'Formula') {
            const next = children.slice(index + 1).find((each) => each.role !== undefined);
            const declared = [child, node, ...above].find((each) => each.lang !== undefined);
            formulas.push({
              page: number - 1,
              alt: child.alt ?? null,
              lang: child.lang ?? null,
              spoken: declared?.lang ?? null,
              ancestors: [node, ...above]
                .map((each) => each.role ?? '')
                .filter((role) => role !== '' && role !== 'Root'),
              text: textOf(child),
              next: next === undefined ? null : { role: next.role!, text: textOf(next) },
            });
          }
          if (child.role !== undefined) formulasIn(child, [node, ...above]);
        });
      };
      if (tree) formulasIn(tree, []);
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
      destinations,
      languages,
      roles,
      elements: structureElements(text),
      figures: taggedFigures(text),
      notes: taggedNotes(text),
      formulas,
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
