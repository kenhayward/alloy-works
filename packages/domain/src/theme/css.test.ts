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

/** The declarations of the one rule whose selector list includes `selector`. */
function ruleFor(text: string, selector: string): string {
  const rule = text
    .split('\n')
    .find((line) => line.split(' { ')[0]!.split(', ').includes(selector));
  if (!rule) throw new Error(`No rule for ${selector}`);
  return rule.slice(rule.indexOf(' { ') + 3, -3);
}

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
    const z = (points: string) => `calc(${points}pt * var(--aw-zoom))`;
    expect(panel.split('; ')).toEqual([
      'font-family: "aw-face-mono"',
      `font-size: ${z('12')}`,
      'font-weight: 700',
      'font-style: italic',
      'color: #1a2b3c',
      'background-color: #f0f0f0',
      'background-clip: padding-box',
      'text-align: justify',
      `text-indent: ${z('9')}`,
      `margin-block: 0 ${z('-1.203')}`,
      `margin-inline: ${z('18')} ${z('6')}`,
      'border: 0 solid transparent',
      `border-block-width: ${z('5')} ${z('7')}`,
      // Its padding inside its fill, on every side; its half-leading above its first line.
      `padding-block: ${z('5.203')} ${z('4')}`,
      `padding-inline: ${z('4')}`,
      `line-height: ${z('16')}`,
    ]);
    // Contextual spacing: two neighbours in Panel lose the space between them, and only that.
    expect(text).toContain(
      '.aw-canvas.aw-canvas [data-style="panel"] + [data-style="panel"] { border-block-start-width: 0; }',
    );
    expect(text).toContain(
      '.aw-canvas.aw-canvas [data-style="panel"]:has(+ [data-style="panel"]) { border-block-end-width: 0; }',
    );

    // Strong, restated: every character property, the script's size its scale times 1331/2048.
    expect(ruleFor(text, '.aw-canvas.aw-canvas .aw-mark-strong').split('; ')).toEqual([
      'font-weight: 400',
      'font-style: italic',
      'text-decoration-line: underline',
      'color: #223344',
      'font-family: "aw-face-mono"',
      'vertical-align: super',
      'font-size: 0.52em',
      'line-height: 0',
    ]);
  });

  it("STY-050 CNT-082 spaces blocks by adding one's space after to the next's space before, never collapsing them", () => {
    // A block's spaces are transparent borders, which never collapse into each other as margins do.
    // The body: no space before, 2.75pt after.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain('border: 0 solid transparent');
    expect(body).toContain('border-block-width: 0 calc(2.75pt * var(--aw-zoom))');
    expect(css).not.toMatch(/margin-(top|bottom|block-start|block-end):/);
  });

  it("moves each line's extra space above it, as Word does, by cancelling CSS's split", () => {
    // CSS puts half of a line's extra space above and half below. Word puts all of it above.
    // Half-leading = (line spacing - (ascent + descent) x size) / 2: 1.084pt for body at 11pt on
    // 14.35pt. Adding it above and taking it back below as a margin - which can go negative where
    // padding cannot - leaves it all above.
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain('margin-block: 0 calc(-1.084pt * var(--aw-zoom))');
    expect(body).toContain('padding-block: calc(1.084pt * var(--aw-zoom)) 0');
  });

  it('CNT-097 sets text in the face the theme declares, never a face of the same name on the machine, at the size it declares', () => {
    const body = ruleFor(css, '.aw-canvas.aw-canvas [data-place="text"][data-style="body"]');
    expect(body).toContain('font-family: "aw-face-serif"');
    expect(body).toContain('font-size: calc(11pt * var(--aw-zoom))');
    expect(css).not.toContain('Liberation');
    expect(css).toContain('.aw-canvas.aw-canvas math { font-family: "aw-face-maths"; }');
    // Inline code in the monospaced face at 0.8 of the text it stands in.
    const code = ruleFor(css, '.aw-canvas.aw-canvas .aw-mark-inlineCode');
    expect(code).toContain('font-family: "aw-face-mono"');
    expect(code).toContain('font-size: 0.8em');
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
    expect(ruleFor(css, '.aw-canvas.aw-canvas .aw-mark-hyperlink').split('; ')).toEqual([
      'font-weight: inherit',
      'font-style: inherit',
      'text-decoration-line: none',
      'color: inherit',
      'font-family: inherit',
      'vertical-align: baseline',
      'font-size: inherit',
    ]);
    expect(ruleFor(css, '.aw-canvas.aw-canvas .aw-mark-strong')).toContain('font-weight: 700');
    expect(ruleFor(css, '.aw-canvas.aw-canvas .aw-mark-subscript')).toContain(
      'vertical-align: sub',
    );
  });
});

