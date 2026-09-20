import { z } from 'zod';

import { canonicalJson } from '../../stored/canonical.js';

import { blockNodeSchema, footnoteContentSchema, type BlockNode } from './blocks.js';
import { marksAsASet } from './canonical.js';
import type { InlineNode } from './inline.js';
import type { Mark } from './marks.js';

export const CURRENT_SCHEMA_VERSION = 1;

const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

/**
 * The root, and its members are closed (CNT-146). The component's identifier belongs to the artifact
 * rather than to its content; everything else a component carries whatever its type is here.
 */
export const contentDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1),
  language: bcp47,
  direction: z.enum(['ltr', 'rtl']),
  content: z.array(blockNodeSchema).min(1),
});

export type ContentDocument = z.infer<typeof contentDocumentSchema>;

/**
 * Refuses an identifier not already in NFC. The canonical form writes every string in NFC, so two
 * spellings of one identifier - composed and decomposed - would pass a comparison of raw strings as
 * two and be stored and digested as one; and a reference spelled one way would resolve where the
 * other would not. Refused rather than normalised: the caller stores exactly what the digest covers.
 */
function refuseUnnormalised(identifier: string, what: string): void {
  if (identifier !== identifier.normalize('NFC')) {
    throw new Error(`${what} ${identifier} is not in NFC`);
  }
}

/**
 * Adds an identifier to those already held, refusing one already there (CNT-002), or one not in NFC,
 * which the stored form would fold into another.
 */
function claim(id: string, seen: Set<string>): void {
  refuseUnnormalised(id, 'Identifier');
  if (seen.has(id)) throw new Error(`Identifier ${id} is used more than once in this component`);
  seen.add(id);
}

/**
 * What one scope has claimed so far: the identifiers taken, the value each mark identifier stands
 * for, and the mark identifiers the **last text run the walk returned** carried, which is what
 * `claimRange` reads to tell one annotation from two. A component is one scope and a section title
 * is another, because a title is in no component and is reached through its node as a block is
 * through its occurrence.
 */
export interface Claimed {
  readonly ids: Set<string>;
  readonly marks: Map<string, string>;
  readonly carried: Set<string>;
}

/** A fresh scope. The three parts are always made together, so nothing can thread one without the others. */
export function newScope(): Claimed {
  return { ids: new Set(), marks: new Map(), carried: new Set() };
}

/**
 * An identifier names one annotation (CNT-004), so within one scope it carries exactly one value -
 * one kind and one set of attributes. A `language` mark `m1` reading `fr-FR` on one run and `de-DE`
 * on another is two annotations wearing one identifier, and CNT-005 makes accepting, rejecting or
 * excluding an annotation one operation over every fragment of that identifier - which cannot mean
 * anything when the identifier names two. The same argument refuses one identifier worn by two
 * **kinds** of mark, for which no case has been made that it should be allowed: an identifier that
 * is both an emphasis and a comment names two annotations as surely as two tags do. Refusing is
 * also the reversible direction. Nothing has stored a mark, so refusing costs nothing now, and
 * admitting more later needs no migration, while admitting it now could never be tightened.
 *
 * The value compared is the mark's canonical form, the same string the digest is taken over, so two
 * marks the stored form cannot tell apart are one annotation here too. The identifier is keyed in
 * NFC for the same reason: the canonical form folds the two spellings into one, so comparing raw
 * strings would let one identifier past as two.
 *
 * The message names the identifier and says what is wrong with it, and carries no word of the
 * author's text, which a caller may log or hand back.
 */
function claimMark(mark: Mark, claimed: Claimed): void {
  const value = canonicalJson(mark);
  const held = claimed.marks.get(mark.id.normalize('NFC'));
  if (held === undefined) {
    claimed.marks.set(mark.id.normalize('NFC'), value);
    return;
  }
  if (held !== value) {
    throw new Error(`Mark identifier ${mark.id} carries two different values in one document`);
  }
}

