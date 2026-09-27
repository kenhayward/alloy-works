import { styledSize, type Place, type ResolvedTheme } from '@alloy-works/domain';
import { useEffect, type RefObject } from 'react';
import { usePixels, usePresentation, type Pixels } from './presentation.js';

/**
 * The size, in points, of the text an image in a line stands in: its paragraph's style, a stored
 * `body` by the place the paragraph stands in (TH-E), as the canvas's rules set that paragraph.
 */
function textSize(theme: ResolvedTheme, image: Element): number {
  const paragraph = image.closest('p[data-style]');
  const stored = paragraph?.getAttribute('data-style') ?? 'body';
  const place = (
    paragraph?.classList.contains('aw-footnote-paragraph')
      ? 'footnote'
      : (paragraph?.getAttribute('data-place') ?? 'text')
  ) as Place;
  const id = stored === 'body' ? theme.places[place] : stored;
  const style = theme.paragraphStyles.get(id) ?? theme.paragraphStyles.get(theme.places.text);
  return style?.properties.size ?? 0;
}

/**
 * Sets each image under `root` at the size its image style resolves to (CNT-122): `styledSize`, the
 * rule `assemble` sizes a publication's images by, from the asset version's own pixels and the layout's
 * frame, in points times the canvas's zoom. A figure and an image in a line alike, whether the root is
 * the editing surface or a document's read text. An image whose style the theme does not hold is left
 * as it is drawn. Each image is sized once for what it was sized from, so redrawing costs nothing.
 */
export function sizeImages(
  root: ParentNode,
  theme: ResolvedTheme,
  frame: { readonly measure: number; readonly textHeight: number },
  pixelsOf: (asset: string) => Promise<Pixels | null>,
): void {
  for (const image of root.querySelectorAll<HTMLImageElement>(
    'img[data-asset], figure[data-image-style] img',
  )) {
    const holder = image.closest('[data-image-style]');
    const asset = image.getAttribute('data-asset') ?? holder?.getAttribute('data-asset');
    const styleId = holder?.getAttribute('data-image-style');
    const style = styleId ? theme.imageStyles.get(styleId) : undefined;
    if (!asset || !style) continue;
    const size = style.placement === 'inline' ? textSize(theme, image) : 0;
    const key = `${asset} ${style.id} ${size} ${frame.measure} ${frame.textHeight}`;
    if (image.getAttribute('data-sized') === key) continue;
    void pixelsOf(asset).then((pixels) => {
      if (!pixels || pixels.width <= 0 || pixels.height <= 0) return;
      const { width } = styledSize(style, pixels, { ...frame, size });
      image.style.width = `calc(${Number(width.toFixed(3))}pt * var(--aw-zoom))`;
      image.style.height = 'auto';
      image.setAttribute('data-sized', key);
    });
  }
}

/**
 * Keeps the images under `ref` at their styled size while the presentation holds, sizing again when the
 * view draws an image, changes its style or moves it to another paragraph.
 */
export function useStyledImages(ref: RefObject<HTMLElement | null>): void {
  const presentation = usePresentation();
  const pixelsOf = usePixels();
  useEffect(() => {
    const root = ref.current;
    if (!root || presentation?.state !== 'ready' || !pixelsOf) return undefined;
    const size = () => sizeImages(root, presentation.theme, presentation.frame, pixelsOf);
    size();
    const observer = new MutationObserver(size);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-image-style', 'data-style', 'data-place'],
    });
    return () => observer.disconnect();
  }, [ref, presentation, pixelsOf]);
}
