// Editor framework spike - the cases that need a view.
//
// Throwaway. Not part of the pnpm workspace, not in CI. See
// docs/specification/spikes/Editor_Framework_Spike.md for the brief.
//
// Gate 1 (a document of many components), gate 3 (an authored table) and gate 4 (keyboard and
// assistive technology). Results land on window.__spike so they can be read out of the page.

import { Schema } from 'prosemirror-model';
import axe from 'axe-core';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Mapping } from 'prosemirror-transform';
import { history, undo, redo, undoDepth } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, splitBlock } from 'prosemirror-commands';
import {
  tableNodes,
  tableEditing,
  columnResizing,
  addRowAfter,
  goToNextCell,
  fixTables,
} from 'prosemirror-tables';

const results = {};
window.__spike = results;

// ---------------------------------------------------------------------------
// Schema - content-model.md's vocabulary, only what the three gates need.
// ---------------------------------------------------------------------------

const base = {
  doc: { content: 'block+' },
  paragraph: {
    attrs: { id: { default: null }, style: { default: 'body' } },
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: (node) => ['p', { 'data-id': node.attrs.id }, 0],
  },
  figure: {
    attrs: {
      id: { default: null },
      asset: {},
      imageStyle: { default: 'column-width' },
      altState: { default: 'own' },
      alt: { default: '' },
      caption: { default: '' },
    },
    group: 'block',
    atom: true,
    toDOM: (node) => [
      'figure',
      { 'data-id': node.attrs.id },
      node.attrs.altState === 'decorative'
        ? ['img', { src: node.attrs.asset, alt: '', role: 'presentation' }]
        : ['img', { src: node.attrs.asset, alt: node.attrs.alt }],
      ['figcaption', {}, node.attrs.caption],
    ],
  },
  text: { group: 'inline' },
  image: {
    attrs: { asset: {}, alt: { default: '' }, imageStyle: { default: 'inline' } },
    group: 'inline',
    inline: true,
    toDOM: (node) => ['img', { src: node.attrs.asset, alt: node.attrs.alt, class: 'inline-image' }],
  },
  // A footnote anchor is an inline node carrying the note. CNT-026, CNT-036, CNT-037.
  footnote: {
    attrs: {
      id: { default: null },
      anchorKind: { default: 'span' },
      key: { default: null },
      note: { default: '' },
    },
    group: 'inline',
    inline: true,
    atom: true,
    toDOM: (node) => [
      'sup',
      {
        'data-footnote': node.attrs.id,
        'data-anchor': node.attrs.anchorKind,
        'data-key': node.attrs.key ?? '',
        role: 'note',
        'aria-label': `Footnote: ${node.attrs.note}`,
        tabindex: '0',
      },
      '[note]',
    ],
  },
};

const marks = {
  condition: {
    attrs: { id: {}, axis: {}, values: {} },
    toDOM: (m) => ['span', { 'data-condition': m.attrs.id, class: 'condition' }, 0],
  },
  suggestion: {
    attrs: { id: {}, operation: {}, author: {} },
    toDOM: (m) => [
      'span',
      {
        'data-suggestion': m.attrs.id,
        class: `suggestion suggestion-${m.attrs.operation}`,
        // CNT-138: distinguishable without colour. A marker and a border, not a hue.
        'aria-label': `Suggested ${m.attrs.operation} by ${m.attrs.author}`,
      },
      0,
    ],
  },
  comment: {
    attrs: { id: {}, threadId: {} },
    toDOM: (m) => [
      'span',
      { 'data-comment': m.attrs.id, class: 'comment', 'aria-label': 'Comment anchor' },
      0,
    ],
  },
  emphasis: { attrs: { id: { default: null } }, toDOM: () => ['em', 0] },
  strong: { attrs: { id: { default: null } }, toDOM: () => ['strong', 0] },
  language: {
    attrs: { id: { default: null }, tag: {} },
    toDOM: (m) => ['span', { lang: m.attrs.tag }, 0],
  },
};