/**
 * **The runs carrying one mark identifier are contiguous.** `claimMark` makes an identifier name one
 * annotation by value; this makes it name one *place*. Once an identifier has appeared and a later
 * text run does not carry it, it may not appear again in the scope: an emphasis over `alp`, nothing
 * over `ha beta g`, and the same identifier again over `amma` is one annotation in two visually
 * separate pieces, and CNT-005 makes accepting, rejecting or excluding an annotation one operation
 * over every fragment of that identifier - so that one would change the document in two places an
 * author never joined, which is a surprise no wording of a prompt can undo. The editor reaches it by
 * the shortest route there is: mark a phrase, then press the same button over a word in the middle.
 *
 * Refusing costs an annotation that legitimately covers two disjoint ranges, and no such case could
 * be constructed. Refusing is also the reversible direction: nothing has stored a mark, so admitting
 * more later needs no migration, while admitting it now could never be tightened.
 *
 * **Only a text run closes an identifier.** The editor is written to the same predicate - `spansOf`
 * in `packages/editor/src/marks.ts` joins two runs when the text between them is empty - and holds
 * it **after every transaction**, in `annotationsInOnePiece` (`packages/editor/src/state.ts`), which
 * renames the later pieces of an annotation left in two, whatever split it. It is a plugin rather
 * than a rule inside each command because the gestures that split an annotation are not all
 * commands: typing one character at the end of a `language` run is not, and the mark is not
 * inclusive, so the typed run carries no mark and stands between two pieces of one annotation. So an
 * editing session cannot reach this refusal **within a mark type**. What it still stands between a
 * version and is content from somewhere else - another producer, a future import - and two cases the
 * plugin's scope leaves out on purpose: one identifier worn by two **kinds** of mark, which
 * `claimMark` answers instead and no command can mint, and a document handed to `createEditorState`
 * already in two pieces, which nothing produces and which stays that way until the first edit.
 *
 * The predicate itself, on both sides:
 *
 * - **A run split by an edit** is four adjacent runs of one annotation, differing only in their
 *   other marks (CNT-004). Each carries the identifier, so none closes it.
 * - **A block boundary is not a run.** An annotation running from the end of one paragraph into the
 *   start of the next is one annotation, and an empty paragraph between them has no runs at all.
 * - **A node that is not a run carries no marks**, so an equation or a cross-reference inside an
 *   emphasised phrase must not close it. Only a text run without the identifier does.
 *
 * A footnote's inline content is its own range (`checkInlineContent` empties `carried` for it and
 * puts back what stood outside). Two sides of it: a footnote anchor standing inside an annotation
 * never breaks it, because its words are not in the flow of the sentence the annotation covers and a
 * reader sees no gap; and an identifier in the main text is not the identifier inside the note,
 * because those are two regions a reader would have to resolve in two places, which is the very
 * thing this rule exists to refuse.
 *
 * **Judged on what the walk returned, never on what arrived** - the trap `refuseAdjacentEmpties`
 * paid for. An empty run between two fragments of one annotation is dropped by `mergeRuns`, so a
 * rule reading adjacency off the input would refuse a document the parse itself makes contiguous;
 * and conversely, a document accepted at a save and refused on read-back is a 500 for an author
 * whose work could never become a version. So this runs over `mergeRuns`' output, with the rest of
 * the walk.
 *
 * The message names the identifier and says what is wrong with it, and carries no word of the
 * author's text, which a caller may log or hand back.
 */
function claimRange(mark: Mark, claimed: Claimed): void {
  const id = mark.id.normalize('NFC');
  if (claimed.marks.has(id) && !claimed.carried.has(id)) {
    throw new Error(`Mark identifier ${mark.id} covers two separate ranges in one document`);
  }
}

/**
 * Two adjacent empty paragraphs are spacing, which CNT-023 makes unrepresentable; one is where a
 * cursor stands (CNT-124). Held in every sequence of blocks the model has - the top level, a list
 * item, a blockquote, a table cell and a footnote - because admission's normalise collapses them in
 * every one, and a rule the two write paths disagree on is a rule one of them breaks.
 *
 * **Judged on what the walk returned, never on what arrived.** A paragraph holding one empty run is
 * an empty paragraph once the inline walk has dropped that run (issue #154), so reading adjacency
 * off the input would accept two of them, store them as two empty paragraphs, and then refuse the
 * same document on read-back - a 500 for an author whose work could never become a version. The
 * parse owes every caller one invariant: what it accepts, it accepts again unchanged.
 */
