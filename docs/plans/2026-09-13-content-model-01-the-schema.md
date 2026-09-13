# Content model 1: the schema and its canonical form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a component's content a thing the product can hold: a typed tree validated on every
boundary, serialised to one canonical form so its hash means something, recording the schema version
it was written against, with a migration path from that version to every version after it.

**Architecture:** Everything lands in `packages/domain/src/content/model/`, which is new and does not
touch the spike code beside it. Marks, then inline nodes, then blocks, then the root that holds them -
each a zod schema, each parsed through one entry point. Canonical serialisation is a pure function
over a parsed document; the hash is the caller's, so the domain package needs no crypto. Migration is a
read-time projection, never a rewrite, because versions are immutable.

**Tech Stack:** TypeScript strict, zod 4, Vitest 5. No new dependency.

**Spec:** [`../design/content-model.md`](../design/content-model.md)

First of several. This one is the stored shape and nothing else: no admission pipeline, no readers, no
resolution. Those have their own plans and are written when their turn comes.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail. A test that passes before the implementation exists is testing nothing.
- **Name the requirement in the `describe` or `it` title**, as `it('CNT-002 allocates an identifier on
every block', ...)`. This is load-bearing: `packages/trace` scans titles to compute `Covered`, and an
  identifier in a comment is a mention rather than a citation.
- **`packages/domain` stays platform-free.** No React, no Electron, no `fs`, no `window`, no
  `node:crypto`. The one part of the product testable without booting anything stays that way.
- **A passing run has no errors or warnings.** Pristine output is a gate, not a preference.
- **Prettier, printWidth 100.** `pnpm format` before every commit.
- **One pull request, one version bump, one changelog entry.** Never commit to `main`.
- **No real data anywhere.** Fixture names are invented: `Ada`, `Grace`, `Alice`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement this
  plan names.

---

## Three decisions taken before this plan was written

**1. The new model goes beside the spike code, not through it.** `packages/domain/src/content/`
already holds the spike's schema and the four gate-case tests that are the evidence ADR-0005 stands
on, plus `compare.ts`, `resolve.ts`, `binding.ts` and the OOXML pair. Rewriting `document.ts` in place
breaks all of them at once, and no task in between would leave the repository green.

So the new model is `packages/domain/src/content/model/`, and the spike code is untouched by this
plan. **Retiring it is a later plan's job**, along with moving the OOXML reader and writer to their own
workspace as [content-model.md](../design/content-model.md) requires, and re-pointing gate case 3 at an
authored table because a bound table is T2. That plan can do it in one move once there is something to
move onto. This plan states the debt rather than leaving it implicit.

**2. The hash is the caller's, and this package produces its canonical input.** `content_hash` belongs
to [storage-and-versioning.md](../design/storage-and-versioning.md). Hashing here would mean either
`node:crypto`, which is not platform-free, or `crypto.subtle`, which is async and would make parsing
async for no gain. So `canonicalise(document)` returns a string and whoever stores it hashes it. The
property that matters - two identical documents produce one string - is testable here without a hash.

**Member order is lexicographic.** [content-model.md](../design/content-model.md) says "members in a
declared order"; lexicographic is a declared order, it needs no table to be kept in step with the
schema, and a table that drifts from the schema is a hash that changes for no reason.

**3. An inline image carries an alternative the same way a figure does.** CNT-022 requires alternative
text of a figure and AST-015 makes decorative a state of its own. CNT-087 admits an image inline and
says nothing about either, which would leave an image with no accessible name representable. The design
does not settle this, so this plan does, narrowly: `image` carries the same three-state as `figure`, on
the grounds that an image with no accessible name is a WCAG 2.2 failure whether or not it sits in a
figure. If that is wrong it is one field and a migration, and it is named here so a reviewer can say so.

---

## Task 1: Marks, and the closed set

**Files:**

- Create: `packages/domain/src/content/model/marks.ts`
- Test: `packages/domain/src/content/model/marks.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `markSchema`, `markTypes`, `type Mark`, and the per-mark schemas by name

Thirteen marks, closed by CNT-006. Every one carries an identifier (CNT-004). Nothing carries a
typeface, a size or a colour (CNT-008).

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/model/marks.test.ts
import { describe, expect, it } from 'vitest';

import { markSchema, markTypes } from './marks.js';

describe('the mark vocabulary', () => {
  it('CNT-006 is closed, and the set is the thirteen the design names', () => {
    expect([...markTypes].sort()).toEqual(
      [
        'comment',
        'condition',
        'definedTerm',
        'emphasis',
        'hyperlink',
        'inlineCode',
        'language',
        'quotedPhrase',
        'strong',
        'subscript',
        'suggestion',
        'superscript',
        'underline',
      ].sort(),
    );
  });

  it('CNT-006 refuses a mark type outside the set', () => {
    expect(() => markSchema.parse({ type: 'highlight', id: 'm1' })).toThrow();
  });

  it('CNT-004 requires an identifier on every mark', () => {
    for (const type of markTypes) {
      expect(() => markSchema.parse({ type })).toThrow();
    }
  });

  it('CNT-008 refuses a mark carrying appearance', () => {
    expect(() => markSchema.parse({ type: 'strong', id: 'm1', colour: 'red' })).toThrow();
    expect(() => markSchema.parse({ type: 'strong', id: 'm1', fontSize: 12 })).toThrow();
  });

  it('CNT-032 carries an axis and permitted values on a condition', () => {
    const mark = markSchema.parse({
      type: 'condition',
      id: 'm1',
      axis: 'jurisdiction',
      values: ['uk'],
    });
    expect(mark).toEqual({ type: 'condition', id: 'm1', axis: 'jurisdiction', values: ['uk'] });
  });

  it('CNT-033 carries an operation and an author on a suggestion', () => {
    const mark = markSchema.parse({
      type: 'suggestion',
      id: 'm1',
      operation: 'delete',
      author: 'Ada',
    });
    expect(mark.type).toBe('suggestion');
  });

  it('CNT-034 carries a thread identity on a comment anchor', () => {
    expect(markSchema.parse({ type: 'comment', id: 'm1', threadId: 't1' }).type).toBe('comment');
  });

  it('LIB-015 makes a defined term carry a term identity and no text', () => {
    expect(markSchema.parse({ type: 'definedTerm', id: 'm1', term: 'term-7' }).type).toBe(
      'definedTerm',
    );
    expect(() => markSchema.parse({ type: 'definedTerm', id: 'm1', text: 'Widget' })).toThrow();
  });

  it('CNT-127 refuses a hyperlink whose scheme is not allowlisted', () => {
    expect(
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'https://example.test/a' }).type,
    ).toBe('hyperlink');
    expect(() =>
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() =>
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'file:///etc/passwd' }),
    ).toThrow();
  });

  it('CNT-140 requires a BCP 47 tag on a language mark, with its region where it has one', () => {
    expect(markSchema.parse({ type: 'language', id: 'm1', tag: 'pt-BR' }).type).toBe('language');
    expect(() => markSchema.parse({ type: 'language', id: 'm1', tag: 'portuguese' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- marks`
