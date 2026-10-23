import styles from './Import.module.css';

/** The address of Help's page on what an import keeps (IMP-026). */
export const IMPORT_HELP = '#/help/import';

/**
 * What an import keeps, by format, for the import page's header (IMP-026, IMP-025): a short
 * statement, never a promise that a round trip gives the same file back.
 */
export function keptBy(type: 'docx' | 'markdown' | 'html' | null): string {
  return type === 'docx'
    ? 'An import keeps a Word document’s structure: its headings, lists, tables, footnotes, captions, figures, cross-references, tracked changes and comments. It does not keep its appearance, which a theme sets here, or its blank lines, which are layout, so exporting it again does not give back the same file.'
    : 'An import keeps this file’s structure: its headings, lists, tables, quotations, links and emphasis. It does not keep its appearance or its styles, and keeps an image only where the file holds it: one at an address is never fetched.';
}

/**
 * **Help: what an import keeps** (IMP-026): the Word structures that arrive, and those that do not,
 * as the reader reads them (docs/design/import.md).
 */
export function ImportHelp() {
  return (
    <section aria-labelledby="import-help-heading" className={styles['page']}>
      <h1 id="import-help-heading">What an import keeps</h1>
      <p>
        An import reads a file’s structure into sections and components. Its appearance comes from
        this product’s theme instead, and blank lines are layout, so a document exported to Word
        again is never the same file as the one imported.
      </p>
      <h2 id="import-help-arrives">What arrives from Word</h2>
      <ul aria-labelledby="import-help-arrives">
        <li>Headings, as sections and components, and deeper ones inside them</li>
        <li>Lists, with their numbering carried on or restarted</li>
        <li>Tables</li>
        <li>Footnotes</li>
        <li>Captions, on their table or figure</li>
        <li>Figures, PNG and JPEG images with their alternative text</li>
        <li>Cross-references, to what they point at</li>
        <li>Tracked changes, as suggestions attributed to their Word author</li>
        <li>Comments, as threads with their replies</li>
      </ul>
      <h2 id="import-help-not">What does not arrive</h2>
      <ul aria-labelledby="import-help-not">
        <li>Text boxes, which are left out and said</li>
        <li>Content controls, which are kept as their text</li>
        <li>Equations, as yet: their text is shown beside the part they stood in</li>
        <li>Endnotes</li>
        <li>Page setup: margins, columns, headers and footers</li>
        <li>Macros and embedded objects, which are never stored</li>
        <li>
          File properties, such as its author, which are discarded unless the Imports policy keeps
          them
        </li>
      </ul>
      <h2>Markdown and HTML</h2>
      <p>
        Their headings, lists, tables, quotations, links and emphasis arrive as Word’s do. An image
        arrives only where the file holds it; one at an address is never fetched, and is said to be
        left out.
      </p>
      <p>What an import leaves out or keeps differently is always listed in its report.</p>
    </section>
  );
}
