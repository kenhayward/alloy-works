import { describe, expect, it } from 'vitest';

import {
  PAGINATION_BOUND,
  PROJECTED_CHARACTER_PROPERTIES,
  PROJECTED_PARAGRAPH_PROPERTIES,
  projectCss,
} from './css.js';
import { characterPropertiesSchema, paragraphBaseSchema } from './schema.js';
import { defaultInputs, resolved } from './theme.fixture.js';

/** The editor's projection. It translates resolved styles and decides nothing. */
const css = projectCss(resolved());

/** A rule's selector list, split at its own commas and never at one inside `:is(..)` or `:has(..)`. */
function selectorsOf(line: string): string[] {
  const list = line.slice(0, line.indexOf(' { '));
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    if (list[at] === '(') depth += 1;
    else if (list[at] === ')') depth -= 1;
    else if (list[at] === ',' && depth === 0) {
      selectors.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  return [...selectors, list.slice(start).trim()];
}

/** Every rule whose selector list includes `selector`, in order, as its declarations. */
function rulesFor(text: string, selector: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.includes(' { ') && selectorsOf(line).includes(selector))
    .map((rule) => rule.slice(rule.indexOf(' { ') + 3, -3));
}

/** The declarations of the first rule whose selector list includes `selector`. */
function ruleFor(text: string, selector: string): string {
  const [rule] = rulesFor(text, selector);
  if (rule === undefined) throw new Error(`No rule for ${selector}`);
  return rule;
}

const z = (points: string) => `calc(${points}pt * var(--aw-zoom))`;
const NONE = z('0');
/** A mark's own element, and the element its text is set in inside it (issue #331). */
const RUN = '.aw-canvas.aw-canvas .aw-mark-';
const TEXT = ' > .aw-mark-below > .aw-mark-run';

/**
 * The default theme with a style an author may choose that states every paragraph property at a value
 * no default holds, and marks that state every character property.
 */
function everyProperty() {
  const inputs = defaultInputs();
  inputs.catalogues.paragraph.styles.push({
    id: 'panel',
    name: 'Panel',
    appliesTo: ['text'],
    properties: {
      typeface: 'mono',
      size: 12,
      bold: true,
      italic: true,
      colour: '#1a2b3c',
      background: '#f0f0f0',
      padding: 4,
      alignment: 'justify',
      firstLineIndent: 9,
      startIndent: 18,
      endIndent: 6,
      spaceBefore: 5,
      spaceAfter: 7,
      lineSpacing: 16,
      contextualSpacing: true,
    },
  });
  const character = inputs.catalogues.character.styles.find((style) => style.mark === 'strong')!;
  character.properties = {
    bold: false,
    italic: true,
    underline: true,
    colour: '#223344',
    typeface: 'mono',
    position: 'superscript',
    scale: 0.8,
  };
  return projectCss(resolved(inputs));
}

