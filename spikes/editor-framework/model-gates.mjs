// Editor framework spike - the cases that need no browser.
//
// Throwaway. Not part of the pnpm workspace, not in CI. See
// docs/specification/spikes/Editor_Framework_Spike.md for the brief.
//
// Covers gate 2 (overlapping annotations, then edited), case 5 (block identifiers through ordinary
// editing) and case 6 (the lossless round-trip). Gates 1, 3 and 4 need a view and are elsewhere.

import { Schema, Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

let pass = 0;
let fail = 0;
const findings = [];

function check(name, got, want, note) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  findings.push({ name, ok, got, want, note });
  const mark = ok ? 'pass' : 'FAIL';
  console.log(`${mark}  ${name}`);
  if (!ok) {
    console.log(`      got  ${JSON.stringify(got)}`);
    console.log(`      want ${JSON.stringify(want)}`);
  }
  if (note) console.log(`      note ${note}`);
}

// ---------------------------------------------------------------------------
// The schema, as content-model.md describes it. Only what these cases need.
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      // FINDING: `attrs: { id: {} }` - required, no default - is refused outright. `doc` content is
      // `block+`, so ProseMirror must be able to GENERATE a paragraph to fill a required position, and
      // it cannot generate one whose id it does not know:
      //
      //   SyntaxError: Only non-generatable nodes (paragraph) in a required position
      //
      // So in the editor's schema a block id cannot be required. It takes a default and a plugin
      // fills it. The STORED schema still requires it (zod, packages/domain), and the mapping refuses
      // a null id - which is why content-model.md reads CNT-001 as a lossless mapping rather than as
      // identical objects. See the findings document.
      attrs: { id: { default: null } },
      content: 'inline*',
      group: 'block',
      toDOM: (node) => ['p', { 'data-id': node.attrs.id }, 0],
    },
    text: { group: 'inline' },
  },
  marks: {
    // Every mark carries an id (CNT-004). Annotation marks carry what their requirement names.
    condition: {
      attrs: { id: {}, axis: {}, values: {} },
      toDOM: (m) => ['span', { 'data-condition': m.attrs.id }, 0],
    },
    suggestion: {
      attrs: { id: {}, operation: {}, author: {} },
      toDOM: (m) => ['span', { 'data-suggestion': m.attrs.id }, 0],
    },
    comment: {
      attrs: { id: {}, threadId: {} },
      toDOM: (m) => ['span', { 'data-comment': m.attrs.id }, 0],
    },
    emphasis: { attrs: { id: {} }, toDOM: () => ['em', 0] },
    strong: { attrs: { id: {} }, toDOM: () => ['strong', 0] },
  },
});

// ---------------------------------------------------------------------------
// The finding above, asserted rather than left in a comment.
// ---------------------------------------------------------------------------

function schemaRefusesRequiredBlockId() {
  try {
    new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { attrs: { id: {} }, content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
      marks: {},
    });
    return null;
  } catch (error) {
    return error.message;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Every distinct mark id of `type` in the document, and how many text nodes carry each.
function markSpread(doc, type) {
  const spread = new Map();
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== type) continue;
      spread.set(m.attrs.id, (spread.get(m.attrs.id) ?? 0) + 1);
    }
  });
  return spread;
}

function blockIds(doc) {
  const ids = [];
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') ids.push(node.attrs.id);
  });
  return ids;
}