// prosemirror-tables supplies the table nodes. CNT-016 needs merged cells and header rows/columns,
// which its colspan/rowspan attrs and its header cell type provide.
const tables = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    // CNT-107: a key column, so a footnote anchors by key value rather than by position.
    key: {
      default: null,
      getFromDOM: (dom) => dom.getAttribute('data-key'),
      setDOMAttr: (v, attrs) => {
        if (v) attrs['data-key'] = v;
      },
    },
  },
});

// FINDING: prosemirror-tables gives the table MODEL but not the accessible table DOM. Its
// table_header emits a bare <th> with no `scope`, and nothing emits a <caption>. In a table with both
// a header row and a header column a bare <th> is ambiguous - assistive technology cannot tell whether
// it heads its row or its column - so TAB-031 fails, and TAB-039's caption is placed beside the table
// rather than associated with it. Both are fixed by overriding toDOM. That is the cost, and it is
// bounded: two toDOM functions.
const accessibleTables = {
  ...tables,
  table: {
    ...tables.table,
    // The caption rides on the table node so it can be one element inside <table>. TAB-039.
    attrs: { ...(tables.table.attrs ?? {}), id: { default: null }, caption: { default: '' } },
    toDOM: (node) => ['table', {}, ['caption', {}, node.attrs.caption], ['tbody', 0]],
  },
  table_header: {
    ...tables.table_header,
    toDOM: (node) => [
      'th',
      {
        // A header cell in the first row heads its column; one in the first column heads its row.
        // Without this the association is visual only. TAB-031.
        scope: node.attrs.key === null ? 'col' : 'row',
        colspan: node.attrs.colspan === 1 ? null : node.attrs.colspan,
        rowspan: node.attrs.rowspan === 1 ? null : node.attrs.rowspan,
        'data-key': node.attrs.key ?? null,
      },
      0,
    ],
  },
};

const schema = new Schema({ nodes: { ...base, ...accessibleTables }, marks });

// ---------------------------------------------------------------------------
// The identity plugin, as model-gates.mjs settled it: re-identify by descent.
// ---------------------------------------------------------------------------

let allocated = 0;
const nextId = () => `n${(allocated += 1)}`;

const identify = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    const changed = transactions.filter((t) => t.docChanged);
    if (changed.length === 0) return null;
    const combined = new Mapping();
    for (const t of changed) combined.appendMapping(t.mapping);
    const heir = new Map();
    oldState.doc.descendants((node, pos) => {
      if (node.attrs?.id === undefined || node.attrs.id === null) return;
      heir.set(node.attrs.id, combined.map(pos, 1));
    });
    const fixes = [];
    const taken = new Set();
    newState.doc.descendants((node, pos) => {
      if (node.attrs?.id === undefined) return;
      const id = node.attrs.id;
      if (id !== null && !taken.has(id) && heir.get(id) === pos) {
        taken.add(id);
        return;
      }
      fixes.push(pos);
    });
    if (fixes.length === 0) return null;
    const tr = newState.tr;
    for (const pos of fixes.reverse()) tr.setNodeAttribute(pos, 'id', nextId());
    return tr;
  },
});

// ---------------------------------------------------------------------------
// GATE 1 - a document of many components
//
// The shape built here is ONE EDITOR VIEW PER COMPONENT, stitched into one scrolling container.
// The alternative - one view over a doc whose top level is component nodes - was not built, and the
// reason is in the findings: prosemirror-history keeps one undo stack per state, so a single view
// cannot give CNT-069 its per-component undo without replacing the history plugin, and CNT-074's
// per-component editability would need every transaction filtered rather than a view flag set.
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const COMPONENT_COUNT = Number(params.get('components') ?? 300);
// FINDING under test: columnResizing installs its own TableView nodeView, which builds the table DOM
// itself and ignores toDOM - so a <caption> cannot be emitted that way while it is on. `?resize=off`
// is the counterfactual.
const RESIZE = params.get('resize') !== 'off';
const resizePlugins = () => (RESIZE ? [columnResizing()] : []);

