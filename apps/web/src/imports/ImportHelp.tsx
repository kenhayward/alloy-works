import styles from './Import.module.css';
import { words } from '../words/words.js';

/** The address of Help's page on what an import keeps (IMP-026). */
export const IMPORT_HELP = '#/help/import';

/**
 * What an import keeps, by format, for the import page's header (IMP-026, IMP-025): a short
 * statement, never a promise that a round trip gives the same file back.
 */
export function keptBy(type: 'docx' | 'markdown' | 'html' | null): string {
  return type === 'docx'
    ? words('imports.an-import-keeps-a-word')
    : words('imports.an-import-keeps-this-file');
}

/**
 * **Help: what an import keeps** (IMP-026): the Word structures that arrive, and those that do not,
 * as the reader reads them (docs/design/import.md).
 */
export function ImportHelp() {
  return (
    <section aria-labelledby="import-help-heading" className={styles['page']}>
      <h1 id="import-help-heading">{words('imports.what-an-import-keeps')}</h1>
      <p>{words('imports.an-import-reads-a-file')}</p>
      <h2 id="import-help-arrives">{words('imports.what-arrives-from-word')}</h2>
      <ul aria-labelledby="import-help-arrives">
        <li>{words('imports.headings-as-sections-and-components')}</li>
        <li>{words('imports.lists-with-their-numbering-carried')}</li>
        <li>{words('imports.tables')}</li>
        <li>{words('imports.footnotes')}</li>
        <li>{words('imports.captions-on-their-table-or')}</li>
        <li>{words('imports.figures-png-and-jpeg-images')}</li>
        <li>{words('imports.cross-references-to-what-they')}</li>
        <li>{words('imports.tracked-changes-as-suggestions-attributed')}</li>
        <li>{words('imports.comments-as-threads-with-their')}</li>
      </ul>
      <h2 id="import-help-not">{words('imports.what-does-not-arrive')}</h2>
      <ul aria-labelledby="import-help-not">
        <li>{words('imports.text-boxes-which-are-left')}</li>
        <li>{words('imports.content-controls-which-are-kept')}</li>
        <li>{words('imports.equations-as-yet-their-text')}</li>
        <li>{words('imports.endnotes')}</li>
        <li>{words('imports.page-setup-margins-columns-headers')}</li>
        <li>{words('imports.macros-and-embedded-objects-which')}</li>
        <li>{words('imports.file-properties-such-as-its')}</li>
      </ul>
      <h2>{words('imports.markdown-and-html')}</h2>
      <p>{words('imports.their-headings-lists-tables-quotations')}</p>
      <p>{words('imports.what-an-import-leaves-out')}</p>
    </section>
  );
}
