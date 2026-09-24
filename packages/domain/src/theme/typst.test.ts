import { describe, expect, it } from 'vitest';

import { resolved, defaultInputs } from './theme.fixture.js';
import { projectTypst } from './typst.js';

/**
 * The PDF's projection: data for the fixed Typst template (ADR-0013), never Typst source. It is what
 * `publishing/12` carries as `theme`. Numbers are points; the template decides nothing but how to lay
 * the values out, so every value is here already in the engine's own terms.
 */
const typst = projectTypst(resolved());

describe('projectTypst', () => {
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
    const aligned = projectTypst(resolved(inputs));
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
    expect(projectTypst(resolved(inputs)).marks.strong).toEqual({
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
    expect(Object.keys(projectTypst(theme).styles)).toContain('aside');
    const used = Object.keys(projectTypst(theme, ['lead']).styles);
    expect(used).toContain('lead');
    expect(used).not.toContain('aside');
    for (const id of [...Object.values(theme.places), ...Object.values(theme.roles)]) {
      expect(used, id).toContain(id);
    }
    expect(() => projectTypst(theme, ['missing'])).toThrow(/missing/);
  });

  it('is plain data: it survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(typst))).toEqual(typst);
    expect(typst.paper).toBe('#ffffff');
  });
});
