import { escapeXml } from '../content/ooxml/xml.js';
import { DEFINITION_EMS } from '../publishing/measure.js';
import type { PublishedBlock, PublishedList } from '../publishing/published.js';
import { formatCounter, type NumberFormat } from '../structure/scheme.js';

import type { FaceAdvances } from './advances.js';
import { lettersPart, romanPart, WORD_LEVELS } from './numbering.js';

/**
 * **A list as Word numbers it** (Word 2, ruling R4; WO-I): each list, at any depth, a numbering
 * definition of its own - its kind, its format and its start at the level it stands at, `w:ilvl` one
 * deeper for each list it stands in - so that a recipient's Word numbers and bullets it as the PDF
 * does, and renumbers it when they add an item. A definition list has no marker and no definition: its
 * terms and its definitions are paragraphs (the writer's).
 *
 * **Where it stands is the PDF's**, from the engine's defaults, which template 13 leaves as they are,
 * measured in the PDF the worker compiles (Typst 0.15.1, the default theme's 11pt list item, the text
 * block's edge at 72pt):
 *
 * - a marker stands `LIST_INDENT` in from where the list does: a disc at 72.00, a nested list's
 *   circle at 81.35, where the disc's item stands;
 * - an item stands `BODY_INDENT` after its list's widest marker: a disc 3.85 wide and its item at
 *   81.35; "9." and "10." ending together, "10." 13.75 wide and the items at 91.25; "iv." and "v." at
 *   88.09. So each marker ends where the widest does, which Word does by right-justifying its number;
 * - a definition hangs `DEFINITION_EMS` beneath its term: the term at 72.00, its definitions at 94.00.
 *
 * Each width is the marker's advance in the face the list item's style sets it in (`faceAdvances`), as
 * the engine measures it: Word lays a number out at a stop, not by its width, so the writer gives the
 * stop where the engine's marker ends.
 */

/** Typst's `list.indent` and `enum.indent`, which template 13 leaves at the engine's 0pt. */
export const LIST_INDENT = 0;

/** Typst's `body-indent`, which template 13 leaves at the engine's half an em: marker to item. */
export const BODY_INDENT = 0.5;

/** A definition's hang beneath its term, in ems: Typst's `terms.hanging-indent`, the engine's 2em. */
export const DEFINITION_HANG = DEFINITION_EMS;

/**
 * The bullet an unordered list takes, by how many unordered lists it stands in: template 13's disc,
 * circle and square, cycled as the engine cycles them (`main.typ`, `set list(marker: ...)`). The
 * engine counts unordered lists alone: an ordered list between them takes no bullet of the three.
 */
const BULLETS = [0x2022, 0x25e6, 0x25aa].map((codePoint) => String.fromCodePoint(codePoint));

/** A published ordered list's format as the scheme's counters name it, `decimal` where it has none. */
const COUNTERS: Readonly<Record<NonNullable<PublishedList['format']>, NumberFormat>> = {
  decimal: 'decimal',
  alphabetic: 'lowerAlpha',
  roman: 'lowerRoman',
};

/** The same, as `ST_NumberFormat` spells it. */
const WORD_LIST_FORMATS: Readonly<Record<NonNullable<PublishedList['format']>, string>> = {
  decimal: 'decimal',
  alphabetic: 'lowerLetter',
  roman: 'lowerRoman',
};

/** A list Word numbers, and where it and its items stand. */
export interface WordList {
  /** Its `w:numId` and `w:abstractNumId`, one number for both. */
  readonly id: number;
  /** The level it stands at: how many lists it stands in. */
  readonly level: number;
  readonly kind: 'ordered' | 'unordered';
  readonly format: NonNullable<PublishedList['format']>;
  readonly start: number;
  /** How many unordered lists it stands in, which its bullet is chosen by. */
  readonly bullets: number;
  /** Where its markers end, in points from the text block's start edge. */
  readonly marker: number;
  /** From one marker's end to the next level's: the widest marker's width and the body indent. */
  readonly step: number;
  /** Between a marker's end and its item, in points. */
  readonly gap: number;
  /** The run properties its markers are set with: the list item style's face, weight and size. */
  readonly markerProperties: string;
}

/** What a marker of this list prints: its number and a full stop, or its bullet. */
function markerText(
  kind: WordList['kind'],
  format: WordList['format'],
  counter: number,
  bullets: number,
) {
  return kind === 'unordered'
    ? BULLETS[((bullets % BULLETS.length) + BULLETS.length) % BULLETS.length]!
    : `${formatCounter(counter, COUNTERS[format])}.`;
}

