import { equationAlternative } from '../content/admission/mathml.js';
import { ADMITTED_FORMATS } from '../assets/header.js';
import type { AssetVersionContent } from '../assets/version.js';
import { startsOutsideItsNumbering, type BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { CrossReferenceTarget, InlineNode } from '../content/model/inline.js';
import type { Mark } from '../content/model/marks.js';
import { hasText } from '../content/model/text.js';
import { contributionsOf, type Contribution } from '../structure/contributions.js';
import { contents, listOf } from '../structure/lists.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberingTable,
} from '../structure/numbering.js';
import {
  walkOutline,
  type OutlineDocument,
  type OutlineMatter,
  type OutlineNode,
} from '../structure/outline.js';
import {
  kindWord,
  printableForms,
  referenceResolver,
  type BoundTarget,
  type ReferenceResolution,
} from '../structure/references.js';
import { defaultNumberingScheme, type NumberFormat } from '../structure/scheme.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from '../theme/read.js';
import type { Place, Role, Typeface } from '../theme/schema.js';
import { projectTypst12 } from '../theme/typst.js';

import type { PublishFailure } from './failures.js';
import { characterProblems, codePointName, type Covers, type Setting } from './glyphs.js';
import {
  captionHeight,
  CELL_INSET,
  columnsAt,
  columnsOf,
  expandTabs,
  BODY_SIZE,
  inlineImageHeight,
  listIndent,
  textBlockHeight,
  textMeasure,
} from './measure.js';
import { publishedLanguage } from './language.js';
import type { Layout, PdfFormat } from './layout.js';
import { mathsText, mathsTree, type MathsRefusal } from './maths.js';
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
  type PublishedEquation,
  type PublishedFigure,
  type PublishedInline,
  type PublishedItem,
  type PublishedMark,
  type PublishedNode,
  type PublishedNode1,
  type PublishedPattern,
  type PublishedPdfFormat,
  type PublishedTitleRun,
} from './published.js';

/**
 * What a publish is assembled from, all of it recorded before the job ran: the document version's
 * outline, the content of the version each occurrence took - **only the occurrences the publisher may
 * read**, keyed by node - the failures the request already found resolving them, the layout and the
 * theme versions the request was made under, the document version's revision, and which characters
 * each family the worker holds can set.
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
  /**
   * The theme the request was made under, resolved by `readTheme` (themes 1, ruling R6): what every
   * paragraph, mark, role and equation is set from, and what `publishing/12` carries as its `theme`.
   * **Null exactly where `layout` is** - a request made before layouts, which migration 0024 gave no
   * theme and template 1 sets in its one family - and `assemble` throws on one without the other,
   * since no request is made under either alone.
   */
  readonly theme: ResolvedTheme | null;
  /** The document version as `revision.version` (VER-009). Ignored where `layout` is null. */
  readonly revision: string;
  /** Which characters each family can set, asked by the family's name (themes 1, ruling R6). */
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

/**
 * What a stored paragraph's style says where the author chose none, as the editor has written on every
 * paragraph since the content model was built: the default of the place it stands in (themes 1, TH-E),
 * which the theme names. Without a theme it is the one style template 1 sets, and every other is
 * `style_missing`.
 */
const BODY = 'body';

/**
 * The one family template 1 sets everything in, the pinned serif: what the glyph check asks of a
 * request made before layouts, which has no theme to name a face. Frozen, as template 1 is.
 */
const SLICE_ONE_FAMILY = 'Liberation Serif';

/** The heading roles, the first level's first: a node deeper than the sixth takes the sixth's. */
const HEADINGS = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
] as const satisfies readonly Role[];

/**
 * Where an image stands in the compile root (figures 3, ruling R2): `assets/`, the hash its key ends
 * in, and the extension its format declares. The one rule, which the published document names and the
 * job writes the file at, so the two cannot name different places.
 */