function refuseAdjacentEmpties(blocks: readonly BlockNode[]): void {
  const isEmptyParagraph = (block: BlockNode | undefined) =>
    block?.type === 'paragraph' && block.content.length === 0;
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    if (previous && current && isEmptyParagraph(previous) && isEmptyParagraph(current)) {
      throw new Error(`Blocks ${previous.id} and ${current.id} are adjacent empty paragraphs`);
    }
  }
}

/**
 * The mark set of a run as the canonical form writes it, which is what "identical marks" means
 * (issue #154). Marks are a set (CNT-003), so `[emphasis, language]` and `[language, emphasis]` are
 * one value: the comparison goes through `marksAsASet`, the rule the digest already sorts by, and
 * then through `canonicalJson`, which compares every member of every mark - a mark's identifier
 * included. So two runs merge only where the digest already calls their marks one value, and a merge
 * can never fold two marks the stored form keeps apart.
 */
function markSetOf(run: { marks: readonly unknown[] }): string {
  return canonicalJson({ marks: run.marks }, marksAsASet);
}

/**
 * The canonical form of a sequence of inline nodes (issue #154): one visible text carrying one set of
 * marks is one run, so it has one stored spelling and one digest.
 *
 * - **A run with no text is dropped.** `{ value: '' }` is storable and shows nothing, so a paragraph
 *   holding one is a second spelling of the paragraph without it - and the editor's own save path
 *   drops it, which would change a digest with no author change. A paragraph left with no runs keeps
 *   `content: []`, which CNT-124 admits.
 * - **Two adjacent runs whose mark sets are equal become one**, their values joined in order. No
 *   identifier "wins": the two sets are the same value, so the merged run keeps the first run's array
 *   as it stands. Runs differing **only** by a mark's identifier are two annotations (CNT-004) and
 *   stay apart.
 * - **Only runs merge.** Anything else inline - an equation, a footnote, a cross-reference - ends a
 *   run, because it is visible text between them.
 * - **A run's value is put in NFC** (CNT-056), on the way in and again after a join. Two NFC strings
 *   joined need not be one: `'Cafe'` and `'\u{301} au lait'` are each in NFC and their join is not,
 *   so without this the merge would write a spelling the digest does not cover - one digest and two
 *   stored spellings, which is the defect this function exists to close, by another door. Text is
 *   normalised rather than refused, unlike an identifier (`refuseUnnormalised`): an identifier is
 *   compared and resolved by exact string, so folding one would change what it names, while a run's
 *   value is prose the digest already reads in NFC. Normalising also refuses nothing that was
 *   accepted before, which a stored shape at this point in its life may not do.
 *
 * Empty runs go first, so two runs one stood between still meet.
 */
function mergeRuns(inlines: readonly InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  let previousMarks: string | undefined;
  for (const inline of inlines) {
    if (inline.type !== 'text') {
      merged.push(inline);
      previousMarks = undefined;
      continue;
    }
    const value = inline.value.normalize('NFC');
    if (value === '') continue;
    const marks = markSetOf(inline);
    const previous = merged[merged.length - 1];
    if (previous?.type === 'text' && previousMarks === marks) {
      merged[merged.length - 1] = { ...previous, value: (previous.value + value).normalize('NFC') };
      continue;
    }
    merged.push(value === inline.value ? inline : { ...inline, value });
    previousMarks = marks;
  }
  return merged;
}

