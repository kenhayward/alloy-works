import styles from './Administration.module.css';

/**
 * Administration's About and release notes (the AD plan, AD7): this version, how it is being run, the
 * notices a third party's terms ask for, and what changed in it - the changelog's newest entry, which
 * the build reads (`__RELEASE_NOTES__`).
 */
export function About({ about }: { about: React.ReactNode }) {
  const notes = __RELEASE_NOTES__;
  return (
    <>
      <p>{`Version ${__APP_VERSION__}`}</p>
      {about}
      {/* CPAL's attribution, here alone and never where citations are used (ADR-0067). */}
      <section aria-labelledby="third-party-notices">
        <h2 id="third-party-notices">Third-party notices</h2>
        <p>
          Citations are formatted by citeproc-js, Copyright (c) 2009-2019 Frank Bennett, under the
          Common Public Attribution License 1.0.
        </p>
      </section>
      {notes !== null && (
        <section aria-labelledby="release-notes" className={styles['notes']}>
          <h2 id="release-notes">{`What changed in ${notes.version}`}</h2>
          <p className={styles['muted']}>
            {new Date(`${notes.date}T12:00:00Z`).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
          {notes.sections.map((section) => (
            <section key={section.heading} aria-label={`${section.heading} in ${notes.version}`}>
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
