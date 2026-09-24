import { describe, expect, it } from 'vitest';

import { resolved, defaultInputs } from './theme.fixture.js';
import { projectTypst, projectTypst12 } from './typst.js';

/**
 * The PDF's projection: data for the fixed Typst template (ADR-0013), never Typst source. Numbers are
 * points; the template decides nothing but how to lay the values out, so every value is here already
 * in the engine's own terms. `projectTypst12` is what `publishing/12` carries as `theme`, frozen with
 * template 12; `projectTypst` is `publishing/13`'s, with table and image styles and contextual spacing.
 */
const typst = projectTypst12(resolved());

describe('projectTypst12, frozen with publishing/12', () => {
  it('states every property of a style at its resolved value (STY-050, STY-051)', () => {
    expect(typst.styles['heading-1']).toEqual({
      font: 'Liberation Serif',
      size: 16,
      weight: 'bold',
      style: 'normal',
      fill: '#000000',
      background: null,
      align: 'start',
      justify: false,
      firstLineIndent: 0,
      startIndent: 0,
      endIndent: 0,
      spaceBefore: 10.33,
      spaceAfter: 4.57,
      lineSpacing: 20.88,
      keepWithNext: true,
      keepTogether: false,
      widowControl: true,
      hyphenate: false,
      padding: 0,
      descent: 443 / 2048,
      leading: 4.88,
    });
  });

  it('carries inherited values, so the template never walks a chain', () => {
    expect(typst.styles['heading-4']).toMatchObject({
      size: 11,
      weight: 'bold',
      lineSpacing: 14.35,
      leading: 3.35,
      keepWithNext: true,
    });
  });

  it("puts a style's fill, and each alignment, in the engine's terms", () => {
    expect(typst.styles['preformatted']).toMatchObject({
      font: 'Liberation Mono',
      size: 8.8,
      background: '#f0f0f0',
      padding: 6,
      descent: 615 / 2048,
      leading: 2.72,
    });
    expect(typst.styles['attribution']).toMatchObject({ align: 'end', justify: false });

    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption'
        ? { ...style, properties: { alignment: 'centre' as const } }
        : style.id === 'quotation'
          ? { ...style, properties: { alignment: 'justify' as const, hyphenate: true } }
          : style,
    );
    const aligned = projectTypst12(resolved(inputs));
    expect(aligned.styles['caption']).toMatchObject({ align: 'center', justify: false });
    expect(aligned.styles['quotation']).toMatchObject({
      align: 'start',
      justify: true,
      hyphenate: true,
    });
  });

  it('renders each mark by what its character style states, and only that', () => {
    expect(typst.marks).toEqual({
      language: {},
      hyperlink: {},
      quotedPhrase: {},
      emphasis: { style: 'italic' },
      strong: { weight: 'bold' },
      underline: { underline: true },
      subscript: { position: 'subscript' },
      superscript: { position: 'superscript' },
      inlineCode: { font: 'Liberation Mono', scale: 0.8 },
    });

    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'strong'
        ? { ...style, properties: { bold: false, underline: true, colour: '#1f3a5f' } }
        : style,
    );
    expect(projectTypst12(resolved(inputs)).marks.strong).toEqual({
      weight: 'regular',
      underline: true,
      fill: '#1f3a5f',
    });
  });

  it('states the size a subscript or a superscript is set at, as a fraction of its text, so the template leaves it to nothing', () => {
    // The engine's own for both pinned text faces, measured: a subscript in 11pt text at 7.149pt.
    expect(typst.script).toBe(1331 / 2048);
  });

  it('carries the places, the roles and the maths face, so the template names no face of its own', () => {
    expect(typst.places).toMatchObject({ text: 'body', footnote: 'footnote' });
    expect(typst.roles).toMatchObject({ heading1: 'heading-1', preformatted: 'preformatted' });
    expect(typst.maths).toBe('STIX Two Math');
  });

  it('projects the styles a document uses and every style a place or a role names, and no other', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles.push(
      { id: 'lead', name: 'Lead', basedOn: 'body', appliesTo: ['text'], properties: { size: 13 } },
      { id: 'aside', name: 'Aside', basedOn: 'body', appliesTo: ['text'], properties: {} },
    );
    const theme = resolved(inputs);
    expect(Object.keys(projectTypst12(theme).styles)).toContain('aside');
    const used = Object.keys(projectTypst12(theme, ['lead']).styles);
    expect(used).toContain('lead');
    expect(used).not.toContain('aside');
    for (const id of [...Object.values(theme.places), ...Object.values(theme.roles)]) {
      expect(used, id).toContain(id);
    }
    expect(() => projectTypst12(theme, ['missing'])).toThrow(/missing/);
  });

  it('is plain data: it survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(typst))).toEqual(typst);
    expect(typst.paper).toBe('#ffffff');
  });
});

