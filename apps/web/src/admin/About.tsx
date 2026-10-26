import styles from './Administration.module.css';
import { words } from '../words/words.js';

/**
 * Administration's About and release notes (the AD plan, AD7): this version, how it is being run, the
 * notices a third party's terms ask for, and what changed in it - the changelog's newest entry, which
 * the build reads (`__RELEASE_NOTES__`).
 */
export function About({ about }: { about: React.ReactNode }) {
  const notes = __RELEASE_NOTES__;
  return (
    <>
      <p>{words('admin.version', { __APP_VERSION__ })}</p>
      {about}
      {/* CPAL's attribution, here alone and never where citations are used (ADR-0067). */}
      <section aria-labelledby="third-party-notices">
        <h2 id="third-party-notices">{words('admin.third-party-notices')}</h2>
        <p>{words('admin.citations-are-formatted-by-citeproc')}</p>
        <p>
          {words('admin.citation-styles-and-locales-from')}{' '}
          <a href="https://citationstyles.org" target="_blank" rel="noreferrer">
            {words('admin.citation-style-language-project')}
          </a>
          {words('admin.under-the-creative-commons-attribution')}
        </p>
      </section>
      {notes !== null && (
        <section aria-labelledby="release-notes" className={styles['notes']}>
          <h2 id="release-notes">{words('admin.what-changed-in', { version: notes.version })}</h2>
          <p className={styles['muted']}>
            {new Date(`${notes.date}T12:00:00Z`).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
          {notes.sections.map((section) => (
            <section
              key={section.heading}
              aria-label={words('admin.in', { heading: section.heading, version: notes.version })}
            >
              <h3>{section.heading}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={`${item.title}${item.text}`}>
                    {item.title !== '' && <strong>{item.title}</strong>} {item.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </>
  );
}
