import { Mark, type ParseRule, type TagParseRule } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { editorSchema } from './schema.js';

/**
 * A stand-in for the element a parse rule is handed. `packages/editor` runs in Node, so there is no
 * `document` here; a hand-written fake is enough, because a rule only ever asks for attributes.
 */
const element = (attributes: Readonly<Record<string, string>>): HTMLElement =>
  ({ getAttribute: (name: string) => attributes[name] ?? null }) as unknown as HTMLElement;

const isTagRule = (rule: ParseRule): rule is TagParseRule => 'tag' in rule;

/** The single tag rule a mark is given, with the gate this slice requires it to carry. */
function gate(name: string): (node: HTMLElement) => unknown {
  const rules = editorSchema.marks[name]?.spec.parseDOM;
  const rule = rules?.[0];
  if (rules?.length !== 1 || !rule || !isTagRule(rule) || !rule.getAttrs)
    throw new Error(`${name} has no single gated tag rule`);
  return rule.getAttrs;
}

describe('the editor schema', () => {
  it('holds the ten marks an author or the mapping needs', () => {
    expect(Object.keys(editorSchema.marks).sort()).toEqual([
      'definedTerm',
      'emphasis',
      'hyperlink',
      'inlineCode',
      'language',
      'quotedPhrase',
      'strong',
      'subscript',
      'superscript',
      'underline',
    ]);
  });

  it('does not hold a mark nothing in T1 can create', () => {
    for (const name of ['condition', 'suggestion', 'comment'])
      expect(editorSchema.marks[name]).toBeUndefined();
  });

  it("holds its marks in the content model's own order, so a round trip keeps a run's mark order", () => {
    expect(Object.keys(editorSchema.marks)).toEqual([
      'emphasis',
      'strong',
      'underline',
      'subscript',
      'superscript',
      'inlineCode',
      'definedTerm',
      'quotedPhrase',
      'hyperlink',
      'language',
    ]);
    // Why the order above is load-bearing rather than tidy: `Mark.setFrom` sorts by the rank a mark
    // was declared with, so the editor cannot preserve the order a stored run was written in, and a
    // mapping fixture written in declaration order passes whether or not the mapping works.
    const built = Mark.setFrom([
      editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' }),
      editorSchema.mark('inlineCode', { id: 'm2' }),
      editorSchema.mark('emphasis', { id: 'm3' }),
    ]);
    expect(built.map((mark) => mark.type.name)).toEqual(['emphasis', 'inlineCode', 'language']);
  });

  it('lets a paragraph carry every mark, where before it carried none', () => {
    expect(editorSchema.nodes.paragraph.markSet).toBeNull();
    for (const type of Object.values(editorSchema.marks))
      expect(editorSchema.nodes.paragraph.allowsMarkType(type)).toBe(true);
  });

  it('does not extend a hyperlink or a language mark by typing at its end', () => {
    expect(editorSchema.marks.hyperlink!.spec.inclusive).toBe(false);
    expect(editorSchema.marks.language!.spec.inclusive).toBe(false);
    expect(editorSchema.marks.emphasis!.spec.inclusive ?? true).toBe(true);
  });

  it('CNT-147 renders a language mark with its tag and asks that it is not spell checked', () => {
    const mark = editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' });
    expect(editorSchema.marks.language!.spec.toDOM!(mark, true)).toEqual([
      'span',
      { lang: 'fr-CA', spellcheck: 'false', class: 'aw-language', 'data-mark-id': 'm1' },
      0,
    ]);
  });

  it('CNT-126 renders a hyperlink with its target and its title', () => {
    const withTitle = editorSchema.mark('hyperlink', {
      id: 'm2',
      href: 'https://example.test/report',
      title: 'The quarterly report',
    });
    expect(editorSchema.marks.hyperlink!.spec.toDOM!(withTitle, true)).toEqual([
      'a',
      {
        href: 'https://example.test/report',
        title: 'The quarterly report',
        'data-mark-id': 'm2',
      },
      0,
    ]);
    const bare = editorSchema.mark('hyperlink', { id: 'm3', href: 'mailto:ada@example.test' });
    expect(editorSchema.marks.hyperlink!.spec.toDOM!(bare, true)).toEqual([
      'a',
      { href: 'mailto:ada@example.test', 'data-mark-id': 'm3' },
      0,
    ]);
  });

  it('renders every other mark as its own element, carrying the identifier', () => {
    const rendered = (name: string, attrs: Record<string, string>) =>
      editorSchema.marks[name]!.spec.toDOM!(editorSchema.mark(name, attrs), true);
    expect(rendered('emphasis', { id: 'm1' })).toEqual(['em', { 'data-mark-id': 'm1' }, 0]);
    expect(rendered('strong', { id: 'm2' })).toEqual(['strong', { 'data-mark-id': 'm2' }, 0]);
    expect(rendered('underline', { id: 'm3' })).toEqual(['u', { 'data-mark-id': 'm3' }, 0]);
    expect(rendered('subscript', { id: 'm4' })).toEqual(['sub', { 'data-mark-id': 'm4' }, 0]);
    expect(rendered('superscript', { id: 'm5' })).toEqual(['sup', { 'data-mark-id': 'm5' }, 0]);
    expect(rendered('inlineCode', { id: 'm6' })).toEqual(['code', { 'data-mark-id': 'm6' }, 0]);
    expect(rendered('quotedPhrase', { id: 'm7' })).toEqual(['q', { 'data-mark-id': 'm7' }, 0]);
    expect(rendered('definedTerm', { id: 'm8', term: 'toner' })).toEqual([
      'dfn',
      { 'data-term': 'toner', 'data-mark-id': 'm8' },
      0,
    ]);
  });

  it('reads back a mark it rendered itself, and never one without an identifier', () => {
    // prosemirror-view reads typed input out of the DOM through the schema's own parser, so a mark
    // with no rule is invisible to it and the diff can drop it as the author types. The rule exists
    // for that read-back alone: it matches nothing the editor did not write, because `data-mark-id`
    // is the gate and an identifier is never invented here.
    for (const name of Object.keys(editorSchema.marks)) {
      expect(gate(name)(element({ lang: 'fr-CA', href: 'https://example.test/' })), name).toBe(
        false,
      );
    }
    expect(gate('emphasis')(element({ 'data-mark-id': 'm1' }))).toEqual({ id: 'm1' });
    expect(gate('definedTerm')(element({ 'data-mark-id': 'm2', 'data-term': 'toner' }))).toEqual({
      id: 'm2',
      term: 'toner',
    });
    expect(
      gate('hyperlink')(
        element({ 'data-mark-id': 'm3', href: 'https://example.test/report', title: 'Report' }),
      ),
    ).toEqual({ id: 'm3', href: 'https://example.test/report', title: 'Report' });
    expect(
      gate('hyperlink')(element({ 'data-mark-id': 'm4', href: 'mailto:ada@example.test' })),
    ).toEqual({ id: 'm4', href: 'mailto:ada@example.test', title: null });
    expect(gate('language')(element({ 'data-mark-id': 'm5', lang: 'fr-CA' }))).toEqual({
      id: 'm5',
      tag: 'fr-CA',
    });
  });

  it('holds one mark of a type on a character, and cannot see two positions at once', () => {
    const french = editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' });
    const german = editorSchema.mark('language', { id: 'm1', tag: 'de-DE' });
    // A second language mark replaces the first over the same characters, so one identifier cannot
    // carry two values in one place.
    expect(german.addToSet([french]).map((mark) => mark.attrs.tag)).toEqual(['de-DE']);
    // Across two places it can, and no mark spec can tell: a spec is handed one mark, never the
    // document. CNT-004's "one annotation under one identifier" is held by the commands that mint an
    // identifier per application, not here.
    expect(french.eq(german)).toBe(false);
  });
});
