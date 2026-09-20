import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { Mark } from '../content/model/marks.js';
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
  PUBLISHED_MARK_ORDER,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  type PublishedBlock,
  type PublishedBlock1,
  type PublishedDocument,
  type PublishedDocument1,
  type PublishedMark,
  type PublishedNode,
  type PublishedNode1,
  type PublishedPattern,
  type PublishedPdfFormat,
  type PublishedRun,
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

  // `publishing/1` holds a run of text alone and is frozen, so a mark is refused outright when there
  // is no layout; under a layout a run carries the nine of `PUBLISHED_MARK_ORDER`.
  const carriesMarks = layout !== null;

  /** A block the template can set, or a failure naming what it is. */
  const publishable = (block: BlockNode, node: string): PublishedBlock[] => {
    if (block.type !== 'paragraph') {
      failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
      return [];
    }
    if (block.style !== BODY) {
      failures.push(failure('compose', 'style_missing', node, block.id, block.style));
    }
    const runs: PublishedRun[] = [];
    for (const inline of block.content) {
      if (inline.type !== 'text') {
        failures.push(failure('compose', 'inline_not_publishable', node, block.id, inline.type));
        continue;
      }
      const outcome = publishedMarks(inline.marks, carriesMarks);
      if (outcome.kind === 'refused') {
        // Every reason this run cannot be published, in the order the marks are stored in, never
        // the first alone (PUB-052).
        for (const { code, detail } of outcome.refusals) {
          failures.push(failure('compose', code, node, block.id, detail));
        }
        continue;
      }
      // Only what will be set is checked against the faces, exactly as an unmarked run is: a run
      // already refused is not set, and a second complaint about it would say nothing new.
      check(inline.value, node, block.id);
      runs.push({ text: inline.value, marks: outcome.marks });
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
      if ('unpublishable' in title) {
        failures.push(
          failure('compose', 'title_not_publishable', node.id, null, title.unpublishable),
        );
      } else {
        check(title.words, node.id, null);
      }
      const children = node.children.map((child) => project(child, depth + 1, matter));
      return {
        ...shell,
        title: 'words' in title ? title.words : '',
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
    blocks: node.blocks.map(withoutMarks),
    children: node.children.map(withoutMatter),
  };
}

/**
 * A block as `publishing/1` held it: a run of its text and nothing else. Every run that reaches here
 * carries no mark, because `assemble` refuses a marked inline outright where there is no layout, so
 * this drops an always-empty member rather than a mark - which is what keeps the frozen bytes frozen.
 */
function withoutMarks(block: PublishedBlock): PublishedBlock1 {
  return { type: block.type, id: block.id, runs: block.runs.map((run) => ({ text: run.text })) };
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

/** The nine marks a published run carries, as a lookup: `PUBLISHED_MARK_ORDER` and nothing else. */
const CARRIED: ReadonlySet<string> = new Set<string>(PUBLISHED_MARK_ORDER);

/** A mark of one of those nine kinds. */
type CarriedMark = Extract<Mark, { type: (typeof PUBLISHED_MARK_ORDER)[number] }>;

const isCarried = (mark: Mark): mark is CarriedMark => CARRIED.has(mark.type);

/** One reason a run cannot be published, as the failure it becomes: its code and its detail. */
interface MarkRefusal {
  readonly code: 'inline_not_publishable' | 'language_not_publishable';
  readonly detail: string;
}

/** What a run's marks publish as, or **every** reason the run is refused, in the order found. */
type MarksOutcome =
  | { readonly kind: 'marks'; readonly marks: readonly PublishedMark[] }
  | { readonly kind: 'refused'; readonly refusals: readonly MarkRefusal[] };

/**
 * A run's marks as the template reads them, in `PUBLISHED_MARK_ORDER`, or why the run is refused.
 * Every reason at once, never the first alone (PUB-052), and each kind named once.
 *
 * The rule is an **allowlist**: a mark is carried only where `PUBLISHED_MARK_ORDER` names its kind,
 * and every other is refused by name. There is deliberately no branch that lets an unrecognised mark
 * through, because three of the four refused - `condition`, `suggestion` and `comment` - are marks
 * the content model accepts from any source, and a condition mark that fell through would set
 * conditional text in a PDF unconditionally, which is text a reader was not meant to be shown. The
 * fourth, `definedTerm`, is refused because nothing resolves a term.
 *
 * **A run carrying two marks of one kind is refused by that kind's name**, although the kind is
 * carried. CNT-003 lets two annotations of one kind cover one range and the parse stores both, so
 * the shape reaches here from any source; the template can only fold one inside the other, and one
 * of the two would then win by fold order rather than by anything the author said - a link to a
 * target the document does not name, or a language a screen reader announces that the document does
 * not claim. `packages/editor/src/mapping.ts` refuses the same shape by the same name rather than
 * keeping one of the two, and the reason is the same: keeping one would publish the loss under the
 * author's name. Nothing has stored a mark yet, so refusing is the direction that can be undone.
 *
 * `carriesMarks` is false for `publishing/1`, whose run is text alone and whose bytes are frozen:
 * there every mark is refused by name, so the frozen shape can never quietly lose one.
 */
function publishedMarks(marks: readonly Mark[], carriesMarks: boolean): MarksOutcome {
  const published: PublishedMark[] = [];
  const refusals: MarkRefusal[] = [];
  const carried = new Set<string>();
  const named = new Set<string>();
  /** A kind the run cannot be published with, named once however many marks of it there are. */
  const refuseKind = (type: string) => {
    if (named.has(type)) return;
    named.add(type);
    refusals.push({ code: 'inline_not_publishable', detail: type });
  };

  for (const mark of marks) {
    if (!carriesMarks || !isCarried(mark) || carried.has(mark.type)) {
      refuseKind(mark.type);
      continue;
    }
    carried.add(mark.type);
    if (mark.type === 'language') {
      // The one rule, asked here and by the editor's warning about a tag no publication can carry
      // (CNT-152), so that the refusal and the warning cannot become two copies of one rule.
      const language = publishedLanguage(mark.tag);
      if (language === null) refusals.push({ code: 'language_not_publishable', detail: mark.tag });
      else published.push({ kind: 'language', language });
      continue;
    }
    published.push(publishedMark(mark));
  }

  if (refusals.length > 0) return { kind: 'refused', refusals };
  const rank = (mark: PublishedMark) => PUBLISHED_MARK_ORDER.indexOf(mark.kind);
  published.sort((a, b) => rank(a) - rank(b));
  return { kind: 'marks', marks: published };
}

/**
 * One carried mark as the template reads it. A branch per kind and no `default:`, so a tenth kind
 * added to `PUBLISHED_MARK_ORDER` without a branch here fails to compile rather than reaching a
 * reader as an unmarked run.
 */
function publishedMark(mark: Exclude<CarriedMark, { type: 'language' }>): PublishedMark {
  switch (mark.type) {
    case 'hyperlink':
      // The title is not carried: a PDF link annotation has no place for it, and inventing one
      // would tell a reader something the author did not say.
      return { kind: 'hyperlink', href: mark.href };
    case 'emphasis':
    case 'strong':
    case 'underline':
    case 'subscript':
    case 'superscript':
    case 'inlineCode':
    case 'quotedPhrase':
      return { kind: mark.type };
  }
}

/**
 * A section title's words, where it holds nothing but unmarked text, or **what in it** cannot be
 * published: an inline's node type, or a mark's. A title is published as a string and has nowhere to
 * put a mark, so a marked title is refused rather than flattened into words the author did not
 * write - and the refusal names what to look for, as a block that cannot be published names its kind.
 */
function textOf(
  title: readonly InlineNode[],
): { readonly words: string } | { readonly unpublishable: string } {
  let words = '';
  for (const inline of title) {
    if (inline.type !== 'text') return { unpublishable: inline.type };
    const [mark] = inline.marks;
    if (mark !== undefined) return { unpublishable: mark.type };
    words += inline.value;
  }
  return { words };
}