Expected: FAIL, `Cannot find module './marks.js'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/content/model/marks.ts
import { z } from 'zod';

/**
 * Thirteen marks, and the set is closed (CNT-006). Adding one is a schema version with a migration
 * and a fixture, not a configuration option.
 *
 * Every mark carries an identifier (CNT-004), which is what makes an annotation fragmented across
 * text nodes remain one annotation, and what makes accepting it one operation (CNT-005).
 */
export const markTypes = [
  'emphasis',
  'strong',
  'underline',
  'subscript',
  'superscript',
  'inlineCode',
  'definedTerm',
  'quotedPhrase',
  'condition',
  'suggestion',
  'comment',
  'hyperlink',
  'language',
] as const;

export type MarkType = (typeof markTypes)[number];

/** CNT-127. Widened only by a requirement, never by a caller. */
export const allowedLinkSchemes = ['http:', 'https:', 'mailto:'] as const;

const identified = { id: z.string().min(1) };

/**
 * A BCP 47 tag, carrying a region wherever the region changes the content (CNT-140, LOC-034). This is
 * a shape check rather than a registry check: `zz-ZZ` passes and is somebody else's problem, but
 * `portuguese` does not, and neither does a bare tag where a script or region was meant.
 */
const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

const plain = (type: MarkType) => z.strictObject({ type: z.literal(type), ...identified });

export const emphasisMarkSchema = plain('emphasis');
export const strongMarkSchema = plain('strong');
/** Named for its appearance rather than its meaning, and CNT-085 says so rather than pretending. */
export const underlineMarkSchema = plain('underline');
export const subscriptMarkSchema = plain('subscript');
export const superscriptMarkSchema = plain('superscript');
export const inlineCodeMarkSchema = plain('inlineCode');
export const quotedPhraseMarkSchema = plain('quotedPhrase');

/** LIB-015: a term is referenced from content and never typed as text. No text member exists. */
export const definedTermMarkSchema = z.strictObject({
  type: z.literal('definedTerm'),
  ...identified,
  term: z.string().min(1),
});

export const conditionMarkSchema = z.strictObject({
  type: z.literal('condition'),
  ...identified,
  axis: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});

export const suggestionMarkSchema = z.strictObject({
  type: z.literal('suggestion'),
  ...identified,
  operation: z.enum(['insert', 'delete', 'replace']),
  author: z.string().min(1),
});

export const commentMarkSchema = z.strictObject({
  type: z.literal('comment'),
  ...identified,
  threadId: z.string().min(1),
});

export const hyperlinkMarkSchema = z.strictObject({
  type: z.literal('hyperlink'),
  ...identified,
  href: z.string().refine((value) => {
    // CNT-127: refused on entry and never stored. Parsing rather than pattern-matching, so that a
    // target the URL parser reads differently from a regular expression cannot slip past.
    try {
      return (allowedLinkSchemes as readonly string[]).includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'scheme is not allowlisted'),
  title: z.string().min(1).optional(),
});

export const languageMarkSchema = z.strictObject({
  type: z.literal('language'),
  ...identified,
  tag: bcp47,
});

export const markSchema = z.discriminatedUnion('type', [
  emphasisMarkSchema,
  strongMarkSchema,
  underlineMarkSchema,
  subscriptMarkSchema,
  superscriptMarkSchema,
  inlineCodeMarkSchema,
  quotedPhraseMarkSchema,
  definedTermMarkSchema,
  conditionMarkSchema,
  suggestionMarkSchema,
  commentMarkSchema,
  hyperlinkMarkSchema,
  languageMarkSchema,
]);

export type Mark = z.infer<typeof markSchema>;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- marks`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/content/model/marks.ts packages/domain/src/content/model/marks.test.ts
git commit -m "Add the closed mark vocabulary"
```

---

## Task 2: Inline nodes

**Files:**

- Create: `packages/domain/src/content/model/inline.ts`
- Test: `packages/domain/src/content/model/inline.test.ts`

**Interfaces:**

- Consumes: `markSchema`, `type Mark` from `./marks.js`
- Produces: `inlineNodeSchema`, `type InlineNode`, `alternativeSchema`, `type Alternative`

Eight inline nodes. `text` is the only leaf and marks apply to it. `footnote` carries the note's
content, which is a restricted block sequence - and blocks do not exist yet, so the footnote's content
is typed as `unknown` here and tightened in task 3, where the recursion closes.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/model/inline.test.ts
import { describe, expect, it } from 'vitest';

import { alternativeSchema, inlineNodeSchema } from './inline.js';

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });

describe('the inline vocabulary', () => {
  it('CNT-024 makes text the base inline node, carrying marks', () => {
    const node = inlineNodeSchema.parse(text('hello', [{ type: 'strong', id: 'm1' }]));
    expect(node).toMatchObject({ type: 'text', value: 'hello' });
  });

  it('CNT-024 refuses a text node carrying appearance', () => {
    expect(() => inlineNodeSchema.parse({ ...text('hello'), fontSize: 12 })).toThrow();
  });

  it('CNT-027 carries a target and a display kind on a cross-reference, and no number', () => {
    const node = inlineNodeSchema.parse({
      type: 'crossReference',
      target: 'b7',
      display: 'numberAndTitle',
    });
    expect(node).toEqual({ type: 'crossReference', target: 'b7', display: 'numberAndTitle' });
    expect(() =>
      inlineNodeSchema.parse({
        type: 'crossReference',
        target: 'b7',
        display: 'number',
        number: 3,
      }),
    ).toThrow();
  });

  it('CNT-050 makes a citation a reference by identity, with no text member', () => {
    expect(inlineNodeSchema.parse({ type: 'citation', entry: 'bib-4' }).type).toBe('citation');
    expect(() => inlineNodeSchema.parse({ type: 'citation', text: 'Smith 2020' })).toThrow();
  });

  it('CNT-052 lets a citation carry a locator beside its reference', () => {
    expect(
      inlineNodeSchema.parse({ type: 'citation', entry: 'bib-4', locator: 'p. 12' }),
    ).toMatchObject({
      locator: 'p. 12',
    });
  });

  it('CNT-029 carries a name and no value on a variable', () => {
    expect(inlineNodeSchema.parse({ type: 'variable', name: 'productName' }).type).toBe('variable');
    expect(() =>
      inlineNodeSchema.parse({ type: 'variable', name: 'productName', value: 'Alloy' }),
    ).toThrow();
  });

  it('CNT-030 carries a query reference and no value on a binding', () => {
    expect(inlineNodeSchema.parse({ type: 'binding', query: 'q-2' }).type).toBe('binding');
    expect(() => inlineNodeSchema.parse({ type: 'binding', query: 'q-2', value: '42' })).toThrow();
  });

  it('CNT-043 stores an equation as MathML, with the LaTeX typed kept beside it', () => {
    const node = inlineNodeSchema.parse({
      type: 'equation',
      mathml: '<math><mi>x</mi></math>',
      latex: 'x',
    });
    expect(node).toMatchObject({ mathml: '<math><mi>x</mi></math>', latex: 'x' });
  });

  it('CNT-043 refuses an equation with no MathML, whatever else it carries', () => {
    expect(() => inlineNodeSchema.parse({ type: 'equation', latex: 'x' })).toThrow();
  });

  it('CNT-022 and AST-015 make an alternative a three-state, with absent not one of them', () => {
    expect(alternativeSchema.parse({ kind: 'own', text: 'A bar chart' }).kind).toBe('own');
    expect(alternativeSchema.parse({ kind: 'inherited' }).kind).toBe('inherited');
    expect(alternativeSchema.parse({ kind: 'decorative' }).kind).toBe('decorative');
    expect(() => alternativeSchema.parse({ kind: 'own', text: '' })).toThrow();
    expect(() => alternativeSchema.parse({})).toThrow();
  });

  it('CNT-123 refuses a dimension on an inline image', () => {
    const ok = {
      type: 'image',
      asset: 'asset-1',
      imageStyle: 'inline',
      alternative: { kind: 'decorative' },
    };
    expect(inlineNodeSchema.parse(ok).type).toBe('image');
    expect(() => inlineNodeSchema.parse({ ...ok, width: 120 })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- inline`
