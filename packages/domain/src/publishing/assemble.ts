import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import { contributionsOf, type Contribution } from '../structure/contributions.js';
import { contents } from '../structure/lists.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberingTable,
} from '../structure/numbering.js';
import type { OutlineDocument, OutlineMatter, OutlineNode } from '../structure/outline.js';
import { defaultNumberingScheme, type NumberFormat } from '../structure/scheme.js';

import type { PublishFailure } from './failures.js';
import { characterProblems, codePointName } from './glyphs.js';
import { publishedLanguage } from './language.js';
import type { Layout, PdfFormat } from './layout.js';
import {
  DRAFT_NOTICE,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedDocument1,
  type PublishedNode,
  type PublishedNode1,
  type PublishedPattern,
  type PublishedPdfFormat,
} from './published.js';

/**
 * What a publish is assembled from, all of it recorded before the job ran: the document version's
 * outline, the content of the version each occurrence took - **only the occurrences the publisher may
 * read**, keyed by node - the failures the request already found resolving them, the layout version
 * the request was made under, the document version's revision, and which characters the pinned faces
 * can set.
 */
export interface AssembleInput {
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<string, ContentDocument>;
  readonly refused: readonly PublishFailure[];
  /**
   * The layout, whose scheme numbers the document (STR-013). **Null for a request made before
   * layouts** - migration 0018 recorded none on it - and `assemble` then makes the first slice's
   * `publishing/1` byte for byte: the default scheme, the draft notice in English, no matter on a
   * node, no revision, and never `nothing_to_publish`, so the request publishes with template 1 as it
   * would have then (Ken's answer F).
   */
  readonly layout: Layout | null;
  /** The document version as `revision.version` (VER-009). Ignored where `layout` is null. */
  readonly revision: string;
  readonly covers: (codePoint: number) => boolean;
}

export type Assembled<
  Document extends PublishedDocument | PublishedDocument1 = PublishedDocument | PublishedDocument1,
> =
  | { readonly ok: true; readonly document: Document; readonly numbering: NumberingTable }
  | { readonly ok: false; readonly failures: readonly PublishFailure[] };

/** The paragraph style the template sets. Every other is `style_missing` until themes (slice 4). */
const BODY = 'body';

/** Each number format as Typst's page numbering writes it, by name, never by position. */
const PATTERNS: Readonly<Record<NumberFormat, PublishedPattern>> = {
  decimal: '1',
  lowerAlpha: 'a',
  upperAlpha: 'A',
  lowerRoman: 'i',
  upperRoman: 'I',
};

const failure = (
  stage: PublishFailure['stage'],
  code: PublishFailure['code'],
  node: string | null,
  block: string | null,
  detail: string | null,
): PublishFailure => ({ stage, code, node, block, detail });

/**
 * One pure function from the recorded inputs to the published document, or to every failure at once
 * (docs/design/publishing.md, "The order"; PUB-052). Its stages run in the order the design states,
 * each over the last one's answer: **resolve** (the request's), **conditions** (REU's, the identity
 * until then), **number** (`number`, over the conditioned outline), **check** (everything the engine
 * would refuse), **project**. It takes no clock and no randomness, and no stage stops at a failure:
 * each records what it found and the next carries on over what remains, skipping only what a failure
 * makes meaningless.
 */
