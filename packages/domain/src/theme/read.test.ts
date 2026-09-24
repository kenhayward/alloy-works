import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_THEME,
} from './default.js';
import { readCatalogue, readTheme, themeRefusalCodes } from './read.js';
import { CATALOGUE_KINDS, PLACES, ROLES, STYLED_MARKS } from './schema.js';
import { codes, defaultInputs, read, resolved } from './theme.fixture.js';

/**
 * The reader (themes 1, ruling R2): the one place a theme's rules live (STY-035). A theme and the
 * catalogues it names go in; a theme with every style resolved comes out, or every refusal at once,
 * each a stable code and a sentence (STY-061). The store, `assemble` and these tests all read through
 * it, so none of them can read a theme differently.
 */
describe('readTheme', () => {
  it('STY-001 resolves every style as a named definition in the catalogue of its kind, and refuses one without a name', () => {
    const theme = resolved();
    for (const style of DEFAULT_CATALOGUES.paragraph.styles) {
      expect(theme.paragraphStyles.get(style.id)).toMatchObject({ id: style.id, name: style.name });
    }
    for (const style of DEFAULT_CATALOGUES.character.styles) {
      expect(theme.characterStyles[style.mark]).toMatchObject({ id: style.id, name: style.name });
    }
    expect([...theme.tableStyles.keys()]).toEqual(['table']);
    expect([...theme.imageStyles.keys()]).toEqual(['figure', 'inline']);

    const inputs = defaultInputs();
    const nameless: Record<string, unknown> = { ...inputs.catalogues.paragraph.styles[0]! };
    delete nameless['name'];
    const refused = readTheme(
      inputs.theme,
      new Map<string, unknown>([
        ...CATALOGUE_KINDS.map(
          (kind) => [inputs.theme.catalogues[kind], inputs.catalogues[kind]] as const,
        ),
        [inputs.theme.catalogues.paragraph, { ...inputs.catalogues.paragraph, styles: [nameless] }],
      ]),
    );
    expect(codes(refused)).toEqual(['catalogue_malformed']);
  });

  it('STY-003 binds a catalogue of each of the six kinds, refusing a theme short of one and a catalogue of another kind in its place', () => {
    expect(Object.keys(resolved().catalogues)).toEqual([...CATALOGUE_KINDS]);

    const short = defaultInputs();
    const catalogues: Record<string, unknown> = { ...short.theme.catalogues };
    delete catalogues['admonition'];
    expect(codes(readTheme({ ...short.theme, catalogues }, new Map()))).toEqual([
      'theme_malformed',
    ]);

    const swapped = defaultInputs();
    const outcome = readTheme(
      swapped.theme,
      new Map<string, unknown>(
        CATALOGUE_KINDS.map((kind) => [
          swapped.theme.catalogues[kind],
          kind === 'citation' ? swapped.catalogues.admonition : swapped.catalogues[kind],
        ]),
      ),
    );
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'catalogue_wrong_kind',
        message: `The theme names ${DEFAULT_CATALOGUE_VERSIONS.citation} as its citation catalogue, which is an admonition catalogue`,
      },
    ]);
  });

  it('binds one catalogue of each kind by artifact version, reading each at the version it names', () => {
    const theme = resolved();
    expect(theme.catalogues).toEqual(DEFAULT_CATALOGUE_VERSIONS);

    // Another version of the paragraph catalogue, one that would refuse, stands beside the one named:
    // it is never read, because the theme names a version and not a catalogue.
    const inputs = defaultInputs();
    const byVersion = new Map<string, unknown>(
      CATALOGUE_KINDS.map((kind) => [inputs.theme.catalogues[kind], inputs.catalogues[kind]]),
    );
    byVersion.set('00000000-0000-4000-8000-000000000000', { kind: 'paragraph', styles: 'none' });
    expect(readTheme(inputs.theme, byVersion).ok).toBe(true);

    byVersion.delete(inputs.theme.catalogues.image);
    const outcome = readTheme(inputs.theme, byVersion);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'catalogue_missing',
        message: `The theme's image catalogue, version ${DEFAULT_CATALOGUE_VERSIONS.image}, was not found`,
      },
    ]);
  });

  it('STY-041 records the licence each typeface is held under and whether it may be embedded in a PDF and in Word, and refuses a typeface that does not say', () => {
    const theme = resolved();
    expect(
      [...theme.typefaces.values()].map(({ id, licence, embedding }) => ({
        id,
        licence,
        embedding,
      })),
    ).toEqual([
      { id: 'serif', licence: 'OFL-1.1', embedding: { pdf: true, word: true } },
      { id: 'mono', licence: 'OFL-1.1', embedding: { pdf: true, word: true } },
      { id: 'maths', licence: 'OFL-1.1', embedding: { pdf: true, word: true } },
    ]);

    for (const member of ['licence', 'embedding']) {
      const inputs = defaultInputs();
      const face: Record<string, unknown> = { ...inputs.theme.typefaces[0]! };
      delete face[member];
      const typefaces = [face, ...inputs.theme.typefaces.slice(1)];
      expect(codes(readTheme({ ...inputs.theme, typefaces }, new Map())), member).toEqual([
        'theme_malformed',
      ]);
    }
  });

  it('resolves every property of a style through its chain to the base, and its typeface to the face itself', () => {
    const theme = resolved();
    const second = theme.paragraphStyles.get('heading-2')!;
    expect(second.properties).toEqual({
      ...DEFAULT_CATALOGUES.paragraph.base,
      size: 13,
      bold: true,
      spaceBefore: 7.43,
      spaceAfter: 2.82,
      lineSpacing: 16.96,
      keepWithNext: true,
    });
    expect(second.basedOn).toBe('heading-1');
    expect(second.appliesTo).toEqual(['heading2']);
    expect(second.typeface.family).toBe('Liberation Serif');
    expect(theme.paragraphStyles.get('preformatted')!.typeface.family).toBe('Liberation Mono');
    expect(theme.paragraphStyles.get('body')!.properties).toEqual(
      DEFAULT_CATALOGUES.paragraph.base,
    );
    expect(theme.characterStyles.inlineCode.typeface?.family).toBe('Liberation Mono');
    expect(theme.characterStyles.strong.typeface).toBeUndefined();
    expect(theme.maths.family).toBe('STIX Two Math');
  });

  it("keeps the theme's places and roles, and styles every mark a publication carries", () => {
    const theme = resolved();
    expect(Object.keys(theme.places)).toEqual([...PLACES]);
    expect(Object.keys(theme.roles)).toEqual([...ROLES]);
    expect(theme.places).toEqual(DEFAULT_THEME.places);
    expect(Object.keys(theme.characterStyles).sort()).toEqual([...STYLED_MARKS].sort());
    expect(theme.paper).toBe('#ffffff');
    expect(theme.name).toBe('Default');
  });

  it('fails on a style the theme does not contain rather than substituting one (STY-027)', () => {
    const inputs = defaultInputs();
    inputs.theme.roles.caption = 'legend';
    inputs.theme.places.footnote = 'small';
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'style_missing',
        message:
          'The footnote place is given the paragraph style small, which the paragraph catalogue does not contain',
      },
      {
        code: 'style_missing',
        message:
          'The caption role is given the paragraph style legend, which the paragraph catalogue does not contain',
      },
    ]);
  });

  it('STY-006 requires every style to declare where it applies, and refuses a place or a role given one that does not apply there', () => {
    // The declaration: a style that says nothing of where it applies does not read.
    const bare: Record<string, unknown> = { ...DEFAULT_CATALOGUES.paragraph.styles[0]! };
    delete bare['appliesTo'];
    expect(readCatalogue({ ...DEFAULT_CATALOGUES.paragraph, styles: [bare] }).ok).toBe(false);

    // The refusal: a style given where it does not apply is refused, never set there anyway.
    const inputs = defaultInputs();
    inputs.theme.places.footnote = 'heading-1';
    inputs.theme.roles.running = 'body';
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'style_not_applicable',
        message:
          'The footnote place is given the paragraph style heading-1, which applies only to heading1',
      },
      {
        code: 'style_not_applicable',
        message:
          'The running role is given the paragraph style body, which applies only to text and listItem',
      },
    ]);
  });

  it('names a parent the catalogue does not contain, and a chain that returns to itself', () => {
    const inputs = defaultInputs();
    const styles = inputs.catalogues.paragraph.styles;
    inputs.catalogues.paragraph.styles = styles.map((style) =>
      style.id === 'caption'
        ? { ...style, basedOn: 'figure-text' }
        : style.id === 'heading-1'
          ? { ...style, basedOn: 'heading-3' }
          : style.id === 'attribution'
            ? { ...style, basedOn: 'attribution' }
            : style,
    );
    const refused = read(inputs);
    // In the catalogue's order; the styles based on a broken chain are not refused again.
    expect(codes(refused)).toEqual(['style_cycle', 'style_parent_missing', 'style_cycle']);
    expect(refused.ok ? [] : refused.refusals.map((each) => each.message)).toEqual([
      'The paragraph style heading-1 is based on itself: heading-1, heading-3, heading-1',
      'The paragraph style caption is based on figure-text, which the paragraph catalogue does not contain',
      'The paragraph style attribution is based on itself: attribution, attribution',
    ]);
  });

  it('refuses two styles with one identifier, and a mark styled twice or not at all', () => {
    const inputs = defaultInputs();
    const body = inputs.catalogues.paragraph.styles[0]!;
    inputs.catalogues.paragraph.styles.push({ ...body });
    const character = inputs.catalogues.character.styles;
    inputs.catalogues.character.styles = [
      ...character.filter((style) => style.mark !== 'underline'),
      { id: 'strong-again', name: 'Strong again', mark: 'strong', properties: {} },
    ];
    expect(codes(read(inputs))).toEqual(['style_duplicate', 'mark_duplicate', 'mark_unstyled']);
  });

  it('refuses a typeface named nowhere in the theme, and one declared twice', () => {
    const inputs = defaultInputs();
    inputs.theme.maths = 'stix';
    inputs.theme.typefaces.push({ ...inputs.theme.typefaces[0]! });
    inputs.catalogues.paragraph.styles.push({
      id: 'sans-body',
      name: 'Sans body',
      appliesTo: ['text'],
      properties: { typeface: 'sans' },
    });
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'inlineCode' ? { ...style, properties: { typeface: 'courier' } } : style,
    );
    expect(codes(read(inputs))).toEqual([
      'typeface_duplicate',
      'typeface_missing',
      'typeface_missing',
      'typeface_missing',
    ]);
  });

  it('refuses preformatted text in a face that is not monospaced', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'preformatted'
        ? { ...style, properties: { ...style.properties, typeface: 'serif' } }
        : style,
    );
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'preformatted_not_monospaced',
        message:
          'The preformatted role is set in the typeface serif, which records no advance: it is not monospaced',
      },
    ]);
  });

  it('refuses a style whose line spacing, as it resolves, is less than its size, naming the style', () => {
    // The final review of themes 1, I2: a line is one em tall, and line spacing is a minimum distance
    // between baselines, so 20pt text 6pt apart printed each line over the one before it.
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, properties: { size: 20, lineSpacing: 6 } } : style,
    );
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'line_spacing_below_size',
        message:
          'The paragraph style caption sets its lines 6pt apart, closer than its size of 20pt: a line is never set closer than its size',
      },
    ]);

    // Inherited as well as stated: a base of 14.35pt under a style that states only 16pt.
    const inherited = defaultInputs();
    inherited.catalogues.paragraph.styles = inherited.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, properties: { size: 16 } } : style,
    );
    expect(codes(read(inherited))).toEqual(['line_spacing_below_size']);

    // Exactly its size is a line one em apart, which is allowed.
    const solid = defaultInputs();
    solid.catalogues.paragraph.styles = solid.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, properties: { size: 20, lineSpacing: 20 } } : style,
    );
    expect(read(solid).ok).toBe(true);
  });

  it('collects every refusal, across the theme and its catalogues, never only the first', () => {
    const inputs = defaultInputs();
    inputs.theme.places.text = 'missing';
    inputs.theme.roles.title = 'body';
    inputs.catalogues.paragraph.styles.push({ ...inputs.catalogues.paragraph.styles[0]! });
    inputs.catalogues.character.styles.pop();
    expect(codes(read(inputs)).sort()).toEqual(
      ['mark_unstyled', 'style_duplicate', 'style_missing', 'style_not_applicable'].sort(),
    );
  });

  it('reports every place a malformed catalogue fails, naming it', () => {
    const inputs = defaultInputs();
    const outcome = readTheme(
      inputs.theme,
      new Map<string, unknown>(
        CATALOGUE_KINDS.map((kind) => [
          inputs.theme.catalogues[kind],
          kind === 'table'
            ? {
                schemaVersion: 1,
                kind: 'table',
                styles: [{ id: 'Table', name: '', appliesTo: [] }],
              }
            : inputs.catalogues[kind],
        ]),
      ),
    );
    expect(codes(outcome)).toEqual([
      'catalogue_malformed',
      'catalogue_malformed',
      'catalogue_malformed',
    ]);
    for (const refusal of outcome.ok ? [] : outcome.refusals) {
      expect(refusal.message).toMatch(
        new RegExp(
          `^The table catalogue ${DEFAULT_CATALOGUE_VERSIONS.table} does not read, at styles\\.0\\.`,
        ),
      );
    }
  });

  it('refuses a stored theme it cannot read at all, rather than throwing', () => {
    for (const value of [null, 'theme', { schemaVersion: 2 }, {}]) {
      const outcome = readTheme(value, new Map());
      expect(codes(outcome), JSON.stringify(value)).toEqual(['theme_malformed']);
    }
  });

  it('gives every refusal a stable code and a sentence a person can read', () => {
    const inputs = defaultInputs();
    inputs.theme.places.text = 'missing';
    inputs.catalogues.paragraph.styles.push({ ...inputs.catalogues.paragraph.styles[0]! });
    const outcome = read(inputs);
    expect(outcome.ok).toBe(false);
    for (const refusal of outcome.ok ? [] : outcome.refusals) {
      expect(themeRefusalCodes).toContain(refusal.code);
      // A plain hyphen in anything a person reads, never an en or em dash.
      expect(refusal.message).not.toMatch(/[–—]/);
      expect(refusal.message).toMatch(/^[A-Z].*[^.]$/);
    }
  });

  it('is a pure function of its input (STY-038)', () => {
    const inputs = defaultInputs();
    const snapshot = structuredClone(inputs);
    expect(read(inputs)).toEqual(read(inputs));
    expect(inputs).toEqual(snapshot);
  });
});