Expected: FAIL, `Cannot find module './inline.js'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/content/model/inline.ts
import { z } from 'zod';

import { markSchema } from './marks.js';

/**
 * CNT-022, AST-012, AST-013, AST-015. A three-state rather than an optional string, because an
 * optional string makes empty mean both "nobody supplied it" and "deliberately decorative" - and that
 * ambiguity is how an inaccessible document passes its own check. Absent is not a state.
 */
export const alternativeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('own'), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal('inherited') }),
  z.strictObject({ kind: z.literal('decorative') }),
]);

export type Alternative = z.infer<typeof alternativeSchema>;

export const textNodeSchema = z.strictObject({
  type: z.literal('text'),
  value: z.string(),
  marks: z.array(markSchema).default([]),
});

/** CNT-043: MathML is canonical. The LaTeX typed is a non-authoritative input record. */
export const equationContentSchema = {
  mathml: z.string().min(1),
  latex: z.string().min(1).optional(),
};

export const inlineEquationNodeSchema = z.strictObject({
  type: z.literal('equation'),
  ...equationContentSchema,
});

/** CNT-027: a target and what to display, never a resolved number or title. */
export const crossReferenceNodeSchema = z.strictObject({
  type: z.literal('crossReference'),
  target: z.string().min(1),
  display: z.enum(['number', 'title', 'numberAndTitle', 'page', 'relative']),
});

export const citationNodeSchema = z.strictObject({
  type: z.literal('citation'),
  entry: z.string().min(1),
  locator: z.string().min(1).optional(),
});

export const variableNodeSchema = z.strictObject({
  type: z.literal('variable'),
  name: z.string().min(1),
});

export const bindingNodeSchema = z.strictObject({
  type: z.literal('binding'),
  query: z.string().min(1),
});

export const imageNodeSchema = z.strictObject({
  type: z.literal('image'),
  asset: z.string().min(1),
  imageStyle: z.string().min(1),
  alternative: alternativeSchema,
});

/**
 * CNT-026, CNT-036, CNT-037, CNT-038. The anchor carries the note, so a moved anchor moves its note.
 * `content` is a restricted block sequence (CNT-129) and is tightened in `blocks.ts`, where the
 * recursion between blocks and inlines closes.
 */
export const footnoteNodeSchema = z.strictObject({
  type: z.literal('footnote'),
  id: z.string().min(1),
  anchor: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('span') }),
    z.strictObject({ kind: z.literal('cell'), key: z.string().min(1) }),
    z.strictObject({
      kind: z.literal('cellPosition'),
      row: z.number().int().min(0),
      column: z.number().int().min(0),
    }),
    z.strictObject({ kind: z.literal('table') }),
  ]),
  content: z.array(z.unknown()),
});

export const inlineNodeSchema = z.discriminatedUnion('type', [
  textNodeSchema,
  inlineEquationNodeSchema,
  footnoteNodeSchema,
  crossReferenceNodeSchema,
  citationNodeSchema,
  variableNodeSchema,
  bindingNodeSchema,
  imageNodeSchema,
]);

export type InlineNode = z.infer<typeof inlineNodeSchema>;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- inline`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/content/model/inline.ts packages/domain/src/content/model/inline.test.ts
git commit -m "Add the inline vocabulary and the three-state alternative"
```

---

## Task 3: Blocks, and the root

**Files:**

- Create: `packages/domain/src/content/model/blocks.ts`
- Create: `packages/domain/src/content/model/document.ts`
- Test: `packages/domain/src/content/model/document.test.ts`

**Interfaces:**

- Consumes: `inlineNodeSchema`, `alternativeSchema` from `./inline.js`
- Produces: `blockNodeSchema`, `type BlockNode`, `contentDocumentSchema`, `type ContentDocument`,
  `parseContentDocument`, `CURRENT_SCHEMA_VERSION`

Seven blocks, and the root that holds them. The root's members are closed (CNT-144).

**A note on the recursion.** `list` items and `blockquote` hold block content, and a footnote's content
is a restricted block sequence, so the schema is recursive. zod needs `z.lazy` and TypeScript needs an
explicit type annotation, because it cannot infer a recursive `z.infer`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/model/document.test.ts
import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, contentDocumentSchema, parseContentDocument } from './document.js';

const paragraph = (id: string, value = 'A sentence.') => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

const doc = (content: unknown[]) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

describe('the content document', () => {
  it('CNT-001 is a tree of typed block nodes, serialised as JSON', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).content[0]?.type).toBe('paragraph');
  });

  it('CNT-144 closes the root, so an unknown member is refused', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), owner: 'Grace' }),
    ).toThrow();
  });

  it('CNT-011 records the schema version the content was written against', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), schemaVersion: 99 }),
    ).toThrow();
  });

  it('CNT-142 carries the component title, and refuses an empty one', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).title).toBe('A component');
    expect(() => contentDocumentSchema.parse({ ...doc([paragraph('b1')]), title: '' })).toThrow();
  });

  it('CNT-140 requires a BCP 47 base language on the component', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), language: 'english' }),
    ).toThrow();
  });

  it('CNT-059 puts direction in the model rather than leaving it to styling', () => {
    expect(parseContentDocument({ ...doc([paragraph('b1')]), direction: 'rtl' }).direction).toBe(
      'rtl',
    );
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), direction: 'auto' }),
    ).toThrow();
  });

  it('CNT-124 requires at least one block', () => {
    expect(() => contentDocumentSchema.parse(doc([]))).toThrow();
  });

  it('CNT-002 requires an identifier on every block', () => {
    expect(() =>
      contentDocumentSchema.parse(doc([{ type: 'paragraph', style: 'body', content: [] }])),
    ).toThrow();
  });

  it('CNT-002 refuses two blocks sharing an identifier', () => {
    expect(() => parseContentDocument(doc([paragraph('b1'), paragraph('b1')]))).toThrow(/b1/);
  });

  it('CNT-023 refuses two adjacent empty paragraphs, and admits one', () => {
    const empty = { type: 'paragraph', id: 'b1', style: 'body', content: [] };
    expect(parseContentDocument(doc([empty])).content).toHaveLength(1);
    expect(() => parseContentDocument(doc([empty, { ...empty, id: 'b2' }]))).toThrow(/adjacent/);
  });

  it('CNT-117 supports three list kinds, and CNT-119 puts start and format on an ordered one', () => {
    const list = {
      type: 'list',
      id: 'b2',
      kind: 'ordered',
      start: 3,
      format: 'roman',
      items: [{ content: [paragraph('b3')] }],
    };
    expect(parseContentDocument(doc([list])).content[0]).toMatchObject({
      kind: 'ordered',
      format: 'roman',
    });
    expect(() => contentDocumentSchema.parse(doc([{ ...list, kind: 'checklist' }]))).toThrow();
  });

  it('CNT-118 nests a list to six levels in a mixture of kinds', () => {
    let items: unknown = [{ content: [paragraph('b-deep')] }];
    for (let level = 6; level >= 1; level -= 1) {
      items = [
        {
          content: [
            { type: 'list', id: `b-l${level}`, kind: level % 2 ? 'ordered' : 'unordered', items },
          ],
        },
      ];
    }
    expect(() =>
      parseContentDocument(doc([{ type: 'list', id: 'b-root', kind: 'unordered', items }])),
    ).not.toThrow();
  });

  it('CNT-016 and CNT-107 carry header rows, spans, a caption and key columns on a table', () => {
    const table = {
      type: 'table',
      id: 'b4',
      caption: 'Revenue',
      headerRows: 1,
      headerColumns: 1,
      keyColumns: [0],
      rows: [{ cells: [{ content: [paragraph('b5')], colspan: 2, rowspan: 1 }] }],
    };
    expect(parseContentDocument(doc([table])).content[0]).toMatchObject({ keyColumns: [0] });
  });

  it('CNT-017 and CNT-022 make a figure reference an asset and carry an alternative', () => {
    const figure = {
      type: 'figure',
      id: 'b6',
      asset: 'asset-1',
      imageStyle: 'column-width',
      caption: 'Figure',
      alternative: { kind: 'inherited' },
    };
    expect(parseContentDocument(doc([figure])).content[0]).toMatchObject({ asset: 'asset-1' });
    const { alternative: _dropped, ...withoutAlternative } = figure;
    expect(() => contentDocumentSchema.parse(doc([withoutAlternative]))).toThrow();
  });

  it('CNT-021 and CNT-047 make a block equation numbered or explicitly unnumbered', () => {
    const equation = { type: 'equation', id: 'b7', mathml: '<math/>', numbered: false };
    expect(parseContentDocument(doc([equation])).content[0]).toMatchObject({ numbered: false });
    const { numbered: _dropped, ...withoutNumbered } = equation;
    expect(() => contentDocumentSchema.parse(doc([withoutNumbered]))).toThrow();
  });

  it('CNT-018 preserves whitespace in a preformatted block', () => {
    const pre = { type: 'preformatted', id: 'b8', text: '  two spaces\n\ttab', language: 'sql' };
    expect(parseContentDocument(doc([pre])).content[0]).toMatchObject({
      text: '  two spaces\n\ttab',
    });
  });

  it('CNT-129 admits no table and no image inside a footnote', () => {
    const withTable = paragraph('b9');
    withTable.content = [
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [
          { type: 'table', id: 'b10', caption: 'x', headerRows: 0, headerColumns: 0, rows: [] },
        ],
      },
    ] as never;
    expect(() => contentDocumentSchema.parse(doc([withTable]))).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- document`