export function assemble(
  input: AssembleInput & { readonly layout: Layout },
): Assembled<PublishedDocument>;
export function assemble(
  input: AssembleInput & { readonly layout: null },
): Assembled<PublishedDocument1>;
export function assemble(input: AssembleInput): Assembled;
export function assemble(input: AssembleInput): Assembled {
  const failures: PublishFailure[] = [...input.refused];
  const { layout } = input;

  // resolve and conditions: what each readable occurrence contributes, then REU's stage (#148).
  const contributions = new Map<string, readonly Contribution[]>();
  for (const [node, content] of input.occurrences)
    contributions.set(node, contributionsOf(content));
  const conditioned = conditions(resolve(input.outline, contributions));
  // number: with the scheme the layout declares (STR-013), and never a number worked out here.
  const numbering = number(conditioned, layout?.scheme ?? defaultNumberingScheme);
  const numbers = sectionNumbers(numbering);

  // check and project: one walk, collecting every failure.
  const refusedNodes = new Set(input.refused.map((each) => each.node));
  const check = (text: string, node: string | null, block: string | null) => {
    for (const { problem, codePoint } of characterProblems(text, input.covers)) {
      failures.push(failure('compose', problem, node, block, codePointName(codePoint)));
    }
  };

  check(input.outline.title, null, null);
  const language = publishedLanguage(input.outline.language);
  if (language === null) {
    failures.push(
      failure('compose', 'language_not_publishable', null, null, input.outline.language),
    );
  }

  // The layout's own words are set in the pinned faces too, so each is checked as the title is. A
  // failure in one is the layout's, never the document's: it has codes of its own, names no place in
  // the document, and nothing the author does to the document puts it right. The layout's parse
  // refuses a language the engine cannot carry and a character it refuses whatever the face, so only
  // a layout built past the parse reaches those two here.
  const wordsLanguage = layout === null ? null : publishedLanguage(layout.language);
  if (layout !== null) {
    if (wordsLanguage === null) {
      failures.push(
        failure('compose', 'layout_language_not_publishable', null, null, layout.language),
      );
    }
    const { head, foot } = layout.formats.pdf;
    const slotWords = [...head, ...foot]
      .flat()
      .flatMap((part) => (part.kind === 'words' ? [part.text] : []));
    const { contents: title, notice, noticeSentence } = layout.words;
    for (const words of [title, notice, noticeSentence, ...slotWords]) {
      for (const { codePoint } of characterProblems(words, input.covers)) {
        failures.push(
          failure('compose', 'layout_glyph_missing', null, null, codePointName(codePoint)),
        );
      }
    }
  }

  /** A block the template can set, or a failure naming what it is. */
  const publishable = (block: BlockNode, node: string): PublishedBlock[] => {
    if (block.type !== 'paragraph') {
      failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
      return [];
    }
    if (block.style !== BODY) {
      failures.push(failure('compose', 'style_missing', node, block.id, block.style));
    }
    const runs: { text: string }[] = [];
    for (const inline of block.content) {
      const refusal = unpublishableInline(inline);
      if (refusal !== null) {
        failures.push(failure('compose', 'inline_not_publishable', node, block.id, refusal));
        continue;
      }
      if (inline.type === 'text') {
        check(inline.value, node, block.id);
        runs.push({ text: inline.value });
      }
    }
    return runs.length === 0 ? [] : [{ type: 'paragraph', id: block.id, runs }];
  };

  /** A node and every node beneath it, in the matter of the top-level node that holds them. */
  const project = (node: OutlineNode, depth: number, matter: OutlineMatter): PublishedNode => {
    const numberText = numbers.get(node.id) ?? null;
    if (numberText !== null) check(numberText, node.id, null);
    const shell = { id: node.id, depth, matter, number: numberText };

    if (node.type === 'section') {
      const title = textOf(node.title);
      if (title === null) {
        failures.push(failure('compose', 'title_not_publishable', node.id, null, null));
      } else {
        check(title, node.id, null);
      }
      const children = node.children.map((child) => project(child, depth + 1, matter));
      return {
        ...shell,
        title: title ?? '',
        language: null,
        direction: null,
        blocks: [],
        children,
      };
    }

    const content = input.occurrences.get(node.id);
    if (content === undefined) {
      // The request recorded why; one it did not is a reference nothing resolved.
      if (!refusedNodes.has(node.id)) {
        failures.push(failure('resolve', 'occurrence_unresolved', node.id, null, null));
      }
      const children = node.children.map((child) => project(child, depth + 1, matter));
      return { ...shell, title: '', language: null, direction: null, blocks: [], children };
    }
    check(content.title, node.id, null);
    // A component in the document's own language is not refused a second time.
    const own = content.language === input.outline.language ? null : content.language;
    const ownLanguage = own === null ? null : publishedLanguage(own);
    if (own !== null && ownLanguage === null) {
      failures.push(failure('compose', 'language_not_publishable', node.id, null, own));
    }
    const blocks = content.content.flatMap((block) => publishable(block, node.id));
    const children = node.children.map((child) => project(child, depth + 1, matter));
    return {
      ...shell,
      title: content.title,
      language: ownLanguage,
      direction: content.direction === input.outline.direction ? null : content.direction,
      blocks,
      children,
    };
  };

  const nodes = input.outline.nodes.map((node) => project(node, 1, node.matter));

  if (layout === null) {
    // A refused document language is already a failure; `language === null` only narrows the type.
    if (failures.length > 0 || language === null) return { ok: false, failures };
    return {
      ok: true,
      numbering,
      document: {
        schema: PUBLISHING_SCHEMA_1,
        title: input.outline.title,
        language,
        direction: input.outline.direction,
        status: 'draft',
        notice: DRAFT_NOTICE,
        nodes: nodes.map(withoutMatter),
      },
    };
  }

  // The front matter the layout declares that has something to show (PUB-079): a cover, or a contents
  // with an entry in it - a contents of nothing is not published (decision K). With neither, and no
  // node left to publish, there is nothing to publish, and never an empty artifact.
  const { cover } = layout.matter;
  const declared = layout.matter.contents;
  const shownContents =
    declared !== null && contents(conditioned, numbering, declared.depth).length > 0
      ? { depth: declared.depth }
      : null;
  // What survives conditions, not what the outline holds: once conditions remove nodes, an outline
  // whose every node is conditioned away has nothing to publish either.
  const survivors = conditioned.resolved.outline.nodes.length;
  if (survivors === 0 && !cover && shownContents === null) {
    failures.push(failure('compose', 'nothing_to_publish', null, null, null));
  }

  // Either language refused is already a failure; the null checks only narrow the types.
  if (failures.length > 0 || language === null || wordsLanguage === null) {
    return { ok: false, failures };
  }
  const { words } = layout;
  return {
    ok: true,
    numbering,
    document: {
      schema: PUBLISHING_SCHEMA,
      title: input.outline.title,
      language,
      direction: input.outline.direction,
      status: 'draft',
      revision: input.revision,
      words: {
        language: wordsLanguage,
        contents: words.contents,
        notice: words.notice,
        noticeSentence: words.noticeSentence,
      },
      format: publishedPdf(layout.formats.pdf),
      front: { cover, contents: shownContents },
      appendices: { newPage: layout.matter.appendices.newPage },
      nodes,
    },
  };
}

