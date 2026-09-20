import { markTypes } from '@alloy-works/domain';
import { readFileSync } from 'node:fs';
import { Mark, type ParseRule, type TagParseRule } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { editorSchema } from './schema.js';

/**
 * The marks the editor holds: the content model's own list, in its own order, minus the three
 * annotations nothing in T1 can create. Derived rather than written out a second time, so that
 * reordering the content model's list, or adding a kind to it, fails here rather than drifting.
 */
const annotations: readonly string[] = ['condition', 'suggestion', 'comment'];
const editorMarks = markTypes.filter((name) => !annotations.includes(name));

/**
 * A stand-in for the element a parse rule is handed. `packages/editor` runs in Node, so there is no
 * `document` here; a hand-written fake is enough, because a rule only ever asks for attributes.
 */
const element = (attributes: Readonly<Record<string, string>>): HTMLElement =>
  ({ getAttribute: (name: string) => attributes[name] ?? null }) as unknown as HTMLElement;

const isTagRule = (rule: ParseRule): rule is TagParseRule => 'tag' in rule;

/** The single tag rule a mark is given, with the gate this slice requires it to carry. */
function ruleFor(name: string): TagParseRule & { getAttrs: (node: HTMLElement) => unknown } {
  const rules = editorSchema.marks[name]?.spec.parseDOM;
  const rule = rules?.[0];
  if (rules?.length !== 1 || !rule || !isTagRule(rule) || !rule.getAttrs)
    throw new Error(`${name} has no single gated tag rule`);
  return { ...rule, getAttrs: rule.getAttrs };
}

const gate = (name: string) => ruleFor(name).getAttrs;

describe('the editor schema', () => {
  it('holds the ten marks an author or the mapping needs', () => {
    expect(Object.keys(editorSchema.marks).sort()).toEqual([...editorMarks].sort());
    expect(editorMarks).toHaveLength(10);
  });

  it('does not hold a mark nothing in T1 can create', () => {
    for (const name of annotations) expect(editorSchema.marks[name]).toBeUndefined();
  });

  it("holds its marks in the content model's own order, so a round trip keeps a run's mark order", () => {
    expect(Object.keys(editorSchema.marks)).toEqual(editorMarks);
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

  it('renders a language mark with its tag, and says nothing about spelling', () => {
    const mark = editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' });
    // Whether the run is spell checked depends on the component's base language, which a mark's
    // `toDOM` cannot see. It is a decoration recomputed from the document (CNT-147, `state.ts`).
    expect(editorSchema.marks.language!.spec.toDOM!(mark, true)).toEqual([
      'span',
      { lang: 'fr-CA', class: 'aw-language', 'data-mark-id': 'm1' },
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

  it('matches only the elements it renders itself, by a selector it cannot widen unnoticed', () => {
    // `a[href]` rather than `a` is the one that matters: widening it would let a read-back make a
    // hyperlink with no target, which the content model refuses - an unsaveable document.
    const selectors: Readonly<Record<string, string>> = {
      emphasis: 'em',
      strong: 'strong',
      underline: 'u',
      subscript: 'sub',
      superscript: 'sup',
      inlineCode: 'code',
      definedTerm: 'dfn',
      quotedPhrase: 'q',
      hyperlink: 'a[href]',
      language: 'span.aw-language',
    };
    for (const name of Object.keys(editorSchema.marks))
      expect(ruleFor(name).tag, name).toBe(selectors[name]);
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
      expect(gate(name)(element({ 'data-mark-id': '' })), name).toBe(false);
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

  it('refuses a read-back whose required value is missing, which the content model would refuse', () => {
    // An identifier alone is not a mark. `<dfn data-mark-id="d1">` with no term, a language span
    // with no `lang` and a link with no `href` are each refused by the content model, so admitting
    // one here would make a document the author could not save.
    expect(gate('definedTerm')(element({ 'data-mark-id': 'd1' }))).toBe(false);
    expect(gate('language')(element({ 'data-mark-id': 'd2' }))).toBe(false);
    expect(gate('hyperlink')(element({ 'data-mark-id': 'd3' }))).toBe(false);
    expect(gate('definedTerm')(element({ 'data-mark-id': 'd4', 'data-term': '' }))).toBe(false);
  });

  it('holds one mark of a type on a character, and cannot see two positions at once', () => {
    const french = editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' });
    const german = editorSchema.mark('language', { id: 'm1', tag: 'de-DE' });
    // A second language mark replaces the first over the same characters, so one identifier cannot
    // carry two values in one place.
    expect(german.addToSet([french]).map((mark) => mark.attrs.tag)).toEqual(['de-DE']);
    // Across two places it can, and no mark spec can tell: a spec is handed one mark, never the
    // document. CNT-004's "one annotation under one identifier" is held over the whole document, by
    // `parseContentDocument`, which `fromEditor` ends in - so a command that re-used an identifier
    // for a changed value would be refused on the way to storage rather than silently stored.
    expect(french.eq(german)).toBe(false);
  });
});

describe('the editor stylesheet', () => {
  it('styles every mark the schema can render', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8');
    // A rule at a time, comments stripped first: a selector counts only when it heads a real
    // `{ ... }` rule body, not when it merely appears in a comment or a string - so this also
    // proves the file parses as CSS, not just that the ten names occur somewhere in the text.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleSelectors = [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
      match[1]!.split(',').map((selector) => selector.trim()),
    );
    // The eight tag selectors task 1's schema renders, `a[href]` for the hyperlink (not the bare
    // `a`, which would style an anchor with no target) and `.aw-language` for the language mark,
    // whose own element carries no tag of its own (F19).
    const expected = [
      '.ProseMirror em',
      '.ProseMirror strong',
      '.ProseMirror u',
      '.ProseMirror sub',
      '.ProseMirror sup',
      '.ProseMirror code',
      '.ProseMirror q',
      '.ProseMirror dfn',
      '.ProseMirror a[href]',
      '.ProseMirror .aw-language',
    ];
    for (const selector of expected) expect(ruleSelectors, selector).toContain(selector);
  });
});
