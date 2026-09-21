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
  ({
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
  }) as unknown as HTMLElement;

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

describe('the lists in the editor schema', () => {
  /**
   * The five node types, named once. The tuples are `as const` because `Schema.nodes` is a mapped
   * type over the names the schema was built with: a `string` index would not typecheck, and a
   * misspelling here should fail the compiler rather than the assertion.
   */
  const items = ['listItem', 'definitionItem'] as const;
  const lists = ['list', 'definitionList'] as const;

  /**
   * The content match an item offers **once its required opening has been matched**. `contentMatch`
   * is the match at position zero, and a definition item opens with its term (decision C: a
   * ProseMirror content expression is fixed per type, so one item type cannot be `block+` for two
   * kinds and `term block+` for the third). Do not "simplify" this by relaxing `definitionItem` to
   * `block+` or `term? block+` - that is the one change decision C exists to forbid.
   */
  const opens = (item: (typeof items)[number]) =>
    item === 'definitionItem'
      ? editorSchema.nodes.definitionItem.contentMatch.matchType(editorSchema.nodes.term)!
      : editorSchema.nodes.listItem.contentMatch;

  it('holds a list and an item shaped as the stored model holds them', () => {
    expect(editorSchema.nodes.list.spec.content).toBe('listItem+');
    expect(editorSchema.nodes.listItem.spec.content).toBe('block+');
    // The item carries nothing: the stored item has no identifier, so neither has this.
    expect(editorSchema.nodes.listItem.spec.attrs).toBeUndefined();
    expect(editorSchema.nodes.listItem.spec.defining).toBe(true);
  });

  // Uncited on purpose. CNT-117 asks for lists in three kinds - ordered, unordered and definition -
  // and this body is about the definition kind alone, which is a third of the statement and not the
  // statement. The citation belongs on a body that makes all three and round-trips them.
  it('holds a definition list whose item opens with the term it defines', () => {
    expect(editorSchema.nodes.definitionList.spec.content).toBe('definitionItem+');
    expect(editorSchema.nodes.definitionItem.spec.content).toBe('term block+');
    // A term takes marks, because a term is inline content and not a string.
    expect(editorSchema.nodes.term.spec.marks).toBe('_');
  });

  it('keeps a term out of the block group, which the adjacency walk depends on', () => {
    // `noAdjacentEmptyParagraphs` in `state.ts` builds each sequence from the children in the
    // `block` group, because that is the sequence the stored model holds CNT-023 over: an item's
    // term belongs to the item and its blocks are a sequence of their own (`checkBlock` in
    // `packages/domain`). Give `term` this group and the editor's sequence stops being the stored
    // model's.
    //
    // Worth recording plainly: **no shape this schema can make distinguishes the two readings
    // today.** `definitionItem` is `term block+`, so a term can only stand first, and the walk's
    // emptiness test keys on the type name `paragraph`, so a term pairs with nothing whatever group
    // it is in. That is what makes this assertion the guard rather than a document-level test - and
    // what makes it worth having, because the day a family puts a node that is not a block between
    // two that are, the group is the only thing standing between the two write paths.
    expect(editorSchema.nodes.term.isInGroup('block')).toBe(false);
    expect(editorSchema.nodes.listItem.isInGroup('block')).toBe(false);
    for (const name of ['paragraph', 'list', 'definitionList'] as const) {
      expect(editorSchema.nodes[name].isInGroup('block')).toBe(true);
    }
  });

  // Uncited on purpose. CNT-124 - "a component must always hold at least one block ... a newly
  // created component must hold exactly one empty paragraph" - is a rule of the content model and is
  // already `Covered` where the model holds it. This body shows only that widening `doc` to `block+`
  // did not change what ProseMirror puts in an empty document, which is a regression guard on the
  // change this task makes.
  it('still fills an empty document with a paragraph, not a list', () => {
    expect(editorSchema.nodes.doc.spec.content).toBe('block+');
    // `paragraph` is declared first among the block group, and that order is what ProseMirror fills
    // from. `Schema.node` would throw here rather than fill: `createAndFill` is the API that answers
    // what an empty document becomes.
    expect(editorSchema.nodes.paragraph.spec.group).toBe('block');
    const doc = editorSchema.nodes.doc.createAndFill({
      title: 'T',
      language: 'en-GB',
      direction: 'ltr',
    })!;
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe('paragraph');
  });

  it('renders a numbered list as an ordered list and a bulleted one as unordered', () => {
    const item = () =>
      editorSchema.node('listItem', null, [editorSchema.node('paragraph', { id: 'b1' })]);
    const ordered = editorSchema.node(
      'list',
      { id: 'L1', kind: 'ordered', start: 5, format: 'alphabetic' },
      [item()],
    );
    // The start and the numbering reach the element, because a stylesheet can only style what the
    // element carries: without them the surface shows `1.` where the PDF shows `e.`.
    expect(editorSchema.nodes.list.spec.toDOM!(ordered)).toEqual([
      'ol',
      { start: '5', 'data-format': 'alphabetic' },
      0,
    ]);
    const bulleted = editorSchema.node('list', { id: 'L2' }, [item()]);
    expect(editorSchema.nodes.list.spec.toDOM!(bulleted)).toEqual(['ul', {}, 0]);
  });

  it('reads a numbered list back with the start and the numbering it was rendered with', () => {
    // `parseDOM` is not decoration here either (see `markSpec`): prosemirror-view reads typed input
    // back out of the DOM, so a rule that dropped `start` and `format` would reset an author's
    // numbering as they typed in the list.
    const rule = editorSchema.nodes.list.spec
      .parseDOM!.filter(isTagRule)
      .find((r) => r.tag === 'ol');
    expect(rule?.getAttrs?.(element({ start: '5', 'data-format': 'alphabetic' }))).toEqual({
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
    });
    expect(rule?.getAttrs?.(element({}))).toEqual({ kind: 'ordered', start: null, format: null });
  });

  it('reads back no start and no numbering from an element carrying neither', () => {
    // `Number('five')` is `NaN` and `Number('')` is 0, and `data-format` would otherwise come
    // through whatever it said. `listNodeSchema` refuses both, and a document that reaches
    // `saveIteration` carrying one is answered with a fixed message that names nothing - so
    // anything the store would refuse reads as absent here, which is always storable.
    const rule = editorSchema.nodes.list.spec
      .parseDOM!.filter(isTagRule)
      .find((r) => r.tag === 'ol');
    expect(rule?.getAttrs?.(element({ start: 'five', 'data-format': 'bullets' }))).toEqual({
      kind: 'ordered',
      start: null,
      format: null,
    });
    expect(rule?.getAttrs?.(element({ start: '2.5' }))).toEqual({
      kind: 'ordered',
      start: null,
      format: null,
    });
    expect(rule?.getAttrs?.(element({ start: '-1' }))).toEqual({
      kind: 'ordered',
      start: null,
      format: null,
    });
    // A start of 0 is one a decimal list may have, so it is read rather than dropped (CNT-153,
    // held in `checkBlock` and in `setListAttributes`).
    expect(rule?.getAttrs?.(element({ start: '0' }))).toEqual({
      kind: 'ordered',
      start: 0,
      format: null,
    });
  });

  it('lets every kind of item hold every kind of list, so any mixture nests', () => {
    // Uncited on purpose. CNT-118 asks that a list nests to at least six levels in every kind and in
    // any mixture of kinds; this body asserts content expressions and makes no levels at all. It
    // shows the schema permits the mixture, which is a precondition and not the requirement.
    for (const item of items)
      for (const list of lists)
        expect(
          opens(item).matchType(editorSchema.nodes[list]),
          `${item} -> ${list}`,
        ).not.toBeNull();
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
    // Each mark's own selector, read from what its `toDOM` actually renders rather than written out
    // by hand: `a[href]` for the hyperlink, because its rendered element carries an `href` (never
    // the bare `a`, which would style an anchor with no target), and `.aw-language` for the language
    // mark, because its rendered element carries a `class` and no tag of its own (F19). Deriving the
    // list this way, rather than spelling out the ten strings, means a mark added later with no rule
    // of its own fails here on the day it is added, not on the day someone remembers to extend a
    // hand-written list.
    const selectorOf = (name: string): string => {
      const type = editorSchema.marks[name]!;
      const attrs = Object.fromEntries(Object.keys(type.spec.attrs ?? {}).map((key) => [key, 'x']));
      const mark = type.create(attrs);
      const [tag, domAttrs] = type.spec.toDOM!(mark, true) as [string, Record<string, string>, 0];
      if (typeof domAttrs.class === 'string') return `.${domAttrs.class}`;
      if ('href' in domAttrs) return `${tag}[href]`;
      return tag;
    };

    for (const name of Object.keys(editorSchema.marks)) {
      const selector = `.ProseMirror ${selectorOf(name)}`;
      expect(ruleSelectors, selector).toContain(selector);
    }
  });

  it('styles a list at every level it can nest', () => {
    // Read from disk and parsed the same way as the mark test above, and for the same reason: this
    // also proves the file still parses as CSS once the list rules are added, not merely that some
    // text occurs in it.
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8');
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleSelectors = [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
      match[1]!.split(',').map((selector) => selector.trim()),
    );
    const expectSelector = (selector: string) =>
      expect(ruleSelectors, selector).toContain(selector);

    // The tag a rendered node carries, read from its own `toDOM` output rather than typed as a
    // literal string: a selector below is built out of this, so a tag `toDOM` stops rendering fails
    // here first, on the selector it changes, rather than leaving a rule silently unreachable.
    const tagOf = (domOutput: unknown): string => (domOutput as [string, ...unknown[]])[0];
    const formatOf = (domOutput: unknown): string | undefined => {
      const [, attrs] = domOutput as [string, Record<string, string>, 0];
      return attrs['data-format'];
    };

    const paragraph = (id: string) => editorSchema.node('paragraph', { id });
    const listItem = (id: string) => editorSchema.node('listItem', null, [paragraph(id)]);
    const list = (attrs: Record<string, unknown>, child: ReturnType<typeof listItem>) =>
      editorSchema.node('list', attrs, [child]);

    const ulTag = tagOf(editorSchema.nodes.list.spec.toDOM!(list({ id: 'L1' }, listItem('b1'))));
    const liTag = tagOf(editorSchema.nodes.listItem.spec.toDOM!(listItem('b2')));

    // The template pins three markers - disc, circle, square - and **cycles** them, so a fourth
    // level takes the disc again (docs/plans/2026-09-21-editor-04-lists-and-quotations.md; the
    // marker set belongs in a theme and not a template, which is issue #158 and not this task's
    // fix). CSS cannot say "every three", and a selector of three `ul`s matches three levels **or
    // more** - so left at three the surface was square from the third level down while the
    // publication cycled, which is the opposite of what the stylesheet claimed. The cycle is written
    // out to six levels, CNT-118's floor and the depth the template's own note confirms; a list
    // nested inside itself is that many copies of its own tag, chained by descendant combinators,
    // because that is what a real nested list looks like in the DOM.
    for (let depth = 1; depth <= 6; depth += 1) {
      expectSelector(`.ProseMirror ${Array(depth).fill(ulTag).join(' ')}`);
    }

    // A list item holding another list is `li` inside `li` in the DOM: the selector a nested list's
    // indentation step needs.
    expectSelector(`.ProseMirror ${liTag}`);
    expectSelector(`.ProseMirror ${liTag} ${liTag}`);

    // An ordered list takes its marker from the node's own `format`, not from the browser's default
    // numbering, so the surface and the PDF agree on what an author set in the panel.
    const orderedList = (format: string | null) =>
      list({ id: 'L2', kind: 'ordered', format }, listItem('b3'));
    const olTag = tagOf(editorSchema.nodes.list.spec.toDOM!(orderedList(null)));
    expectSelector(`.ProseMirror ${olTag}`);
    for (const format of ['alphabetic', 'roman'] as const) {
      const value = formatOf(editorSchema.nodes.list.spec.toDOM!(orderedList(format)));
      expectSelector(`.ProseMirror ${olTag}[data-format='${value}']`);
    }

    // The term: set apart from its own definition without colour alone.
    const dlTag = tagOf(
      editorSchema.nodes.definitionList.spec.toDOM!(
        editorSchema.node('definitionList', { id: 'D1' }, [
          editorSchema.node('definitionItem', null, [
            editorSchema.node('term', null),
            paragraph('b4'),
          ]),
        ]),
      ),
    );
    expectSelector(`.ProseMirror ${dlTag}`);
    const dtTag = tagOf(editorSchema.nodes.term.spec.toDOM!(editorSchema.node('term', null)));
    expectSelector(`.ProseMirror ${dtTag}`);
  });
});