export function publishedImagePath(asset: Pick<PublishingAsset, 'object' | 'format'>): string {
  const hash = asset.object.slice(asset.object.lastIndexOf('/') + 1);
  return `assets/${hash}.${ADMITTED_FORMATS[asset.format].extension}`;
}

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
  const { layout, theme } = input;
  if ((layout === null) !== (theme === null)) {
    // A caller's defect, never the document's: every request since layouts is made under a theme too
    // (migration 0024), and none before them is.
    throw new Error(
      'A request made under a layout is set from a theme, and one made before layouts from none',
    );
  }
  const failures: PublishFailure[] = [...input.refused];

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
  /**
   * **Every face a theme names that sets text here**, by the typeface's identifier (themes 1, ruling
   * R6): a face that sets text is a face the PDF embeds, so the first time one is asked for, a theme
   * that records its licence as not permitting embedding in a PDF fails the publish,
   * `typeface_not_embeddable`, naming its family, once (STY-042). A face the document never sets text
   * in is never embedded and never refused. Answers the family, which is what the glyph check asks.
   */
  const embedded = new Set<string>();
  const setBy = (typeface: Typeface): string => {
    if (!embedded.has(typeface.id)) {
      embedded.add(typeface.id);
      if (!typeface.embedding.pdf) {
        failOnce(failure('compose', 'typeface_not_embeddable', null, null, typeface.family));
      }
    }
    return typeface.family;
  };
  /** The style a role or a place is set in: the reader found each in the catalogue, applying there. */
  const roleStyle = (role: Role): ResolvedParagraphStyle =>
    theme!.paragraphStyles.get(theme!.roles[role])!;
  const placeStyle = (place: Place): ResolvedParagraphStyle =>
    theme!.paragraphStyles.get(theme!.places[place])!;
  /** The families text in these roles is set in, each face set by; template 1's without a theme. */
  const roles = (...names: readonly Role[]): string[] =>
    theme === null ? [SLICE_ONE_FAMILY] : names.map((name) => setBy(roleStyle(name).typeface));
  /** The family text in a place's default style is set in; template 1's without a theme. */
  const inPlace = (place: Place): string[] =>
    theme === null ? [SLICE_ONE_FAMILY] : [setBy(placeStyle(place).typeface)];

  // What the layout sets in its running heads and feet, and which sequences it lists after the
  // contents: where the document's title, a section's title and a caption are set again.
  const slotParts =
    layout === null ? [] : [...layout.formats.pdf.head, ...layout.formats.pdf.foot].flat();
  const slotFields = new Set(
    slotParts.flatMap((part) => (part.kind === 'field' ? [part.field] : [])),
  );
  const listed = (sequence: string) =>
    layout?.matter.lists.some((list) => list.sequence === sequence) ?? false;
  /**
   * The families a node's title and number are set in: its heading's, by its depth - the sixth's for
   * any deeper - and again the contents entry's where the layout's contents reaches that depth, and
   * the running slots' for a first-level node where a slot prints the section, which names the first
   * level alone (template 11's `section`).
   */
  const titleFamilies = (depth: number): string[] => {
    if (layout === null) return roles();
    const contents = layout.matter.contents;
    return roles(
      HEADINGS[Math.min(depth, HEADINGS.length) - 1]!,
      ...(contents !== null && depth <= contents.depth ? (['contentsEntry'] as const) : []),
      ...(depth === 1 && slotFields.has('section') ? (['running'] as const) : []),
    );
  };
  /** A table's or a figure's caption and label: the caption's, and the list entry's where it is listed. */
  const captionFamilies = (sequence: 'table' | 'figure'): string[] =>
    roles('caption', ...(listed(sequence) ? (['listEntry'] as const) : []));

  /**
   * **The glyph check asks the face that sets the text** (themes 1, ruling R6; decision A before it):
   * each of `families`, by name - a paragraph style's, a role's, a mark's - where `setting` says how the
   * engine sets it, as body text, as code or in an equation. A character missing from a family setting
   * code is `code_glyph_missing`, as it always was, so the author is not told no face has it. Each
   * character is said once for the text, however many of its families lack it.
   */
  const check = (
    text: string,
    node: string | null,
    block: string | null,
    families: readonly string[],
    setting: Setting = 'body',
  ) => {
    const said = new Set<string>();
    for (const family of new Set(families)) {
      for (const { problem, codePoint } of characterProblems(text, input.covers, family, setting)) {
        const code =
          problem === 'glyph_missing' && setting === 'code' ? 'code_glyph_missing' : problem;
        if (said.has(`${code} ${codePoint}`)) continue;
        said.add(`${code} ${codePoint}`);
        failures.push(failure('compose', code, node, block, codePointName(codePoint)));
      }
    }
  };
  /** The layout's own words, asked of the families they are set in: a failure is the layout's. */
  const checkWords = (
    words: string,
    families: readonly string[],
    record: (next: PublishFailure) => void,
  ) => {
    const said = new Set<number>();
    for (const family of new Set(families)) {
      for (const { codePoint } of characterProblems(words, input.covers, family, 'body')) {
        if (said.has(codePoint)) continue;
        said.add(codePoint);
        record(failure('compose', 'layout_glyph_missing', null, null, codePointName(codePoint)));
      }
    }
  };

  // The document's title: on the cover in the title role's style, and in a running slot that prints
  // it. Checked whether or not the layout sets a cover, as it always was.
  check(
    input.outline.title,
    null,
    null,
    layout === null
      ? roles()
      : roles('title', ...(slotFields.has('title') ? (['running'] as const) : [])),
  );
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
  // a layout built past the parse reaches those two here. Each is asked of the role that sets it
  // (themes 1): the contents' title, the notice, its sentence, the running slots and the lists' titles.
  const wordsLanguage = layout === null ? null : publishedLanguage(layout.language);
  if (layout !== null) {
    if (wordsLanguage === null) {
      failures.push(
        failure('compose', 'layout_language_not_publishable', null, null, layout.language),
      );
    }
    const slotWords = slotParts.flatMap((part) => (part.kind === 'words' ? [part.text] : []));
    const { contents: title, notice, noticeSentence, above, below } = layout.words;
    const listTitles = layout.matter.lists.map((list) => list.title);
    // A relative reference prints the layout's words for above and below (cross-references 2, R2),
    // where it has them: asked here of running text's family whether or not a reference prints one,
    // and again of the family of the text a reference prints one in, where one does.
    const relative = [above, below].flatMap((words) => (words === undefined ? [] : [words]));
    const push = (next: PublishFailure) => failures.push(next);
    // Asked without being set by: running text's face may set nothing in this document.
    const text = [placeStyle('text').typeface.family];
    // The running slots' face sets the page's number and the revision where no word does.
    const running = slotParts.length > 0 ? roles('running') : [];
    // The contents' title is set only where the layout declares a contents, and asked where it is not
    // as it always was, of running text's family, since nothing sets it.
    checkWords(title, layout.matter.contents === null ? text : roles('contents'), push);
    checkWords(notice, roles('notice'), push);
    checkWords(noticeSentence, roles('noticeSentence'), push);
    for (const words of slotWords) checkWords(words, running, push);
    for (const words of listTitles) checkWords(words, roles('list'), push);
    for (const words of relative) checkWords(words, text, push);
  }

  // Every cross-reference in the document, resolved before anything is projected (cross-references 2):
  // a reference can point forwards, and whether a block carries its anchor depends on references not
  // yet reached. Under a layout alone - `publishing/1` has no run to put one in, so without a layout a
  // reference is refused by name where it stands, as it always was.
  const resolved =
    layout === null
      ? NO_REFERENCES
      : resolveReferences(input, numbering, layout.words.above, layout.words.below);
  failures.push(...resolved.failures);
  /** A block's or a footnote's anchor where a reference names it, else null. */
  const anchorOf = (node: string, block: string): string | null => {
    const anchor = blockAnchor(node, block);
    return resolved.named.has(anchor) ? anchor : null;
  };
  /**
   * What a block that publishes nothing leaves in its place: an empty marker carrying its anchor where
   * a reference names it (XR-D), so the reference finds its label, and nothing where none does.
   */
  const markerOf = (node: string, block: string): PublishedBlock[] => {
    const anchor = anchorOf(node, block);
    return anchor === null ? [] : [{ type: 'marker', anchor }];
  };

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
   *
   * **So is a footnote, in a paragraph's runs alone** (footnotes 2, FN-B): `inParagraph` says the runs
   * are a paragraph's, with the table the paragraph stands in, if any, which a footnote anchored to a
   * cell resolves against. Anywhere else - a caption, a term, an attribution, a table's note - one is
   * refused by name, naming `block`.
   *
   * **And so is a cross-reference, as `resolveReferences` printed it** (cross-references 2): a link to
   * its target in a paragraph's text - `inParagraph`, a footnote's paragraphs among them - outside a
   * table's header rows, and text everywhere else (R5, XR-D). One that did not resolve, or asked for a
   * form its target lacks, has already failed by name and is not set.
   *
   * **And so is an equation, wherever inline content is** (equations 2, EQ-G): as its maths tree and
   * its alternative, a table's header rows included - measured to set and tag there as in the body,
   * where a footnote and a link are refused - and a caption, whose list sets it again. Its failures
   * name `block`, as an image's do.
   *
   * `families` are the families the runs are set in where no mark names a face (themes 1): the
   * paragraph style's, or the role's - and every place it is set again, as a caption is in its list.
   * `size` is that style's size, which an image among the runs is printed 1.2 ems of.
   */
  const publishedRuns = (
    content: readonly InlineNode[],
    node: string,
    block: string,
    families: readonly string[],
    size: number,
    indent = 0,
    caption = false,
    inParagraph: { readonly table: TableNode | null; readonly heading: boolean } | null = null,
  ): PublishedInline[] => {
    const runs: PublishedInline[] = [];
    for (const inline of content) {
      if (inline.type === 'footnote' && layout !== null) {
        // A table's header rows repeat on every page it reaches, and the engine refuses a footnote in
        // a repeated header outright - a link in an artifact - naming nothing (final review of
        // footnotes 2). Refused always, since whether a table crosses a page is not known here.
        if (inParagraph === null || inParagraph.heading) {
          failOnce(failure('compose', 'footnote_not_publishable_here', node, block, null));
          continue;
        }
        const published = publishedFootnote(inline, node, block, inParagraph.table, families);
        if (published !== null) runs.push(published);
        continue;
      }
      if (inline.type === 'crossReference' && layout !== null) {
        const printed = resolved.printed.get(referenceKey(node, inline.id));
        // A header row is set again on every page the table reaches, as an artifact, where the engine
        // refuses a link; a caption, a term, an attribution and a note are set again or read apart.
        const link = inParagraph !== null && !inParagraph.heading;
        if (printed === undefined) continue;
        // The layout's word for above or below, set in the family of the text it stands in.
        if (printed.relative && printed.text !== null) checkWords(printed.text, families, failOnce);
        runs.push({ reference: { ...printed, link } });
        continue;
      }
      // A caption's height is estimated from its words, and the list after the contents sets it again,
      // so an image in one is refused rather than set (final review of figures 5).
      if (inline.type === 'image' && layout !== null && caption) {
        failOnce(failure('compose', 'image_in_caption', node, block, null));
        continue;
      }
      if (inline.type === 'image' && layout !== null) {
        const published = publishedImage(inline, node, block, indent, size);
        if (published !== null) runs.push(published);
        continue;
      }
      if (inline.type === 'equation' && layout !== null) {
        const equation = publishedEquation(inline.mathml, node, block);
        if (equation !== null) runs.push({ equation });
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
      check(
        inline.value,
        node,
        block,
        runFamilies(outcome.marks, families),
        code ? 'code' : 'body',
      );
      runs.push({ text: inline.value, marks: outcome.marks });
    }
    return runs;
  };

  /**
   * The families a run of text is set in (themes 1, ruling R6): the face of its innermost mark that
   * names one - marks apply in `PUBLISHED_MARK_ORDER`, outermost first, so the last to name a face is
   * the one the run is set in, inline code's under the default theme - and otherwise the families of
   * what it stands in. Without a theme a run carries no mark.
   */
  const runFamilies = (
    marks: readonly PublishedMark[],
    families: readonly string[],
  ): readonly string[] => {
    if (theme === null) return families;
    let face: Typeface | undefined;
    for (const mark of marks) face = theme.characterStyles[mark.kind].typeface ?? face;
    return face === undefined ? families : [setBy(face)];
  };

  /**
   * The paragraph style a stored paragraph is set in (themes 1, TH-E), and the families its text is
   * set in. A stored `body` means the default of `place`, where it stands; any other identifier is the
   * style it names, which must be in the theme's paragraph catalogue - `style_missing` (STY-027) - and
   * must apply there - `style_not_applicable` (STY-006) - each naming `block` and the style. A
   * paragraph refused either way is still checked, in the place's default, so what else is wrong with
   * it is said too. Without a theme `body` is the one style template 1 sets, as it always was.
   */
  const paragraphStyle = (
    stored: string,
    place: Place,
    node: string,
    block: string,
  ): { readonly id: string; readonly families: readonly string[]; readonly size: number } => {
    if (theme === null) {
      if (stored !== BODY) failures.push(failure('compose', 'style_missing', node, block, stored));
      return { id: BODY, families: [SLICE_ONE_FAMILY], size: BODY_SIZE };
    }
    const id = stored === BODY ? theme.places[place] : stored;
    const style = theme.paragraphStyles.get(id);
    const applies = style?.appliesTo.includes(place) ?? false;
    if (style === undefined) {
      failures.push(failure('compose', 'style_missing', node, block, stored));
    } else if (!applies) {
      failures.push(failure('compose', 'style_not_applicable', node, block, id));
    }
    const setIn = style !== undefined && applies ? style : placeStyle(place);
    return { id, families: [setBy(setIn.typeface)], size: setIn.properties.size };
  };

  /**
   * A footnote as the template sets it (footnotes 2), or null where it is refused.
   *
   * - **Anchored to the table as a whole** it is refused, naming the block it stands in: a note on a
   *   table is the table's note (FN-C).
   * - **Anchored to a cell**, the anchor must resolve against the table it stands in (CNT-042), or the
   *   publish fails naming the footnote. It is set where it stands either way.
   * - **With no text at all** it is refused, naming it: a numbered mark over nothing would publish a
   *   note the author never wrote. Judged on what is stored, so a footnote whose only words are refused
   *   for a mark is told about the mark and not called empty as well.
   * - **Its paragraphs are a paragraph's**, style, marks, glyphs and languages - a stored `body` the
   *   `footnote` place's default - and their failures name the footnote. An empty one is dropped, as
   *   a component's is.
   * - **Its label** is set twice: as its mark, in the families of the text it stands in, and at the
   *   foot of the page in the `footnote` place's default.
   */
  const publishedFootnote = (
    footnote: Extract<InlineNode, { type: 'footnote' }>,
    node: string,
    block: string,
    table: TableNode | null,
    families: readonly string[],
  ): PublishedInline | null => {
    const { anchor } = footnote;
    // Every reason at once, never the first alone (PUB-052), so each is said before any returns.
    let refused = false;
    if (anchor.kind === 'table') {
      failOnce(failure('compose', 'footnote_not_publishable_here', node, block, null));
      refused = true;
    } else if (anchor.kind !== 'span' && !anchorResolves(anchor, table)) {
      failures.push(failure('compose', 'footnote_anchor_unresolved', node, footnote.id, null));
      refused = true;
    }
    const content = footnote.content as readonly Extract<BlockNode, { type: 'paragraph' }>[];
    // Words, not runs: spaces alone say nothing, as a caption of spaces names nothing.
    const says = content.some((paragraph) =>
      paragraph.content.some((inline) => inline.type !== 'text' || inline.value.trim() !== ''),
    );
    if (!says) {
      failures.push(failure('compose', 'footnote_empty', node, footnote.id, null));
      refused = true;
    }
    // A layout whose scheme prefixes footnotes with their chapter gives none in a part with no
    // numbered section before it, and a mark with nothing in it is no footnote (final review).
    const label =
      numbering.entries.find((entry) => entry.node === node && entry.block === footnote.id)
        ?.label ?? null;
    if (label === null) {
      failures.push(failure('compose', 'footnote_unnumbered', node, footnote.id, null));
      refused = true;
    }
    if (refused || label === null) return null;
    const paragraphs = content.flatMap((paragraph) => {
      const style = paragraphStyle(paragraph.style, 'footnote', node, footnote.id);
      // A footnote's text is a paragraph's text, where a reference is a link (R5); a footnote holds no
      // footnote (CNT-129), so nothing here asks the table the flag carries.
      const runs = publishedRuns(
        paragraph.content,
        node,
        footnote.id,
        style.families,
        style.size,
        0,
        false,
        { table, heading: false },
      );
      // A footnote's own paragraph is a block a reference can name (CNT-125), and carries its anchor
      // where one does. An empty one is dropped unless it is named: then it stays, holding nothing,
      // and the template sets its label where it would have begun, as a marker stands for a block.
      const anchor = anchorOf(node, paragraph.id);
      return runs.length === 0 && anchor === null
        ? []
        : [{ type: 'paragraph' as const, id: paragraph.id, anchor, style: style.id, runs }];
    });
    check(label, node, footnote.id, [...inPlace('footnote'), ...families]);
    return { footnote: { label, anchor: anchorOf(node, footnote.id), paragraphs } };
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
   * the recursion arrives at. `place` is where the block stands, whatever holds it most nearly -
   * running text, a list's item, a quotation or a table's cell - which a stored `body` means the
   * default style of (themes 1, TH-E).
   */
  const publishable = (
    block: BlockNode,
    node: string,
    place: Place,
    indent = 0,
    table: TableNode | null = null,
    heading = false,
  ): PublishedBlock[] => {
    switch (block.type) {
      case 'paragraph': {
        const style = paragraphStyle(block.style, place, node, block.id);
        const runs = publishedRuns(
          block.content,
          node,
          block.id,
          style.families,
          style.size,
          indent,
          false,
          { table, heading },
        );
        // An empty paragraph is where a cursor stands and publishes nothing (CNT-124), unless a
        // reference names it: then its marker stands where it would have.
        if (runs.length === 0) return markerOf(node, block.id);
        return [
          {
            type: 'paragraph',
            id: block.id,
            anchor: anchorOf(node, block.id),
            style: style.id,
            runs,
          },
        ];
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
          // A term is set in the list item's default style, as its item's first line is.
          const term =
            item.term === undefined
              ? []
              : publishedRuns(
                  item.term,
                  node,
                  block.id,
                  inPlace('listItem'),
                  placeStyle('listItem').properties.size,
                  indent,
                );
          return {
            term: term.length === 0 ? null : term,
            blocks: item.content.flatMap((each) =>
              publishable(
                each,
                node,
                'listItem',
                indent + listIndent(block, placeStyle('listItem').properties.size),
                table,
                heading,
              ),
            ),
          };
        });
        // An item that came out empty is **kept**: it is storable because that is where a cursor
        // stands after Enter (CNT-124's reason), and an item that vanished would renumber every
        // item below it - a reader shown numbers the author never wrote. A list with nothing at
        // all in it is another matter: it contributes nothing rather than an empty `L` - but a marker
        // for it, or for what is in it, where a reference names either, since a marker sets nothing.
        return items.every((item) => item.term === null && item.blocks.every(isMarker))
          ? [...markerOf(node, block.id), ...items.flatMap((item) => item.blocks)]
          : [
              {
                type: 'list',
                id: block.id,
                anchor: anchorOf(node, block.id),
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
        if (block.text === '') return markerOf(node, block.id);
        // Set in the `preformatted` role's style, as code, and measured by it (themes 1, ruling R6);
        // its label above it in the `preformattedLabel` role's.
        const preformatted = roleStyle('preformatted');
        const family = setBy(preformatted.typeface);
        if (block.language !== undefined) {
          check(block.language, node, block.id, roles('preformattedLabel'));
        }
        const lines = block.text.split('\n').map(expandTabs);
        const most = columnsAt(publishedPdf(layout.formats.pdf), indent, preformatted);
        lines.forEach((line, index) => {
          check(line, node, block.id, [family], 'code');
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
        return [
          {
            type: 'preformatted',
            id: block.id,
            anchor: anchorOf(node, block.id),
            label: block.language ?? null,
            lines,
          },
        ];
      }
      case 'blockquote': {
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        // Inset by exactly its style's start and end indents (themes 1), which template 12 sets in
        // place of the engine's own inset of a quotation.
        const quoted = placeStyle('quotation').properties;
        const inset = indent + quoted.startIndent + quoted.endIndent;
        const blocks = block.content.flatMap((each) => publishable(each, node, 'quotation', inset));
        const attribution =
          block.attribution === undefined
            ? []
            : publishedRuns(
                block.attribution,
                node,
                block.id,
                roles('attribution'),
                roleStyle('attribution').properties.size,
                inset,
              );
        // Nothing to show and nothing to attribute contributes nothing, rather than an empty
        // `BlockQuote` (decision P) - but the markers it and what it quotes leave, as a list does.
        if (blocks.every(isMarker) && attribution.length === 0) {
          return [...markerOf(node, block.id), ...blocks];
        }
        return [
          {
            type: 'blockquote',
            id: block.id,
            anchor: anchorOf(node, block.id),
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
        // The table's own style, from the theme's table catalogue (themes 1), which holds no property
        // until themes 2: it must be there, and apply to a table.
        const tableStyle = theme!.tableStyles.get(block.style);
        if (tableStyle === undefined) {
          failures.push(failure('compose', 'style_missing', node, block.id, block.style));
        } else if (!tableStyle.appliesTo.includes('table')) {
          failures.push(failure('compose', 'style_not_applicable', node, block.id, block.style));
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
        const caption = publishedRuns(
          block.caption,
          node,
          block.id,
          captionFamilies('table'),
          roleStyle('caption').properties.size,
          indent,
          true,
        );
        // A note on the table as a whole (CNT-038, FN-C), set beneath it in its figure (footnotes 2,
        // ruling R7), in the `tableNote` role's style. One that says nothing, which another route may
        // store, is none.
        const note =
          block.note === undefined
            ? []
            : publishedRuns(
                block.note,
                node,
                block.id,
                roles('tableNote'),
                roleStyle('tableNote').properties.size,
                indent,
              );
        const noteSays = note.some((run) => !('text' in run) || run.text.trim() !== '');
        const label =
          numbering.entries.find((entry) => entry.node === node && entry.block === block.id)
            ?.label ?? null;
        if (label !== null) check(label, node, block.id, captionFamilies('table'));
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
            anchor: anchorOf(node, block.id),
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
                  publishable(
                    each,
                    node,
                    'tableCell',
                    cellIndent(indent, columns, cell.colspan),
                    block,
                    rowIndex < block.headerRows,
                  ),
                ),
                colspan: cell.colspan,
                rowspan: cell.rowspan,
                scope: scopeAt(rowIndex, starts[rowIndex]![cellIndex]!),
              })),
            })),
            note: noteSays ? note : null,
          },
        ];
      }
      case 'figure': {
        // Refused by name without a layout, as a list is: the frozen first shape holds paragraphs alone.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        // The image style, from the theme's image catalogue (themes 1), which holds no property until
        // themes 2: it must be there, and apply to a figure.
        const imageStyle = theme!.imageStyles.get(block.imageStyle);
        if (imageStyle === undefined) {
          failures.push(failure('compose', 'style_missing', node, block.id, block.imageStyle));
        } else if (!imageStyle.appliesTo.includes('figure')) {
          failures.push(
            failure('compose', 'style_not_applicable', node, block.id, block.imageStyle),
          );
        }
        // CNT-017's caption: a caption of no words names nothing (ruling R5), as a table's does not.
        const words = block.caption.map((inline) => (inline.type === 'text' ? inline.value : ''));
        if (words.join('').trim() === '') {
          failures.push(failure('compose', 'figure_without_caption', node, block.id, null));
        }
        const caption = publishedRuns(
          block.caption,
          node,
          block.id,
          captionFamilies('figure'),
          roleStyle('caption').properties.size,
          indent,
          true,
        );
        const label =
          numbering.entries.find((entry) => entry.node === node && entry.block === block.id)
            ?.label ?? null;
        if (label !== null) check(label, node, block.id, captionFamilies('figure'));

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
        // An equation's characters are counted as words are: an estimate, as the words' is, and
        // generous where maths sets on one line what words would wrap.
        const said =
          (label === null ? '' : `${label} `) +
          caption
            .map((run) => {
              if ('text' in run) return run.text;
              if ('reference' in run) return run.reference.text ?? '';
              if ('equation' in run) return mathsText(run.equation.tree);
              return '';
            })
            .join('');
        const left =
          textBlockHeight(format) -
          captionHeight(columnsOf(said), across, roleStyle('caption').properties.size);
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
            anchor: anchorOf(node, block.id),
            label,
            caption,
            path: publishedImagePath(asset),
            width: points(width),
            height: points(height),
            alternative,
          },
        ];
      }
      case 'equation': {
        // Refused by name without a layout, as a list is: the frozen first shape holds paragraphs alone.
        if (layout === null) {
          failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
          return [];
        }
        const equation = publishedEquation(block.mathml, node, block.id);
        // `number`'s label, set beside the equation as its own text (EQ-E). A numbered equation the
        // scheme gives none - a layout numbering equations within chapters, in a part with no numbered
        // chapter before it - would be set with nothing beside it, so it is refused, as a footnote is.
        const label =
          numbering.entries.find((entry) => entry.node === node && entry.block === block.id)
            ?.label ?? null;
        const unnumbered = block.numbered && label === null;
        if (unnumbered) {
          failures.push(failure('compose', 'equation_unnumbered', node, block.id, null));
        }
        // Set beside the equation in the style of the place it stands in, and in the list of
        // equations where the layout declares one.
        if (label !== null) {
          check(label, node, block.id, [
            ...inPlace(place),
            ...(listed('equation') ? roles('listEntry') : []),
          ]);
        }
        if (equation === null || unnumbered) return [];
        return [
          { type: 'equation', id: block.id, anchor: anchorOf(node, block.id), label, ...equation },
        ];
      }
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
   * failures recorded: an image style of the theme's that applies to an image in a line (themes 1),
   * an image the request resolved, alternative text as a figure's, and one line high - 1.2 ems of
   * `size`, the size of the style it stands in (`inlineImageHeight`) - no wider than the room where it
   * stands.
   */
  const publishedImage = (
    image: Extract<InlineNode, { type: 'image' }>,
    node: string,
    block: string,
    indent: number,
    size: number,
  ): PublishedInline | null => {
    const style = theme!.imageStyles.get(image.imageStyle);
    if (style === undefined) {
      failOnce(failure('compose', 'style_missing', node, block, image.imageStyle));
      return null;
    }
    if (!style.appliesTo.includes('inlineImage')) {
      failOnce(failure('compose', 'style_not_applicable', node, block, image.imageStyle));
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
    const height = inlineImageHeight(size);
    const width = (height * asset.width) / asset.height;
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
        height: points(height),
        alternative,
      },
    };
  };

  /**
   * The language the text at a place is in: the component's, for anything an occurrence holds, and the
   * document's in a section's title, whose words are the document's. What an equation's alternative is
   * spoken in (EQ-D). Null where the engine cannot carry it, which is refused where the language is.
   */
  const spokenIn = (node: string) =>
    publishedLanguage(input.occurrences.get(node)?.language ?? input.outline.language);

  /**
   * An equation as a writer sets it (equations 2, rulings R2 to R5), or null with every reason it
   * cannot be recorded, each naming `block` - the equation, or the block an inline one stands in, or
   * none for one in a section's title, whose node is the place:
   *
   * - **its maths tree**, or `equation_unrenderable` naming the construct the converter refused, from
   *   `REFUSAL_NAMES` alone (CNT-049) - so nothing of it reaches a writer, as source or as a blank;
   * - **its alternative**, the MathML's `alttext` as `equationAlternative` reads it - the rule the
   *   editor reads - or `alternative_missing`, as an image with none: the engine would otherwise refuse
   *   the whole document without saying which (EQ-D). Read whatever the tree came to, so both are said;
   * - **its characters**, every one the tree sets asked of the theme's maths face (R3; themes 1) - the
   *   engine's fallback is off for maths, so one the face lacks would be set as nothing -
   *   `math_glyph_missing` for each, named apart from `glyph_missing` because the body face may have it.
   *
   * Said once for its block however many of its equations share a reason, as an image's are.
   */
  const publishedEquation = (
    mathml: string,
    node: string,
    block: string | null,
  ): PublishedEquation | null => {
    const converted = mathsTree(mathml);
    if (!converted.ok) {
      failOnce(
        failure('compose', 'equation_unrenderable', node, block, REFUSAL_NAMES[converted.reason]),
      );
    }
    // MathML that cannot be read has no alternative to read either, and giving it one mends nothing,
    // so it is said once, as the equation that cannot be set.
    const alternative = equationAlternative(mathml);
    const unreadable = !converted.ok && converted.reason === 'unreadable';
    if (alternative === null && !unreadable) {
      failOnce(failure('compose', 'alternative_missing', node, block, null));
    }
    if (!converted.ok) return null;
    const faceless = characterProblems(
      mathsText(converted.tree),
      input.covers,
      setBy(theme!.maths),
      'math',
    );
    for (const { problem, codePoint } of faceless) {
      const code = problem === 'glyph_missing' ? 'math_glyph_missing' : problem;
      failOnce(failure('compose', code, node, block, codePointName(codePoint)));
    }
    // The language is refused where it is declared - the component, or the document - not again here.
    const language = spokenIn(node);
    if (alternative === null || faceless.length > 0 || language === null) return null;
    return { tree: converted.tree, alternative: { text: alternative, language } };
  };

  /** A node and every node beneath it, in the matter of the top-level node that holds them. */
  const project = (node: OutlineNode, depth: number, matter: OutlineMatter): PublishedNode => {
    const numberText = numbers.get(node.id) ?? null;
    if (numberText !== null) check(numberText, node.id, null, titleFamilies(depth));
    const anchor = nodeAnchor(node.id);
    const shell = {
      id: node.id,
      anchor: resolved.named.has(anchor) ? anchor : null,
      depth,
      matter,
      number: numberText,
    };

    if (node.type === 'section') {
      // A title's reference is its number in the title's words (R6), set again in the contents and the
      // running heads. One that failed has said so and prints nothing. An equation in it is published
      // as it is anywhere (equations 2): a published title is runs, which the template sets in the
      // heading, and so in the contents and the running heads that set the heading's body again. Its
      // failures name the section. Without a layout both are refused, as `publishing/1` always did.
      const title = textOf(
        node.title,
        layout === null
          ? null
          : (reference) => {
              const printed = resolved.printed.get(referenceKey(node.id, reference.id));
              // The layout's word for above or below, set in the title's families.
              if (printed?.relative && printed.text !== null) {
                checkWords(printed.text, titleFamilies(depth), failOnce);
              }
              return printed?.text ?? '';
            },
        layout === null ? null : (equation) => publishedEquation(equation.mathml, node.id, null),
      );
      // A footnote in a title would be set twice, in the contents and where it stands (FN-B).
      // Under a layout alone: a request made before layouts keeps saying what it always said.
      if (layout !== null && 'unpublishable' in title && title.unpublishable === 'footnote') {
        failures.push(failure('compose', 'footnote_not_publishable_here', node.id, null, null));
      } else if ('unpublishable' in title) {
        failures.push(
          failure('compose', 'title_not_publishable', node.id, null, title.unpublishable),
        );
      } else {
        check(titleWords(title.runs), node.id, null, titleFamilies(depth));
      }
      const children = node.children.map((child) => project(child, depth + 1, matter));
      return {
        ...shell,
        title: 'runs' in title ? title.runs : [],
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
      return { ...shell, title: [], language: null, direction: null, blocks: [], children };
    }
    check(content.title, node.id, null, titleFamilies(depth));
    // A component in the document's own language is not refused a second time.
    const own = content.language === input.outline.language ? null : content.language;
    const ownLanguage = own === null ? null : publishedLanguage(own);
    if (own !== null && ownLanguage === null) {
      failures.push(failure('compose', 'language_not_publishable', node.id, null, own));
    }
    const blocks = content.content.flatMap((block) => publishable(block, node.id, 'text'));
    const children = node.children.map((child) => project(child, depth + 1, matter));
    return {
      ...shell,
      // A component's title is a string, and one run of its words.
      title: content.title === '' ? [] : [{ text: content.title, marks: [] }],
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
      // Every paragraph style the theme holds, not only those used (themes 1, ruling R6).
      theme: projectTypst12(theme!),
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
 * A node as `publishing/1` held it: no matter, its title a string, and every other member in the order
 * it had then, since the order is part of the bytes Typst reads and of the digest a publication
 * records. Its title's runs are words alone: without a layout an equation in a title is refused by
 * name, as anything else in one but words is.
 */
function withoutMatter(node: PublishedNode): PublishedNode1 {
  return {
    id: node.id,
    depth: node.depth,
    number: node.number,
    title: titleWords(node.title),
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
    case 'equation':
      // Unreachable for the same reason as a list: without a layout each is refused by name first.
      throw new Error(
        `publishing/1 holds paragraphs alone, and block ${block.id} is a ${block.type}`,
      );
    case 'marker':
      // Unreachable too: without a layout no reference is resolved, so nothing is named and no marker
      // is made.
      throw new Error(`publishing/1 holds paragraphs alone, not a marker for ${block.anchor}`);
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
 * What `equation_unrenderable` names of each refusal (equations 2, ruling R5): a construct from this
 * fixed list and nothing else - never the variant, the element or the attribute the content wrote,
 * which an author reaches by a paste and which a failure's detail must not carry. Keyed by the
 * refusal's own reason, so a reason added to the converter fails to compile here until it is named.
 */
const REFUSAL_NAMES: Readonly<Record<MathsRefusal['reason'], string>> = {
  unreadable: 'unreadable',
  error: 'merror',
  rightToLeft: 'rtl',
  scripts: 'multiscripts',
  offset: 'voffset',
  spanningCell: 'spanningCell',
  variant: 'mathvariant',
  element: 'element',
  attribute: 'attribute',
  text: 'text',
  // The final review of equations 2: a space no line holds or no number can, an accent of more than
  // one character (I1), and an equation that draws nothing (M1).
  space: 'space',
  accent: 'accent',
  empty: 'empty',
};

/** A cross-reference as the content model stores it. */
type ReferenceNode = Extract<InlineNode, { type: 'crossReference' }>;

/**
 * What a resolved reference prints, before where it stands says whether it is a link. `relative` says
 * the text is the layout's own word for above or below, which the template sets in the layout's
 * language (the final review of cross-references 2); a number or a title is the document's.
 */
type Printed =
  | {
      readonly anchor: string;
      readonly text: string;
      readonly page: false;
      readonly relative: boolean;
    }
  | { readonly anchor: string; readonly text: null; readonly page: true; readonly relative: false };

/** Every reference in a document, resolved: what each prints, what is named, and what failed. */
interface ResolvedReferences {
  /** What each reference that resolved to a form it can print prints, by `referenceKey`. */
  readonly printed: ReadonlyMap<string, Printed>;
  /** The anchor of every target such a reference names: what the file labels, and nothing more. */
  readonly named: ReadonlySet<string>;
  readonly failures: readonly PublishFailure[];
}

/** Nothing resolved: a request made before layouts, which refuses a reference where it stands. */
const NO_REFERENCES: ResolvedReferences = { printed: new Map(), named: new Set(), failures: [] };

/**
 * The anchors of the published document (publishing.md, "The published document"): a block or a
 * footnote by its occurrence and its identifier together, since one component placed twice holds the
 * same identifiers twice (STR-010), and a node by its own. A node's identifier is 26 characters of
 * `[a-z2-7]`, so the hyphen after it cannot be confused with one in a block's identifier.
 */
const blockAnchor = (node: string, block: string) => `b-${node}-${block}`;
const nodeAnchor = (node: string) => `n-${node}`;

/** A reference by where it is read - its occurrence, or the section it titles - and its identifier. */
const referenceKey = (node: string, reference: string) => `${node}\u{0}${reference}`;

const isMarker = (block: PublishedBlock): boolean => block.type === 'marker';

/** What a failure names of a target it could not find (R7): its kind and identifiers, never text. */
function targetNamed(target: CrossReferenceTarget): string {
  switch (target.kind) {
    case 'block':
      return `block ${target.block}`;
    case 'component':
      return `component ${target.component} block ${target.block}`;
    case 'node':
      return `node ${target.node}`;
    default: {
      const unreachable: never = target;
      throw new Error(`No name for a target of kind ${(unreachable as CrossReferenceTarget).kind}`);
    }
  }
}

/** A reference found in the document: where it is read, whether in a title, and where it stands. */
interface Found {
  readonly node: string;
  readonly reference: ReferenceNode;
  readonly inTitle: boolean;
  readonly at: number;
}

/**
 * **Every cross-reference in the document, resolved and printed** (cross-references 2, rulings R3 to
 * R7), before anything is projected, since a reference may point forwards and a target carries its
 * anchor only where one names it.
 *
 * **One walk, in the order the publish sets things**, gives every reference and every target a place
 * in document order: a node where its heading is set, before its content and its children; a block
 * where it begins, before what it holds; a footnote where its mark stands in its text. So a target
 * that holds a reference - the section it stands in, its paragraph, the table whose caption it is in -
 * comes before it, and `relative` prints _above_ for it (R3). The walk reaches every place inline
 * content is stored: a section's title, and in a component a paragraph, a list's term and items at any
 * depth, a quotation and its attribution, a table's caption, cells and note, a figure's caption, and a
 * footnote's paragraphs - a footnote refused for where it stands included, so every reference's
 * failure is said, not only those in what is published. A footnote's paragraph is a target too
 * (CNT-125), placed after its footnote's mark, where its note begins. A block equation is placed where
 * it stands, as any block is (equations 2, R7); an inline one is no target, and holds no reference.
 *
 * Each is resolved in the occurrence it is read in (`referenceResolver`, R1), and then:
 *
 * - **one that does not resolve** fails `cross_reference_unresolved`, naming where it is read, the
 *   reference and its target (STR-029, STR-062);
 * - **one asking for a form its target cannot print** fails `cross_reference_form_unavailable`, naming
 *   the form: one `printableForms` does not offer, a page in a section's title (R6) - which the
 *   running heads and the contents set again, where a page would be computed per place - a
 *   relative form under a layout with no words for above and below (R2), and **any form of a target
 *   standing in a table's header rows** (cross-references 2, task 4, measured): the engine sets a
 *   header row again on every page the table reaches, the target's label with it, and a label set
 *   twice refuses the compile - "label occurs multiple times" - wherever the table happens to break,
 *   which only the engine knows. Refused wherever it breaks, as a footnote there is. A header
 *   column is set once, and is published;
 * - **every other** prints its form: the label, the title, both with a space between, the layout's
 *   word for above or below, or nothing for a page, which the template prints - and its target's
 *   anchor is named.
 *
 * A section's title is the words it is **published** with, its own references as their numbers, so a
 * reference to it prints what its heading shows. A title's reference is a number or a page alone
 * (`checkInlineContent`), so this never asks a title for a title. **A caption, read as a title**, is
 * its author's words with each of its own references printed as its target's number - or, where that
 * target has none, its kind in one word - whatever form the reference itself asks for: a number never
 * reads a caption, so a caption naming another's title, which names the first's, has an end (the final
 * review of cross-references 2). Dropping the reference instead would print words the author never
 * wrote, "See  for more".
 */
function resolveReferences(
  input: AssembleInput,
  numbering: NumberingTable,
  above: string | undefined,
  below: string | undefined,
): ResolvedReferences {
  const found: Found[] = [];
  const positions = new Map<string, number>();
  const sections = new Map<string, Extract<OutlineNode, { type: 'section' }>>();
  /** Every figure's and table's caption, by the block's anchor, with the occurrence it is read in. */
  const captions = new Map<
    string,
    { readonly node: string; readonly caption: readonly InlineNode[] }
  >();
  /** Every anchor standing in a table's header rows, which the engine sets on every page. */
  const repeated = new Set<string>();
  let at = 0;

  const place = (anchor: string, inHeader: boolean) => {
    positions.set(anchor, at++);
    if (inHeader) repeated.add(anchor);
  };
  const inlines = (
    content: readonly InlineNode[],
    node: string,
    inTitle: boolean,
    inHeader: boolean,
  ) => {
    for (const inline of content) {
      if (inline.type === 'crossReference') {
        found.push({ node, reference: inline, inTitle, at: at++ });
      } else if (inline.type === 'footnote') {
        place(blockAnchor(node, inline.id), inHeader);
        const paragraphs = inline.content as readonly Extract<BlockNode, { type: 'paragraph' }>[];
        for (const paragraph of paragraphs) {
          place(blockAnchor(node, paragraph.id), inHeader);
          inlines(paragraph.content, node, inTitle, inHeader);
        }
      }
    }
  };
  // A branch per stored block kind, and a `default:` that refuses what it cannot name, as
  // `publishable` has: a block walked past here is a reference in it never resolved.
  const block = (stored: BlockNode, node: string, inHeader: boolean): void => {
    place(blockAnchor(node, stored.id), inHeader);
    switch (stored.type) {
      case 'paragraph':
        inlines(stored.content, node, false, inHeader);
        return;
      case 'list':
        for (const item of stored.items) {
          inlines(item.term ?? [], node, false, inHeader);
          for (const each of item.content) block(each, node, inHeader);
        }
        return;
      case 'blockquote':
        for (const each of stored.content) block(each, node, inHeader);
        inlines(stored.attribution ?? [], node, false, inHeader);
        return;
      case 'table':
        captions.set(blockAnchor(node, stored.id), { node, caption: stored.caption });
        inlines(stored.caption, node, false, inHeader);
        stored.rows.forEach((row, index) => {
          const header = inHeader || index < stored.headerRows;
          for (const cell of row.cells) for (const each of cell.content) block(each, node, header);
        });
        inlines(stored.note ?? [], node, false, inHeader);
        return;
      case 'figure':
        captions.set(blockAnchor(node, stored.id), { node, caption: stored.caption });
        inlines(stored.caption, node, false, inHeader);
        return;
      case 'preformatted':
      case 'equation':
        return;
      default: {
        const unreachable: never = stored;
        throw new Error(`No reference walk for a block of kind ${(unreachable as BlockNode).type}`);
      }
    }
  };
  walkOutline(input.outline.nodes, (node) => {
    place(nodeAnchor(node.id), false);
    if (node.type === 'section') {
      sections.set(node.id, node);
      inlines(node.title, node.id, true, false);
      return;
    }
    for (const each of input.occurrences.get(node.id)?.content ?? []) block(each, node.id, false);
  });

  const resolve = referenceResolver({
    outline: input.outline,
    occurrences: input.occurrences,
    numbering,
  });
  const resolutions = new Map<string, ReferenceResolution>();
  for (const { node, reference } of found) {
    resolutions.set(referenceKey(node, reference.id), resolve(reference.target, { node }));
  }
  /** The number a reference resolved to, or its target's kind where it has none; nothing if it failed. */
  const numberOf = (node: string, reference: ReferenceNode): string => {
    const resolution = resolutions.get(referenceKey(node, reference.id));
    return resolution?.ok === true
      ? (resolution.target.label ?? kindWord(resolution.target.kind))
      : '';
  };
  /**
   * A section's title as it is published: its references as the numbers they resolved to. And a
   * figure's or a table's caption as a title form prints it: its words, its references as their
   * numbers, each falling back to its kind.
   *
   * **A title or a caption holding an equation has no title a reference can print** (equations 2): a
   * reference prints its words as text, and an equation is not words - its words without it would say
   * what the author did not write, "Growth as  rises". So a title form of one fails by name, as of a
   * target with no words, and its number is still its number.
   */
  const published = (target: BoundTarget): BoundTarget => {
    const captioned =
      target.block === null ? undefined : captions.get(blockAnchor(target.node, target.block));
    if (captioned?.caption.some((inline) => inline.type === 'equation')) {
      return { ...target, title: null };
    }
    if (captioned !== undefined) {
      const words = captioned.caption
        .map((inline) => {
          if (inline.type === 'text') return inline.value;
          if (inline.type === 'crossReference') return numberOf(captioned.node, inline);
          return '';
        })
        .join('');
      return { ...target, title: hasText(words) ? words : null };
    }
    const section = target.block === null ? sections.get(target.node) : undefined;
    if (section === undefined) return target;
    const title = textOf(
      section.title,
      (reference) => {
        const resolution = resolutions.get(referenceKey(section.id, reference.id));
        return resolution?.ok === true ? (resolution.target.label ?? '') : '';
      },
      null,
    );
    // A marked title is refused where it stands, and keeps the words resolution read.
    if ('unpublishable' in title && title.unpublishable === 'equation') {
      return { ...target, title: null };
    }
    if (!('runs' in title)) return target;
    const words = titleWords(title.runs);
    return { ...target, title: hasText(words) ? words : null };
  };

  const printed = new Map<string, Printed>();
  const named = new Set<string>();
  const failures: PublishFailure[] = [];
  for (const { node, reference, inTitle, at: where } of found) {
    const key = referenceKey(node, reference.id);
    const resolution = resolutions.get(key)!;
    if (!resolution.ok) {
      failures.push(
        failure(
          'compose',
          'cross_reference_unresolved',
          node,
          reference.id,
          targetNamed(reference.target),
        ),
      );
      continue;
    }
    const target = published(resolution.target);
    const { display } = reference;
    const anchor =
      target.block === null ? nodeAnchor(target.node) : blockAnchor(target.node, target.block);
    const unavailable =
      !printableForms(target).includes(display) ||
      (inTitle && display === 'page') ||
      (display === 'relative' && (above === undefined || below === undefined)) ||
      repeated.has(anchor);
    if (unavailable) {
      failures.push(
        failure('compose', 'cross_reference_form_unavailable', node, reference.id, display),
      );
      continue;
    }
    named.add(anchor);
    // Found by the same walk, so every target resolution reaches has its place.
    const before = positions.get(anchor)! <= where;
    const label = target.label ?? '';
    const title = target.title ?? '';
    const text: Record<Exclude<typeof display, 'page'>, string> = {
      number: label,
      title,
      numberAndTitle: `${label} ${title}`,
      relative: (before ? above : below) ?? '',
    };
    printed.set(
      key,
      display === 'page'
        ? { anchor, text: null, page: true, relative: false }
        : { anchor, text: text[display], page: false, relative: display === 'relative' },
    );
  }
  return { printed, named, failures };
}

/** A stored table, as a footnote's cell anchor resolves against one. */
type TableNode = Extract<BlockNode, { type: 'table' }>;

/**
 * Whether a footnote's anchor to a cell names a cell of the table it stands in (CNT-042, footnotes 2,
 * ruling R5). By position, the grid must hold that row and that column. By key, the table must declare
 * **one** key column and have a row whose key cell's words are the key: a key over several key columns
 * is not yet defined - nothing makes one, and the key-columns slice decides how one is spelt - so it
 * does not resolve rather than being matched by a rule invented here. Standing in no table, neither
 * resolves.
 */
function anchorResolves(
  anchor: Exclude<Extract<InlineNode, { type: 'footnote' }>['anchor'], { kind: 'span' | 'table' }>,
  table: TableNode | null,
): boolean {
  if (table === null) return false;
  const { columns, starts } = gridOf(table);
  if (anchor.kind === 'cellPosition') {
    return anchor.row < table.rows.length && anchor.column < columns;
  }
  const [key, ...others] = table.keyColumns ?? [];
  if (key === undefined || others.length > 0) return false;
  return table.rows.some((row, rowIndex) =>
    row.cells.some((cell, cellIndex) => {
      const start = starts[rowIndex]![cellIndex]!;
      return start <= key && key < start + cell.colspan && wordsOf(cell) === anchor.key;
    }),
  );
}

/** A cell's words: the text of its paragraphs' runs, a footnote's excepted, trimmed. */
function wordsOf(cell: TableNode['rows'][number]['cells'][number]): string {
  return cell.content
    .flatMap((block) => (block.type === 'paragraph' ? block.content : []))
    .map((inline) => (inline.type === 'text' ? inline.value : ''))
    .join('')
    .trim();
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
 * A section title's runs, where it holds nothing but unmarked text and what `reference` and `equation`
 * publish, or **what in it** cannot be published: an inline's node type, or a mark's. A title's words
 * are set again in the contents and the running heads, and a mark there is not yet decided, so a
 * marked title is refused rather than flattened into words the author did not write - and the refusal
 * names what to look for, as a block that cannot be published names its kind.
 *
 * **A cross-reference is words** where `reference` says what it prints (cross-references 2, ruling
 * R6): its number, set among the title's words. **An equation is a run of its own** where `equation`
 * publishes it (equations 2), and nothing where it has already failed by name. Either is null where
 * there is no layout - and for `equation`, where only the title's words are wanted - and then it is
 * what cannot be published, as it always was.
 */
function textOf(
  title: readonly InlineNode[],
  reference: ((inline: ReferenceNode) => string) | null,
  equation:
    ((inline: Extract<InlineNode, { type: 'equation' }>) => PublishedEquation | null) | null,
): { readonly runs: readonly PublishedTitleRun[] } | { readonly unpublishable: string } {
  const runs: PublishedTitleRun[] = [];
  let words = '';
  /** The words met since the last equation, as one run: a title's words carry no mark. */
  const said = () => {
    if (words !== '') runs.push({ text: words, marks: [] });
    words = '';
  };
  for (const inline of title) {
    if (inline.type === 'crossReference' && reference !== null) {
      words += reference(inline);
      continue;
    }
    if (inline.type === 'equation' && equation !== null) {
      said();
      const published = equation(inline);
      if (published !== null) runs.push({ equation: published });
      continue;
    }
    if (inline.type !== 'text') return { unpublishable: inline.type };
    const [mark] = inline.marks;
    if (mark !== undefined) return { unpublishable: mark.type };
    words += inline.value;
  }
  said();
  return { runs };
}

/** A title's words: its runs of text joined, what the glyph check and `publishing/1` read of it. */
function titleWords(runs: readonly PublishedTitleRun[]): string {
  return runs.map((run) => ('text' in run ? run.text : '')).join('');
}