/**
 * The rules inline content is held to wherever it is stored, in one walk. The walk cannot live in
 * `inline.ts`, because a footnote holds blocks and a block holds inlines - so one of the two files
 * has to learn about the other after the fact, and this is that place.
 *
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here. Those
 *   paragraphs hold nothing outside CNT-129's closed list: no image, and no footnote - so the walk
 *   descends one footnote deep and no further, whatever it is given.
 * - **Every identifier inside is claimed in the scope** - a footnote's own, each of its paragraphs', and
 *   a cross-reference's - so none can share one with a block or with anything else in what holds it
 *   (CNT-002, issue #122). A cross-reference targets a footnote by identity (STR-026), so one it
 *   shared would name two things. Each is in NFC, and so is the block a target names, because the
 *   stored form is.
 * - **A cross-reference targets only what its home can reach.** In a component, never an outline
 *   node: a node belongs to one document's outline, and a component is used in many. In a section
 *   title, an outline node alone: a title is in no component, and an outline is answered with a
 *   component the reader may not read withheld, which a title's reference would carry past.
 * - **A reference in a section title shows a number or a page, and nothing that could be a title.**
 *   Resolving a title that shows a title resolves that title, so a node naming itself, or two titles
 *   naming each other, would never finish. The `withoutPages` form a page reference falls back to is
 *   held to the same rule, and so is `relative`, which says nothing a heading needs. Widening this
 *   later, once resolution can refuse a cycle by name, changes nothing stored.
 *
 * **Returns the inlines as parsed** (issue #124): a footnote's content arrives unparsed, because the
 * inline schema cannot name a paragraph, so the walk hands back each footnote with its parsed
 * paragraphs in place of what arrived - their `style`, and their runs' `marks`, filled in as the
 * parse fills them in everywhere else. What is stored and digested is what is returned, so two
 * spellings of one footnote are one value, one canonical string and one digest. Everything else is
 * returned as it was given, already parsed by the schema that reached it.
 *
 * - **A mark identifier carries one value in the scope** (`claimMark`): an annotation fragmented
 *   across runs stays one annotation under one identifier (CNT-004), so the same identifier reading
 *   two ways is refused by name. A run carrying no text is dropped before this, so a mark on one
 *   claims nothing - it is not stored, so there is nothing for it to disagree with.
 * - **And it covers one range in the scope** (`claimRange`): an identifier that appears, stops and
 *   appears again is two separated pieces answering to one name, which CNT-005 would resolve
 *   together although the author sees two. Only a text run without the identifier ends it, so a
 *   block boundary, an empty paragraph and a node that is not a run are all transparent, and a
 *   footnote's content is a range of its own.
 *
 * **And the runs come back merged** (`mergeRuns`, issue #154), which is the same rule reaching the
 * other way: one visible text carrying one set of marks is one run. The merge is here rather than in
 * `canonicalise`, which returns a string and so would leave the stored spelling split while only the
 * digest agreed - and would miss a section title altogether, whose canonical form the outline
 * composes itself. Every inline home this walk reaches is covered by putting it here: a paragraph's
 * content, a blockquote's attribution, a table's note, a footnote's paragraphs and a section title.
 *
 * Exported because inline content is stored in more than one place: a section title in an outline
 * is inline content too (structure.md), and runs this same walk rather than a copy of it, so one rule
 * governs inline content wherever it is stored. Throws on the first breach.
 */
export function checkInlineContent(
  inlines: readonly InlineNode[],
  home: InlineHome,
  claimed: Claimed,
): InlineNode[] {
  return mergeRuns(inlines).map((inline) => {
    if (inline.type === 'text') {
      // The identifiers this one run carries, which `claimRange` is asked about once each: a second
      // mark of one run wearing an identifier the first already wore is not a second range - there
      // is one run and no gap - and `claimMark` has the accurate answer for it, that one identifier
      // cannot carry two values. A caller hands that message back as a failure, so which of the two
      // rules answers decides what an author is told.
      const own = new Set<string>();
      for (const mark of inline.marks) {
        const id = mark.id.normalize('NFC');
        if (!own.has(id)) claimRange(mark, claimed);
        own.add(id);
        claimMark(mark, claimed);
      }
      claimed.carried.clear();
      for (const id of own) claimed.carried.add(id);
      return inline;
    }
    if (inline.type === 'crossReference') {
      claim(inline.id, claimed.ids);
      if (inline.target.kind !== 'node') refuseUnnormalised(inline.target.block, 'Target');
      if (home === 'component' && inline.target.kind === 'node') {
        throw new Error(`Cross-reference ${inline.id} in a component targets an outline node`);
      }
      if (home === 'title' && inline.target.kind !== 'node') {
        throw new Error(`Cross-reference ${inline.id} in a title targets what a title cannot name`);
      }
      if (home === 'title' && !shownInATitle(inline)) {
        throw new Error(`Cross-reference ${inline.id} in a title shows what could name a title`);
      }
    }
    if (inline.type !== 'footnote') return inline;
    claim(inline.id, claimed.ids);
    const parsed = footnoteContentSchema.parse(inline.content);
    // A footnote's paragraphs are a range of their own (`claimRange`): nothing inside continues an
    // annotation from outside, and nothing outside continues one from inside - while the anchor
    // itself, being no run, leaves an annotation it stands in untouched.
    const outside = [...claimed.carried];
    claimed.carried.clear();
    const paragraphs = parsed.map((paragraph) => {
      claim(paragraph.id, claimed.ids);
      for (const inner of paragraph.content) {
        if (inner.type === 'image' || inner.type === 'footnote') {
          throw new Error(`Footnote ${inline.id} holds a node a footnote may not: ${inner.type}`);
        }
      }
      return { ...paragraph, content: checkInlineContent(paragraph.content, home, claimed) };
    });
    refuseAdjacentEmpties(paragraphs);
    claimed.carried.clear();
    for (const id of outside) claimed.carried.add(id);
    return { ...inline, content: paragraphs };
  });
}