describe('contrast, when a theme is read', () => {
  it("refuses a paragraph style's colour below 4.5:1 against the paper it stands on", () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, properties: { colour: '#777777' } } : style,
    );
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'contrast_too_low',
        message:
          'The paragraph style caption sets #777777 on the paper #ffffff at 4.47:1, below the 4.5:1 its text needs',
      },
    ]);
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, properties: { colour: '#767676' } } : style,
    );
    expect(read(inputs).ok).toBe(true);
  });

  it('asks 3:1 of large text - 18pt, or 14pt bold - and 4.5:1 of the rest', () => {
    const inputs = defaultInputs();
    // #888888 on white is 3.54:1: enough for the 16pt bold title, not for an 11pt caption.
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'title' || style.id === 'caption'
        ? { ...style, properties: { ...style.properties, colour: '#888888' } }
        : style,
    );
    const outcome = read(inputs);
    const refused = outcome.ok ? [] : outcome.refusals.map((each) => each.message);
    // The title itself passes; what its marks set smaller in it - the scripts at 10.4pt and inline
    // code at 12.8pt, both bold - does not (I3), in the title's colour.
    expect(refused).toEqual([
      expect.stringMatching(/^The paragraph style caption /),
      expect.stringMatching(
        /^The character style subscript sets #888888, the colour of the paragraph style title,/,
      ),
      expect.stringMatching(
        /^The character style superscript sets #888888, the colour of the paragraph style title,/,
      ),
      expect.stringMatching(
        /^The character style inline-code sets #888888, the colour of the paragraph style title,/,
      ),
    ]);
  });

  it("measures a style against its own background where it has one, not the paper's", () => {
    const inputs = defaultInputs();
    inputs.theme.paper = '#000000';
    inputs.catalogues.paragraph.base.colour = '#ffffff';
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'preformatted'
        ? { ...style, properties: { ...style.properties, background: '#1a1a1a' } }
        : style,
    );
    // White on black everywhere, and on the preformatted text's near-black fill.
    expect(read(inputs).ok).toBe(true);

    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'preformatted'
        ? { ...style, properties: { ...style.properties, background: '#f0f0f0' } }
        : style,
    );
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals.map((each) => each.message)).toEqual([
      'The paragraph style preformatted sets #ffffff on its background #f0f0f0 at 1.13:1, below the 4.5:1 its text needs',
    ]);
  });

  it("measures a mark's colour against every background it can stand on - the paper and each style's fill", () => {
    const inputs = defaultInputs();
    // #767676 passes on the white paper at 4.54:1 and fails on preformatted text's #f0f0f0 at 3.98:1.
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'hyperlink' ? { ...style, properties: { colour: '#767676' } } : style,
    );
    const outcome = read(inputs);
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'contrast_too_low',
        message:
          'The character style link sets #767676 on the background #f0f0f0 of the paragraph style preformatted at 3.98:1, below the 4.5:1 its text needs',
      },
    ]);
  });

  /**
   * Every paragraph style at one size, with no fill and in one colour, so that a mark is judged against
   * the paper alone and at a size its paragraph is not: the final review of themes 1's I3.
   */
  const everyStyleAt = (
    size: number,
    marks: Partial<Record<string, Record<string, unknown>>>,
    colour = '#000000',
    bold = false,
  ) => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) => ({
      ...style,
      properties: {
        ...style.properties,
        size,
        lineSpacing: size + 4,
        background: 'none' as const,
        colour,
        bold,
      },
    }));
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) => ({
      ...style,
      properties: marks[style.mark] ?? style.properties,
    }));
    return read(inputs);
  };

  it("judges a mark's colour at the size its text is set at: the paragraph's size times the mark's scale", () => {
    // #949494 on white is 3.03:1: enough for 18pt text, not for the 9pt a half-size mark sets in it.
    expect(everyStyleAt(18, { strong: { colour: '#949494' } }).ok).toBe(true);
    const outcome = everyStyleAt(18, { strong: { colour: '#949494', scale: 0.5 } });
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'contrast_too_low',
        message:
          'The character style strong sets #949494 on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
      },
    ]);
    // And a larger mark needs less: 9pt text at twice its size is 18pt.
    expect(everyStyleAt(9, { strong: { colour: '#949494', scale: 2 } }).ok).toBe(true);
  });

  it('judges a subscript and a superscript at the size the engine sets one, a fraction of its text', () => {
    // 1331 of 2048 of the text around it: at 28pt a script is 18.2pt, large text, and at 27pt 17.5pt,
    // which is not. The default theme's two marks state no colour: they take their paragraph's.
    expect(everyStyleAt(28, {}, '#949494').ok).toBe(true);
    const outcome = everyStyleAt(27, {}, '#949494');
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'contrast_too_low',
        message:
          'The character style subscript sets #949494, the colour of the paragraph style body, on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
      },
      {
        code: 'contrast_too_low',
        message:
          'The character style superscript sets #949494, the colour of the paragraph style body, on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
      },
    ]);
    // A coloured script too: 18pt text passes #949494 and its 11.7pt subscript does not.
    expect(
      codes(everyStyleAt(18, { subscript: { position: 'subscript', colour: '#949494' } })),
    ).toEqual(['contrast_too_low']);
  });

  it("judges a mark with no colour of its own that shrinks its text in its paragraph's colour", () => {
    // Every paragraph large and #949494, legitimately 3:1, and inline code at half its size: 9pt text
    // at 3.03:1, with the scripts at 11.7pt beside it.
    const outcome = everyStyleAt(18, { inlineCode: { typeface: 'mono', scale: 0.5 } }, '#949494');
    expect(outcome.ok ? [] : outcome.refusals.map((each) => each.message)).toEqual([
      'The character style subscript sets #949494, the colour of the paragraph style body, on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
      'The character style superscript sets #949494, the colour of the paragraph style body, on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
      'The character style inline-code sets #949494, the colour of the paragraph style body, on the paper #ffffff at 3.03:1, below the 4.5:1 its text needs',
    ]);
  });

  it('judges a mark bold where it or its paragraph is bold, and regular where it turns bold off', () => {
    // The marks that set text smaller given a colour that passes anywhere, so that only the mark
    // under test is judged in its paragraph's.
    const full = {
      subscript: { position: 'subscript', colour: '#000000' },
      superscript: { position: 'superscript', colour: '#000000' },
      inlineCode: { typeface: 'mono', colour: '#000000' },
    };
    // 14pt bold is large text, so #949494 passes in a 14pt bold paragraph...
    expect(everyStyleAt(14, full, '#949494', true).ok).toBe(true);
    // ...and not under a mark that sets it regular, though the mark states no colour.
    expect(
      codes(everyStyleAt(14, { ...full, emphasis: { bold: false } }, '#949494', true)),
    ).toEqual(['contrast_too_low']);
    // A mark's own bold makes 14pt text large: #949494 strong passes on regular 14pt text.
    expect(everyStyleAt(14, { strong: { bold: true, colour: '#949494' } }).ok).toBe(true);
    expect(codes(everyStyleAt(14, { strong: { bold: false, colour: '#949494' } }))).toEqual([
      'contrast_too_low',
    ]);
  });

  it('passes the default theme', () => {
    expect(read(defaultInputs()).ok).toBe(true);
  });
});

