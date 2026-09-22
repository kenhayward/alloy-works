import {
  admissionLimits,
  createReport,
  forbiddenInPreformatted,
  type ReaderResult,
  type ReportCollector,
} from '@alloy-works/domain';

/** Every spelling of a line break a clipboard carries, as one: CR LF, a lone CR, and U+2028/U+2029. */
export const LINE_BREAK = /\r\n?|\u2028|\u2029/g;

/**
 * Whether a paragraph may not hold this code point: every C0 and C1 control. A tab is not here,
 * because a reader turns it into a space first; a line feed is not here, because a reader has already
 * made it the boundary between two paragraphs.
 */
const forbiddenInParagraph = (codePoint: number) =>
  codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);

/**
 * The text without the characters its block may not hold, and how many there were. The model
 * refuses them rather than dropping them, so a reader that let one through would have the whole
 * paste refused for a character nobody can see - and one it dropped without counting would be the
 * spike's silent loss again.
 */
export function withoutControls(
  text: string,
  into: 'paragraph' | 'preformatted',
): { readonly text: string; readonly removed: number } {
  const forbidden = into === 'paragraph' ? forbiddenInParagraph : forbiddenInPreformatted;
  let removed = 0;
  let kept = '';
  for (const character of text) {
    if (forbidden(character.codePointAt(0)!)) removed += 1;
    else kept += character;
  }
  return { text: kept, removed };
}

/** A reader's refusal of text too long to parse, before it parses any of it. */
export function refuseOversized(text: string): ReaderResult | undefined {
  if (text.length <= admissionLimits.characters) return undefined;
  const report = createReport();
  report.add('read', 'refused', 'oversized');
  return {
    ok: false,
    refusal: 'oversized',
    failure: `The clipboard holds more than ${admissionLimits.characters} characters`,
    report: report.entries,
  };
}

/** Says how many control characters were removed, once, where there were any. */
export function reportControls(report: ReportCollector, removed: number): void {
  if (removed > 0) report.add('read', 'discarded', 'control', { count: removed });
}