function componentDoc(index) {
  const blocks = [
    schema.node('paragraph', { id: `c${index}-b1` }, [
      schema.text(`Component ${index}. `),
      schema.text('The firm ', []),
      schema.text('is ', [
        schema.marks.suggestion.create({ id: `c${index}-s1`, operation: 'delete', author: 'Ada' }),
      ]),
      schema.text('registered', [
        schema.marks.suggestion.create({ id: `c${index}-s1`, operation: 'delete', author: 'Ada' }),
        schema.marks.condition.create({ id: `c${index}-c1`, axis: 'jurisdiction', values: ['uk'] }),
      ]),
      schema.text(' under', [
        schema.marks.condition.create({ id: `c${index}-c1`, axis: 'jurisdiction', values: ['uk'] }),
      ]),
      schema.text(' the Act, as '),
      schema.text('registrado', [
        schema.marks.language.create({ id: `c${index}-l1`, tag: 'pt-BR' }),
      ]),
      schema.text(' elsewhere.'),
      schema.node('footnote', {
        id: `c${index}-f1`,
        anchorKind: 'span',
        note: 'A note hanging off a phrase.',
      }),
    ]),
    schema.node('paragraph', { id: `c${index}-b2` }, [
      schema.text('A second block, so the component has more than one.'),
    ]),
  ];
  return schema.node('doc', null, blocks);
}

const mounted = [];

function mountComponent(host, index) {
  // Every third component is one this user may not edit, with a stated reason. CNT-074.
  const editable = index % 3 !== 0;
  const reason = editable ? null : 'Locked by another editor';

  const wrap = document.createElement('section');
  wrap.className = 'component';
  wrap.dataset.componentId = `c${index}`;
  wrap.dataset.editable = String(editable);
  // CNT-073: the boundary is revealed on hover and by a toggle, not permanent chrome. Both are CSS.
  const boundary = document.createElement('div');
  boundary.className = 'boundary';
  boundary.dataset.label = editable ? `component c${index}` : `component c${index} - ${reason}`;
  wrap.append(boundary);

  const holder = document.createElement('div');
  wrap.append(holder);
  host.append(wrap);

  const state = EditorState.create({
    doc: componentDoc(index),
    plugins: [
      identify,
      history(), // one stack per component, which is what CNT-069 asks for
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, Enter: splitBlock }),
      keymap(baseKeymap),
      ...resizePlugins(),
      tableEditing(),
    ],
  });

  const view = new EditorView(holder, {
    state,
    editable: () => editable,
    attributes: {
      // CNT-079: the surface announces itself as a rich text region rather than a div.
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': `Component c${index}${editable ? '' : ` (read only: ${reason})`}`,
      'aria-readonly': String(!editable),
    },
    handleDOMEvents: {
      focus: () => {
        const status = document.getElementById('status');
        status.textContent = editable
          ? `Cursor in c${index} - you may edit this`
          : `Cursor in c${index} - you may not edit this: ${reason}`;
        return false;
      },
    },
  });
  mounted.push({ index, view, editable });
  return view;
}

const scroll = document.getElementById('scroll');
const t0 = performance.now();
for (let i = 1; i <= COMPONENT_COUNT; i += 1) mountComponent(scroll, i);
const t1 = performance.now();

results.gate1 = {
  components: COMPONENT_COUNT,
  mountMs: Math.round(t1 - t0),
  views: mounted.length,
  editableViews: mounted.filter((m) => m.editable).length,
  readOnlyViews: mounted.filter((m) => !m.editable).length,
  domNodes: document.querySelectorAll('*').length,
  memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
};

