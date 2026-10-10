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
  // A value standing in a line of text, drawn from a cylinder: a value bound to a source (B2).
  Value: [
    'M2 13h12',
    'M5 4.2c0-.9 1.3-1.4 3-1.4s3 .5 3 1.4v5.6c0 .9-1.3 1.4-3 1.4s-3-.5-3-1.4z',
    'M5 4.2c0 .9 1.3 1.4 3 1.4s3-.5 3-1.4',
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
  'Hide pane': ['M9.5 4 5.5 8l4 4'],
  'Show pane': ['M6.5 4l4 4-4 4'],
  'Add section': ['M2.5 3.6h11M2.5 7.2h6.5M2.5 10.8h4', 'M12 9.2v5.2M9.4 11.8h5.2'],
  'Add component': ['M3 2.4h5.6L11.4 5.2v4.4H3z', 'M12 9.6v4.8M9.6 12h4.8'],
  Undo: ['M3 5.4h6.2a3.4 3.4 0 0 1 0 6.8H5.4', 'M5.4 2.8 2.6 5.4l2.8 2.6'],
  Folder: ['M2.4 4.2h4l1.2 1.6h6V12H2.4z'],
  Document: ['M3.4 2.6h5.4l3 3v7.8H3.4z', 'M8.6 2.6v3.2h3'],
  Move: ['M8 3v10M5.2 10.2 8 13l2.8-2.8'],
  // A picture in a frame: a hill and the sun, as every image button draws one.
  Figure: ['M2.5 3h11v10h-11z', 'M2.5 11.5 6 8l3 3 2-2 2.5 2.5', 'M10.5 5.8h.01'],
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
  // The Part tab's link field (ADR-0054): one sheet over another.
  'Copy link': [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
    'M5 15H4V4h11v1',
  ],
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
  Confirmed: ['m5 12.5 4.5 4.5L19 7'],
  Edit: ['M4 20h4L19 9l-4-4L4 16z', 'm14 6 4 4'],
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

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
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
