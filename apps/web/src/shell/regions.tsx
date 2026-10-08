import { useEffect } from 'react';

/** What a region's landing may be: anything a Tab would reach. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where F6 lands in a region: what the region names as its entry (the component editor's header,
 * whose own ring then goes on), else the item the rail marks current, else the first thing a Tab
 * would reach, else the region itself.
 */
function land(region: HTMLElement): void {
  const target =
    region.querySelector<HTMLElement>('[data-region-entry]') ??
    region.querySelector<HTMLElement>('[aria-current="page"]') ??
    region.querySelector<HTMLElement>(FOCUSABLE) ??
    region;
  if (target === region && region.tabIndex < 0) region.tabIndex = -1;
  target.focus();
}

/**
 * F6 and Shift-F6 between the application's regions - the header band, the module rail, the page -
 * marked `data-app-region`, wrapping (ADR-0046; the LG plan, LG6b). A page with a ring of its own,
 * such as the component editor's, takes the key first, and leaves it here only past either end.
 */
export function RegionKeys(): null {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F6' || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const regions = [...document.querySelectorAll<HTMLElement>('[data-app-region]')].filter(
        (region) => region.closest('[hidden]') === null,
      );
      if (regions.length === 0) return;
      event.preventDefault();
      const at = regions.findIndex((region) => region.contains(document.activeElement));
      const back = event.shiftKey;
      const next =
        at < 0
          ? back
            ? regions.length - 1
            : 0
          : (at + (back ? -1 : 1) + regions.length) % regions.length;
      land(regions[next]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