Expected: FAIL, `Cannot find module './document.js'`.

- [ ] **Step 3: Write `blocks.ts`**

```ts
// packages/domain/src/content/model/blocks.ts
import { z } from 'zod';

import { alternativeSchema, equationContentSchema, inlineNodeSchema } from './inline.js';

const identified = { id: z.string().min(1) };

/** CNT-094: appearance comes from a named style. There is no alignment, indent or spacing member. */
const styled = { style: z.string().min(1).default('body') };

export type BlockNode =
  | { type: 'paragraph'; id: string; style: string; content: z.infer<typeof inlineNodeSchema>[] }
  | {
      type: 'list';
      id: string;
      kind: 'ordered' | 'unordered' | 'definition';
      start?: number;
      format?: 'decimal' | 'alphabetic' | 'roman';
      items: { content: BlockNode[] }[];
    }
  | {
      type: 'table';
      id: string;
      caption: string;
      headerRows: number;
      headerColumns: number;
      keyColumns?: number[];
      note?: z.infer<typeof inlineNodeSchema>[];
      rows: { cells: { content: BlockNode[]; colspan: number; rowspan: number }[] }[];
    }
  | {
      type: 'figure';
      id: string;
      asset: string;
      imageStyle: string;
      caption: string;
      alternative: z.infer<typeof alternativeSchema>;
    }
  | { type: 'preformatted'; id: string; text: string; language?: string }
  | {
      type: 'blockquote';
      id: string;
      content: BlockNode[];
      attribution?: z.infer<typeof inlineNodeSchema>[];
    }
  | { type: 'equation'; id: string; mathml: string; latex?: string; numbered: boolean };

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    paragraphNodeSchema,
    listNodeSchema,
    tableNodeSchema,
    figureNodeSchema,
    preformattedNodeSchema,
    blockquoteNodeSchema,
    blockEquationNodeSchema,
  ]),
);

export const paragraphNodeSchema = z.strictObject({
  type: z.literal('paragraph'),
  ...identified,
  ...styled,
  content: z.array(inlineNodeSchema),
});

export const listNodeSchema = z.strictObject({
  type: z.literal('list'),
  ...identified,
  kind: z.enum(['ordered', 'unordered', 'definition']),
  // CNT-119: local to this list and independent of the outline's numbering.
  start: z.number().int().min(0).optional(),
  format: z.enum(['decimal', 'alphabetic', 'roman']).optional(),
  // A list item holds block content, so nesting is unbounded by construction and CNT-118's six
  // levels is a floor rather than a limit.
  items: z.array(z.strictObject({ content: z.array(blockNodeSchema).min(1) })).min(1),
});

export const tableNodeSchema = z.strictObject({
  type: z.literal('table'),
  ...identified,
  caption: z.string(),
  headerRows: z.number().int().min(0),
  headerColumns: z.number().int().min(0),
  /** CNT-107: where declared, a footnote anchors by key value rather than by position. */
  keyColumns: z.array(z.number().int().min(0)).optional(),
  /** CNT-038: a note on the table as a whole, which is not an inline anchor because a table is not a span. */
  note: z.array(inlineNodeSchema).optional(),
  rows: z.array(
    z.strictObject({
      cells: z.array(
        z.strictObject({
          content: z.array(blockNodeSchema),
          colspan: z.number().int().min(1).default(1),
          rowspan: z.number().int().min(1).default(1),
        }),
      ),
    }),
  ),
});

export const figureNodeSchema = z.strictObject({
  type: z.literal('figure'),
  ...identified,
  asset: z.string().min(1),
  imageStyle: z.string().min(1),
  caption: z.string(),
  alternative: alternativeSchema,
});

export const preformattedNodeSchema = z.strictObject({
  type: z.literal('preformatted'),
  ...identified,
  text: z.string(),
  language: z.string().min(1).optional(),
});

export const blockquoteNodeSchema = z.strictObject({
  type: z.literal('blockquote'),
  ...identified,
  content: z.array(blockNodeSchema).min(1),
  attribution: z.array(inlineNodeSchema).optional(),
});

export const blockEquationNodeSchema = z.strictObject({
  type: z.literal('equation'),
  ...identified,
  ...equationContentSchema,
  /** CNT-047: numbered or explicitly unnumbered. There is no third state. */
  numbered: z.boolean(),
});
```