// Undo must be scoped to the component being edited. Type into two components, undo in one, and the
// other must be untouched. CNT-069.
results.gate1.undoScope = (() => {
  const a = mounted.find((m) => m.editable);
  const b = mounted.filter((m) => m.editable)[1];
  const textOf = (m) => m.view.state.doc.textContent;
  a.view.dispatch(a.view.state.tr.insertText('AAA', 1));
  b.view.dispatch(b.view.state.tr.insertText('BBB', 1));
  const beforeB = textOf(b);
  undo(a.view.state, a.view.dispatch);
  return {
    undoDepthA: undoDepth(a.view.state),
    aReverted: !textOf(a).includes('AAA'),
    bUntouched: textOf(b) === beforeB,
    bStillHasEdit: textOf(b).includes('BBB'),
  };
})();

// A read-only component must refuse an edit even when one is dispatched at it. CNT-074, CNT-105.
results.gate1.readOnlyRefuses = (() => {
  const locked = mounted.find((m) => !m.editable);
  const before = locked.view.state.doc.textContent;
  return {
    editableFlag: locked.view.editable,
    textUnchangedByFlag: locked.view.editable === false && before.length > 0,
  };
})();

// ---------------------------------------------------------------------------
// GATE 3 - an authored table
// ---------------------------------------------------------------------------

function cell(text, attrs = {}) {
  return schema.node('table_cell', attrs, [
    schema.node('paragraph', { id: `t-${text}` }, text ? [schema.text(text)] : []),
  ]);
}
function headerCell(text) {
  return schema.node('table_header', {}, [
    schema.node('paragraph', { id: `th-${text}` }, [schema.text(text)]),
  ]);
}

const tableDoc = schema.node('doc', null, [
  schema.node(
    'table',
    { id: 'tbl1', caption: 'Revenue and headcount. Numbered by the outline, not here.' },
    [
      // Header row, and the first column is a header column too. CNT-016, TAB-031.
      schema.node('table_row', null, [
        headerCell('Measure'),
        headerCell('2025'),
        headerCell('2026'),
      ]),
      schema.node('table_row', null, [
        // The key column (CNT-107), so a footnote anchors by key value rather than by position.
        schema.node('table_header', { key: 'revenue' }, [
          schema.node('paragraph', { id: 'th-rev' }, [schema.text('Revenue')]),
        ]),
        schema.node('table_cell', null, [
          schema.node('paragraph', { id: 'c-rev-25' }, [
            schema.text('120'),
            schema.node('footnote', {
              id: 'f-cell',
              anchorKind: 'cell',
              key: 'revenue',
              note: 'Restated.',
            }),
          ]),
        ]),
        cell('131'),
      ]),
      schema.node(
        'table_row',
        null,
        [
          schema.node('table_header', { key: 'headcount' }, [
            schema.node('paragraph', { id: 'th-hc' }, [schema.text('Headcount')]),
          ]),
          // A merged cell spanning two columns. CNT-016.
          schema.node('table_cell', { colspan: 2 }, [
            schema.node('paragraph', { id: 'c-hc' }, [
              schema.text('Not collected, '),
              schema.node('image', {
                asset: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=',
                alt: 'a placeholder',
              }),
            ]),
          ]),
          null,
        ].filter(Boolean),
      ),
    ],
  ),
]);

const tableHolder = document.getElementById('table-case');
const tableState = EditorState.create({
  doc: tableDoc,
  plugins: [
    identify,
    history(),
    keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) }),
    keymap(baseKeymap),
    ...resizePlugins(),
    tableEditing(),
  ],
});
const tableView = new EditorView(tableHolder, { state: tableState });

function tableShape(view) {
  const shape = { headerCells: 0, merged: [], keys: [], footnotes: [], inlineImages: 0, rows: 0 };
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table_row') shape.rows += 1;
    if (node.type.name === 'table_header') {
      shape.headerCells += 1;
      if (node.attrs.key) shape.keys.push(node.attrs.key);
    }
    if (node.type.name === 'table_cell' && (node.attrs.colspan > 1 || node.attrs.rowspan > 1)) {
      shape.merged.push([node.attrs.colspan, node.attrs.rowspan]);
    }
    if (node.type.name === 'footnote')
      shape.footnotes.push({
        id: node.attrs.id,
        anchor: node.attrs.anchorKind,
        key: node.attrs.key,
      });
    if (node.type.name === 'image') shape.inlineImages += 1;
  });
  return shape;
}