// Any node or mark whose purpose is a range boundary would show up as a type we did not declare,
// or as an extra text node split at the overlap with no mark difference. CNT-007.
function boundaryConstructs(doc) {
  const found = [];
  doc.descendants((node) => {
    if (!['doc', 'paragraph', 'text'].includes(node.type.name)) found.push(node.type.name);
    for (const m of node.marks ?? []) {
      if (!['condition', 'suggestion', 'comment', 'emphasis', 'strong'].includes(m.type.name)) {
        found.push(`mark:${m.type.name}`);
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// The cost of CNT-002, priced - and it is subtler than a duplicate scan.
//
// ProseMirror's split copies the node's attrs to both halves, so a split duplicates the block id and
// nothing reports it. The obvious fix - walk the document, rename any id already seen - is WRONG, and
// wrong in a way that destroys data: paste a block carrying an id already in use at the top of the
// document and document order makes the incoming block the first occurrence, so the scan renames the
// EXISTING block. That breaks every cross-reference to it (STR-026) and makes comparison report a
// deletion (the reasoning behind CNT-009).
//
// So re-identification has to know which blocks ARRIVED, not merely which ids collide. The changed
// ranges come from the transaction's mapping; a block inside one is a candidate, a block outside one
// keeps what it has. That is the real cost of CNT-002 in this framework, and it is still one plugin.
// ---------------------------------------------------------------------------

let allocated = 0;
const nextId = () => `n${(allocated += 1)}`;

const identify = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    const changed = transactions.filter((t) => t.docChanged);
    if (changed.length === 0) return null;

    const combined = new Mapping();
    for (const t of changed) combined.appendMapping(t.mapping);

    // Where each id sat before the change, carried forward to where that position is now. A block
    // standing at its id's forward-mapped position DESCENDS from the block that held it and keeps it.
    // Every other block holding that id is new - a split's second half, or something pasted - and is
    // re-identified. The predicate is descent, not arrival: a split makes a new node out of content
    // that did not arrive from anywhere, so 'which content is new' cannot answer it.
    const heir = new Map();
    oldState.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph' || node.attrs.id === null) return;
      // assoc 1, and this is not a detail: a block inserted exactly at an existing block's position
      // maps that position to BEFORE the new content with assoc -1 and AFTER it with assoc 1. With -1
      // the incoming block looks like the heir and the existing block gets renamed, which is the
      // data-destroying outcome. One argument, and it decides which block keeps its identity.
      heir.set(node.attrs.id, combined.map(pos, 1));
    });

    const fixes = [];
    const taken = new Set();
    newState.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return;
      const id = node.attrs.id;
      if (id !== null && !taken.has(id) && heir.get(id) === pos) {
        taken.add(id);
        return;
      }
      fixes.push(pos);
    });
    if (fixes.length === 0) return null;

    const tr = newState.tr;
    // Later positions first, so an earlier fix cannot shift a later one.
    for (const pos of fixes.reverse()) tr.setNodeAttribute(pos, 'id', nextId());
    return tr;
  },
});

// ---------------------------------------------------------------------------
// Gate 2 - overlapping annotations, then edited
//
// The content model spike's case 1, rebuilt in the editor's model: a profiling condition over
// "registered under" and a suggested deletion over "is registered", which overlap without nesting.
// ---------------------------------------------------------------------------

console.log('\n=== Gate 2 - overlapping annotations, then edited ===\n');

check(
  'a required block id with no default is refused by the editor schema (CNT-002, CNT-124)',
  schemaRefusesRequiredBlockId() !== null,
  true,
  schemaRefusesRequiredBlockId() ?? 'schema was accepted - the finding no longer holds',
);

const condition = schema.marks.condition.create({ id: 'c1', axis: 'jurisdiction', values: ['uk'] });
const suggestion = schema.marks.suggestion.create({ id: 's1', operation: 'delete', author: 'Ada' });

// "The firm is registered under the Act"
//                 |-- s1 --|
//                    |---- c1 ----|
// s1 covers "is registered", c1 covers "registered under" - they overlap and neither nests.
const overlapping = schema.node('doc', null, [
  schema.node('paragraph', { id: 'b1' }, [
    schema.text('The firm '),
    schema.text('is ', [suggestion]),
    schema.text('registered', [suggestion, condition]),
    schema.text(' under', [condition]),
    schema.text(' the Act'),
  ]),
]);

check(
  'the overlap needs no construct of its own (CNT-007)',
  boundaryConstructs(overlapping),
  [],
  'no milestone, no range-start, no range-end, no standoff node',
);

