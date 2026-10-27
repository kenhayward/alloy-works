import { FONT_LICENCES } from '@alloy-works/fonts';
import liberation from '@alloy-works/fonts/files/LICENSE-Liberation.txt?raw';
import naskh from '@alloy-works/fonts/files/LICENSE-NotoNaskhArabic.txt?raw';
import stix from '@alloy-works/fonts/files/LICENSE-STIX.txt?raw';
import plex from '@alloy-works/fonts/interface/LICENSE-Plex.txt?raw';

import styles from './Administration.module.css';
import { formats, words, wordsWith } from '../words/words.js';

/** Each licence file's text, which the OFL asks to travel with its faces, by its path in the package. */
const LICENCE_TEXTS: Readonly<Record<(typeof FONT_LICENCES)[number]['file'], string>> = {
  'interface/LICENSE-Plex.txt': plex,
  'files/LICENSE-Liberation.txt': liberation,
  'files/LICENSE-STIX.txt': stix,
  'files/LICENSE-NotoNaskhArabic.txt': naskh,
};

/**
 * Administration's About and release notes (the AD plan, AD7): this version, how it is being run, the
 * notices a third party's terms ask for, every typeface's licence among them (the UI plan, UF-H), and
 * what changed in it - the changelog's newest entry, which
 * the build reads (`__RELEASE_NOTES__`). The notes are the changelog's English, shown as content.
 */
export function About({ about }: { about: React.ReactNode }) {
  const notes = __RELEASE_NOTES__;
  return (
    <>
      <p>{words('admin.version', { version: __APP_VERSION__ })}</p>
      {about}
      {/* CPAL's attribution, here alone and never where citations are used (ADR-0067). */}
      <section aria-labelledby="third-party-notices">
        <h2 id="third-party-notices">{words('admin.third-party-notices')}</h2>
        <p>{words('admin.citations-are-formatted-by-citeproc')}</p>
        <p>
          {wordsWith(
            'admin.citation-styles-and-locales-from',
            {},
            {
              project: (
                <a href="https://citationstyles.org" target="_blank" rel="noreferrer">
                  {words('admin.citation-style-language-project')}
                </a>
              ),
            },
          )}
        </p>
        {FONT_LICENCES.map(({ file, families }) => (
          <div key={file}>
            <p>
              {words('admin.typefaces-under-the-ofl', {
                families: formats().list([...families], { type: 'conjunction' }),
              })}
            </p>
            <details>
              <summary>{words('admin.licence-text')}</summary>
              <pre data-content className={styles['licence']}>
                {LICENCE_TEXTS[file]}
              </pre>
            </details>
          </div>
        ))}
      </section>
      {notes !== null && (
        <section aria-labelledby="release-notes" className={styles['notes']}>
          <h2 id="release-notes">{words('admin.what-changed-in', { version: notes.version })}</h2>
          <p className={styles['muted']}>
            {formats().date(new Date(`${notes.date}T12:00:00Z`), {
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
              <h3 data-content>{section.heading}</h3>
              <ul data-content>
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
