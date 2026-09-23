import styles from './Icon.module.css';

/** Letterforms: the marks a type designer would draw as type rather than as a picture. */
const LETTERS: Record<string, string> = {
  Strong: 'B',
  Emphasis: 'I',
  Underline: 'U',
  Subscript: 'x\u2082',
  Superscript: 'x\u00b2',
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
  'Save version': ['M3 2.6h7.2L13.4 5.8V13.4H3z', 'M5.6 2.6v3.6h4.8'],
  'Done editing': ['M3.2 8.4 6.3 11.5 12.8 5'],
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