/**
 * How wide the widest marker of a list is, in points: each item's number, or its bullet, as `face`
 * sets it at `size` - the engine's column of markers, which its items stand after.
 */
export function markerWidth(
  list: PublishedList,
  bullets: number,
  face: FaceAdvances,
  size: number,
): number {
  if (list.kind === 'definition') return 0;
  const format = list.format ?? 'decimal';
  const start = list.start ?? 1;
  let widest = 0;
  for (let index = 0; index < list.items.length; index += 1) {
    const text = markerText(list.kind, format, start + index, bullets);
    widest = Math.max(widest, face.width(text) * size);
  }
  return widest;
}

/** A list Word would not print as the PDF does, and why: `list_not_in_word`'s `detail`. */
export interface ListNotInWord {
  readonly block: string;
  readonly detail: 'depth' | 'letters' | 'roman';
}

/**
 * **What of a node's lists Word would not print as the PDF does** (Word 2, ruling R4), asked by
 * `assemble` where Word is asked for, of the blocks it publishes:
 *
 * - `depth`: a list at the tenth level, where Word has none (WO-I). Its levels are the lists it stands
 *   in, through items and quotations; a table's cell is a place of its own, whose lists begin again at
 *   the first, as the writer numbers them. Said of the tenth alone, not of the lists inside it;
 * - `letters` and `roman`: an ordered list whose numbers run past what Word writes as the PDF does -
 *   a letter past the 27th, which Word doubles (`bb` where the PDF has `ab`), or a roman numeral past
 *   3999 - as a heading's number is judged.
 */
export function listsNotInWord(blocks: readonly PublishedBlock[]): ListNotInWord[] {
  const found: ListNotInWord[] = [];
  const walk = (each: readonly PublishedBlock[], level: number) => {
    for (const block of each) {
      if (block.type === 'list') {
        if (level === WORD_LEVELS) {
          found.push({ block: block.id, detail: 'depth' });
          continue;
        }
        if (block.kind === 'ordered') {
          const format = COUNTERS[block.format ?? 'decimal'];
          const last = (block.start ?? 1) + block.items.length - 1;
          if (lettersPart(format, last)) found.push({ block: block.id, detail: 'letters' });
          if (romanPart(format, last)) found.push({ block: block.id, detail: 'roman' });
        }
        for (const item of block.items) walk(item.blocks, level + 1);
      } else if (block.type === 'blockquote') {
        walk(block.blocks, level);
      } else if (block.type === 'table') {
        for (const row of block.rows) for (const cell of row.cells) walk(cell.blocks, 0);
      }
    }
  };
  walk(blocks, 0);
  return found;
}

const twips = (points: number) => Math.round(points * 20);

/**
 * A list's definition and its `w:num`, in `CT_Numbering`'s order, as two strings the numbering part
 * gathers apart (every `w:abstractNum` before every `w:num`). Nine levels, Word's all, so a recipient
 * can move an item in or out: the list's own at its level, and at each other the same kind - the
 * bullet for that depth, the same format counted from 1 - a step further in or out, never past the
 * text block's edge.
 */
export function listNumberingXml(list: WordList): { abstract: string; num: string } {
  const levels = Array.from({ length: WORD_LEVELS }, (_, ilvl) => {
    const marker = Math.max(0, list.marker + (ilvl - list.level) * list.step);
    const text =
      list.kind === 'unordered'
        ? markerText('unordered', list.format, 0, list.bullets + ilvl - list.level)
        : `%${ilvl + 1}.`;
    return (
      `<w:lvl w:ilvl="${ilvl}">` +
      `<w:start w:val="${ilvl === list.level ? list.start : 1}"/>` +
      `<w:numFmt w:val="${list.kind === 'unordered' ? 'bullet' : WORD_LIST_FORMATS[list.format]}"/>` +
      `<w:lvlText w:val="${escapeXml(text)}"/>` +
      '<w:lvlJc w:val="right"/>' +
      `<w:pPr><w:ind w:left="${twips(marker + list.gap)}" w:hanging="${twips(list.gap)}"/></w:pPr>` +
      `<w:rPr>${list.markerProperties}</w:rPr>` +
      '</w:lvl>'
    );
  });
  return {
    abstract:
      `<w:abstractNum w:abstractNumId="${list.id}">` +
      `<w:multiLevelType w:val="multilevel"/>${levels.join('')}</w:abstractNum>`,
    num: `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${list.id}"/></w:num>`,
  };
}