/**
 * A node as `publishing/1` held it: no matter, and every other member in the order it had then, since
 * the order is part of the bytes Typst reads and of the digest a publication records.
 */
function withoutMatter(node: PublishedNode): PublishedNode1 {
  return {
    id: node.id,
    depth: node.depth,
    number: node.number,
    title: node.title,
    language: node.language,
    direction: node.direction,
    blocks: node.blocks,
    children: node.children.map(withoutMatter),
  };
}

/** The layout's PDF member as the template reads it: the page in points, numbering as patterns. */
function publishedPdf(pdf: PdfFormat): PublishedPdfFormat {
  const numbered = (matter: OutlineMatter) => ({
    pattern: PATTERNS[pdf.pageNumbering[matter].format],
    restart: pdf.pageNumbering[matter].restart,
  });
  return {
    width: pdf.page.width,
    height: pdf.page.height,
    orientation: pdf.orientation,
    margins: pdf.margins,
    gutter: pdf.gutter,
    head: pdf.head,
    foot: pdf.foot,
    pageNumbering: {
      front: numbered('front'),
      body: numbered('body'),
      appendix: numbered('appendix'),
    },
  };
}

/** Why an inline cannot be set yet - its node type, or its first mark - or null when it can. */
function unpublishableInline(inline: InlineNode): string | null {
  if (inline.type !== 'text') return inline.type;
  const [mark] = inline.marks;
  return mark === undefined ? null : mark.type;
}

/** A section title's words, where it holds nothing but unmarked text; null otherwise. */
function textOf(title: readonly InlineNode[]): string | null {
  let words = '';
  for (const inline of title) {
    if (inline.type !== 'text' || unpublishableInline(inline) !== null) return null;
    words += inline.value;
  }
  return words;
}