/**
 * The block half of the walk: claims every block's identifier, runs `checkInlineContent` over every
 * inline home a block has - a paragraph's content, a blockquote's attribution, a table's note - and
 * rebuilds each block from what it returns, so what is stored is the parsed form all the way down.
 */
function checkBlocks(blocks: readonly BlockNode[], claimed: Claimed): BlockNode[] {
  const checked = blocks.map((block) => checkBlock(block, claimed));
  refuseAdjacentEmpties(checked);
  return checked;
}

function checkBlock(block: BlockNode, claimed: Claimed): BlockNode {
  claim(block.id, claimed.ids);
  switch (block.type) {
    case 'paragraph':
      return { ...block, content: checkInlineContent(block.content, 'component', claimed) };
    case 'list':
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          content: checkBlocks(item.content, claimed),
        })),
      };
    case 'blockquote': {
      const attribution =
        block.attribution && checkInlineContent(block.attribution, 'component', claimed);
      return {
        ...block,
        ...(attribution === undefined ? {} : { attribution }),
        content: checkBlocks(block.content, claimed),
      };
    }
    case 'table': {
      const note = block.note && checkInlineContent(block.note, 'component', claimed);
      return {
        ...block,
        ...(note === undefined ? {} : { note }),
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: checkBlocks(cell.content, claimed),
          })),
        })),
      };
    }
    default:
      return block;
  }
}

/** Whether a reference shows only what cannot contain a title: a number, or a page falling back to one. */
function shownInATitle(reference: { display: string; withoutPages?: string | undefined }): boolean {
  if (reference.display === 'number') return true;
  return (
    reference.display === 'page' &&
    (reference.withoutPages === undefined || reference.withoutPages === 'number')
  );
}

/** Where inline content is stored, which decides what a cross-reference in it may target. */
export type InlineHome = 'component' | 'title';

/**
 * The one entry point. Validates on creation, on change and on read-back (CNT-010); nothing else
 * constructs a document.
 *
 * Seven rules the schema cannot express on its own, because each is about a document rather than a
 * node: identifiers are unique within the component (CNT-002), two adjacent empty paragraphs are
 * refused (CNT-023), a footnote's content is a restricted block sequence (CNT-129), a
 * cross-reference in a component never targets an outline node, a mark identifier carries one value
 * (CNT-004) over one contiguous range of runs, and a sequence of inline content comes back with its
 * runs merged (issue #154). One walk holds all seven: the block
 * half here, and `checkInlineContent` for inline content, sharing one set of claimed identifiers, with
 * adjacency held in every sequence of blocks either half reaches, a footnote's among them, **over
 * what that sequence became** rather than over what arrived. A single empty paragraph is admitted,
 * because CNT-124 requires a new component to be one. What is returned is what the walk parsed, and
 * nothing else - and parsing that again returns it unchanged, which is the invariant every caller
 * here relies on, because the service parses a request body and `packages/db` parses it again.
 */
export function parseContentDocument(value: unknown): ContentDocument {
  const parsed = contentDocumentSchema.parse(value);
  return { ...parsed, content: checkBlocks(parsed.content, newScope()) };
}