describe('projectCss for tables and images (W8.3)', () => {
  /** A table style that states every property at something the default does not. */
  function ruledAndBanded() {
    const inputs = defaultInputs();
    inputs.catalogues.table.styles.push({
      id: 'banded',
      name: 'Banded',
      appliesTo: ['table'],
      headerRow: { fill: '#dddddd', bold: true, rule: { width: 1.5, colour: '#333333' } },
      headerColumn: { fill: '#eeeeee', bold: true, rule: { width: 0.75, colour: '#444444' } },
      banding: { fill: '#f5f5f5' },
      rules: {
        outer: { width: 2, colour: '#111111' },
        horizontal: { width: 0.5, colour: '#222222' },
        vertical: 'none',
      },
      padding: 4,
      breaks: { repeatHeader: true, keepRowsWhole: true, continuationLabel: false },
    });
    return projectCss(resolved(inputs));
  }
  const at = '.aw-canvas.aw-canvas [data-table-style="banded"]';
  const z = (points: string) => `calc(${points}pt * var(--aw-zoom))`;

  it("draws a table's rules, its cells' padding and its outer frame from its table style", () => {
    const text = ruledAndBanded();
    expect(ruleFor(text, `${at} table`)).toBe(
      `border-collapse: collapse; border: ${z('2')} solid #111111`,
    );
    const cells = ruleFor(text, `${at} td`);
    expect(cells).toContain(`padding: ${z('4')}`);
    expect(cells).toContain(`border-block: ${z('0.5')} solid #222222`);
    expect(cells).toContain('border-inline: none');
    // The frame is the outer rule on every side, over the inside rules at the table's edges.
    expect(ruleFor(text, `${at} tr:first-child > *`)).toBe(
      `border-block-start: ${z('2')} solid #111111`,
    );
    expect(ruleFor(text, `${at} tr > :last-child`)).toBe(
      `border-inline-end: ${z('2')} solid #111111`,
    );
  });

  it('fills and embolds a header row and a header column, and rules them off from the body', () => {
    const text = ruledAndBanded();
    expect(ruleFor(text, `${at} [scope="col"]`)).toBe('background-color: #dddddd');
    expect(ruleFor(text, `${at} [scope="row"]`)).toBe('background-color: #eeeeee');
    // Bold over whatever the cell's paragraph style says, as the template sets it on the text.
    expect(ruleFor(text, `${at} [scope="col"] [data-style]`)).toBe('font-weight: 700');
    expect(ruleFor(text, `${at} tr:has(> [scope="col"]):not(:has(+ tr > [scope="col"])) > *`)).toBe(
      `border-block-end: ${z('1.5')} solid #333333`,
    );
    expect(ruleFor(text, `${at} [scope="row"]:not(:has(+ [scope="row"]))`)).toBe(
      `border-inline-end: ${z('0.75')} solid #444444`,
    );
  });

  it('bands every other body row from the first, and leaves a filled header column its own fill', () => {
    expect(
      ruleFor(
        ruledAndBanded(),
        `${at} tr:nth-child(odd of :not(:has(> [scope="col"]))) > :not([scope="row"])`,
      ),
    ).toBe('background-color: #f5f5f5');
  });

  it('leaves the default table as template 12 set it: every rule black at 1pt, cells 5pt, no fills', () => {
    const table = '.aw-canvas.aw-canvas [data-table-style="table"]';
    expect(ruleFor(css, `${table} td`)).toContain(
      'border-block: calc(1pt * var(--aw-zoom)) solid #000000',
    );
    expect(ruleFor(css, `${table} [scope="col"]`)).toBe('background-color: transparent');
    expect(css).not.toContain(`${table} tr:nth-child`);
    expect(css).not.toContain(`${table} [scope="col"] [data-style]`);
  });

  it("aligns a figure within its band by its image style, and leaves an image's size to its style's resolution", () => {
    expect(ruleFor(css, '.aw-canvas.aw-canvas [data-image-style="figure"] .aw-figure-image')).toBe(
      'text-align: center',
    );
    // Its size is `styledSize`'s, set on the image by the editor: no fixed size of the stylesheet's
    // stands in its way.
    expect(
      ruleFor(
        css,
        '.aw-canvas.aw-canvas [data-image-style] img, .aw-canvas.aw-canvas img[data-image-style]'.split(
          ', ',
        )[0]!,
      ),
    ).toBe('max-height: none; height: auto');
  });
});
