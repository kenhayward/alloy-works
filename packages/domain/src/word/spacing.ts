/**
 * **The space between two paragraphs, as the PDF puts it, in Word** (Word 2, ruling R6; measured, M1).
 * Word 1 set every Word publication's spaces adding (`w:doNotUseHTMLParagraphAutoSpacing`), and there
 * Word's contextual spacing is per paragraph and per side: a paragraph whose style asks for it drops
 * its own space on the side facing a paragraph of its own style, and nothing else. That is template
 * 13's rule within one flow, and so Word's own reading of the styles is the PDF's everywhere but where
 * a container decides otherwise - two quotations in a row, which the PDF sets apart by both their
 * spaces where Word would close them up; a list's items, which the PDF stands a line apart where the
 * style would space them; the lines of preformatted text, which the PDF sets as one paragraph. There,
 * the writer says what the PDF puts on each side (`wanted`), and this states over the style only what
 * Word would otherwise read differently: M1's d8 - contextual spacing off, and the space it would
 * have dropped dropped by hand - and a space the style would add, dropped.
 */

/** A paragraph as this reads it: its Word style, that style's spaces, and what the PDF wants. */
export interface SpacedParagraph {
  /** Its Word style's identifier: what Word asks whether two neighbours share. */
  readonly style: string;
  /** Its style's spaces in points, and whether it asks for contextual spacing. */
  readonly own: { readonly before: number; readonly after: number; readonly contextual: boolean };
  /** The space the PDF puts on each side, in points, where a container decides it. */
  readonly wanted: { readonly before?: number; readonly after?: number };
}

/** What a paragraph states over its style: a space, or contextual spacing turned off. */
export interface SpacingOverride {
  readonly before?: number;
  readonly after?: number;
  readonly contextual?: false;
}

/** Word's lengths are twentieths of a point, and two that round alike are one. */
const alike = (a: number, b: number) => Math.round(a * 20) === Math.round(b * 20);

/** What each paragraph, in order, states over its style for Word to space it as the PDF does. */
export function spacingOverrides(paragraphs: readonly SpacedParagraph[]): SpacingOverride[] {
  return paragraphs.map((paragraph, index) => {
    const { own, wanted } = paragraph;
    const afterOwn = paragraphs[index - 1]?.style === paragraph.style;
    const beforeOwn = paragraphs[index + 1]?.style === paragraph.style;
    // What Word sets of the style alone, on each side.
    const before = own.contextual && afterOwn ? 0 : own.before;
    const after = own.contextual && beforeOwn ? 0 : own.after;
    const wantBefore = wanted.before ?? before;
    const wantAfter = wanted.after ?? after;
    if (alike(wantBefore, before) && alike(wantAfter, after)) return {};
    // Contextual spacing stays where it drops only what the PDF drops too; off, each side is stated.
    const off =
      own.contextual &&
      ((afterOwn && !alike(wantBefore, 0)) || (beforeOwn && !alike(wantAfter, 0)));
    const dropsBefore = own.contextual && !off && afterOwn;
    const dropsAfter = own.contextual && !off && beforeOwn;
    return {
      ...(dropsBefore || alike(wantBefore, own.before) ? {} : { before: wantBefore }),
      ...(dropsAfter || alike(wantAfter, own.after) ? {} : { after: wantAfter }),
      ...(off ? { contextual: false as const } : {}),
    };
  });
}
