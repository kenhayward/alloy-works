import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import { defaultNumberingScheme } from '../structure/scheme.js';

import { assemble, type AssembleInput } from './assemble.js';
import type { PublishFailure } from './failures.js';

/** A 26-character node identifier, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const positional = {
  numbered: true,
  matter: 'body' as const,
  pageBreak: 'none' as const,
  values: {},
};
const section = (name: string, title: string, children: unknown[] = []) => ({
  type: 'section',
  id: id(name),
  title: [text(title)],
  ...positional,
  children,
});
const reference = (name: string, component = COMPONENT, children: unknown[] = []) => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  ...positional,
  children,
});

const outline = (nodes: unknown[], language = 'en-GB'): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language,
    direction: 'ltr',
    nodes,
  });

const component = (content: unknown[], over: Partial<ContentDocument> = {}): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Calibration',
    language: 'en-GB',
    direction: 'ltr',
    content,
    ...over,
  });

const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});

/** Latin, and nothing else: enough to show a character outside it failing. */
const latin = (codePoint: number) => codePoint < 0x250;

const input = (over: Partial<AssembleInput>): AssembleInput => ({
  outline: outline([]),
  occurrences: new Map(),
  refused: [],
  scheme: defaultNumberingScheme,
  covers: latin,
  ...over,
});

describe('assemble', () => {
  it('projects the outline as headings numbered by number, and each occurrence as its paragraphs', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib')]),
          section('scope', 'Scope'),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
      }),
    );

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.document.nodes).toEqual([
      {
        id: id('intro'),
        depth: 1,
        number: '1',
        title: 'Introduction',
        language: null,
        direction: null,
        blocks: [],
        children: [
          {
            id: id('calib'),
            depth: 2,
            number: '1.1',
            title: 'Calibration',
            language: null,
            direction: null,
            blocks: [{ type: 'paragraph', id: 'p1', runs: [{ text: 'Set the tray.' }] }],
            children: [],
          },
        ],
      },
      {
        id: id('scope'),
        depth: 1,
        number: '2',
        title: 'Scope',
        language: null,
        direction: null,
        blocks: [],
        children: [],
      },
    ]);
    expect(assembled.document.language).toEqual({ lang: 'en', region: 'GB' });
    expect(assembled.document.status).toBe('draft');
  });

  it('carries a component whose language differs from the document', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('fr'), reference('fil')]),
        occurrences: new Map([
          [
            id('fr'),
            component([paragraph('p1', text('Le plateau.'))], {
              language: 'fr-FR',
              title: 'Le plateau',
            }),
          ],
          [
            id('fil'),
            component([paragraph('p1', text('Ang tray.'))], {
              language: 'fil',
              title: 'Ang tray',
            }),
          ],
        ]),
      }),
    );
    expect(assembled.ok && assembled.document.nodes.map((node) => node.language)).toEqual([
      { lang: 'fr', region: 'FR' },
      { lang: 'fil', region: null },
    ]);
  });

  it('refuses a language tag the engine cannot carry, naming it, and never shortens it', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('es'), reference('sl'), reference('sr')], 'sr-Latn'),
        occurrences: new Map([
          [
            id('es'),
            component([paragraph('p1', text('La bandeja.'))], {
              language: 'es-419',
              title: 'La bandeja',
            }),
          ],
          [
            id('sl'),
            component([paragraph('p1', text('Pladenj.'))], {
              language: 'sl-rozaj',
              title: 'Pladenj',
            }),
          ],
          // The document's own tag: refused once, for the document, and not again here.
          [
            id('sr'),
            component([paragraph('p1', text('Posuda.'))], {
              language: 'sr-Latn',
              title: 'Posuda',
            }),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: null,
        block: null,
        detail: 'sr-Latn',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: id('es'),
        block: null,
        detail: 'es-419',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: id('sl'),
        block: null,
        detail: 'sl-rozaj',
      },
    ]);
  });

  it('PUB-052 reports every failure at once: an unreadable place, a mark, a block and a glyph', () => {
    const unreadable: PublishFailure = {
      stage: 'resolve',
      code: 'occurrence_unreadable',
      node: id('hidden'),
      block: null,
      detail: null,
    };
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [
            reference('hidden', OTHER),
            reference('calib'),
            // Nothing resolved this reference; what is under it is still checked.
            reference('lost', COMPONENT, [section('under', 'Under \u{4e2d}')]),
          ]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              paragraph(
                'p1',
                { type: 'text', value: 'Bold', marks: [{ type: 'strong', id: 'm1' }] },
                { type: 'text', value: 'Leaning', marks: [{ type: 'emphasis', id: 'm2' }] },
              ),
              { type: 'preformatted', id: 'pre1', text: 'x' },
              paragraph('p2', text('Arabic \u{627} and \u{4e2d} here')),
            ]),
          ],
        ]),
        refused: [unreadable],
      }),
    );

    expect(assembled.ok).toBe(false);
    expect(!assembled.ok && assembled.failures).toEqual([
      unreadable,
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'strong',
      },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'emphasis',
      },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: id('calib'),
        block: 'pre1',
        detail: 'preformatted',
      },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p2', detail: 'U+0627' },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p2', detail: 'U+4E2D' },
      {
        stage: 'resolve',
        code: 'occurrence_unresolved',
        node: id('lost'),
        block: null,
        detail: null,
      },
      { stage: 'compose', code: 'glyph_missing', node: id('under'), block: null, detail: 'U+4E2D' },
    ]);
  });

  it('PUB-086 names the stage of every failure and the place it concerns', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Intro \u{627}'),
          reference('calib'),
          reference('lost'),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('a\u{feff}b'))])]]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('intro'), block: null, detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'character_disallowed',
        node: id('calib'),
        block: 'p1',
        detail: 'U+FEFF',
      },
      {
        stage: 'resolve',
        code: 'occurrence_unresolved',
        node: id('lost'),
        block: null,
        detail: null,
      },
    ]);
  });

  it('sets what the engine sets without a glyph, and reports a character twice as one failure', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('calib')]),
        occurrences: new Map([
          [
            id('calib'),
            component([paragraph('p1', text('X\u{2011}Y\u{ad}\u{200b}\nZ \u{4e2d}\u{4e2d}'))]),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p1', detail: 'U+4E2D' },
    ]);
  });

  it('sets bidi isolates, the Arabic letter mark and tag characters without a glyph, and still refuses a byte-order mark', () => {
    /** Latin and Hebrew, as the pinned faces hold both. */
    const latinAndHebrew = (codePoint: number) =>
      latin(codePoint) || (codePoint >= 0x590 && codePoint <= 0x5ff);
    const assembled = assemble(
      input({
        outline: outline([reference('he')]),
        covers: latinAndHebrew,
        occurrences: new Map([
          [
            id('he'),
            component(
              [
                paragraph('p1', text('\u{5de}\u{5d2}\u{5e9} \u{2066}Tray 4\u{2069} \u{61c}1')),
                paragraph('p2', text('Flag \u{e0067}\u{e0062}\u{e0041}\u{e007f}')),
                paragraph('p3', text('\u{5de}\u{feff}\u{5d2}')),
              ],
              { language: 'he', direction: 'rtl', title: '\u{5de}\u{5d2}\u{5e9}' },
            ),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'character_disallowed',
        node: id('he'),
        block: 'p3',
        detail: 'U+FEFF',
      },
    ]);
  });

  it('answers the same for the same inputs', () => {
    const same = input({
      outline: outline([section('intro', 'Introduction', [reference('calib')])]),
      occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
    });
    expect(assemble(same)).toEqual(assemble(same));
  });
});