describe("publishing/12's projection, kept as template 12 reads it", () => {
  it('carries nothing themes 2 added: no table or image style, and no contextual spacing', () => {
    expect(Object.keys(typst).sort()).toEqual(
      ['maths', 'marks', 'paper', 'places', 'roles', 'script', 'styles'].sort(),
    );
    for (const [id, style] of Object.entries(typst.styles)) {
      expect(style, id).not.toHaveProperty('contextualSpacing');
    }
  });
});

describe('projectTypst, for publishing/13', () => {
  const current = projectTypst(resolved());

  it("states every paragraph style as publishing/12's does, with its contextual spacing", () => {
    for (const [id, style] of Object.entries(typst.styles)) {
      const contextualSpacing = id === 'quotation';
      expect(current.styles[id], id).toEqual({ ...style, contextualSpacing });
    }
    expect(Object.keys(current.styles)).toEqual(Object.keys(typst.styles));
    expect(current.marks).toEqual(typst.marks);
    const rest: Record<string, unknown> = { ...current };
    delete rest['tables'];
    delete rest['images'];
    expect(rest).toEqual({ ...typst, styles: current.styles });
  });

  it("carries every table style by identifier, in the engine's terms: fills, weights and strokes or null, an inset, and its breaks", () => {
    expect(current.tables).toEqual({
      table: {
        headerRow: { fill: null, weight: null, stroke: null },
        headerColumn: { fill: null, weight: null, stroke: null },
        band: null,
        strokes: {
          outer: { thickness: 1, paint: '#000000' },
          horizontal: { thickness: 1, paint: '#000000' },
          vertical: { thickness: 1, paint: '#000000' },
        },
        inset: 5,
        repeatHeader: true,
        keepRowsWhole: false,
        continuationLabel: false,
      },
    });

    const inputs = defaultInputs();
    inputs.catalogues.table.styles.push({
      ...inputs.catalogues.table.styles[0]!,
      id: 'banded',
      name: 'Banded',
      headerRow: { fill: '#dbe4f0', bold: true, rule: { width: 1.5, colour: '#1f3a5f' } },
      headerColumn: { fill: '#eeeeee', bold: false, rule: 'none' },
      banding: { fill: '#f5f5f5' },
      rules: { outer: { width: 0.5, colour: '#333333' }, horizontal: 'none', vertical: 'none' },
      padding: 3,
      breaks: { repeatHeader: false, keepRowsWhole: true, continuationLabel: true },
    });
    expect(projectTypst(resolved(inputs)).tables['banded']).toEqual({
      headerRow: {
        fill: '#dbe4f0',
        weight: 'bold',
        stroke: { thickness: 1.5, paint: '#1f3a5f' },
      },
      // Not bold is the cell's own weight, not regular: the header adds nothing.
      headerColumn: { fill: '#eeeeee', weight: null, stroke: null },
      band: '#f5f5f5',
      strokes: { outer: { thickness: 0.5, paint: '#333333' }, horizontal: null, vertical: null },
      inset: 3,
      repeatHeader: false,
      keepRowsWhole: true,
      continuationLabel: true,
    });
  });

  it("carries every image style by identifier: what it fixes, its maximum, its placement, and its alignment in the engine's terms or none", () => {
    expect(current.images).toEqual({
      figure: {
        fixed: { dimension: 'width', value: 1, unit: 'measure' },
        maximum: { value: 0.6, unit: 'textHeight' },
        placement: 'block',
        align: 'center',
      },
      inline: {
        fixed: { dimension: 'height', value: 1.2, unit: 'em' },
        maximum: { value: 1, unit: 'measure' },
        placement: 'inline',
        align: null,
      },
    });
    const inputs = defaultInputs();
    inputs.catalogues.image.styles.push({
      ...inputs.catalogues.image.styles[0]!,
      id: 'floated',
      name: 'Floated',
      placement: 'float',
      alignment: 'end',
    });
    expect(projectTypst(resolved(inputs)).images['floated']).toMatchObject({
      placement: 'float',
      align: 'end',
    });
  });

  it('carries every table and image style whatever styles a document uses, and is plain data', () => {
    const used = projectTypst(resolved(), ['body']);
    expect(Object.keys(used.tables)).toEqual(['table']);
    expect(Object.keys(used.images)).toEqual(['figure', 'inline']);
    expect(JSON.parse(JSON.stringify(current))).toEqual(current);
  });
});
