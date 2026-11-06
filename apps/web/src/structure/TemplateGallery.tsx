import { useEffect, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './NewDocument.module.css';
import { galleryGroups, offerKey, toneOf, type TemplateOffer } from './galleryOffers.js';
import { words } from '../words/words.js';

const NARROW = '(max-width: 759px)';

/** Whether the window is narrower than the two panes fit: the gallery becomes a select. */
export function useNarrow(): boolean {
  const query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW)
      : null;
  const [narrow, setNarrow] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return undefined;
    const changed = () => setNarrow(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return narrow;
}

/** What an option says under its name. */
function meta(offer: TemplateOffer): string {
  return offer.sections > 0
    ? words('document.template-sections-and-values', {
        sections: offer.sections,
        values: offer.values,
      })
    : words('document.components-to-start', { components: offer.copied + offer.referenced });
}

/**
 * New document's gallery (the ND plan, ND-I): Find a template, then a listbox of the templates by
 * space, the Where space first. The arrows move the choice, Home and End go to the ends, and typing
 * goes to Find. In a narrow window, a select of the same, grouped.
 */
export function TemplateGallery({
  id,
  offers,
  where,
  spaceOrder,
  chosen,
  onChoose,
  narrow,
}: {
  id: string;
  offers: readonly TemplateOffer[];
  where: string;
  spaceOrder: readonly string[];
  chosen: string | null;
  onChoose: (key: string) => void;
  narrow: boolean;
}) {
  const [find, setFind] = useState('');
  const finder = useRef<HTMLInputElement>(null);
  const groups = galleryGroups(offers, where, spaceOrder, narrow ? '' : find);
  const flat = groups.flatMap((group) => group.offers);
  const optionId = (key: string) => `${id}-option-${key}`;

  // The chosen option kept in sight as the keys move it.
  useEffect(() => {
    if (chosen === null) return;
    document.getElementById(optionId(chosen))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  if (narrow) {
    return (
      <label className={styles['narrowChoice']}>
        {words('document.template')}
        <select value={chosen ?? ''} onChange={(event) => onChoose(event.target.value)}>
          {groups.map((group) => (
            <optgroup key={group.space.id} label={group.space.name}>
              {group.offers.map((offer) => (
                <option key={offerKey(offer)} value={offerKey(offer)}>
                  {offer.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const at = flat.findIndex((offer) => offerKey(offer) === chosen);
    const go = (index: number) => {
      const offer = flat[Math.max(0, Math.min(flat.length - 1, index))];
      if (offer) onChoose(offerKey(offer));
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(flat.length - 1);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing goes to Find, the key with it.
      setFind((was) => was + event.key);
      finder.current?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <div className={styles['gallery']}>
      <label className={styles['find']}>
        <Icon name="Search" size={16} />
        <input
          ref={finder}
          type="search"
          aria-label={words('document.find-a-template')}
          placeholder={words('document.find-a-template')}
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
      </label>
      <div
        role="listbox"
        aria-label={words('document.template')}
        tabIndex={0}
        className={styles['list']}
        aria-activedescendant={
          chosen !== null && flat.some((offer) => offerKey(offer) === chosen)
            ? optionId(chosen)
            : undefined
        }
        onKeyDown={onKeyDown}
      >
        {groups.map((group) => (
          <div key={group.space.id} role="group" aria-label={group.space.name}>
            <div className={styles['group']} aria-hidden="true">
              {group.space.name}
            </div>
            {group.offers.map((offer) => {
              const key = offerKey(offer);
              return (
                <div
                  key={key}
                  id={optionId(key)}
                  role="option"
                  aria-selected={key === chosen}
                  aria-labelledby={`${optionId(key)}-name`}
                  aria-describedby={`${optionId(key)}-meta`}
                  className={styles['option']}
                  onClick={() => onChoose(key)}
                >
                  <span
                    className={styles['glyph']}
                    data-tone={offer.id === null ? 'blank' : toneOf(offer.space.id)}
                  >
                    <Icon name="Document" size={20} />
                  </span>
                  <span className={styles['optionText']}>
                    <span id={`${optionId(key)}-name`}>{offer.name}</span>
                    <span id={`${optionId(key)}-meta`} className={styles['meta']}>
                      {meta(offer)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {flat.length === 0 && find.trim() !== '' && (
        <p className={styles['said']}>{words('document.no-template-is-called-that')}</p>
      )}
    </div>
  );
}