check(
  'each annotation is one id across its fragments (CNT-004)',
  [
    ...markSpread(overlapping, 'condition').entries(),
    ...markSpread(overlapping, 'suggestion').entries(),
  ],
  [
    ['c1', 2],
    ['s1', 2],
  ],
  'c1 spans two text nodes, s1 spans two, and each is one annotation',
);

// --- typing inside one annotation ---
let state = EditorState.create({ doc: overlapping, schema });
// Insert inside "registered", which carries both marks. Position: doc(0) p(1) "The firm "(9) ...
const insideBoth = 1 + 'The firm '.length + 'is '.length + 4; // inside "registered"
state = state.apply(state.tr.insertText('XX', insideBoth));

check(
  'typing inside an overlap keeps both annotations, still one id each (CNT-004)',
  [
    ...markSpread(state.doc, 'condition').entries(),
    ...markSpread(state.doc, 'suggestion').entries(),
  ],
  [
    ['c1', 2],
    ['s1', 2],
  ],
  'inserted text inherits the marks at the position and merges into the existing text node',
);

check(
  'the inserted text is inside the annotation rather than beside it',
  state.doc.textContent,
  'The firm is regiXXstered under the Act',
);

// --- splitting the paragraph across both annotations ---
let split = EditorState.create({ doc: overlapping, schema });
const splitAt = 1 + 'The firm '.length + 'is '.length + 4; // inside "registered", inside both marks
split = split.apply(split.tr.split(splitAt));

const conditionAfterSplit = markSpread(split.doc, 'condition');
const suggestionAfterSplit = markSpread(split.doc, 'suggestion');

check(
  'splitting across an annotation keeps it one annotation under one id (CNT-004)',
  [conditionAfterSplit.size, suggestionAfterSplit.size],
  [1, 1],
  'both halves carry the same mark attrs, so the id is shared rather than duplicated as a new one',
);

check(
  'the annotation now spans two blocks and is still one id',
  [conditionAfterSplit.get('c1') >= 2, suggestionAfterSplit.get('s1') >= 2],
  [true, true],
  'marks fragment at a block boundary, which ADR-0005 says is the same shape as standoff markup',
);

// --- accepting one annotation acts on every fragment, in one operation (CNT-005) ---
let accept = EditorState.create({ doc: split.doc, schema });
const tr = accept.tr;
let removals = 0;
accept.doc.descendants((node, pos) => {
  if (!node.isText) return;
  if (node.marks.some((m) => m.type.name === 'suggestion' && m.attrs.id === 's1')) {
    tr.removeMark(pos, pos + node.nodeSize, schema.marks.suggestion);
    removals += 1;
  }
});
accept = accept.apply(tr);

check(
  'accepting acts on every fragment of one id in one transaction (CNT-005)',
  [markSpread(accept.doc, 'suggestion').size, markSpread(accept.doc, 'condition').size],
  [0, 1],
  `one transaction, ${removals} ranges; the overlapping condition is untouched`,
);

// --- two different annotations of the same type, adjacent, must not merge ---
const twoConditions = schema.node('doc', null, [
  schema.node('paragraph', { id: 'b2' }, [
    schema.text('alpha', [
      schema.marks.condition.create({ id: 'cA', axis: 'market', values: ['eu'] }),
    ]),
    schema.text('beta', [
      schema.marks.condition.create({ id: 'cB', axis: 'market', values: ['us'] }),
    ]),
  ]),
]);

check(
  'two annotations of one type, adjacent, stay two (CNT-004)',
  [...markSpread(twoConditions, 'condition').keys()].sort(),
  ['cA', 'cB'],
  'distinct attrs make the marks unequal, so the text nodes do not merge',
);

// ---------------------------------------------------------------------------
// Case 5 - block identifiers through ordinary editing
// ---------------------------------------------------------------------------

console.log('\n=== Case 5 - block identifiers through ordinary editing ===\n');

const twoBlocks = schema.node('doc', null, [
  schema.node('paragraph', { id: 'b1' }, [schema.text('first paragraph')]),
  schema.node('paragraph', { id: 'b2' }, [schema.text('second paragraph')]),
]);