describe('table and image styles, when a theme is read', () => {
  it("resolves each table style and image style whole, by identifier, in the catalogue's order", () => {
    const theme = resolved();
    expect([...theme.tableStyles.values()]).toEqual(DEFAULT_CATALOGUES.table.styles);
    expect([...theme.imageStyles.values()]).toEqual(DEFAULT_CATALOGUES.image.styles);
  });

  it('reads the theme a publication was made under at 0.1, its catalogues upgraded', () => {
    const outcome = readTheme(FIRST_DEFAULT_THEME, FIRST_DEFAULT_CATALOGUES_BY_VERSION);
    if (!outcome.ok) throw new Error(outcome.refusals.map((each) => each.message).join('\n'));
    expect(outcome.theme.catalogues).toEqual(FIRST_DEFAULT_CATALOGUE_VERSIONS);
    expect([...outcome.theme.tableStyles.values()]).toEqual(DEFAULT_CATALOGUES.table.styles);
    expect([...outcome.theme.imageStyles.values()]).toEqual(DEFAULT_CATALOGUES.image.styles);
    // No contextual spacing anywhere, and the quotation as 0.1 had it.
    for (const style of outcome.theme.paragraphStyles.values()) {
      expect(style.properties.contextualSpacing, style.id).toBe(false);
    }
    expect(outcome.theme.paragraphStyles.get('quotation')!.properties).toMatchObject({
      spaceBefore: 0,
      spaceAfter: 2.75,
    });
  });

  /** The default inputs with the image catalogue's styles replaced. */
  const withImages = (...styles: unknown[]) => {
    const inputs = defaultInputs();
    (inputs.catalogues as { image: unknown }).image = { schemaVersion: 2, kind: 'image', styles };
    return inputs;
  };
  const figure = DEFAULT_CATALOGUES.image.styles[0]!;
  const inline = DEFAULT_CATALOGUES.image.styles[1]!;

  it('refuses a fraction of the measure for a height and a fraction of the text block for a width, naming the style', () => {
    const outcome = read(
      withImages(
        { ...figure, fixed: { dimension: 'width', value: 0.5, unit: 'textHeight' } },
        { ...inline, fixed: { dimension: 'height', value: 0.1, unit: 'measure' } },
        // A figure fixing its height: its maximum is a width, which the text block cannot measure.
        {
          ...figure,
          id: 'tall',
          fixed: { dimension: 'height', value: 0.5, unit: 'textHeight' },
          maximum: { value: 0.5, unit: 'textHeight' },
        },
        // And fixing its width, its maximum is a height, which the measure cannot.
        { ...figure, id: 'broad', maximum: { value: 0.5, unit: 'measure' } },
      ),
    );
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'image_unit_wrong_dimension',
        message:
          "The image style figure gives its width as a fraction of the text block's height, which measures only a height",
      },
      {
        code: 'image_unit_wrong_dimension',
        message:
          'The image style inline gives its height as a fraction of the measure, which measures only a width',
      },
      {
        code: 'image_unit_wrong_dimension',
        message:
          "The image style tall gives its greatest width as a fraction of the text block's height, which measures only a height",
      },
      {
        code: 'image_unit_wrong_dimension',
        message:
          'The image style broad gives its greatest height as a fraction of the measure, which measures only a width',
      },
    ]);
  });

  it('refuses ems for an image that is not in a line of text, and a placement that cannot hold what the style applies to', () => {
    const outcome = read(
      withImages(
        {
          ...figure,
          fixed: { dimension: 'height', value: 5, unit: 'em' },
          maximum: { value: 1, unit: 'measure' },
        },
        { ...figure, id: 'boxed', maximum: { value: 5, unit: 'em' } },
        { ...inline, id: 'in-figure', appliesTo: ['figure'] },
        { ...figure, id: 'standing', appliesTo: ['inlineImage'] },
        { ...figure, id: 'afloat', placement: 'float', appliesTo: ['inlineImage'] },
      ),
    );
    expect(outcome.ok ? [] : outcome.refusals).toEqual([
      {
        code: 'image_unit_not_applicable',
        message:
          'The image style figure gives its height in ems, which only an image in a line of text is sized in, and it applies to figure',
      },
      {
        code: 'image_unit_not_applicable',
        message:
          'The image style boxed gives its greatest height in ems, which only an image in a line of text is sized in, and it applies to figure',
      },
      {
        code: 'image_unit_not_applicable',
        message:
          'The image style in-figure gives its height in ems, which only an image in a line of text is sized in, and it applies to figure',
      },
      {
        code: 'image_placement_not_applicable',
        message:
          'The image style in-figure places its image in a line of text, which only an image in a line of text can be, and it applies to figure',
      },
      {
        code: 'image_placement_not_applicable',
        message:
          'The image style standing places its image as a block, which an image in a line of text cannot be, and it applies to inlineImage',
      },
      {
        code: 'image_placement_not_applicable',
        message:
          'The image style afloat places its image floated, which an image in a line of text cannot be, and it applies to inlineImage',
      },
    ]);
  });

  it('refuses a style applying to a figure and to an image in a line of text alike, since no placement holds both', () => {
    const outcome = read(withImages({ ...figure, appliesTo: ['figure', 'inlineImage'] }));
    expect(codes(outcome)).toEqual(['image_placement_not_applicable']);
    // And a catalogue on its own is refused alike, as the store reads it.
    const alone = readCatalogue({
      schemaVersion: 2,
      kind: 'image',
      styles: [{ ...inline, appliesTo: ['figure'] }],
    });
    expect(alone.ok ? [] : alone.refusals.map((each) => each.code)).toEqual([
      'image_unit_not_applicable',
      'image_placement_not_applicable',
    ]);
  });

  it('accepts points in either dimension, for either kind of image', () => {
    expect(
      read(
        withImages(
          {
            ...figure,
            fixed: { dimension: 'height', value: 144, unit: 'pt' },
            maximum: { value: 300, unit: 'pt' },
          },
          {
            ...inline,
            fixed: { dimension: 'width', value: 20, unit: 'pt' },
            maximum: { value: 18, unit: 'pt' },
          },
          {
            ...figure,
            id: 'floated',
            placement: 'float',
            alignment: 'end',
            fixed: { dimension: 'height', value: 0.3, unit: 'textHeight' },
            maximum: { value: 0.5, unit: 'measure' },
          },
        ),
      ).ok,
    ).toBe(true);
  });
});

