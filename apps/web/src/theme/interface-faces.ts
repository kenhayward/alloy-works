import { INTERFACE_FONT_FILES } from '@alloy-works/fonts';
import monoMedium from '@alloy-works/fonts/interface/IBMPlexMono-Medium.woff2?url';
import monoRegular from '@alloy-works/fonts/interface/IBMPlexMono-Regular.woff2?url';
import sansItalic from '@alloy-works/fonts/interface/IBMPlexSans-Italic.woff2?url';
import sansMedium from '@alloy-works/fonts/interface/IBMPlexSans-Medium.woff2?url';
import sansRegular from '@alloy-works/fonts/interface/IBMPlexSans-Regular.woff2?url';
import sansSemiBold from '@alloy-works/fonts/interface/IBMPlexSans-SemiBold.woff2?url';

/**
 * The interface's faces as the renderer bundles them (ADR-0046, decision 5): emitted beside the
 * renderer, as the publishing faces are (`faces.ts`), so neither a tab nor the desktop window ever
 * fetches a face from the network. The chrome's only: `--sans` and `--mono` name them, and a
 * component's text is set in its theme's faces (CNT-097).
 */
const BUNDLED: Readonly<Record<(typeof INTERFACE_FONT_FILES)[number]['file'], string>> = {
  'IBMPlexSans-Regular.woff2': sansRegular,
  'IBMPlexSans-Italic.woff2': sansItalic,
  'IBMPlexSans-Medium.woff2': sansMedium,
  'IBMPlexSans-SemiBold.woff2': sansSemiBold,
  'IBMPlexMono-Regular.woff2': monoRegular,
  'IBMPlexMono-Medium.woff2': monoMedium,
};

/** One `@font-face` for each face; text shows in the fallback until its face has loaded. */
export const INTERFACE_FACES_CSS = INTERFACE_FONT_FILES.map(
  (face) =>
    `@font-face { font-family: '${face.family}'; src: url('${BUNDLED[face.file]}') format('woff2'); ` +
    `font-weight: ${face.weight}; font-style: ${face.style}; font-display: swap; }`,
).join('\n');

const MARK = 'data-interface-faces';

/** Adds the faces to the page's head, once. */
export function installInterfaceFaces(document: Document = window.document): void {
  if (document.head.querySelector(`style[${MARK}]`) !== null) return;
  const style = document.createElement('style');
  style.setAttribute(MARK, '');
  style.textContent = INTERFACE_FACES_CSS;
  document.head.append(style);
}