describe('projectCss', () => {
  it('STY-058 writes every declared paragraph and character property as the theme declares it, and none is left out but the pagination-bound', () => {
    // Every property the schema has is either written or bound to pagination: a property added to the
    // schema and to neither list fails here, so the projection cannot stop at a sample again.
    expect([...PROJECTED_PARAGRAPH_PROPERTIES, ...PAGINATION_BOUND].sort()).toEqual(
      Object.keys(paragraphBaseSchema.shape).sort(),
    );
    expect([...PROJECTED_CHARACTER_PROPERTIES].sort()).toEqual(
      Object.keys(characterPropertiesSchema.shape).sort(),
    );

    // And each is written at the value the theme declares. Panel: Liberation Mono at 12pt on 16pt,
    // whose half-leading is (16 - (1705 + 615) / 2048 x 12) / 2 = 1.203pt.
    const text = everyProperty();
    const panel = ruleFor(text, '.aw-canvas.aw-canvas [data-style="panel"]');
    expect(panel.split('; ')).toEqual([
      'font-family: "aw-face-mono"',
      `font-size: ${z('12')}`,
      'font-weight: 700',
      'font-style: italic',
      'color: #1a2b3c',
      `--aw-before: ${z('5')}`,
      `--aw-after: ${z('7')}`,
      `--aw-leading: ${z('4')}`,
      // What a line of it is, for what stands in one to be measured against (issue #331).
      '--aw-face: "aw-face-mono"',
      `--aw-size: ${z('12')}`,
      '--aw-weight: 700',
      '--aw-posture: italic',
      `--aw-line: ${z('16')}`,
      '--aw-descent: 0.30029',
      `--aw-top: ${z('8.396')}`,
      `--aw-run: ${z('12')}`,
      '--aw-run-face: "aw-face-mono"',
      '--aw-run-weight: 700',
      '--aw-run-posture: italic',
      // Its fill between its spaces: the padding box less the space above and below it.
      '--aw-fill: #f0f0f0',
      'background-color: transparent',
      'background-image: linear-gradient(var(--aw-fill), var(--aw-fill))',
      'background-repeat: no-repeat',
      `background-position: 0 calc(var(--aw-before) - var(--aw-lift, ${NONE}))`,
      `background-size: 100% calc(100% - var(--aw-before) - var(--aw-after) + var(--aw-lift, ${NONE}))`,
      'text-align: justify',
      `text-indent: ${z('9')}`,
      `margin-inline: ${z('18')} ${z('6')}`,
      'border: 0',
      `margin-block: 0 ${z('-1.203')}`,
      // Its space before, its half-leading and its padding inside its fill above its first line; its
      // padding and its space after below its last.
      `padding-block: calc(var(--aw-before) + ${z('5.203')}) calc(${z('4')} + var(--aw-after))`,
      `padding-inline: ${z('4')}`,
      `line-height: ${z('16')}`,
    ]);
    // Contextual spacing: two neighbours in Panel lose the space between them, and only that.
    expect(text).toContain(
      '.aw-canvas.aw-canvas [data-style="panel"] + [data-style="panel"]:not([data-language]) ' +
        `{ --aw-before: ${NONE}; }`,
    );
    expect(text).toContain(
      '.aw-canvas.aw-canvas [data-style="panel"]:has(+ [data-style="panel"]:not([data-language])) ' +
        `{ --aw-after: ${NONE}; }`,
    );

    // Strong, restated: every character property, the script's size its scale times 1331/2048.
    expect(ruleFor(text, `${RUN}strong${TEXT}`).split('; ')).toEqual([
      'font-weight: 400',
      '--aw-run-weight: 400',
      'font-style: italic',
      '--aw-run-posture: italic',
      'text-decoration-line: underline',
      'color: #223344',
      'font-family: "aw-face-mono"',
      '--aw-run-face: "aw-face-mono"',
      'font-size: calc(var(--aw-around) * 0.52)',
      '--aw-run: 1em',
      'line-height: 0',
      'vertical-align: super',
      'position: relative',
      'top: calc(-1 * var(--aw-down))',
    ]);
    // And the line it stands in is grown by its scale, not the script's size: 0.8 grows nothing.
    expect(ruleFor(text, `${RUN}strong`)).toContain(
      `--aw-grow: max(${NONE}, calc(var(--aw-run) * 0.8 - var(--aw-size)))`,
    );
  });

  it('fills a block with no spaces of its own as a colour, which an accessibility checker can read, and one with spaces between them', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles.push({
      id: 'boxed',
      name: 'Boxed',
      appliesTo: ['text'],
      properties: { background: '#eeeeee', padding: 3, spaceBefore: 0, spaceAfter: 0 },
    });
    const text = projectCss(resolved(inputs));
    const boxed = ruleFor(text, '.aw-canvas.aw-canvas [data-style="boxed"]');
    expect(boxed).toContain('--aw-fill: #eeeeee; background: #eeeeee');
    expect(boxed).not.toContain('linear-gradient');
  });

  it("paints a list's first and last items' fills between the list's spaces, a spaceless filled style's too, and never an ancestor's fill in an unfilled one", () => {
    // Boxed has no spaces of its own, so it fills as a colour; as a list's last item it is given the
    // list's space after, which the PDF leaves unfilled: its colour stands down there, and the fill is
    // painted between the spaces instead.
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles.push({
      id: 'boxed',
      name: 'Boxed',
      appliesTo: ['text', 'listItem'],
      properties: { background: '#eeeeee', padding: 3, spaceBefore: 0, spaceAfter: 0 },
    });
    const text = projectCss(resolved(inputs));
    const ends = '.aw-canvas.aw-canvas :is(ul, ol) > li:first-child > [data-style]:first-child';
    const rule = rulesFor(
      text,
      '.aw-canvas.aw-canvas :is(ul, ol) > li:last-child > [data-style]:last-child',
    ).find((each) => each.includes('linear-gradient'));
    expect(rule?.split('; ')).toEqual([
      'background-color: transparent',
      'background-image: linear-gradient(var(--aw-fill), var(--aw-fill))',
      'background-repeat: no-repeat',
      `background-position: 0 calc(var(--aw-before) - var(--aw-lift, ${NONE}))`,
      `background-size: 100% calc(100% - var(--aw-before) - var(--aw-after) + var(--aw-lift, ${NONE}))`,
    ]);
    // Its selector outweighs any style's, two classes and an attribute, whichever comes first.
    expect(ends).toContain(':first-child > [data-style]:first-child');
    // An unfilled style names no fill of its own, so it never paints a fill it inherits.
    expect(ruleFor(text, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]')).toContain(
      '--aw-fill: transparent; background: transparent',
    );
  });

  it("STY-050 CNT-082 spaces blocks by adding one's space after to the next's space before, never collapsing them", () => {
    // A block's spaces are padding, which never collapses into a neighbour's as margins do, and which a
    // browser draws at its length - where a border's width is snapped to whole pixels, which the browser
    // suite found losing up to three quarters of a point at every block. The body: 2.75pt after.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain(`--aw-before: ${NONE}`);
    expect(body).toContain(`--aw-after: ${z('2.75')}`);
    expect(body).toContain('padding-block: calc(var(--aw-before) + ');
    expect(body).toContain(' + var(--aw-after))');
    expect(css).not.toMatch(/border-block-width/);
  });

  it("moves each line's extra space above it, as Word does, by cancelling CSS's split", () => {
    // CSS puts half of a line's extra space above and half below. Word puts all of it above.
    // Half-leading = (line spacing - (ascent + descent) x size) / 2: 1.084pt for body at 11pt on
    // 14.35pt. Adding it above and taking it back below as a margin - which can go negative where
    // padding cannot - leaves it all above.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain(`margin-block: 0 ${z('-1.084')}`);
    expect(body).toContain(
      `padding-block: calc(var(--aw-before) + ${z('1.084')}) calc(${NONE} + var(--aw-after))`,
    );
  });

  it("places each block's first baseline from its face's cap height where the renderer knows it, which a browser measures exactly, and its ascent and descent where it cannot trim", () => {
    // Liberation Serif's cap height is 1341/2048 of its em. The body at 11pt on 14.35pt: its first
    // baseline its line spacing less its descender below its top, 14.35 - 443/2048 x 11 = 11.971pt, of
    // which the cap height, 7.203pt, is the trimmed line's; its foot its descender, 2.379pt, below its
    // last baseline. A browser rounds a face's ascent and descent to whole pixels, and trims to its cap
    // height as it is (the browser suite, W13.4).
    const trimmed = projectCss(resolved(), { capHeight: () => 1341 / 2048 });
    const supports = trimmed
      .split('\n')
      .indexOf('@supports (text-box: trim-both cap alphabetic) {');
    expect(supports).toBeGreaterThan(0);
    const inside = trimmed.split('\n').slice(supports).join('\n');
    expect(
      ruleFor(inside, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]').split('; '),
    ).toEqual([
      'text-box: trim-both cap alphabetic',
      `margin-block: var(--aw-lift, ${NONE}) 0`,
      `padding-block: calc(var(--aw-before) + ${z('4.768')}) calc(${z('2.379')} + var(--aw-after))`,
    ]);
    // Only where the face's cap height is known: without it, the ascent and the descent, as before.
    expect(css).not.toContain('@supports');
    expect(projectCss(resolved(), { capHeight: () => undefined })).not.toContain('@supports');
  });

  it('CNT-097 sets text in the face the theme declares, never a face of the same name on the machine, at the size it declares', () => {
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain('font-family: "aw-face-serif"');
    expect(body).toContain('font-size: calc(11pt * var(--aw-zoom))');
    expect(css).not.toContain('Liberation');
    expect(css).toContain('.aw-canvas.aw-canvas math { font-family: "aw-face-maths"; }');
    // Inline code in the monospaced face at 0.8 of the text it stands in.
    const code = ruleFor(css, `${RUN}inlineCode${TEXT}`);
    expect(code).toContain('font-family: "aw-face-mono"');
    expect(code).toContain('font-size: calc(var(--aw-around) * 0.8)');
    // And preformatted text's lines in its role's face and size, never the browser's own for `code`.
    expect(ruleFor(css, '.aw-canvas.aw-canvas pre code')).toBe('font: inherit');
  });

  it('sets a paragraph whose style will not resolve in the default of the place it stands in, as it is marked', () => {
    // Its own style's rule, where the theme holds one for elsewhere, is outranked: one more selector.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-unresolved]');
    expect(body).toContain('font-size: calc(11pt * var(--aw-zoom))');
    expect(
      ruleFor(css, '.aw-canvas.aw-canvas [data-place="quotation"][data-unresolved]'),
    ).toContain('margin-inline: calc(11pt * var(--aw-zoom)) calc(11pt * var(--aw-zoom))');
    expect(ruleFor(css, '.aw-canvas.aw-canvas .aw-footnote-paragraph[data-unresolved]')).toContain(
      'font-size: calc(9.35pt * var(--aw-zoom))',
    );
  });

  it('sets a stored body in the default of the place it stands in, and each role in its own style', () => {
    const quotation = ruleFor(
      css,
      '.aw-canvas.aw-canvas [data-place="quotation"][data-style="body"]',
    );
    expect(quotation).toContain(
      'margin-inline: calc(11pt * var(--aw-zoom)) calc(11pt * var(--aw-zoom))',
    );
    // The footnote's paragraphs are always in the footnote's place.
    expect(
      ruleFor(css, '.aw-canvas.aw-canvas .aw-footnote-paragraph[data-style="body"]'),
    ).toContain('font-size: calc(9.35pt * var(--aw-zoom))');
    // A term is set in its list item's default, and carries no stored style.
    expect(
      ruleFor(css, '.aw-canvas.aw-canvas [data-place="listItem"]:not([data-style])'),
    ).toContain('font-size: calc(11pt * var(--aw-zoom))');
    // A stored body never means the style called Body: it means the default where it stands.
    expect(css).not.toMatch(/\.aw-canvas\.aw-canvas \[data-style="body"\]/);
    for (const role of ['caption', 'tableNote', 'attribution', 'preformatted']) {
      expect(() => ruleFor(css, `.aw-canvas.aw-canvas [data-role="${role}"]`), role).not.toThrow();
    }
    expect(() => ruleFor(css, '.aw-canvas.aw-canvas pre[data-language]::before')).not.toThrow();
  });

  it("sets a list as the template does: its items their place's leading apart and its place's spaces around it, whatever styles its items are in, and its markers in its place's style", () => {
    // The default list item is the body: 11pt on 14.35pt, 2.75pt after.
    const list = '.aw-canvas.aw-canvas :is(ul, ol)';
    expect(ruleFor(css, `${list} > li > [data-style]:first-child`)).toBe(
      `margin-block-start: calc(${z('3.35')} - var(--aw-leading) + var(--aw-lift, ${NONE}))`,
    );
    expect(ruleFor(css, `${list} > li:first-child > [data-style]:first-child`)).toBe(
      `--aw-before: ${NONE}`,
    );
    expect(ruleFor(css, `${list} > li:not(:first-child) > [data-style]:first-child`)).toBe(
      `--aw-before: ${NONE}`,
    );
    expect(ruleFor(css, `${list} > li:last-child > [data-style]:last-child`)).toBe(
      `--aw-after: ${z('2.75')}`,
    );
    expect(ruleFor(css, `${list} > li:not(:last-child) > [data-style]:last-child`)).toBe(
      `--aw-after: ${NONE}`,
    );
    expect(ruleFor(css, list)).toBe('margin-block: 0');
    // Its items where the engine sets them: a column of markers as wide as the widest, half an em of
    // the place's size, then the text - each item a row of the list's grid.
    expect(rulesFor(css, list)).toContain(
      'display: grid; grid-template-columns: max-content minmax(0, 1fr); ' +
        `column-gap: ${z('5.5')}; padding-inline-start: 0; list-style: none`,
    );
    expect(ruleFor(css, `${list} > li`)).toContain('grid-template-columns: subgrid');
    expect(ruleFor(css, '.aw-canvas.aw-canvas ol > li::before')).toBe(
      'content: counter(list-item, decimal) "."; justify-self: end',
    );
    expect(ruleFor(css, '.aw-canvas.aw-canvas ul ul > li::before')).toBe(
      'content: "\\25E6"; justify-self: start',
    );
    expect(rulesFor(css, '.aw-canvas.aw-canvas li')).toEqual([
      'margin-block: 0',
      `font-family: "aw-face-serif"; font-size: ${z('11')}; font-weight: 400; font-style: normal; ` +
        'color: #000000; line-height: 0',
    ]);
  });

  it("stands a quotation's attribution inside the quotation's indents, and preformatted text's label above its block, as the template sets them", () => {
    // The default quotation is inset 11pt each side, and its attribution states no indent of its own.
    expect(ruleFor(css, '.aw-canvas.aw-canvas blockquote > [data-role="attribution"]')).toBe(
      `margin-inline: ${z('11')} ${z('11')}`,
    );
    // The default label: 1.3pt before, 10.44pt line spacing and 3.4pt after - 15.14pt of room above
    // its block, where the label stands, out of the block's flow and its fill.
    const at = '.aw-canvas.aw-canvas pre[data-language][data-role]';
    expect(ruleFor(css, at)).toBe(`position: relative; margin-block-start: ${z('15.14')}`);
    expect(ruleFor(css, `${at}::before`)).toBe(
      `position: absolute; inset-block-start: ${z('-15.14')}; inset-inline: 0 0`,
    );
  });

  it('CNT-115 scales every length by the canvas zoom, and writes none in any other unit but ems of the text', () => {
    const lengths = css.match(/-?\d+(\.\d+)?(pt|px|em|rem|mm|in)\b/g) ?? [];
    expect(lengths.length).toBeGreaterThan(0);
    for (const length of lengths) expect(length).toMatch(/pt$|em$/);
    // Every point is inside a calc by the zoom.
    expect(css.match(/\d(\.\d+)?pt(?! \* var\(--aw-zoom\))/g)).toBeNull();
  });

  it('writes nothing that depends on pagination - preview shows those (STY-037)', () => {
    expect(css).not.toMatch(/keep|break-|orphans|widows|hyphen/);
  });

  it("puts the canvas on the theme's paper, in the ink of the text's own style", () => {
    expect(css).toContain('.aw-canvas { background: #ffffff; color: #000000; }');
  });

  it("states every property of a mark, the text's own where its style states none, so no browser default shows", () => {
    expect(ruleFor(css, `${RUN}hyperlink${TEXT}`).split('; ')).toEqual([
      'font-weight: var(--aw-run-weight)',
      'font-style: var(--aw-run-posture)',
      'text-decoration-line: none',
      'color: inherit',
      'font-family: var(--aw-run-face)',
      'font-size: var(--aw-around)',
      '--aw-run: 1em',
      'line-height: 0',
      'vertical-align: var(--aw-down)',
    ]);
    expect(ruleFor(css, `${RUN}strong${TEXT}`)).toContain('font-weight: 700');
    expect(ruleFor(css, `${RUN}subscript${TEXT}`)).toContain('vertical-align: sub');
    // The mark's own element says nothing of its look but its colour and its underline's absence -
    // a link's own - which its text inherits and draws.
    expect(ruleFor(css, `${RUN}hyperlink`)).toContain('color: inherit; text-decoration-line: none');
  });

  it('opens no line for a mark set in another face or at another size, as the template sets it on its line', () => {
    // Inline code, in the monospaced face at 0.8: its own line height would have opened its line by a
    // point and a half under the default theme (the browser suite, W13.4). Its text is drawn at no
    // height of its own, whatever its face and size.
    expect(ruleFor(css, `${RUN}inlineCode${TEXT}`)).toContain('line-height: 0');
    expect(ruleFor(css, `${RUN}strong${TEXT}`)).toContain('line-height: 0');
  });

  it("opens a line held by a run larger than its text as the template does, by what it stands above the text's top and below its foot, on every line the run is on (issue #331)", () => {
    // Every paragraph says what a line of it is: its face, size, weight and posture, its line spacing,
    // its descender, its text's own top above the baseline - one em less the descender - and the size a
    // run in it stands at. The body: Liberation Serif at 11pt on 14.35pt, 443/2048 of an em below.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    for (const declaration of [
      '--aw-face: "aw-face-serif"',
      `--aw-size: ${z('11')}`,
      '--aw-weight: 400',
      '--aw-posture: normal',
      `--aw-line: ${z('14.35')}`,
      '--aw-descent: 0.21631',
      `--aw-top: ${z('8.621')}`,
      `--aw-run: ${z('11')}`,
      '--aw-run-face: "aw-face-serif"',
      '--aw-run-weight: 400',
      '--aw-run-posture: normal',
    ]) {
      expect(body.split('; ')).toContain(declaration);
    }
    // The size a run stands at is a length computed where it is set, so a run inside another reads the
    // size of the one around it.
    expect(css).toContain(
      "@property --aw-run { syntax: '<length>'; inherits: true; initial-value: 0; }",
    );

    // A mark is three boxes. Its own element is a line of its paragraph's text - the same face, size
    // and line spacing, so the same line box the browser makes for the paragraph's own text - raised by
    // what the run stands above the text's top: its growth, the size it stands at less the text's,
    // times one less the descender, as the template's top edge is an em less the descender of the size
    // it is set at.
    const scaled = defaultInputs();
    scaled.catalogues.character.styles.find((style) => style.mark === 'strong')!.properties = {
      bold: true,
      scale: 1.25,
    };
    const text = projectCss(resolved(scaled));
    expect(ruleFor(text, `${RUN}strong`).split('; ')).toEqual([
      'font-family: var(--aw-face)',
      'font-size: var(--aw-size)',
      'font-weight: var(--aw-weight)',
      'font-style: var(--aw-posture)',
      'line-height: var(--aw-line)',
      'color: inherit',
      'text-decoration-line: none',
      '--aw-around: var(--aw-run)',
      `--aw-grow: max(${NONE}, calc(var(--aw-run) * 1.25 - var(--aw-size)))`,
      '--aw-up: calc((1 - var(--aw-descent)) * var(--aw-grow))',
      '--aw-down: calc(var(--aw-descent) * var(--aw-grow))',
      'vertical-align: var(--aw-up)',
    ]);
    // The second is another such line, lowered from the first by the whole growth: below the text's
    // baseline by what the run stands below its foot.
    expect(ruleFor(text, `${RUN}strong > .aw-mark-below`)).toBe(
      'vertical-align: calc(-1 * var(--aw-grow))',
    );
    // And the third is the text, raised back onto the baseline, drawn at no height of its own, at its
    // scale of the run it stands in, and the size and look a mark inside it stands in.
    expect(ruleFor(text, `${RUN}strong${TEXT}`).split('; ')).toEqual([
      'font-weight: 700',
      '--aw-run-weight: 700',
      'font-style: var(--aw-run-posture)',
      'text-decoration-line: none',
      'color: inherit',
      'font-family: var(--aw-run-face)',
      'font-size: calc(var(--aw-around) * 1.25)',
      '--aw-run: 1em',
      'line-height: 0',
      'vertical-align: var(--aw-down)',
    ]);
    // A script grows its line by its scale alone, as the template's does: the script's own size is the
    // engine's shaping, not a size its line is measured at. It moves up or down by the browser's own
    // rule, drawn where it would stand on the text's baseline.
    const subscript = ruleFor(css, `${RUN}subscript${TEXT}`).split('; ');
    expect(subscript).toContain('font-size: calc(var(--aw-around) * 0.65)');
    expect(subscript.slice(-3)).toEqual([
      'vertical-align: sub',
      'position: relative',
      'top: calc(-1 * var(--aw-down))',
    ]);
    expect(ruleFor(css, `${RUN}subscript`)).toContain(
      `--aw-grow: max(${NONE}, calc(var(--aw-run) - var(--aw-size)))`,
    );
  });

  it("opens a line held by an image as the template does, by what the image stands above the text's own top (issue #331)", () => {
    const trimmed = projectCss(resolved(), { capHeight: () => 1341 / 2048 });
    const inside = trimmed.slice(trimmed.indexOf('@supports'));
    // A block of its own, standing on the text's baseline, whose first line is a line of the text's -
    // as tall above its baseline as the browser makes the paragraph's own lines - less the text's own
    // top, above the image: so its line is opened by what the image stands above that top.
    expect(ruleFor(inside, '.aw-canvas.aw-canvas .aw-inline-image-holder')).toBe(
      'display: inline-block; line-height: 0; text-indent: 0; vertical-align: baseline',
    );
    expect(ruleFor(inside, '.aw-canvas.aw-canvas .aw-inline-image-holder::before')).toBe(
      'content: "\\200b" / ""; display: block; line-height: var(--aw-line); ' +
        'text-box: trim-end text alphabetic; margin-block-end: calc(-1 * var(--aw-top)); ' +
        'pointer-events: none',
    );
    expect(css).not.toContain('.aw-inline-image-holder');
  });

  it("keeps what holds a paragraph's first and last lines open where the browser would trim it away: a line of its own text above the first and below the last, trimmed instead (issue #331)", () => {
    // The browser trims a block's first line to its cap height and its last to its baseline, and with
    // them whatever holds either open. So a paragraph holding something that can - an image in a line,
    // a mark larger than its text - begins and ends with a line of its own text, the trimmed ones, and
    // stands that line higher: its space before, its padding, its descender and its cap height less
    // than it would have, as padding where that is more than nothing and as a lift where it is less.
    const scaled = defaultInputs();
    scaled.catalogues.character.styles.find((style) => style.mark === 'strong')!.properties = {
      scale: 1.25,
    };
    const trimmed = projectCss(resolved(scaled), { capHeight: () => 1341 / 2048 });
    const inside = trimmed.slice(trimmed.indexOf('@supports'));
    const grows =
      ':has(.aw-inline-image-holder:not(.aw-footnote-text *), .aw-mark-strong:not(.aw-footnote-text *))';
    // Never a paragraph marked as not resolving, whose label is its first line (STY-070).
    const body = `.aw-canvas.aw-canvas [data-place="text"][data-style="body"]:not([data-unresolved])${grows}`;
    // The body: no padding, 443/2048 and 1341/2048 of 11pt - 9.582pt - less than its space before.
    const lifted = `calc(var(--aw-before) + ${z('-9.582')})`;
    expect(ruleFor(inside, body).split('; ')).toEqual([
      `--aw-lift: min(${NONE}, ${lifted})`,
      `padding-block-start: max(${NONE}, ${lifted})`,
      `text-indent: 0 each-line`,
      // Lifted, it reaches over the foot of what stands above it, which is that block's to be clicked:
      // what it lifts is clipped away, which a pointer passes through. Above what follows, so that a
      // footnote's editor, drawn beneath it, stays over the next paragraph as it was.
      'position: relative',
      'z-index: 1',
      `clip-path: inset(calc(-1 * var(--aw-lift, ${NONE})) -100em -100em)`,
    ]);
    // The lines of its own text it begins and ends with say nothing to a screen reader.
    expect(ruleFor(inside, `${body}::before`)).toBe(
      'content: "\\200b\\A" / ""; white-space: pre; pointer-events: none',
    );
    expect(ruleFor(inside, `${body}::after`)).toBe(
      'content: "\\200b" / ""; display: block; margin-block-end: calc(-1 * var(--aw-line)); pointer-events: none',
    );
    // And every block's lift is its margin above, with what else stands it there.
    expect(
      ruleFor(inside, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]'),
    ).toContain(`margin-block: var(--aw-lift, ${NONE}) 0`);
    // A paragraph marked as not resolving keeps its label, and a footnote's is where its anchor is:
    // every selector a paragraph holding either is chosen by leaves one marked out, whatever style it
    // names - a style the theme holds for somewhere else is marked too.
    const chosen = inside
      .split('\n')
      .filter((line) => line.includes(grows))
      .flatMap((line) => selectorsOf(line));
    expect(chosen.length).toBeGreaterThan(0);
    for (const selector of chosen) expect(selector).toContain(':not([data-unresolved])');
    expect(inside).not.toContain(`[data-unresolved]${grows}`);
    expect(inside).not.toContain(`.aw-footnote-paragraph[data-style="body"]${grows}`);
    // A mark no larger than its text holds nothing open: the default's paragraphs grow only for images.
    const plain = projectCss(resolved(), { capHeight: () => 1341 / 2048 });
    expect(plain).toContain(':has(.aw-inline-image-holder:not(.aw-footnote-text *)) {');
    expect(plain).not.toContain(':has(.aw-inline-image-holder:not(.aw-footnote-text *), .aw-mark');
  });

  it("holds a list item's line open to its marker's top and foot, as the template's marker in the list's style does (issue #331)", () => {
    // The default list item: Liberation Serif at 11pt on 14.35pt. The marker is trimmed to its cap
    // height and its baseline, which a browser measures exactly, and stood the list's leading and its
    // own top above its baseline - 14.35 - (443 + 1341) / 2048 x 11 = 4.768pt above its cap height - and
    // its descender, 2.379pt, below: the item's line is opened to whichever of it and the item's text
    // stands further out.
    const trimmed = projectCss(resolved(), { capHeight: () => 1341 / 2048 });
    const inside = trimmed.slice(trimmed.indexOf('@supports'));
    const list = '.aw-canvas.aw-canvas :is(ul, ol)';
    expect(ruleFor(inside, `${list} > li::before`)).toBe(
      `text-box: trim-both cap alphabetic; line-height: ${z('14.35')}; ` +
        `padding-block: ${z('4.768')} ${z('2.379')}`,
    );
    // The first item's marker stands the list's space before above it as its text does, and the last
    // item's the list's space after below it.
    expect(ruleFor(inside, `${list} > li:first-child::before`)).toBe(
      `padding-block-start: ${z('4.768')}`,
    );
    expect(ruleFor(inside, `${list} > li:last-child::before`)).toBe(
      `padding-block-end: ${z('5.129')}`,
    );
  });

  it("gives a list inside an item that ends it no space after, as the template's list sets only its leading between its items (issue #331)", () => {
    const nested =
      '.aw-canvas.aw-canvas li:not(:last-child) > :is(ul, ol):last-child > li:last-child';
    expect(ruleFor(css, `${nested} > [data-style]:last-child`)).toBe(`--aw-after: ${NONE}`);
    // However deep: a list at the end of an item at the end of a list at the end of an item.
    expect(
      ruleFor(css, `${nested} > :is(ul, ol):last-child > li:last-child > [data-style]:last-child`),
    ).toBe(`--aw-after: ${NONE}`);
    const trimmed = projectCss(resolved(), { capHeight: () => 1341 / 2048 });
    const inside = trimmed.slice(trimmed.indexOf('@supports'));
    expect(ruleFor(inside, `${nested}::before`)).toBe(`padding-block-end: ${z('2.379')}`);
  });
});