- [ ] **Step 4: Write `document.ts`**

```ts
// packages/domain/src/content/model/document.ts
import { z } from 'zod';

import { blockNodeSchema, type BlockNode } from './blocks.js';

export const CURRENT_SCHEMA_VERSION = 1;

const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

/**
 * The root, and its members are closed (CNT-144). The component's identifier belongs to the artifact
 * rather than to its content; everything else a component carries whatever its type is here.
 */
export const contentDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1),
  language: bcp47,
  direction: z.enum(['ltr', 'rtl']),
  content: z.array(blockNodeSchema).min(1),
});

export type ContentDocument = z.infer<typeof contentDocumentSchema>;

function walk(blocks: readonly BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'list') for (const item of block.items) walk(item.content, visit);
    if (block.type === 'blockquote') walk(block.content, visit);
    if (block.type === 'table') {
      for (const row of block.rows) for (const cell of row.cells) walk(cell.content, visit);
    }
  }
}

/**
 * The one entry point. Validates on creation, on change and on read-back (CNT-010); nothing else
 * constructs a document.
 *
 * Two rules the schema cannot express on its own, because both are about a document rather than a node:
 * identifiers are unique within the component (CNT-002), and two adjacent empty paragraphs are refused
 * (CNT-023). A single empty paragraph is admitted, because CNT-124 requires a new component to be one.
 */
export function parseContentDocument(value: unknown): ContentDocument {
  const document = contentDocumentSchema.parse(value);

  const seen = new Set<string>();
  walk(document.content, (block) => {
    if (seen.has(block.id)) {
      throw new Error(`Block identifier ${block.id} is used more than once in this component`);
    }
    seen.add(block.id);
  });

  const isEmptyParagraph = (block: BlockNode) =>
    block.type === 'paragraph' && block.content.length === 0;
  const refuseAdjacentEmpties = (blocks: readonly BlockNode[]) => {
    for (let index = 1; index < blocks.length; index += 1) {
      const previous = blocks[index - 1];
      const current = blocks[index];
      if (previous && current && isEmptyParagraph(previous) && isEmptyParagraph(current)) {
        throw new Error(`Blocks ${previous.id} and ${current.id} are adjacent empty paragraphs`);
      }
    }
  };
  refuseAdjacentEmpties(document.content);
  walk(document.content, (block) => {
    if (block.type === 'list') for (const item of block.items) refuseAdjacentEmpties(item.content);
    if (block.type === 'blockquote') refuseAdjacentEmpties(block.content);
  });

  return document;
}
```

- [ ] **Step 5: Tighten the footnote's content (CNT-129)**

The footnote's `content` was `z.array(z.unknown())` in task 2, because blocks did not exist. Replace it
now with the restricted sequence CNT-129 names: paragraphs only, and no table and no image inside.

```ts
// packages/domain/src/content/model/blocks.ts - appended, and inline.ts's footnote schema updated
/** CNT-129: a restricted block sequence. The list is closed and admits no table and no image. */
export const footnoteContentSchema = z.array(paragraphNodeSchema).min(1);
```

Wire it by having `document.ts` validate footnote content after parsing, in the same `walk`, so the
recursion between `inline.ts` and `blocks.ts` stays one-directional and TypeScript stays happy:

```ts
// inside parseContentDocument, in the same walk
if (block.type === 'paragraph') {
  for (const inline of block.content) {
    if (inline.type === 'footnote') footnoteContentSchema.parse(inline.content);
  }
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- document`
Expected: PASS, 17 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/content/model/
git commit -m "Add the block vocabulary and the content document root"
```

---

## Task 4: Canonical serialisation

**Files:**

- Create: `packages/domain/src/content/model/canonical.ts`
- Test: `packages/domain/src/content/model/canonical.test.ts`

**Interfaces:**

- Consumes: `type ContentDocument` from `./document.js`
- Produces: `canonicalise(document: ContentDocument): string`

`content_hash` is load-bearing: `storage-and-versioning.md` refuses a version whose hash is unchanged,
and equal hashes skip a comparison. Both break if two identical documents can serialise differently.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/model/canonical.test.ts
import { describe, expect, it } from 'vitest';

import { canonicalise } from './canonical.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from './document.js';

const base = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr' as const,
};

describe('canonical serialisation', () => {
  it('CNT-011 produces one string for two documents differing only in member order', () => {
    const one = parseContentDocument({
      ...base,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'x', marks: [] }],
        },
      ],
    });
    const other = parseContentDocument({
      content: [
        {
          style: 'body',
          content: [{ marks: [], value: 'x', type: 'text' }],
          id: 'b1',
          type: 'paragraph',
        },
      ],
      direction: 'ltr',
      language: 'en-GB',
      title: 'A component',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    expect(canonicalise(one)).toBe(canonicalise(other));
  });

  it('CNT-011 produces one string for two documents differing only in mark order', () => {
    const marks = [
      { type: 'strong', id: 'm1' },
      { type: 'emphasis', id: 'm2' },
    ];
    const withOrder = (ordered: unknown[]) =>
      canonicalise(
        parseContentDocument({
          ...base,
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value: 'x', marks: ordered }],
            },
          ],
        }),
      );
    expect(withOrder(marks)).toBe(withOrder([...marks].reverse()));
  });

  it('CNT-056 emits NFC, so two visually identical strings serialise alike', () => {
    const composed = parseContentDocument({
      ...base,
      title: 'café',
      content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
    });
    const decomposed = parseContentDocument({
      ...base,
      title: 'café',
      content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
    });
    expect(canonicalise(composed)).toBe(canonicalise(decomposed));
  });

  it('CNT-011 changes the string when the content changes', () => {
    const of = (value: string) =>
      canonicalise(
        parseContentDocument({
          ...base,
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value, marks: [] }],
            },
          ],
        }),
      );
    expect(of('x')).not.toBe(of('y'));
  });

  it('CNT-011 emits no insignificant whitespace', () => {
    const serialised = canonicalise(
      parseContentDocument({
        ...base,
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
      }),
    );
    expect(serialised).not.toMatch(/\n|\t|: | ,/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- canonical`
Expected: FAIL, `Cannot find module './canonical.js'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/content/model/canonical.ts
import type { ContentDocument } from './document.js';

/**
 * The canonical serialisation, and the input to `content_hash`.
 *
 * `storage-and-versioning.md` refuses a version whose hash is unchanged and skips a comparison when
 * two hashes are equal, so both behaviours rest on two identical documents producing one string.
 *
 * Three rules, and no more: members in lexicographic order (a declared order that needs no table to
 * keep in step with the schema), strings in NFC (CNT-056), and no insignificant whitespace.
 *
 * Marks are a set rather than a sequence (CNT-003), so they sort too - by type then identifier, which
 * is total because an identifier is unique.
 *
 * This returns a string rather than a hash on purpose: hashing needs `node:crypto`, which is not
 * platform-free, or `crypto.subtle`, which would make parsing async for no gain. The caller hashes.
 */
export function canonicalise(document: ContentDocument): string {
  return emit(document);
}

function emit(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${emitMember(key, member)}`).join(',')}}`;
  }
  throw new Error(`Cannot canonicalise a value of type ${typeof value}`);
}

function emitMember(key: string, member: unknown): string {
  if (key !== 'marks' || !Array.isArray(member)) return emit(member);
  const sorted = [...(member as { type: string; id: string }[])].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1,
  );
  return `[${sorted.map(emit).join(',')}]`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- canonical`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/content/model/canonical.ts packages/domain/src/content/model/canonical.test.ts
