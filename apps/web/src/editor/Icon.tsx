import styles from './Icon.module.css';

/** Letterforms: the marks a type designer would draw as type rather than as a picture. */
const LETTERS: Record<string, string> = {
  Strong: 'B',
  Emphasis: 'I',
  Underline: 'U',
  Subscript: 'x\u2082',
  Superscript: 'x\u00b2',
  // Omega, which word processors draw on the button that inserts a symbol (W14.7).
  Symbols: String.fromCodePoint(0x3a9),
  'Quoted phrase': '\u201c\u201d',
};

/** One or two paths on a 16px grid, stroked in the current colour (the handoff's own table). */
const PATHS: Record<string, readonly string[]> = {
  'Inline code': ['M6 4.5 2.5 8 6 11.5', 'M10 4.5 13.5 8 10 11.5'],
  Link: [
    'M6.4 9.6 9.6 6.4',
    'M9.1 5.4h1.6a2.6 2.6 0 0 1 0 5.2H9.1M6.9 10.6H5.3a2.6 2.6 0 0 1 0-5.2h1.6',
  ],
  Language: [
    'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
    'M2.7 8h10.6M8 2.6c1.7 1.9 1.7 9 0 10.8M8 2.6c-1.7 1.9-1.7 9 0 10.8',
  ],
  // A pilcrow and the way its line runs: a part's base direction.
  'Left to right': [
    'M7 2.5v6.5M10 2.5v6.5M11.5 2.5H6.3a2.1 2.1 0 0 0 0 4.2H7',
    'M3 12.5h10M11 10.7l2 1.8-2 1.8',
  ],
  'Right to left': [
    'M7 2.5v6.5M10 2.5v6.5M11.5 2.5H6.3a2.1 2.1 0 0 0 0 4.2H7',
    'M13 12.5H3M5 10.7l-2 1.8 2 1.8',
  ],
  // A tag tied to words: a governed term (the TM plan, TMc).
  Term: ['M2.5 4.5h7l4 3.5-4 3.5h-7z', 'M5.2 8h.01'],
  'Bulleted list': ['M6 4.5h7.5M6 8h7.5M6 11.5h7.5', 'M3 4.5h.01M3 8h.01M3 11.5h.01'],
  'Numbered list': [
    'M6.5 4.5h7M6.5 8h7M6.5 11.5h7',
    'M2 3.6h1v2.6M1.9 6.2h2.2M2.1 9.4a1 1 0 0 1 1.7.7c0 .8-1.8 1.3-1.8 2.3h2',
  ],
  'Definition list': ['M2.5 4.3h6M2.5 10h6', 'M5.5 7.3h8M5.5 13h4.5'],
  'Nest item': ['M7 4.5h6.5M7 8h6.5M7 11.5h6.5', 'M2.5 6.3 4.6 8l-2.1 1.7'],
  'Lift item': ['M7 4.5h6.5M7 8h6.5M7 11.5h6.5', 'M4.6 6.3 2.5 8l2.1 1.7'],
  Quotation: ['M3.6 4.3v7.4', 'M6.8 5.4h6.6M6.8 8.4h6.6M6.8 11.4h4.2'],
  'Preformatted text': ['M2.6 3.6h10.8v8.8H2.6z', 'M5 6.8h3M5 9.4h6'],
  Table: ['M2.5 3h11v10h-11z', 'M2.5 6.4h11M2.5 9.7h11M6.2 3v10M9.8 3v10'],
  // Lines of text and a raised mark after the first, which carries no number (footnotes 1).
  Footnote: ['M2.5 5h7M2.5 8.5h11M2.5 12h8', 'M12.3 2.2v3.2M10.9 3l2.8 1.6M13.7 3l-2.8 1.6'],
  // Lines of text, and an arrow leaving them for the thing they name, drawn as a box: a reference
  // points elsewhere in the document, where a footnote's mark stays on its line (cross-references 1).
  Reference: [
    'M2.5 10.5h6M2.5 13.5h9',
    'M9.5 2.5h4v4h-4z',
    'M3.5 7.8c0-2 1.4-3.3 3.8-3.3M5.9 3.1l1.4 1.4-1.4 1.4',
  ],
  // A numbered citation in its brackets, [1], as a numeric style prints one (CId).
  Cite: ['M5.5 3H3.5v10h2M10.5 3h2v10h-2', 'M7 5.4 8.3 4.4v7.2'],
  // An index's lines, a ribbon marking one: an entry that prints nothing where it stands (IX-M).
  'Index entry': ['M2.5 4h6M2.5 7.5h4.5M2.5 11h6M2.5 14h4.5', 'M10.5 2.5h3v8l-1.5-1.4-1.5 1.4z'],
  // A value standing in a line of text, drawn from a cylinder: a value bound to a source (B2).
  Value: [
    'M2 13h12',
    'M5 4.2c0-.9 1.3-1.4 3-1.4s3 .5 3 1.4v5.6c0 .9-1.3 1.4-3 1.4s-3-.5-3-1.4z',
    'M5 4.2c0 .9 1.3 1.4 3 1.4s3-.5 3-1.4',
  ],
  // A number sign, and words forking from it: the arm a number selects (the MF plan, MF-G).
  'Message form': ['M2.5 6h5.5M2 10h5.5M5 3.5 4 12.5M8 3.5l-1 9', 'M10 8h1.5l2-3M11.5 8l2 3'],
  // A line that forks, one branch for each reader: text kept for some profiles alone (R6-H).
  Condition: ['M4 2.5v11', 'M4 9c0-3 2.2-4.5 5-4.5h3.5', 'M10.5 2.5l2 2-2 2'],
  // Braces round an x: a name standing for a value (the R5 plan, R5b).
  Variable: [
    'M5.5 3C4 3 4 4 4 5.2S3.6 7.6 2.5 8c1.1.4 1.5 1.6 1.5 2.8S4 13 5.5 13',
    'M10.5 3C12 3 12 4 12 5.2s.4 2.4 1.5 2.8c-1.1.4-1.5 1.6-1.5 2.8S12 13 10.5 13',
    'M6.8 6.3l2.4 3.4M9.2 6.3l-2.4 3.4',
  ],
  // A pi, its bar curling in at the left as a typeset one does: the letter word processors draw on
  // their equation button, where a root sign reads as the square root alone (equations 1).
  Equation: [
    'M2.5 5.2c.5-.9 1.2-1.3 2.2-1.3h8.8',
    'M6.2 3.9c0 3.6-.6 6.6-2.2 8.6',
    'M10.4 3.9v6.9c0 1 .5 1.6 1.4 1.6h.9',
  ],
  'Save version': ['M3 2.6h7.2L13.4 5.8V13.4H3z', 'M5.6 2.6v3.6h4.8'],
  'Done editing': ['M3.2 8.4 6.3 11.5 12.8 5'],
  // A clock turned back: the author's own saved text, to restore (W11.2).
  'Saved text': ['M3.1 6.2A5.2 5.2 0 1 1 2.8 8.8', 'M2.4 3.6v2.8h2.8', 'M8 5.2V8l2 1.4'],
  Close: ['M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8'],
  // The outline pane and the status bar (interface slice 15).
  Back: ['M13 8H3.4M7 3.8 3 8l4 4.2'],
  Contents: ['M2.5 4h11M2.5 8h11M2.5 12h7'],
  // A pilcrow: the paragraph's style (ADR-0075).
  Paragraph: ['M12 2.5H7a3 3 0 0 0 0 6h2', 'M9 2.5v11M12 2.5v11'],
  Insert: ['M8 3v10M3 8h10'],
  'Hide pane': ['M9.5 4 5.5 8l4 4'],
  'Show pane': ['M6.5 4l4 4-4 4'],
  'Add section': ['M2.5 3.6h11M2.5 7.2h6.5M2.5 10.8h4', 'M12 9.2v5.2M9.4 11.8h5.2'],
  'Add component': ['M3 2.4h5.6L11.4 5.2v4.4H3z', 'M12 9.6v4.8M9.6 12h4.8'],
  Undo: ['M3 5.4h6.2a3.4 3.4 0 0 1 0 6.8H5.4', 'M5.4 2.8 2.6 5.4l2.8 2.6'],
  Folder: ['M2.4 4.2h4l1.2 1.6h6V12H2.4z'],
  Document: ['M3.4 2.6h5.4l3 3v7.8H3.4z', 'M8.6 2.6v3.2h3'],
  // A page with a plus on it: making a document (the ND handoff).
  'New document': ['M3.4 2.6h5.4l3 3v7.8H3.4z', 'M8.6 2.6v3.2h3', 'M7.6 7.4v4.4M5.4 9.6h4.4'],
  // Two parts joined by a line: components kept and placed together (the CG plan).
  'Component group': ['M2.5 2.5h6v4.5h-6z', 'M7.5 9h6v4.5h-6z', 'M5.5 7v4h2'],
  Move: ['M8 3v10M5.2 10.2 8 13l2.8-2.8'],
  // A picture in a frame: a hill and the sun, as every image button draws one.
  Figure: ['M2.5 3h11v10h-11z', 'M2.5 11.5 6 8l3 3 2-2 2.5 2.5', 'M10.5 5.8h.01'],
  // A picture laid over another, the one it takes the place of (ADR-0055).
  'Replace image': ['M5.5 4.5V2.5h8v7h-2', 'M2.5 5.5h8v8h-8zM2.5 12 5 9.5l2 2 1.5-1.5 2 2'],
  // Three sliders, each at its own setting: a dialog of settings (ADR-0055).
  Settings: ['M2.5 4.5h11M2.5 8h11M2.5 11.5h11', 'M5.5 3v3M10.5 6.5v3M7 10v3'],
  // A store of records, drawn as the cylinder databases are: what a bound figure's text comes from.
  Data: [
    'M3.5 4c0-1 2-1.8 4.5-1.8s4.5.8 4.5 1.8-2 1.8-4.5 1.8S3.5 5 3.5 4z',
    'M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8',
  ],
  // The zoom's steps in the status bar (ADR-0056).
  'Zoom out': ['M3.5 8h9'],
  'Zoom in': ['M3.5 8h9M8 3.5v9'],
  // The document bar's (ADR-0056): an open book, a pencil, an eye, a frame's corners, a lock.
  Reading: [
    'M2 3.5h4.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H2z',
    'M14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14z',
  ],
  // Review's: a speech bubble (the TH plan, Task 3).
  Review: ['M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z'],
  Authoring: ['M3 13l.6-2.6 6.9-6.9 2 2-6.9 6.9z', 'M9.5 4.5l2 2'],
  Preview: [
    'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z',
    'M6 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  ],
  'Show boundaries': ['M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11', 'M5.5 5.5h5v5h-5z'],
  'Manage access': ['M4 7.5h8v6H4z', 'M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2'],
  // A small picture standing on a line of text: an image in a run, where a figure stands alone.
  Image: ['M2 13h12', 'M5 4.5h6v6H5z', 'M5 9.5 7 7.5l1.5 1.5 1-1 1.5 1.5'],
  // A clipboard holding Markdown's own mark, an M and a downward arrow.
  'Paste as Markdown': [
    'M5.4 3H3.2v10.8h9.6V3h-2.2M5.8 1.8h4.4v2.4H5.8z',
    'M4.8 11.4V7.2l1.4 1.8 1.4-1.8v4.2M10.4 7.2v4.2M9 10l1.4 1.4 1.4-1.4',
  ],
};

/**
 * Administration's actions (ADR-0049, the admin handoff's own shapes), drawn on a 24px grid at a
 * heavier stroke, each circle written as two arcs. Delete, Revoke and Withdraw are the one bin.
 */
const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';
/** A circle as a path, so every glyph is paths alone. */
function ring(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0-${2 * r} 0`;
}
/** A table's frame, 17 by 15 with rounded corners. */
const GRID =
  'M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z';
const NOTE = ['M5 4h14v11l-5 5H5z', 'M14 20v-5h5M8.5 9h7M8.5 12.5h4'];
const PERSON = 'M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0';
const ADMIN: Record<string, readonly string[]> = {
  Rename: ['M4 20h4L19 9l-4-4L4 16z', 'm14 6 4 4'],
  Access: [
    'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
    'M10 11a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M12 13v3',
  ],
  Archive: [
    'M4 4h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M5 9v11h14V9M10 13h4',
  ],
  Restore: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  'API tokens': ['M4 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'm11 12 9-9M17 6l3 3M15 8l2 2'],
  Members: [
    PERSON,
    'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2',
  ],
  Delete: [BIN],
  // The Data tab's (ADR-0054): what an item is, and the way to it.
  'A bound value': [
    'M8 4C6 4 6 5.5 6 7s0 3.5-2 5c2 1.5 2 3.5 2 5s0 3 2 3',
    'M16 4c2 0 2 1.5 2 3s0 3.5 2 5c-2 1.5-2 3.5-2 5s0 3-2 3',
    'M12 12h.01',
  ],
  'A bound table': [GRID, 'M3.5 9.5h17M9 4.5v15'],
  'Go to': ['M5 12h14', 'm13 6 6 6-6 6'],
  View: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  Compare: ['m7 4-4 4 4 4', 'M3 8h14', 'm17 12 4 4-4 4', 'M21 16H7'],
  Baseline: ['M5 21V4', 'M5 4h13l-3 4 3 4H5'],
  Publication: ['M4 12 20 4l-4 16-5-6z', 'm11 14 9-10'],
  Download: ['M12 4v11', 'm7 11 5 5 5-5', 'M5 20h14'],
  'Day open': ['m6 9.5 6 6 6-6'],
  Filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  'Go to a date': ['M5 6h14v14H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
  'Activity graph': ['M5 20v-6', 'M10 20V9', 'M15 20v-9', 'M20 20V5'],
  'Collapse every day': ['m7 10 5-5 5 5', 'm7 19 5-5 5 5'],
  'Expand every day': ['m7 5 5 5 5-5', 'm7 14 5 5 5-5'],
  // The Part tab's link field (ADR-0054): one sheet over another.
  'Copy link': [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
    'M5 15H4V4h11v1',
  ],
  // The assistant's turn (issue #871): its answer copied, and asked again.
  Copy: [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
    'M5 15H4V4h11v1',
  ],
  // Duplicate's (the duplicate handoff): the act, its starting points, what it says and loses.
  Duplicate: [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
    'M5 15H4V4h11v1',
  ],
  Branch: [ring(7, 5, 2), ring(7, 19, 2), ring(17, 7, 2), 'M7 7v10', 'M17 9a6 6 0 0 1-6 6H7'],
  Information: [ring(12, 12, 8.5), 'M12 11v5', 'M12 8h.01'],
  Warning: ['M12 4 21 19.5H3z', 'M12 10v4.5', 'M12 17h.01'],
  Fixed: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  Retry: ['M20 12a8 8 0 1 1-2.3-5.6L20 8.5', 'M20 4v4.5h-4.5'],
  Revoke: [BIN],
  Withdraw: [BIN],
  'Invite people': [PERSON, 'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6'],
  // A detail page's (ADR-0050): its strip, its header and its pager.
  Credential: ['M4 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'm11 12 9-9M17 6l3 3M15 8l2 2'],
  'Needs attention': ['M12 4 2.5 20h19z', 'M12 10v4.5M12 17.2v.01'],
  'Used by': ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  Connection: ['M9 3v5M15 3v5', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v4'],
  Checksum: ['M9 4 7 20M17 4l-2 16', 'M4.5 9h16M3.5 15h16'],
  Test: ['M13 3 5 13.5h6L10 21l8-10.5h-6z'],
  'Previous page': ['m14.5 6-6 6 6 6'],
  'Next page': ['m9.5 6 6 6-6 6'],
  // The Bound table band's (ADR-0051), from the handoff's drawings.
  Provenance: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 4v4h4M12 7.5V12l3 2'],
  Change: ['M4 8h13l-3-3M20 16H7l3 3'],
  Resolve: ['M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4'],
  Keep: ['M9 4h6l-1 6 3 3H7l3-3z', 'M12 13v7'],
  Numbered: ['M9 4 7 20M17 4l-2 16M4 9h17M3 15h17'],
  'First column heads its row': [GRID, 'M3.5 9.5h17M3.5 14.5h17M9 4.5v15'],
  'Empty statement': [ring(12, 12, 7.5), 'm6.7 17.3 10.6-10.6'],
  Note: NOTE,
  Notes: NOTE,
  Source: ['M6 4h9l4 4v12H6z', 'M14.5 4v4.5H19M9 13h7M9 16.5h5'],
  Wide: ['M3 12h18M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5'],
  // A table's grid and what is done to it (ADR-0079, the handoff's own shapes).
  'Row above': ['M4 13h16v8H4zM4 17h16', 'M12 2v8M8 6h8'],
  'Row below': ['M4 3h16v8H4zM4 7h16', 'M12 14v8M8 18h8'],
  'Column before': ['M13 4h8v16h-8zM17 4v16', 'M2 12h8M6 8v8'],
  'Column after': ['M3 4h8v16H3zM7 4v16', 'M14 12h8M18 8v8'],
  'Delete row': ['M4 4h16v7H4z', 'M9 15l6 6M15 15l-6 6'],
  'Delete column': ['M4 4h7v16H4z', 'M15 9l6 6M21 9l-6 6'],
  'Merge cells': ['M3 5h18v14H3zM12 5v4M12 15v4', 'M5 12h5M8 10l2 2-2 2M19 12h-5M16 10l-2 2 2 2'],
  'Split cell': ['M3 5h18v14H3zM12 5v14', 'M5 12h4M7 10l-2 2 2 2M19 12h-4M17 10l2 2-2 2'],
  'Go to the table': ['M12 2v4M12 18v4M2 12h4M18 12h4', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  'Wide style': ['M6 3h12v18H6zM9 8h6M9 12h6M9 16h4'],
  'Wide scale': ['M6 3h12v18H6z', 'M9 9 6 6M15 9l3-3M9 15l-3 3M15 15l3 3'],
  'Wide landscape': ['M3 7h18v12H3z', 'M8 3.5a6 6 0 0 1 7.5.5M16 1.5v3h-3'],
  Wrap: ['M4 6h16M4 12h13a3 3 0 0 1 0 6h-4', 'm15 16-2 2 2 2', 'M4 18h5'],
  Format: ['M4 7h10M18 7h2M4 17h4M12 17h8', ring(16, 7, 2), ring(10, 17, 2)],
  'Move up': ['m6 15 6-6 6 6'],
  'Move down': ['m6 9 6 6 6-6'],
  'Align start': ['M4 6h16M4 10h10M4 14h16M4 18h10'],
  'Align centre': ['M4 6h16M7 10h10M4 14h16M7 18h10'],
  'Align end': ['M4 6h16M10 10h10M4 14h16M10 18h10'],
  'Align decimal': [
    'M4 7h6M14 7h6M6 12h4M14 12h3M3 17h7M14 17h6',
    ring(12, 7, 0.9),
    ring(12, 12, 0.9),
    ring(12, 17, 0.9),
  ],
  Columns: [GRID, 'M9.3 4.5v15M14.7 4.5v15'],
  Sort: ['M7 4v16M3.5 7.5 7 4l3.5 3.5M14 7h7M14 12h5M14 17h3'],
  Add: ['M12 5v14M5 12h14'],
  Minus: ['M5 12h14'],
  Confirmed: ['m5 12.5 4.5 4.5L19 7'],
  Override: ['M4 6h16M4 10h10M4 14h6M4 18h5M14.5 20.5 21 14a1.8 1.8 0 0 0-2.5-2.5L12 18l-.5 3z'],
  Edit: ['M4 20h4L19 9l-4-4L4 16z', 'm14 6 4 4'],
  // The document panels' rail (ADR-0074).
  Part: ['M12 3 3 7.5l9 4.5 9-4.5z', 'm3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5'],
  Lists: ['M9 6h11M9 12h11M9 18h11', 'M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
  Assistant: ['M11 4l1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8z', 'M18.5 3v4M16.5 5h4'],
  Versions: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 4v4h4M12 7.5V12l3 2'],
  Publishing: ['m21 3-6.5 18-3.5-7.5L3.5 10z', 'M21 3 11 13.5'],
  Threads: ['M4 5h11v8H9l-5 4z', 'M18 9h2v11l-4-3h-6v-2'],
  Suggestions: ['M4 20h4L19 9l-4-4L4 16z', 'M14 20h6'],
  // The threads panel (the TP plan).
  Search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'm20 20-4.8-4.8'],
  Show: ['M4 5h16l-6 7.5V19l-4-2v-4.5z'],
  Internal: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  // Who holds a part (the EP plan, EP7): the padlock with a tick for yours, a keyhole for another's.
  'Lock yours': ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3', 'm9.3 15.4 2 2 3.4-3.8'],
  'Lock held': ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3', 'M12 14.2v2.8'],
  Mention: [
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M15.5 8.5V13a2.5 2.5 0 0 0 5 0v-1A8.5 8.5 0 1 0 17 19.4',
  ],
  Reply: ['m21 3-6.5 18-3.5-7.5L3.5 10z', 'M21 3 11 13.5'],
  'Resolve thread': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'm8 12.5 3 3 5-6'],
  'Mark all read': ['m3 13 4 4 8-9', 'm10 16 1 1 9-10'],
  'Open thread': ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
  'Go to text': ['M7 17 17 7', 'M9 7h8v8'],
  'Open state': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 12h.01'],
  'Raised by me': ['M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0', 'M5 20a7 7 0 0 1 14 0'],
  Drafted: ['M14.5 6a4 4 0 0 0-5 5L4 16.5 7.5 20l5.5-5.5a4 4 0 0 0 5-5L15.5 12 12 8.5z'],
  // The assistant's composer (the DQ plan): its prompts, a book; asking, an arrow up.
  Prompts: ['M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5a1.5 1.5 0 0 0 0 3H19', 'M9 7h6'],
  Send: ['M12 19V5', 'm5 12 7-7 7 7'],
  'Chevron down': ['m6 9 6 6 6-6'],
  'Chevron up': ['m6 15 6-6 6 6'],
  'Part section': ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  'Part component': ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  'Flows on': ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h10'],
  'New page': ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
  'Right page': ['M3 5h8v14H3z', 'M13 5h8v14h-8z', 'M16 9h2', 'M16 13h2'],
  Layout: ['M4 4h16v16H4z', 'M4 9h16', 'M9 9v11'],
  Fields: ['M5 3h14v18H5z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
  Readers: [
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M3 20a6 6 0 0 1 12 0',
    'M16 5a3 3 0 0 1 0 6',
    'M18 14a6 6 0 0 1 3 6',
  ],
  'Field text': ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  'Field person': ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M5 21a7 7 0 0 1 14 0'],
  'Field date': ['M5 6h14v14H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
  Rounds: [
    'm17 3 3 3-3 3',
    'M4 11v-1a4 4 0 0 1 4-4h12',
    'm7 21-3-3 3-3',
    'M20 13v1a4 4 0 0 1-4 4H4',
  ],
};
/** Three dots, filled. */
const MORE = [
  'M10.4 5a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  'M10.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  'M10.4 19a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
];

/**
 * An icon for an editor command or act, keyed by the command's own label: 16px on the toolbar, and
 * larger where a dialog shows the command that opened it. Always hidden from
 * assistive technology: the button it sits in carries the name. A label with no drawing renders
 * nothing, which the toolbar's test would catch.
 */
/** Drawn filled rather than stroked, on a 10px grid: the outline's section triangle. */
const TRIANGLE = 'M1.5 2.5h7L5 7.5z';

/**
 * The icons that point along the line, mirrored right to left (the UI plan, UI-G; LOC-004): back and on,
 * in and out, a pane's side, a list's marks and a quotation's rule at the start, a collapsed section's
 * triangle. A letter, a clock or a tick reads the same either way.
 */
const MIRRORED = new Set([
  'Column before',
  'Column after',
  'Delete column',
  'Back',
  'Undo',
  'Previous page',
  'Next page',
  'Go to',
  'Go to text',
  'Hide pane',
  'Show pane',
  'Nest item',
  'Lift item',
  'Bulleted list',
  'Definition list',
  'Quotation',
  'Reference',
  'Align start',
  'Align end',
  'Section',
]);

const mirroring = (name: string) => (MIRRORED.has(name) ? { 'data-mirrored': '' } : {});

const CIRCLE = 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0';
const CLOCK = `${CIRCLE}M12 7v5l3 2`;
const WARNING = 'M12 3l9.5 17h-19zM12 10v4M12 17h.01';
const DASH = 'M5 12h14';
const PENCIL = 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z';
const CROSS_CIRCLE = `${CIRCLE}M15 9l-6 6M9 9l6 6`;
const TICK = 'M5 13l4 4L19 7';

/** Each lozenge's icon, on a 24px grid (docs/interface/lifecycle-states.md); `state:` and its kind. */
const STATES: Record<string, string> = {
  draft: CIRCLE,
  beingEdited: PENCIL,
  returned: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  inReview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  inApproval: CLOCK,
  approved: `${CIRCLE}M8 12l3 3 5-6`,
  effective: `${CIRCLE}M12 7.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z`,
  published: 'M22 2l-7 20-4-9-9-4zM22 2 11 13',
  changedSince: WARNING,
  notApproved: `${CIRCLE}M8 12h8`,
  pastReview: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  onHold: 'M8 5v14M16 5v14',
  released: 'M4 11h16v10H4zM8 11V7a4 4 0 0 1 7.5-2',
  superseded: 'M5 12h14M13 6l6 6-6 6',
  current: `${CIRCLE}M12 12h.01`,
  archived: 'M3 4h18v5H3zM5 9v11h14V9M10 13h4',
  retired: 'M12 3v9M6.5 7a8 8 0 1 0 11 0',
  neverPublished: DASH,
  notYoursToRead: 'M4 11h16v10H4zM8 11V7a4 4 0 0 1 8 0v4',
  diverged:
    'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9',
  pending: 'M7 3h10M7 21h10M8 3v3l4 6 4-6V3M8 21v-3l4-6 4 6v3',
  accepted: TICK,
  rejected: 'M6 6l12 12M18 6 6 18',
  withdrawn: CROSS_CIRCLE,
  resolved: 'M4 4h16v16H4zM8 12l3 3 5-6',
  notStarted: CIRCLE,
  inProgress: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  complete: TICK,
  closed: 'M4 4h16v16H4zM9 12h6',
  untranslated: DASH,
  machineDrafted: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  inTranslation: CLOCK,
  translated: `${CIRCLE}M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18`,
  outOfDate: WARNING,
  neverResolved: DASH,
  changedSinceResolved: WARNING,
  failed: CROSS_CIRCLE,
  revisionWaiting: CLOCK,
  definitionChanged: WARNING,
  revisedByHand: PENCIL,
  changedSincePublished: WARNING,
  holding: TICK,
  retracted: CROSS_CIRCLE,
  corrected: PENCIL,
  state: 'M5 5h14v14H5z',
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  if (name.startsWith('state:')) {
    const kind = name.slice('state:'.length);
    return (
      <svg
        className={styles['path']}
        data-icon={name}
        {...(kind === 'superseded' || kind === 'returned' ? { 'data-mirrored': '' } : {})}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={size > 11 ? 2.4 : 2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(kind === 'draft' ? { strokeDasharray: '3 3.2' } : {})}
      >
        <path d={STATES[kind]} />
      </svg>
    );
  }
  const letter = LETTERS[name];
  if (letter !== undefined) {
    return (
      <span className={styles['letter']} data-icon={name} data-letter={name} aria-hidden="true">
        {letter}
      </span>
    );
  }
  if (name === 'Section') {
    return (
      <svg
        className={styles['path']}
        data-icon={name}
        {...mirroring(name)}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        fill="currentColor"
      >
        <path d={TRIANGLE} />
      </svg>
    );
  }
  if (name === 'More actions' || ADMIN[name] !== undefined) {
    const more = name === 'More actions';
    return (
      <svg
        className={styles['path']}
        data-icon={name}
        {...mirroring(name)}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={more ? 'currentColor' : 'none'}
        {...(more
          ? {}
          : {
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            })}
      >
        {(more ? MORE : ADMIN[name]!).map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  const paths = PATHS[name];
  if (paths === undefined) return null;
  return (
    <svg
      className={styles['path']}
      data-icon={name}
      {...mirroring(name)}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      // Heavier for the two single strokes; lighter where it is drawn larger than the toolbar's 16px.
      strokeWidth={
        name === 'Done editing' || name === 'Close'
          ? 1.6
          : name === 'Document' || size > 16
            ? 1.4
            : 1.5
      }
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
