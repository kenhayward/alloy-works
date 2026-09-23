import { ADMITTED_FORMATS } from '../assets/header.js';
import type { AssetVersionContent } from '../assets/version.js';
import { startsOutsideItsNumbering, type BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { Mark } from '../content/model/marks.js';
import { contributionsOf, type Contribution } from '../structure/contributions.js';
import { contents, listOf } from '../structure/lists.js';
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
import { characterProblems, codePointName, type Covers, type Face } from './glyphs.js';
import {
  captionHeight,
  CELL_INSET,
  columnsAt,
  columnsOf,
  expandTabs,
  INLINE_IMAGE_HEIGHT,
  listIndent,
  QUOTATION_INDENT,
  textBlockHeight,
  textMeasure,
} from './measure.js';
import { publishedLanguage } from './language.js';
import type { Layout, PdfFormat } from './layout.js';
import {
  DRAFT_NOTICE,
  PUBLISHED_MARK_ORDER,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  type PublishedBlock,
  type PublishedBlock1,
  type PublishedCell,
  type PublishedDocument,
  type PublishedDocument1,
  type PublishedFigure,
  type PublishedInline,
  type PublishedItem,
  type PublishedMark,
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
  readonly covers: Covers;
  /**
   * Every asset version the request resolved as its publisher, by identifier (figures 3, ruling R6):
   * what a figure placing one is published from. One the publisher may not read is not here, and the
   * request recorded why.
   */
  readonly assets: ReadonlyMap<string, PublishingAsset>;
}

/** What `assemble` reads of an asset version: where its bytes are, what they are, and its default. */
export type PublishingAsset = Pick<
  AssetVersionContent,
  'object' | 'format' | 'width' | 'height' | 'alternative'
>;

export type Assembled<
  Document extends PublishedDocument | PublishedDocument1 = PublishedDocument | PublishedDocument1,
> =
  | { readonly ok: true; readonly document: Document; readonly numbering: NumberingTable }
  | { readonly ok: false; readonly failures: readonly PublishFailure[] };

/** The paragraph style the template sets. Every other is `style_missing` until themes (slice 4). */
const BODY = 'body';

/** The one table style the template sets until themes.md gives styles (tables 2, ruling R4). */
const TABLE_STYLE = 'table';

/**
 * Where an image stands in the compile root (figures 3, ruling R2): `assets/`, the hash its key ends
 * in, and the extension its format declares. The one rule, which the published document names and the
 * job writes the file at, so the two cannot name different places.
 */
export function publishedImagePath(asset: Pick<PublishingAsset, 'object' | 'format'>): string {
  const hash = asset.object.slice(asset.object.lastIndexOf('/') + 1);
  return `assets/${hash}.${ADMITTED_FORMATS[asset.format].extension}`;
}

/** The one image style the template sets for a figure until themes.md gives styles (decision F-K). */
const FIGURE_STYLE = 'figure';

/** And the one it sets for an image in a run of text (figures 5, ruling R3). */
const INLINE_STYLE = 'inline';

/**
 * The share of the text block's height a figure may stand (decision F-K): past it, the height is held
 * here and the width taken from the proportions - STY-017's rule with a fixed number, since the
 * engine lets an image run off its page and says nothing.
 */
const FIGURE_HEIGHT_SHARE = 0.6;

/**
 * The least an image may be given, in points - an inch - where its caption takes the rest of the page:
 * a caption that leaves less is refused, `caption_too_long`, rather than set beside a smudge.
 */
const FIGURE_LEAST_HEIGHT = 72;

/** A length in points as a published document carries it: to hundredths, so its bytes are stable. */
const points = (length: number) => Math.round(length * 100) / 100;

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
  /**
   * A failure recorded once however many times it is met: two images in one paragraph too wide, or
   * both with no description, are one place to look and one reason, said once (final review of
   * figures 5). Used where one block can meet the same reason again - its images - and nowhere else.
   */
  const failOnce = (next: PublishFailure) => {
    const said = failures.some(
      (each) =>
        each.stage === next.stage &&
        each.code === next.code &&
        each.node === next.node &&
        each.block === next.block &&
        each.detail === next.detail,
    );
    if (!said) failures.push(next);
  };
  // A figure whose image the request could not read, where it said so: told once, not twice.
  const refusedAssets = new Set(
    input.refused
      .filter((each) => each.code === 'asset_unreadable')
      .map((each) => `${each.node} ${each.block}`),
  );
  // Asked of the family the text will be set in (decision A): preformatted text and an inline code
  // run are set in the monospace face, everything else in the body face, and a character missing
  // from the monospace alone is `code_glyph_missing`, so the author is not told no face has it.
  const check = (text: string, node: string | null, block: string | null, face: Face = 'body') => {
    for (const { problem, codePoint } of characterProblems(text, input.covers, face)) {
      const code = problem === 'glyph_missing' && face === 'code' ? 'code_glyph_missing' : problem;
      failures.push(failure('compose', code, node, block, codePointName(codePoint)));
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
    const listTitles = layout.matter.lists.map((list) => list.title);
    for (const words of [title, notice, noticeSentence, ...slotWords, ...listTitles]) {
      for (const { codePoint } of characterProblems(words, input.covers, 'body')) {
        failures.push(
          failure('compose', 'layout_glyph_missing', null, null, codePointName(codePoint)),
        );
      }
    }
  }

  // `publishing/1` holds a run of text alone and is frozen, so a mark is refused outright when there
  // is no layout; under a layout a run carries the nine of `PUBLISHED_MARK_ORDER`.
  const carriesMarks = layout !== null;

  /**
   * One sequence of inline content as the template reads it, or a failure naming what in it cannot
   * be published. `block` is the identifier those failures are reported under: a paragraph's own,
   * and for a definition item's **term the list's**, because a stored item carries no identifier of
   * its own and the list is the nearest real thing to point an author at. `runsOf` in
   * `packages/editor/src/mapping.ts` names the same place for the same reason.
   *
   * **An image is published among the runs** under a layout (figures 5): one line high, its width from
   * its proportions and no wider than the room where it stands - `indent` is what the measure has
   * lost by then, a table's cell included - and described as a figure is. Its failures name `block`,
   * the block that holds it.
   */
  const publishedRuns = (
    content: readonly InlineNode[],
    node: string,
    block: string,
    indent = 0,
    caption = false,
  ): PublishedInline[] => {
    const runs: PublishedInline[] = [];
    for (const inline of content) {
      // A caption's height is estimated from its words, and the list after the contents sets it again,
      // so an image in one is refused rather than set (final review of figures 5).
      if (inline.type === 'image' && layout !== null && caption) {
        failOnce(failure('compose', 'image_in_caption', node, block, null));
        continue;
      }
      if (inline.type === 'image' && layout !== null) {
        const published = publishedImage(inline, node, block, indent);
        if (published !== null) runs.push(published);
        continue;
      }
      if (inline.type !== 'text') {
        failures.push(failure('compose', 'inline_not_publishable', node, block, inline.type));
        continue;
      }
      const outcome = publishedMarks(inline.marks, carriesMarks);
      if (outcome.kind === 'refused') {
        // Every reason this run cannot be published, in the order the marks are stored in, never
        // the first alone (PUB-052).
        for (const { code, detail } of outcome.refusals) {
          failures.push(failure('compose', code, node, block, detail));
        }
        continue;
      }
      // Only what will be set is checked against the faces, exactly as an unmarked run is: a run
      // already refused is not set, and a second complaint about it would say nothing new.
      const code = outcome.marks.some((mark) => mark.kind === 'inlineCode');
      check(inline.value, node, block, code ? 'code' : 'body');
      runs.push({ text: inline.value, marks: outcome.marks });
    }
    return runs;
  };

  /**
   * A block the template can set, or a failure naming what it is. **A branch per stored block kind,
   * and a `default:` that refuses what it cannot name**, so an eighth kind added to `BlockNode`
   * fails to compile and, if one ever arrived anyway, is thrown on rather than skipped: a block
   * silently dropped is a document published under the author's name with a piece of it missing.
   * `withoutMarks` and `publishedMark` below are closed the same way, and none of the three has a
   * branch that returns without saying what it saw.
   *
   * **It descends.** A list item holds block content, so this calls itself, and the style check and
   * the glyph check reach a paragraph at any depth because both are asked in the paragraph branch
   * the recursion arrives at.
   */
  const publishable = (block: BlockNode, node: string, indent = 0): PublishedBlock[] => {
    switch (block.type) {
      case 'paragraph': {
        if (block.style !== BODY) {
          failures.push(failure('compose', 'style_missing', node, block.id, block.style));
        }
        const runs = publishedRuns(block.content, node, block.id, indent);
        return runs.length === 0 ? [] : [{ type: 'paragraph', id: block.id, runs }];
      }
      case 'list': {
        // `publishing/1` and `publishing/2` hold paragraphs alone and their bytes are frozen
        // (decision E), so where there is no layout a list is refused by name rather than
        // flattened into the paragraphs of its items - which would publish a document that had
        // lost every marker, every term and every level, under the author's name.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        // **A backstop, not the rule.** `checkBlock` asks this same predicate on the way in, and
        // every occurrence reaches `assemble` through `parseContentDocument`, so nothing an author,
        // an import or a paste can store arrives here. It is kept for the reason the frozen shapes
        // keep theirs - content assembled by any path is refused by name, never numbered from
        // something nobody wrote - and it asks `startsOutsideItsNumbering` rather than spelling the
        // condition a second time, so that a change to what the model permits cannot leave this
        // refusing in silence.
        if (startsOutsideItsNumbering(block)) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, 'list:start'));
          return [];
        }
        const items = block.items.map((item): PublishedItem => {
          // A term stands on a definition list's item alone, which is `checkBlock`'s rule and
          // not restated here. Where the author has typed none, or where every run of one was
          // refused, `null` is the one spelling, so a template has one thing to guard.
          //
          // **And it is deliberately not backstopped, where the start above it is.** A term on an
          // ordered list is computed here and then dropped by the template, which reads `item.term`
          // only in its definition branch - so what a reader is shown is the list the author wrote,
          // with one thing missing that the model says may not be there at all. A start outside its
          // numbering is the other kind of wrong: the template reads it, and a reader is shown
          // numbers nobody wrote, presented as the author's. A publication that is silently
          // incomplete about content the model forbids is worth less than a refusal and more than a
          // publication that is confidently false, and the two are not the same call. `checkBlock`
          // refuses both on the way in, and every occurrence reaches here through
          // `parseContentDocument`, so neither is reachable today by any producer.
          const term =
            item.term === undefined ? [] : publishedRuns(item.term, node, block.id, indent);
          return {
            term: term.length === 0 ? null : term,
            blocks: item.content.flatMap((each) =>
              publishable(each, node, indent + listIndent(block)),
            ),
          };
        });
        // An item that came out empty is **kept**: it is storable because that is where a cursor
        // stands after Enter (CNT-124's reason), and an item that vanished would renumber every
        // item below it - a reader shown numbers the author never wrote. A list with nothing at
        // all in it is another matter: it contributes nothing rather than an empty `L`.
        return items.every((item) => item.term === null && item.blocks.length === 0)
          ? []
          : [
              {
                type: 'list',
                id: block.id,
                kind: block.kind,
                start: block.start ?? null,
                format: block.format ?? null,
                items,
              },
            ];
      }
      case 'preformatted': {
        // Refused by name without a layout, as a list is: the frozen shapes hold paragraphs alone.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        // An empty block is where a cursor stands, as an empty paragraph is (decision P).
        if (block.text === '') return [];
        const lines = block.text.split('\n').map(expandTabs);
        const most = columnsAt(publishedPdf(layout.formats.pdf), indent);
        lines.forEach((line, index) => {
          check(line, node, block.id, 'code');
          const width = columnsOf(line);
          if (width > most) {
            failures.push(
              failure(
                'compose',
                'line_too_wide',
                node,
                block.id,
                `line ${index + 1}, ${width} of ${most} columns`,
              ),
            );
          }
        });
        return [{ type: 'preformatted', id: block.id, label: block.language ?? null, lines }];
      }
      case 'blockquote': {
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        const blocks = block.content.flatMap((each) =>
          // Both sides: the engine pads a block quotation by an em left and right.
          publishable(each, node, indent + 2 * QUOTATION_INDENT),
        );
        const attribution =
          block.attribution === undefined
            ? []
            : publishedRuns(block.attribution, node, block.id, indent + 2 * QUOTATION_INDENT);
        // Nothing to show and nothing to attribute contributes nothing, rather than an empty
        // `BlockQuote` (decision P).
        if (blocks.length === 0 && attribution.length === 0) return [];
        return [
          {
            type: 'blockquote',
            id: block.id,
            blocks,
            attribution: attribution.length === 0 ? null : attribution,
          },
        ];
      }
      case 'table': {
        // Refused by name without a layout, as a list is: the frozen first shape holds paragraphs alone.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        // The table's own style is the one the template sets until themes.md gives styles (ruling R4).
        if (block.style !== TABLE_STYLE) {
          failures.push(failure('compose', 'style_missing', node, block.id, block.style));
        }
        // A caption of no words names nothing (ruling R3), whatever else it holds.
        const words = block.caption.map((inline) => (inline.type === 'text' ? inline.value : ''));
        if (words.join('').trim() === '') {
          failures.push(failure('compose', 'table_without_caption', node, block.id, null));
        }
        // A header cell spanning past the header rows would take the rows it reaches into the header.
        const spansBody = block.rows
          .slice(0, block.headerRows)
          .some((row, at) => row.cells.some((each) => at + each.rowspan > block.headerRows));
        if (spansBody) {
          failures.push(failure('compose', 'table_header_spans_body', node, block.id, null));
        }
        // A note on the table as a whole (CNT-038) is refused by name until footnotes 2 sets it
        // beneath the table, rather than the table being published without it (footnotes 1, R12).
        if (block.note !== undefined) {
          failures.push(failure('compose', 'inline_not_publishable', node, block.id, 'note'));
        }
        const caption = publishedRuns(block.caption, node, block.id, indent, true);
        const label =
          numbering.entries.find((entry) => entry.node === node && entry.block === block.id)
            ?.label ?? null;
        if (label !== null) check(label, node, block.id);
        const { columns, starts } = gridOf(block);
        const scopeAt = (row: number, column: number): PublishedCell['scope'] => {
          const heading = row < block.headerRows;
          const leading = column < block.headerColumns;
          if (heading && leading) return 'both';
          if (heading) return 'column';
          return leading ? 'row' : null;
        };
        return [
          {
            type: 'table',
            id: block.id,
            label,
            caption,
            headerRows: block.headerRows,
            headerColumns: block.headerColumns,
            columns,
            rows: block.rows.map((row, rowIndex) => ({
              cells: row.cells.map((cell, cellIndex) => ({
                // Paragraphs and lists alone (decision T-D), each published as it is anywhere else -
                // in the room the cell has: its share of the measure, less the engine's inset each side.
                blocks: cell.content.flatMap((each) =>
                  publishable(each, node, cellIndent(indent, columns, cell.colspan)),
                ),
                colspan: cell.colspan,
                rowspan: cell.rowspan,
                scope: scopeAt(rowIndex, starts[rowIndex]![cellIndex]!),
              })),
            })),
          },
        ];
      }
      case 'figure': {
        // Refused by name without a layout, as a list is: the frozen first shape holds paragraphs alone.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        if (block.imageStyle !== FIGURE_STYLE) {
          failures.push(failure('compose', 'style_missing', node, block.id, block.imageStyle));
        }
        // CNT-017's caption: a caption of no words names nothing (ruling R5), as a table's does not.
        const words = block.caption.map((inline) => (inline.type === 'text' ? inline.value : ''));
        if (words.join('').trim() === '') {
          failures.push(failure('compose', 'figure_without_caption', node, block.id, null));
        }
        const caption = publishedRuns(block.caption, node, block.id, indent, true);
        const label =
          numbering.entries.find((entry) => entry.node === node && entry.block === block.id)
            ?.label ?? null;
        if (label !== null) check(label, node, block.id);

        const asset = input.assets.get(block.asset);
        if (asset === undefined) {
          // The request resolved every image as the publisher and recorded why one is missing; one it
          // did not record is an image nothing resolved, said the same way and naming no more.
          if (!refusedAssets.has(`${node} ${block.id}`)) {
            failures.push(failure('resolve', 'asset_unreadable', node, block.id, null));
          }
          return [];
        }
        // Sized here, never by the template (ruling R3): the width where the figure stands, the height
        // from the proportions as displayed, and past its share of the text block - or past what its
        // caption leaves of the page, where that is less - that height instead. A figure does not
        // break, so image and caption must stand on one page together (final review).
        const format = publishedPdf(layout.formats.pdf);
        const across = textMeasure(format) - indent;
        const said =
          (label === null ? '' : `${label} `) +
          caption.map((run) => ('text' in run ? run.text : '')).join('');
        const left = textBlockHeight(format) - captionHeight(columnsOf(said), across);
        const tooLong = left < FIGURE_LEAST_HEIGHT;
        if (tooLong) failures.push(failure('compose', 'caption_too_long', node, block.id, null));
        // Asked whatever the caption came to, so both are said at once (PUB-052).
        const alternative = alternativeOf(block.alternative, asset, node, block.id);
        if (tooLong || alternative === undefined) return [];
        const most = Math.min(textBlockHeight(format) * FIGURE_HEIGHT_SHARE, left);
        const tall = (across * asset.height) / asset.width;
        const [width, height] =
          tall > most ? [(most * asset.width) / asset.height, most] : [across, tall];
        return [
          {
            type: 'figure',
            id: block.id,
            label,
            caption,
            path: publishedImagePath(asset),
            width: points(width),
            height: points(height),
            alternative,
          },
        ];
      }
      case 'equation':
        failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
        return [];
      default: {
        // **Unreachable, and named rather than left to fall through.** The assignment is what makes
        // an eighth `BlockNode` kind fail to compile - every kind above is accounted for, so what
        // reaches here is `never` - and the throw is what happens if one arrives anyway, from a
        // build reading content a newer schema wrote. Falling through instead would return
        // `undefined`, which the caller's `flatMap` folds straight into the blocks a reader is
        // shown: a hole in the published document rather than a refusal naming what made it.
        const unreachable: never = block;
        throw new Error(
          `No published shape for a block of kind ${(unreachable as BlockNode).type}`,
        );
      }
    }
  };

  /**
   * A figure's alternative text as the template reads it (ruling R4, PUB-033): its own in the language of
   * the component it is in, the image's in the language that declares, or null where it is decorative -
   * or undefined, with the failure recorded, where it has none or the engine could not carry its
   * language. The component's own language is refused where the component is, so it is not again here.
   */
  const alternativeOf = (
    stored: Extract<BlockNode, { type: 'figure' }>['alternative'],
    asset: PublishingAsset,
    node: string,
    block: string,
  ): PublishedFigure['alternative'] | undefined => {
    if (stored.kind === 'decorative') return null;
    if (stored.kind === 'own') {
      // Its own text of spaces alone says nothing, whatever wrote it - the stored shape takes any text
      // that is not empty, and only the editor refuses a blank one - so it is none (final review).
      if (stored.text.trim() === '') {
        failOnce(failure('compose', 'alternative_missing', node, block, null));
        return undefined;
      }
      const content = input.occurrences.get(node);
      const language = content === undefined ? null : publishedLanguage(content.language);
      return language === null ? undefined : { text: stored.text, language };
    }
    if (asset.alternative === null) {
      failOnce(failure('compose', 'alternative_missing', node, block, null));
      return undefined;
    }
    const language = publishedLanguage(asset.alternative.language);
    if (language === null) {
      failOnce(
        failure('compose', 'language_not_publishable', node, block, asset.alternative.language),
      );
      return undefined;
    }
    return { text: asset.alternative.text, language };
  };

  /**
   * The indent a table's cell stands at: what the measure has lost where the table stands, and the
   * rest of the measure the cell does not have - its columns' share less the engine's inset each side.
   */
  const cellIndent = (indent: number, columns: number, colspan: number): number => {
    const measure = textMeasure(publishedPdf(layout!.formats.pdf));
    const cell = ((measure - indent) * colspan) / columns - 2 * CELL_INSET;
    return measure - cell;
  };

  /**
   * An image in a run of text as the template reads it (figures 5, rulings R2 to R4), or null with its
   * failures recorded: the `inline` style, an image the request resolved, alternative text as a
   * figure's, and one line high no wider than the room where it stands.
   */
  const publishedImage = (
    image: Extract<InlineNode, { type: 'image' }>,
    node: string,
    block: string,
    indent: number,
  ): PublishedInline | null => {
    if (image.imageStyle !== INLINE_STYLE) {
      failOnce(failure('compose', 'style_missing', node, block, image.imageStyle));
      return null;
    }
    const asset = input.assets.get(image.asset);
    if (asset === undefined) {
      if (!refusedAssets.has(`${node} ${block}`)) {
        failOnce(failure('resolve', 'asset_unreadable', node, block, null));
      }
      return null;
    }
    const alternative = alternativeOf(image.alternative, asset, node, block);
    const width = (INLINE_IMAGE_HEIGHT * asset.width) / asset.height;
    const room = textMeasure(publishedPdf(layout!.formats.pdf)) - indent;
    if (width > room) {
      failOnce(failure('compose', 'image_too_wide', node, block, null));
      return null;
    }
    if (alternative === undefined) return null;
    return {
      image: {
        path: publishedImagePath(asset),
        width: points(width),
        height: points(INLINE_IMAGE_HEIGHT),
        alternative,
      },
    };
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
      // Each list the layout declares that has an entry, in its order (ruling R7): a list of nothing
      // is not published, as a contents of nothing is not (decision K).
      front: {
        cover,
        contents: shownContents,
        lists: layout.matter.lists
          .filter((list) => listOf(conditioned, numbering, list.sequence).length > 0)
          .map((list) => ({ sequence: list.sequence, title: list.title })),
      },
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
 *
 * **A branch per published block kind, and a `default:` that refuses what it cannot name**, so a
 * third kind cannot be added without this failing to compile and cannot arrive at run time without
 * being thrown on. The `list` branch throws and is **unreachable by construction**: where
 * there is no layout `publishable` refuses a list before it can become one (decision E), and a
 * document with a failure never reaches `withoutMatter` at all. It is here to stay unreachable - the
 * cheap way to make a union compile is a branch that returns nothing, and that would drop a list
 * silently into the frozen shape, which is exactly what this whole file is arranged against.
 */
function withoutMarks(block: PublishedBlock): PublishedBlock1 {
  switch (block.type) {
    case 'paragraph':
      return {
        type: block.type,
        id: block.id,
        // Every run here is text: an image is refused by name without a layout, as any inline is.
        runs: block.runs.map((run) => ({ text: 'text' in run ? run.text : '' })),
      };
    case 'list':
    case 'preformatted':
    case 'blockquote':
    case 'table':
    case 'figure':
      // Unreachable for the same reason as a list: without a layout each is refused by name first.
      throw new Error(
        `publishing/1 holds paragraphs alone, and block ${block.id} is a ${block.type}`,
      );
    default: {
      // As in `publishable`: the assignment keeps the compile failure and the throw names what
      // arrived, so a third published kind can never be folded into the frozen shape as `undefined`.
      const unreachable: never = block;
      throw new Error(
        `publishing/1 holds paragraphs alone, not a ${(unreachable as PublishedBlock).type}`,
      );
    }
  }
}

/**
 * A stored table's width and the column each cell starts in, placing a cell in the first place no
 * cell above has spanned into - the walk `checkGrid` makes when the table is read, which is why the
 * grid is known here to be whole and rectangular.
 */
function gridOf(table: Extract<BlockNode, { type: 'table' }>): {
  columns: number;
  starts: number[][];
} {
  const covered: boolean[][] = table.rows.map(() => []);
  const starts = table.rows.map((row, rowIndex) => {
    let column = 0;
    return row.cells.map((cell) => {
      while (covered[rowIndex]![column]) column += 1;
      const start = column;
      for (let down = 0; down < cell.rowspan; down += 1) {
        for (let across = 0; across < cell.colspan; across += 1) {
          covered[rowIndex + down]![start + across] = true;
        }
      }
      column += cell.colspan;
      return start;
    });
  });
  return { columns: covered[0]!.length, starts };
}

/** The layout's PDF member as the template reads it: the page in points, numbering as patterns. */
export function publishedPdf(pdf: PdfFormat): PublishedPdfFormat {
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
 * One carried mark as the template reads it. A branch per kind, and a `default:` that refuses what
 * it cannot name, so a tenth kind added to `PUBLISHED_MARK_ORDER` without a branch here fails to
 * compile, and one arriving at run time is thrown on rather than pushed into a run's marks as
 * `undefined` - which would reach a reader as an unmarked run.
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
    default: {
      // As in `publishable`: the assignment keeps the compile failure and the throw names what
      // arrived, rather than returning `undefined` for the caller to push into a run's marks.
      const unreachable: never = mark;
      throw new Error(`No published shape for a mark of kind ${(unreachable as Mark).type}`);
    }
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