git commit -m "Add the canonical serialisation the content hash rests on"
```

---

## Task 5: Migration as a projection, and quarantine

**Files:**

- Create: `packages/domain/src/content/model/migrate.ts`
- Create: `packages/domain/src/content/model/fixtures/v1/minimal.json`
- Create: `packages/domain/src/content/model/fixtures/v1/every-node.json`
- Test: `packages/domain/src/content/model/migrate.test.ts`

**Interfaces:**

- Consumes: `contentDocumentSchema`, `CURRENT_SCHEMA_VERSION`, `parseContentDocument`
- Produces: `migrate(value: unknown): unknown`, `readContent(value, context): ReadOutcome`,
  `type ReadOutcome`

**Migration never rewrites what is stored.** Version rows take inserts only and `content_hash` is the
hash of what was written, so migrating a stored version would either invalidate its hash or need a row
nobody authored. Content is migrated on the way out, every read.

With one schema version the chain is empty. The harness, the fixture directory and the test that walks
every fixture to current all exist anyway, because the first schema change is the one most likely to
find that they do not.

- [ ] **Step 1: Write the fixtures**

`fixtures/v1/minimal.json` is a component of one empty paragraph - what CNT-124 says a new component
is. `fixtures/v1/every-node.json` carries one of every block, one of every inline node and one of every
mark, so that a later migration cannot silently drop a construct nobody remembered.

**A fixture directory is never deleted.** CNT-012 keeps every version ever written readable, which in
this market is measured in decades.

- [ ] **Step 2: Write the failing test**

```ts
// packages/domain/src/content/model/migrate.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, parseContentDocument } from './document.js';
import { migrate, readContent } from './migrate.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('schema versions and migration', () => {
  it('CNT-012 migrates every fixture of every schema version to the current one', () => {
    const versions = readdirSync(fixtures);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      for (const name of readdirSync(join(fixtures, version))) {
        const stored = JSON.parse(readFileSync(join(fixtures, version, name), 'utf8'));
        const migrated = migrate(stored);
        expect(() => parseContentDocument(migrated), `${version}/${name}`).not.toThrow();
        expect((migrated as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }
    }
  });

  it('CNT-012 refuses a schema version it has no path from, by name', () => {
    expect(() =>
      migrate({ schemaVersion: 99, title: 'x', language: 'en-GB', direction: 'ltr', content: [] }),
    ).toThrow(/99/);
  });

  it('CNT-012 refuses content that records no schema version at all', () => {
    expect(() => migrate({ title: 'x', language: 'en-GB', direction: 'ltr', content: [] })).toThrow(
      /schema version/i,
    );
  });

  it('CNT-013 quarantines content that fails validation on read-back, naming what failed', () => {
    const outcome = readContent(
      { schemaVersion: 1, title: '', language: 'en-GB', direction: 'ltr', content: [] },
      {
        artifact: 'component-7',
        version: '3.14',
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a quarantine');
    expect(outcome.artifact).toBe('component-7');
    expect(outcome.version).toBe('3.14');
    expect(outcome.failure).toMatch(/title/);
  });

  it('CNT-013 yields no partial content from a failed read', () => {
    const outcome = readContent(
      {
        schemaVersion: 1,
        title: 'x',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph' }],
      },
      {
        artifact: 'component-8',
        version: '1.0',
      },
    );
    expect(outcome).not.toHaveProperty('document');
  });

  it('CNT-013 returns the document when it reads back cleanly', () => {
    const stored = JSON.parse(readFileSync(join(fixtures, 'v1', 'minimal.json'), 'utf8'));
    const outcome = readContent(stored, { artifact: 'component-9', version: '1.0' });
    expect(outcome.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- migrate`
Expected: FAIL, `Cannot find module './migrate.js'`.

- [ ] **Step 4: Write the minimal implementation**

```ts
// packages/domain/src/content/model/migrate.ts
import { CURRENT_SCHEMA_VERSION, parseContentDocument, type ContentDocument } from './document.js';

/**
 * A migration from one schema version to the next. Total and pure: it takes whatever was stored at
 * `from` and returns whatever `from + 1` expects, and it reads nothing outside its argument.
 */
type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/**
 * Empty while there is one schema version. It exists now rather than when it is needed, because the
 * first schema change is the moment a chain nobody built is discovered to be missing - and by then
 * there is stored content that needs it.
 */
const migrations: Record<number, Migration> = {};

/**
 * Migration is a READ-TIME PROJECTION, never a rewrite. Version rows take inserts only and
 * `content_hash` is the hash of what was written, so migrating a stored version would either
 * invalidate its hash or need a version row nobody authored. The stored bytes never change.
 */
export function migrate(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    throw new Error('Stored content records no schema version, so it cannot be migrated (CNT-011)');
  }
  const record = { ...(value as Record<string, unknown>) };
  const from = record.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new Error(
      `Stored content records a schema version that is not a version: ${String(from)}`,
    );
  }
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Stored content was written against schema version ${from}, which is newer than this build's ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  let migrated = record;
  for (let version = from; version < CURRENT_SCHEMA_VERSION; version += 1) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema version ${version} to ${version + 1}`);
    migrated = step(migrated);
    migrated.schemaVersion = version + 1;
  }
  return migrated;
}

export type ReadOutcome =
  | { ok: true; document: ContentDocument }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * CNT-013: content that fails validation on read-back is quarantined and reported, never silently
 * coerced or partially loaded. A typed outcome rather than an exception, so there is no path that
 * yields half a document - a generic error swallowed by a handler is the coercion CNT-013 forbids
 * with extra steps.
 */
export function readContent(
  value: unknown,
  context: { artifact: string; version: string },
): ReadOutcome {
  try {
    return { ok: true, document: parseContentDocument(migrate(value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- migrate`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/content/model/migrate.ts packages/domain/src/content/model/migrate.test.ts packages/domain/src/content/model/fixtures/
git commit -m "Migrate on read, never on write, and quarantine what will not parse"
```

---

## Task 6: Every node has a way out

**Files:**

- Create: `packages/domain/src/content/model/mapping.ts`
- Test: `packages/domain/src/content/model/mapping.test.ts`

**Interfaces:**

- Consumes: `markTypes` from `./marks.js`
- Produces: `outputMapping`, `type OutputMapping`

ADR-0005 commits to the schema being "designed against the OOXML and PDF/UA mappings from the start",
because "a mapping retrofitted onto a schema that did not anticipate it is where publishing fidelity
dies." This is that commitment with teeth: one row per node and per mark, naming the construct it
becomes in each target, and a test that fails when a type has no row.

**Fill each cell by checking it, not by recalling it.** The OOXML column is checked against the OOXML
schema and against [word-output.md](../design/word-output.md), which already owns the detailed mapping
for equations and the document parts. The PDF column is checked against PDF/UA's standard structure
types and against the publishing engine spike's harness. **This plan deliberately does not pre-fill
values nobody has verified** - a wrong construct here is worse than a blank, because a blank fails the
test and a wrong value passes it.

**A cell that cannot be filled blocks the node from the vocabulary.** If a node has no way out of the
product, that is a finding about the node, and it goes back to the design rather than into a comment.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/model/mapping.test.ts
import { describe, expect, it } from 'vitest';

import { markTypes } from './marks.js';
import { outputMapping } from './mapping.js';

const blockTypes = [
  'paragraph',
  'list',
  'table',
  'figure',
  'preformatted',
  'blockquote',
  'equation',
];
const inlineTypes = [
  'text',
  'equation',
  'footnote',
  'crossReference',
  'citation',
  'variable',
  'binding',
  'image',
];

describe('the output mapping', () => {
  it('ADR-0005 has a row for every block type, so no block exists without a way out', () => {
    for (const type of blockTypes) expect(outputMapping.blocks[type], type).toBeDefined();
    expect(Object.keys(outputMapping.blocks).sort()).toEqual([...blockTypes].sort());
  });

  it('ADR-0005 has a row for every inline type', () => {
    for (const type of inlineTypes) expect(outputMapping.inline[type], type).toBeDefined();
    expect(Object.keys(outputMapping.inline).sort()).toEqual([...inlineTypes].sort());
  });

  it('ADR-0005 has a row for every mark type', () => {
    for (const type of markTypes) expect(outputMapping.marks[type], type).toBeDefined();
    expect(Object.keys(outputMapping.marks).sort()).toEqual([...markTypes].sort());
  });

  it('ADR-0005 admits no blank cell, because a node with no way out is a design finding', () => {
    for (const group of [outputMapping.blocks, outputMapping.inline, outputMapping.marks]) {
      for (const [type, row] of Object.entries(group)) {
        expect(row.ooxml.length, `${type} ooxml`).toBeGreaterThan(0);
        expect(row.tagged.length, `${type} tagged PDF`).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- mapping`
Expected: FAIL, `Cannot find module './mapping.js'`.

- [ ] **Step 3: Write the mapping, checking each cell as you write it**

The shape is fixed; the values are yours to verify:

```ts
// packages/domain/src/content/model/mapping.ts
/**
 * Every node and every mark, with what it becomes on the way out of the product.
 *
 * This is a COMPLETENESS CHECK rather than a mapping specification. The detailed mappings belong to
 * word-output.md and to the Typst template, so each has one owner - two documents stating one rule is
 * the condition that lets them drift apart while each looks correct.
 *
 * Each cell was checked against the OOXML schema and against PDF/UA's standard structure types when it
 * was written. A cell that cannot be filled blocks the node from the vocabulary.
 */
export type OutputMapping = Record<string, { ooxml: string; tagged: string; note?: string }>;

export const outputMapping: {
  blocks: OutputMapping;
  inline: OutputMapping;
  marks: OutputMapping;
} = {
  blocks: {
    // paragraph, list, table, figure, preformatted, blockquote, equation
  },
  inline: {
    // text, equation, footnote, crossReference, citation, variable, binding, image
  },
  marks: {
    // the thirteen from markTypes
  },
};
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- mapping`
Expected: PASS, 4 tests.

- [ ] **Step 5: Record anything the mapping could not answer**

If a cell could not be filled, stop and say so in the pull request rather than inventing a construct.
That is a finding about the vocabulary, and the design changes before the code does.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/content/model/mapping.ts packages/domain/src/content/model/mapping.test.ts
git commit -m "Give every node and mark a checked way out of the product"
```

---

## Task 7: Promote the model to the package's public surface

**Files:**

- Create: `packages/domain/src/content/model/index.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/index.test.ts`

**Interfaces:**

- Consumes: everything above
- Produces: the domain package's public surface

The spike's findings say promoting the schema out of the package's private surface "is a deliberate act
for whoever starts the authoring work, not something that should happen by drift". This is that act.

**The scaffolding `Component` stays.** `apps/web/src/App.tsx` uses `createComponent`, and CLAUDE.md is
explicit that it "exists to prove the path end to end; it is not a decision about the content model".
Retiring it is a change to `apps/web`, which is not this plan's subject. It keeps its exports and gains
a comment saying what it is not.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/index.test.ts - replacing the existing assertion
import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('the domain package', () => {
  it('exports the content model as its public surface', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        // The content model, promoted deliberately rather than by drift.
        'CURRENT_SCHEMA_VERSION',
        'allowedLinkSchemes',
        'alternativeSchema',
        'blockNodeSchema',
        'canonicalise',
        'contentDocumentSchema',
        'inlineNodeSchema',
        'markSchema',
        'markTypes',
        'migrate',
        'outputMapping',
        'parseContentDocument',
        'readContent',
        // Scaffolding, and not a decision about the content model. See CLAUDE.md.
        'componentSchema',
        'componentTypes',
        'createComponent',
        'nextVersion',
        'parseComponent',
      ].sort(),
    );
  });

  it('CNT-010 exposes one entry point that validates, and no way round it', () => {
    expect(typeof domain.parseContentDocument).toBe('function');
    expect(domain).not.toHaveProperty('unsafeParseContentDocument');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- index`
Expected: FAIL, the exported keys do not match.

- [ ] **Step 3: Write the barrel and re-export it**

```ts
// packages/domain/src/content/model/index.ts
export { markSchema, markTypes, allowedLinkSchemes } from './marks.js';
export type { Mark, MarkType } from './marks.js';

export { inlineNodeSchema, alternativeSchema } from './inline.js';
export type { InlineNode, Alternative } from './inline.js';

export { blockNodeSchema } from './blocks.js';
export type { BlockNode } from './blocks.js';

export { contentDocumentSchema, parseContentDocument, CURRENT_SCHEMA_VERSION } from './document.js';
export type { ContentDocument } from './document.js';

export { canonicalise } from './canonical.js';
export { migrate, readContent } from './migrate.js';
export type { ReadOutcome } from './migrate.js';

export { outputMapping } from './mapping.js';
export type { OutputMapping } from './mapping.js';
```

```ts
// packages/domain/src/index.ts
export * from './content/model/index.js';

// Scaffolding. This is NOT the content model - see docs/design/content-model.md for that, and
// CLAUDE.md for why this exists. `apps/web` still uses it; retiring it is that app's change.
export {
  componentSchema,
  componentTypes,
  createComponent,
  parseComponent,
  nextVersion,
} from './component.js';

export type { Component, ComponentDraft, ComponentType } from './component.js';
```

- [ ] **Step 4: Run the whole suite and watch it pass**

Run: `pnpm build && pnpm test`
Expected: PASS. The build matters here: `apps/web` imports the domain package's `dist/`, so a broken
barrel is a broken renderer rather than a failed unit test.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/
git commit -m "Promote the content model to the domain package's public surface"
```

---

## Task 8: The design document, the docs and the release

**Files:**

- Modify: `docs/design/content-model.md`
- Modify: `docs/architecture.md`
- Modify: `docs/features.md` and `README.md` if the Features table changes
- Modify: `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Move what is now true from design to architecture**

`docs/design/` describes how the product will be built; `docs/architecture.md` describes the repository
as built. The content model now exists, so its description moves. The design document keeps its
`## Requirements owned` table, which is the mapping and lives nowhere else.

- [ ] **Step 2: Check the claims still hold**

Run: `pnpm --filter @alloy-works/trace generate && pnpm trace check`
Expected: `No problems in the corpus.` A claim naming nothing, or two designs claiming one
requirement, fails here rather than in a review.

- [ ] **Step 3: Report what moved, and do not overstate it**

Run: `pnpm trace verify`

This plan makes requirements `Covered` and `Verified` for the first time outside the scaffolding. Say
the number in the changelog, and say what it is not: a schema that parses is not a product that
authors. `docs/features.md` stays the honest account of the distance.

- [ ] **Step 4: Add the plan's row to `docs/plans/README.md`**

A new **Content model** section, with this plan as row 1, marked `Built (PR #n)`, and the plans it
leaves for later named so the debt this plan states is visible in the index rather than only here:
retiring the spike schema, moving the OOXML pair to its own workspace, re-pointing gate case 3, and the
admission pipeline.

- [ ] **Step 5: Bump, changelog, and open the pull request**

Minor bump: this is a functional enhancement. `0.15.4` becomes `0.16.0`.

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm trace gate
git push -u origin claude/content-model-schema
gh pr create --base main --title "Build the content model's schema and its canonical form"
```

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **The spike schema in `packages/domain/src/content/` still stands**, with `compare.ts`, `resolve.ts`,
  `binding.ts`, the OOXML pair and the four gate-case tests on it. Retiring it, moving the OOXML reader
  and writer to their own workspace, and re-pointing gate case 3 at an authored table are one later
  plan, once there is something to move onto.
- **The admission pipeline** - read, sanitise, migrate, normalise, re-identify, validate, with the
  report threaded through - is the whole of CNT section 10 and has its own plan. Nothing in this one
  admits foreign content.
- **Identity through editing** - the re-identification rule ADR-0023 records, whose predicate is
  descent rather than arrival - belongs with the editor, because it is a plugin over transactions
  rather than a property of the schema.
- **Resolution** (CNT-005, CNT-009) needs conditions and suggestions to resolve, which are T3 and T4
  capabilities. The marks are in the schema from the first version, as CNT-116 requires; the pass that
  acts on them is not.
- **CNT-039's data anchor into generated content** waits for a bound table, which is T2.