describe('contrast on a table style, when a theme is read', () => {
  const table = DEFAULT_CATALOGUES.table.styles[0]!;

  /** The default inputs with the one table style changed, and every cell's text as given. */
  const tabled = (
    changes: Record<string, unknown>,
    cell: Record<string, unknown> = {},
    marks: Partial<Record<string, Record<string, unknown>>> = {},
  ) => {
    const inputs = defaultInputs();
    (inputs.catalogues as { table: unknown }).table = {
      schemaVersion: 2,
      kind: 'table',
      styles: [{ ...table, ...changes }],
    };
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'table-cell'
        ? { ...style, properties: { ...style.properties, ...cell } }
        : style,
    );
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) => ({
      ...style,
      properties: marks[style.mark] ?? style.properties,
    }));
    return read(inputs);
  };

  it("refuses the table cell's text below the contrast its size asks on a header's fill or a band's", () => {
    // #000000 on #333333 is 1.66:1.
    const header = tabled({ headerRow: { fill: '#333333', bold: false, rule: 'none' } });
    expect(header.ok ? [] : header.refusals).toEqual([
      {
        code: 'contrast_too_low',
        message:
          "The table style table sets the text of the paragraph style table-cell, #000000, on its header row's fill #333333 at 1.66:1, below the 4.5:1 its text needs",
      },
    ]);
    const column = tabled({ headerColumn: { fill: '#333333', bold: true, rule: 'none' } });
    expect(column.ok ? [] : column.refusals.map((each) => each.message)).toEqual([
      "The table style table sets the text of the paragraph style table-cell, #000000, on its header column's fill #333333 at 1.66:1, below the 4.5:1 its text needs",
    ]);
    const band = tabled({ banding: { fill: '#333333' } });
    expect(band.ok ? [] : band.refusals.map((each) => each.message)).toEqual([
      "The table style table sets the text of the paragraph style table-cell, #000000, on its band's fill #333333 at 1.66:1, below the 4.5:1 its text needs",
    ]);
    // Fills text stands well on pass, and none is the paper, checked already.
    expect(
      tabled({
        headerRow: { fill: '#dbe4f0', bold: true, rule: 'none' },
        headerColumn: { fill: '#eeeeee', bold: false, rule: 'none' },
        banding: { fill: '#f5f5f5' },
      }).ok,
    ).toBe(true);
  });

  it('judges header text bold where the header says bold, so it asks what large bold text asks', () => {
    // #949494 on white is 3.03:1: enough for 14pt bold, not for 14pt regular.
    const fill = { fill: '#ffffff', rule: 'none' };
    const cell = { size: 14, lineSpacing: 18, colour: '#949494' };
    // The cell's text is refused on the paper as well, and its marks are judged on the fill: only
    // the cell's text on the header's fill is under test here.
    const bold = tabled({ headerRow: { ...fill, bold: true } }, cell);
    const regular = tabled({ headerRow: { ...fill, bold: false } }, cell);
    const tables = (outcome: ReturnType<typeof read>) =>
      outcome.ok
        ? []
        : outcome.refusals
            .map((each) => each.message)
            .filter((each) => each.startsWith('The table style'));
    expect(tables(bold)).toEqual([]);
    expect(tables(regular)).toEqual([
      "The table style table sets the text of the paragraph style table-cell, #949494, on its header row's fill #ffffff at 3.03:1, below the 4.5:1 its text needs",
    ]);
  });

  it("judges a mark on a table's fills at the size and weight it sets, in its own colour or the cell's", () => {
    // Every cell's text 18pt and #595959 on a #b0b0b0 band, 3.22:1: enough for large text. Inline
    // code at 0.8 of it is 14.4pt and regular, which is not large, and is refused in the cell's
    // colour; the scripts, smaller still, are refused alike. A link in its own #6a6a6a is 2.49:1, where on the paper and on preformatted text's fill it passes.
    const outcome = tabled(
      { banding: { fill: '#b0b0b0' } },
      { size: 18, lineSpacing: 22, colour: '#595959' },
      { hyperlink: { colour: '#6a6a6a' } },
    );
    expect(outcome.ok ? [] : outcome.refusals.map((each) => each.message)).toEqual([
      "The character style link sets #6a6a6a on the band's fill #b0b0b0 of the table style table at 2.49:1, below the 3:1 its text needs",
      "The character style subscript sets #595959, the colour of the paragraph style table-cell, on the band's fill #b0b0b0 of the table style table at 3.22:1, below the 4.5:1 its text needs",
      "The character style superscript sets #595959, the colour of the paragraph style table-cell, on the band's fill #b0b0b0 of the table style table at 3.22:1, below the 4.5:1 its text needs",
      "The character style inline-code sets #595959, the colour of the paragraph style table-cell, on the band's fill #b0b0b0 of the table style table at 3.22:1, below the 4.5:1 its text needs",
    ]);
  });

  it('judges nothing on a fill where the cell text stands on a background of its own', () => {
    // The cell's paragraph fills behind its text, so a header's fill is never behind the text.
    expect(
      tabled(
        { headerRow: { fill: '#333333', bold: false, rule: 'none' } },
        { background: '#ffffff' },
      ).ok,
    ).toBe(true);
  });
});