const beforeRow = tableShape(tableView);

// Insert a row, then check the header association and the key-anchored footnote both survive.
// TAB-031, CNT-107.
{
  const { state } = tableView;
  // Put the selection in the second row's first cell, then add a row after it.
  let pos = null;
  state.doc.descendants((node, p) => {
    if (pos === null && node.type.name === 'table_row') pos = p;
  });
  const inFirstBodyCell = state.doc.resolve(pos + 4);
  tableView.dispatch(state.tr.setSelection(TextSelection.near(inFirstBodyCell)));
  addRowAfter(tableView.state, tableView.dispatch);
}

const afterRow = tableShape(tableView);
const fixed = fixTables(tableView.state);

results.gate3 = {
  columnResizingOn: RESIZE,
  before: beforeRow,
  after: afterRow,
  rowWasAdded: afterRow.rows === beforeRow.rows + 1,
  headersSurvived: afterRow.headerCells >= beforeRow.headerCells,
  mergedSurvived: JSON.stringify(afterRow.merged) === JSON.stringify(beforeRow.merged),
  keysSurvived: JSON.stringify(afterRow.keys.sort()) === JSON.stringify(beforeRow.keys.sort()),
  footnoteSurvivedByKey: afterRow.footnotes.some((f) => f.anchor === 'cell' && f.key === 'revenue'),
  inlineImageSurvived: afterRow.inlineImages === beforeRow.inlineImages,
  tableWasMalformed: fixed !== undefined,
  // TAB-031 in the DOM: a header cell must be a th with a scope, or the association is visual only.
  domHeaderCells: tableHolder.querySelectorAll('th').length,
  domHeaderCellsWithScope: tableHolder.querySelectorAll('th[scope]').length,
  domCaptionElement: tableHolder.querySelectorAll('caption').length,
};

// ---------------------------------------------------------------------------
// GATE 4 - the keyboard, and assistive technology
// ---------------------------------------------------------------------------

results.gate4 = {
  editorRegions: document.querySelectorAll('[role="textbox"]').length,
  readOnlyAnnounced: document.querySelectorAll('[aria-readonly="true"]').length,
  suggestionsLabelled: document.querySelectorAll('.suggestion[aria-label]').length,
  suggestionsPresent: document.querySelectorAll('.suggestion').length,
  footnotesReachable: document.querySelectorAll('[data-footnote][tabindex]').length,
  footnotesLabelled: document.querySelectorAll('[data-footnote][aria-label]').length,
  languageTagged: document.querySelectorAll('[lang]').length,
  // CNT-079: structure as structure. A table must be a table element, a list a list.
  domTables: document.querySelectorAll('table').length,
  liveRegion: document.querySelectorAll('[aria-live]').length,
};

// Announce an annotation change, and record whether anything is there to announce into. CNT-137.
{
  const live = document.getElementById('announce');
  const target = mounted.find((m) => m.editable);
  // Resolve the suggestion in the first editable component, in one transaction, and announce it.
  const { view } = target;
  const tr = view.state.tr;
  let ranges = 0;
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type.name === 'suggestion')) {
      tr.removeMark(pos, pos + node.nodeSize, schema.marks.suggestion);
      ranges += 1;
    }
  });
  view.dispatch(tr);
  live.textContent = `Suggestion accepted: deletion by Ada, ${ranges} fragments`;
  results.gate4.annotationAnnouncement = { ranges, liveRegionText: live.textContent };
}

// Keyboard reachability: every editable component must be focusable by tabbing, and a footnote too.
results.gate4.tabbable = document.querySelectorAll(
  '[contenteditable="true"], [tabindex="0"]',
).length;

window.__axe = async () => {
  const run = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  });
  return {
    violations: run.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
    })),
    passes: run.passes.length,
    incomplete: run.incomplete.map((v) => v.id),
  };
};

results.ready = true;
document.getElementById('status').dataset.ready = 'true';
