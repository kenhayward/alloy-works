import { describe, expect, it } from 'vitest';
import { canonicaliseOutline, parseOutlineDocument } from '../structure/outline.js';
import { applyOutlineOperation, outlineOperationSchema } from '../structure/operations.js';
import { titlesIn } from './titles.js';

const SECTION = 'methods'.padEnd(26, 'a');
const empty = {
  schemaVersion: 3,
  title: 'Pond survey',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      type: 'section',
      id: SECTION,
      title: [{ type: 'text', value: 'Methods', marks: [] }],
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    },
  ],
};

const apply = (outline: ReturnType<typeof parseOutlineDocument>, operation: unknown) =>
  applyOutlineOperation(outline, outlineOperationSchema.parse(operation), () => 'unused');

describe('titles by language (the TR plan, TR-L)', () => {
  it('holds the document’s and each section’s title in a further language, in its content and its digest, and never in its own', () => {
    const outline = parseOutlineDocument(empty);
    const named = apply(outline, {
      operation: 'translateTitle',
      node: null,
      language: 'fr-FR',
      title: 'Étude des étangs',
    });
    if (!named.applied) throw new Error(named.reason);
    const both = apply(named.outline, {
      operation: 'translateTitle',
      node: SECTION,
      language: 'fr-FR',
      title: 'Méthodes',
    });
    if (!both.applied) throw new Error(both.reason);
    expect(both.outline.titles).toEqual({ 'fr-FR': 'Étude des étangs' });
    expect(both.outline.nodes[0]).toMatchObject({ titles: { 'fr-FR': 'Méthodes' } });
    expect(canonicaliseOutline(both.outline)).toContain('"titles":{"fr-FR":"Méthodes"}');
    expect(canonicaliseOutline(outline)).not.toContain('titles');

    // In its own language a title is its title, never a translation of it.
    expect(
      apply(outline, { operation: 'translateTitle', node: null, language: 'en-GB', title: 'X' }),
    ).toMatchObject({ applied: false });
    // Cleared with null.
    const cleared = apply(both.outline, {
      operation: 'translateTitle',
      node: SECTION,
      language: 'fr-FR',
      title: null,
    });
    if (!cleared.applied) throw new Error(cleared.reason);
    expect(cleared.outline.nodes[0]).not.toHaveProperty('titles');
    // Refused, never silently dropped, past the most languages a title is given in (the TR final
    // review).
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const full = parseOutlineDocument({
      ...empty,
      titles: Object.fromEntries(
        Array.from({ length: 50 }, (_, n) => [
          `${letters[Math.floor(n / 26)]}${letters[n % 26]}`,
          'Words',
        ]),
      ),
    });
    expect(
      apply(full, { operation: 'translateTitle', node: null, language: 'zz', title: 'Words' }),
    ).toMatchObject({ applied: false });
  });

  it('reads an outline in a language: each title it has there, and names each it lacks', () => {
    const outline = parseOutlineDocument({
      ...empty,
      titles: { fr: 'Étude des étangs' },
    });
    const { outline: read, missing, untitled } = titlesIn(outline, 'fr-FR');
    expect(untitled).toBe(false);
    expect(read.title).toBe('Étude des étangs');
    expect(read.nodes[0]).toMatchObject({
      title: [{ type: 'text', value: 'Methods', marks: [] }],
    });
    expect(missing).toEqual([SECTION]);
    expect(titlesIn(outline, 'de-DE').untitled).toBe(true);
    // In a language its own titles serve, it is itself.
    expect(titlesIn(outline, 'en')).toEqual({ outline, missing: [], untitled: false });
  });
});
