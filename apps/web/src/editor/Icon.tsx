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
  'Save version': ['M3 2.6h7.2L13.4 5.8V13.4H3z', 'M5.6 2.6v3.6h4.8'],
  'Done editing': ['M3.2 8.4 6.3 11.5 12.8 5'],
  Close: ['M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8'],
};

/**
 * An icon for an editor command or act, keyed by the command's own label: 16px on the toolbar, and
 * larger where a dialog shows the command that opened it. Always hidden from
 * assistive technology: the button it sits in carries the name. A label with no drawing renders
 * nothing, which the toolbar's test would catch.
 */
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const letter = LETTERS[name];
  if (letter !== undefined) {
    return (
      <span className={styles['letter']} data-icon={name} data-letter={name} aria-hidden="true">
        {letter}
      </span>
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
      strokeWidth={name === 'Done editing' || name === 'Close' ? 1.6 : size > 16 ? 1.4 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