check('a document starts with the identifiers it was built with', blockIds(twoBlocks), [
  'b1',
  'b2',
]);

// Split the first paragraph, with no plugin: the defect.
let bare = EditorState.create({ doc: twoBlocks, schema });
bare = bare.apply(bare.tr.split(1 + 'first'.length));
const bareIds = blockIds(bare.doc);

check(
  'FINDING: splitting a block duplicates its identifier, silently (CNT-002)',
  new Set(bareIds).size !== bareIds.length,
  true,
  `ids after split with no plugin: ${JSON.stringify(bareIds)} - split copies attrs to both halves`,
);

// The same split, with the plugin. This is the cost, paid.
let splitBlocks = EditorState.create({ doc: twoBlocks, schema, plugins: [identify] });
splitBlocks = splitBlocks.apply(splitBlocks.tr.split(1 + 'first'.length));
const afterSplit = blockIds(splitBlocks.doc);

check(
  'with one appendTransaction, a split allocates a new identifier (CNT-002)',
  new Set(afterSplit).size === afterSplit.length && !afterSplit.includes(null),
  true,
  `ids after split with the plugin: ${JSON.stringify(afterSplit)}`,
);

// A paste of a block carrying an id already in use must be re-identified too (CNT-132).
let pasted = EditorState.create({ doc: twoBlocks, schema, plugins: [identify] });
pasted = pasted.apply(
  pasted.tr.insert(
    0,
    schema.node('paragraph', { id: 'b2' }, [schema.text('pasted, id already in use')]),
  ),
);
const pastedIds = blockIds(pasted.doc);

check(
  'a pasted block is re-identified, and the existing blocks are not (CNT-132, STR-026)',
  [
    new Set(pastedIds).size === pastedIds.length,
    pastedIds.includes('b1'),
    pastedIds.includes('b2'),
  ],
  [true, true, true],
  `ids after paste: ${JSON.stringify(pastedIds)} - b1 and b2 must both survive untouched`,
);

// Join the two original paragraphs.
let joined = EditorState.create({ doc: twoBlocks, schema });
joined = joined.apply(joined.tr.join(1 + 'first paragraph'.length + 1));

check(
  'joining two blocks keeps one of the two identifiers and invents none (CNT-002)',
  blockIds(joined.doc).every((id) => ['b1', 'b2'].includes(id)),
  true,
  `ids after join: ${JSON.stringify(blockIds(joined.doc))}`,
);

// ---------------------------------------------------------------------------
// Case 6 - the lossless round-trip (CNT-001, as content-model.md reads it)
// ---------------------------------------------------------------------------

console.log('\n=== Case 6 - the lossless round-trip ===\n');

// Canonical serialisation: members in a declared order, no insignificant whitespace.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const roundTrip = (doc) => PMNode.fromJSON(schema, JSON.parse(JSON.stringify(doc.toJSON())));

for (const [name, doc] of [
  ['the overlap', overlapping],
  ['after a split across an annotation', split.doc],
  ['two adjacent annotations of one type', twoConditions],
]) {
  const there = doc.toJSON();
  const back = roundTrip(doc).toJSON();
  check(`round-trip is lossless: ${name}`, canonical(back) === canonical(there), true);
}

// Construction order must not change the hash input.
const built = schema.node('doc', null, [
  schema.node('paragraph', { id: 'b9' }, [
    schema.text('x', [
      schema.marks.strong.create({ id: 'm1' }),
      schema.marks.emphasis.create({ id: 'm2' }),
    ]),
  ]),
]);
const reversed = schema.node('doc', null, [
  schema.node('paragraph', { id: 'b9' }, [
    schema.text('x', [
      schema.marks.emphasis.create({ id: 'm2' }),
      schema.marks.strong.create({ id: 'm1' }),
    ]),
  ]),
]);

check(
  'two documents differing only in construction order serialise identically',
  canonical(built.toJSON()) === canonical(reversed.toJSON()),
  true,
  'marks are a set, and the schema declares their order',
);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