describe('projectCss for tables and images (W8.3)', () => {
  /** A table style that states every property at something the default does not. */
  function ruledAndStriped(
    header: { fill: string; bold: boolean } = { fill: '#dddddd', bold: true },
  ) {
    const inputs = defaultInputs();
    inputs.catalogues.table.styles.push({
      id: 'striped',
      name: 'Striped',
      appliesTo: ['table'],
      headerRow: { ...header, rule: { width: 1.5, colour: '#333333' } },
      headerColumn: { fill: '#eeeeee', bold: true, rule: { width: 0.75, colour: '#444444' } },
      banding: { fill: '#f5f5f5' },
      rules: {
        outer: { width: 2, colour: '#111111' },
        horizontal: { width: 0.5, colour: '#222222' },
        vertical: 'none',
      },
      padding: 4,
      breaks: { repeatHeader: true, keepRowsWhole: true, continuationLabel: false },
      caption: 'above',
    });
    return projectCss(resolved(inputs));
  }
  const at = '.aw-canvas.aw-canvas [data-table-style="striped"]';

  it("draws a table's rules as the template does, taking no room - half in each cell beside a line, the outer rule's other half outside - its cells' padding whole", () => {
    const text = ruledAndStriped();
    // The cells' place is the default's: no space before, 3.35pt of leading, 2.75pt after.
    expect(ruleFor(text, `${at} table`)).toBe(
      'border-collapse: collapse; border: 0; background: transparent; ' +
        `box-shadow: 0 0 0 ${z('1')} #111111; margin-block: ${z('3.35')} ${z('2.75')}`,
    );
    const cells = ruleFor(text, `${at} td`);
    expect(cells).toContain(`padding: ${z('4')}; border: 0`);
    expect(cells).toContain(`--aw-rule-top: ${z('0.25')}; --aw-rule-top-colour: #222222`);
    expect(cells).toContain(`--aw-rule-start: ${NONE}; --aw-rule-start-colour: transparent`);
    expect(cells).toContain(
      'box-shadow: inset 0 var(--aw-rule-top) 0 0 var(--aw-rule-top-colour), ' +
        'inset 0 calc(-1 * var(--aw-rule-bottom)) 0 0 var(--aw-rule-bottom-colour), ' +
        'inset var(--aw-rule-left) 0 0 0 var(--aw-rule-left-colour), ' +
        'inset calc(-1 * var(--aw-rule-right)) 0 0 0 var(--aw-rule-right-colour)',
    );
    // The application's own look for a table stands down.
    expect(cells).toContain('text-transform: none; letter-spacing: normal');
    // The frame is the outer rule on every side, over the inside rules at the table's edges.
    expect(ruleFor(text, `${at} tr:first-child > *`)).toBe(
      `--aw-rule-top: ${z('1')}; --aw-rule-top-colour: #111111`,
    );
    expect(ruleFor(text, `${at} tr > :last-child`)).toBe(
      `--aw-rule-end: ${z('1')}; --aw-rule-end-colour: #111111`,
    );
    // A cell's first block takes no space or leading above it, and its last no space after.
    expect(ruleFor(text, `${at} :is(td, th) > [data-style]:first-child`)).toBe(
      `margin-block-start: calc(var(--aw-lift, ${NONE}) - var(--aw-before) - var(--aw-leading))`,
    );
    expect(ruleFor(text, `${at} :is(td, th) > [data-style]:last-child`)).toBe(
      `--aw-after: ${NONE}`,
    );
  });

  it('fills and embolds a header row and a header column, and rules them off from the body', () => {
    const text = ruledAndStriped();
    expect(ruleFor(text, `${at} [scope="col"]`)).toBe('background-color: #dddddd');
    expect(ruleFor(text, `${at} [scope="row"]`)).toBe('background-color: #eeeeee');
    // Bold over whatever the cell's paragraph style says, as the template sets it on the text.
    expect(ruleFor(text, `${at} [scope="col"] [data-style]`)).toBe('font-weight: 700');
    // Each cell beside a header's line draws its half of the header's rule, over the table's own.
    expect(ruleFor(text, `${at} tr:has(> [scope="col"]):not(:has(+ tr > [scope="col"])) > *`)).toBe(
      `--aw-rule-bottom: ${z('0.75')}; --aw-rule-bottom-colour: #333333`,
    );
    expect(ruleFor(text, `${at} tr:has(> [scope="col"]) + tr:not(:has(> [scope="col"])) > *`)).toBe(
      `--aw-rule-top: ${z('0.75')}; --aw-rule-top-colour: #333333`,
    );
    expect(ruleFor(text, `${at} [scope="row"]:not(:has(+ [scope="row"]))`)).toBe(
      `--aw-rule-end: ${z('0.375')}; --aw-rule-end-colour: #444444`,
    );
    expect(ruleFor(text, `${at} [scope="row"]:not(:has(+ [scope="row"])) + *`)).toBe(
      `--aw-rule-start: ${z('0.375')}; --aw-rule-start-colour: #444444`,
    );
  });

  it("carries the header column's rule through the header rows, and gives the corner the header column's fill and weight where the header row has none, as the template does", () => {
    const text = ruledAndStriped({ fill: 'none', bold: false });
    // The corner under one header column: the header row's first cell, in a table whose body rows
    // have one header cell each.
    const corner =
      `${at} table:has(tr > [scope="row"]:nth-child(1)):not(:has(tr > [scope="row"]:nth-child(2))) ` +
      'tr > [scope="col"]';
    expect(ruleFor(text, `${corner}:nth-child(-n + 1)`)).toBe('background-color: #eeeeee');
    expect(ruleFor(text, `${corner}:nth-child(-n + 1) [data-style]`)).toBe('font-weight: 700');
    expect(ruleFor(text, `${corner}:nth-child(1)`)).toBe(
      `--aw-rule-end: ${z('0.375')}; --aw-rule-end-colour: #444444`,
    );
    expect(ruleFor(text, `${corner}:nth-child(2)`)).toBe(
      `--aw-rule-start: ${z('0.375')}; --aw-rule-start-colour: #444444`,
    );
    // Where the header row has its own, the corner is the header row's.
    expect(ruledAndStriped()).not.toContain(`${corner}:nth-child(-n + 1) {`);
  });

  it('bands every other body row from the first, and leaves a filled header column its own fill', () => {
    expect(
      ruleFor(
        ruledAndStriped(),
        `${at} tr:nth-child(odd of :not(:has(> [scope="col"]))) > :not([scope="row"])`,
      ),
    ).toBe('background-color: #f5f5f5');
  });

  it('leaves the default table as template 12 set it: every rule black at 1pt, cells 5pt, no fills', () => {
    const table = '.aw-canvas.aw-canvas [data-table-style="table"]';
    expect(ruleFor(css, `${table} td`)).toContain(
      `--aw-rule-top: ${z('0.5')}; --aw-rule-top-colour: #000000`,
    );
    expect(ruleFor(css, `${table} td`)).toContain(`padding: ${z('5')}`);
    expect(ruleFor(css, `${table} [scope="col"]`)).toBe('background-color: transparent');
    expect(css).not.toContain(`${table} tr:nth-child`);
    expect(css).not.toContain(`${table} [scope="col"] [data-style]`);
  });

  it("stands a caption on the side its style places it: a table's below its cells and before its note, a figure's above its image, and where the markup already stands one, nothing", () => {
    const inputs = defaultInputs();
    const [table] = inputs.catalogues.table.styles;
    inputs.catalogues.table.styles.push({
      ...table!,
      id: 'footed',
      name: 'Footed',
      caption: 'below',
    });
    const [figure] = inputs.catalogues.image.styles;
    if (figure!.placement === 'inline') throw new Error('The first image style places a figure');
    inputs.catalogues.image.styles.push({
      ...figure!,
      id: 'headed',
      name: 'Headed',
      caption: 'above',
    });
    const text = projectCss(resolved(inputs));
    const footed = '.aw-canvas.aw-canvas [data-table-style="footed"]';
    expect(ruleFor(text, footed)).toBe('display: flex; flex-direction: column');
    expect(ruleFor(text, `${footed} > .aw-table-caption`)).toBe('order: 1');
    expect(ruleFor(text, `${footed} > .aw-table-note`)).toBe('order: 2');
    const headed = '.aw-canvas.aw-canvas figure[data-image-style="headed"]';
    expect(rulesFor(text, headed)).toContain('display: flex; flex-direction: column');
    expect(ruleFor(text, `${headed} > .aw-figure-body`)).toBe('order: -1');
    // A table's caption is the first thing in its markup and a figure's the last, which is where the
    // default's styles place them: nothing moves either.
    for (const selector of [
      '.aw-canvas.aw-canvas [data-table-style="table"]',
      '.aw-canvas.aw-canvas [data-table-style="banded"]',
      '.aw-canvas.aw-canvas figure[data-image-style="figure"]',
      '.aw-canvas.aw-canvas figure[data-image-style="half-width"]',
    ]) {
      expect(rulesFor(text, selector).join('; '), selector).not.toMatch(/display: flex|order/);
    }
  });

  it('stands a figure and a table apart from their neighbours as the template does, in blocks of their own, so their spaces add rather than collapse', () => {
    // A figure whose caption is below it stands its caption's space before and leading above its
    // image: none and 3.35pt under the default.
    expect(ruleFor(css, '.aw-canvas.aw-canvas figure[data-image-style="figure"]')).toBe(
      `margin: 0; padding: ${z('3.35')} 0 0; display: flow-root`,
    );
    expect(ruleFor(css, '.aw-canvas.aw-canvas [data-table-style="table"]')).toBe(
      'margin: 0; display: flow-root',
    );
  });

  it("aligns a figure within its band by its image style, stands an image in a line on its baseline, and leaves an image's size to its style's resolution", () => {
    expect(ruleFor(css, '.aw-canvas.aw-canvas [data-image-style="figure"] .aw-figure-image')).toBe(
      'text-align: center',
    );
    // The editor stylesheet makes the image a block, which only its margins move.
    expect(
      ruleFor(css, '.aw-canvas.aw-canvas [data-image-style="figure"] .aw-figure-image img'),
    ).toBe('margin-inline: auto');
    expect(ruleFor(css, '.aw-canvas.aw-canvas img.aw-inline-image')).toBe(
      'vertical-align: baseline',
    );
    // Its size is `styledSize`'s, set on the image by the editor: no fixed size of the stylesheet's
    // stands in its way.
    expect(ruleFor(css, '.aw-canvas.aw-canvas [data-image-style] img')).toBe(
      'max-height: none; height: auto',
    );
  });
});