describe('readCatalogue', () => {
  it('reads a catalogue on its own, as the store does when a version is saved', () => {
    for (const kind of ['paragraph', 'table', 'image'] as const) {
      const outcome = readCatalogue(DEFAULT_CATALOGUES[kind]);
      expect(outcome, kind).toEqual({ ok: true, catalogue: DEFAULT_CATALOGUES[kind] });
    }
  });

  it("reads every catalogue/1 by upgrading it: a table and an image style gain template 12's look and today's rules, a paragraph base no contextual spacing", () => {
    // What the default theme's 0.1 rows hold, read as a publication made under them is set: exactly
    // the look 0.2 states outright.
    expect(readCatalogue(FIRST_DEFAULT_CATALOGUES.table)).toEqual({
      ok: true,
      catalogue: DEFAULT_CATALOGUES.table,
    });
    expect(readCatalogue(FIRST_DEFAULT_CATALOGUES.image)).toEqual({
      ok: true,
      catalogue: DEFAULT_CATALOGUES.image,
    });
    expect(readCatalogue(FIRST_DEFAULT_CATALOGUES.paragraph)).toEqual({
      ok: true,
      catalogue: {
        ...FIRST_DEFAULT_CATALOGUES.paragraph,
        schemaVersion: 2,
        base: { ...FIRST_DEFAULT_CATALOGUES.paragraph.base, contextualSpacing: false },
      },
    });
    for (const kind of ['character', 'admonition', 'citation'] as const) {
      expect(readCatalogue(FIRST_DEFAULT_CATALOGUES[kind]), kind).toEqual({
        ok: true,
        catalogue: { ...FIRST_DEFAULT_CATALOGUES[kind], schemaVersion: 2 },
      });
    }

    // Any table style, and each image style by what it applies to.
    const upgraded = readCatalogue({
      schemaVersion: 1,
      kind: 'image',
      styles: [
        { id: 'plate', name: 'Plate', appliesTo: ['figure'] },
        { id: 'glyph', name: 'Glyph', appliesTo: ['inlineImage'] },
      ],
    });
    expect(upgraded.ok && upgraded.catalogue.kind === 'image' && upgraded.catalogue.styles).toEqual(
      [
        { ...DEFAULT_CATALOGUES.image.styles[0], id: 'plate', name: 'Plate' },
        { ...DEFAULT_CATALOGUES.image.styles[1], id: 'glyph', name: 'Glyph' },
      ],
    );
  });

  it('holds a catalogue/1 to the parse its rows were written against, before it upgrades it', () => {
    // Version 2's properties were never version 1's: stated at 1 they are refused, never upgraded
    // past, so no row written at 1 can come to say something version 1 could not.
    const padded = readCatalogue({
      ...FIRST_DEFAULT_CATALOGUES.table,
      styles: [{ ...FIRST_DEFAULT_CATALOGUES.table.styles[0]!, padding: 12 }],
    });
    expect(padded.ok ? [] : padded.refusals.map((each) => each.code)).toEqual([
      'catalogue_malformed',
    ]);
    expect(padded.ok ? '' : padded.refusals[0]!.message).toMatch(/^The catalogue does not read/);
    const spaced = readCatalogue({
      ...FIRST_DEFAULT_CATALOGUES.paragraph,
      base: { ...FIRST_DEFAULT_CATALOGUES.paragraph.base, contextualSpacing: true },
    });
    expect(spaced.ok).toBe(false);
    expect(readCatalogue({ ...FIRST_DEFAULT_CATALOGUES.table, schemaVersion: 3 }).ok).toBe(false);
  });

  it("refuses what it can know without a theme: the shape, duplicates, marks and chains, but not a typeface's name", () => {
    const inputs = defaultInputs();
    const styles = inputs.catalogues.paragraph.styles;
    const outcome = readCatalogue({
      ...inputs.catalogues.paragraph,
      styles: [
        ...styles,
        { ...styles[0]! },
        { id: 'loose', name: 'Loose', basedOn: 'nowhere', appliesTo: ['text'], properties: {} },
        { id: 'sans', name: 'Sans', appliesTo: ['text'], properties: { typeface: 'sans' } },
      ],
    });
    expect(outcome.ok ? [] : outcome.refusals.map((each) => each.code)).toEqual([
      'style_duplicate',
      'style_parent_missing',
    ]);
    expect(codes(readTheme(null, new Map()))).toEqual(['theme_malformed']);
    expect(readCatalogue({ kind: 'paragraph' }).ok).toBe(false);
  });
});
