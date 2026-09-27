import { PINNED_FONT_FILES } from '@alloy-works/fonts';
import monoBold from '@alloy-works/fonts/files/LiberationMono-Bold.ttf?url';
import monoBoldItalic from '@alloy-works/fonts/files/LiberationMono-BoldItalic.ttf?url';
import monoItalic from '@alloy-works/fonts/files/LiberationMono-Italic.ttf?url';
import monoRegular from '@alloy-works/fonts/files/LiberationMono-Regular.ttf?url';
import serifBold from '@alloy-works/fonts/files/LiberationSerif-Bold.ttf?url';
import serifBoldItalic from '@alloy-works/fonts/files/LiberationSerif-BoldItalic.ttf?url';
import serifItalic from '@alloy-works/fonts/files/LiberationSerif-Italic.ttf?url';
import serifRegular from '@alloy-works/fonts/files/LiberationSerif-Regular.ttf?url';
import maths from '@alloy-works/fonts/files/STIXTwoMath-Regular.otf?url';

/**
 * The pinned faces as the renderer bundles them (themes.md, "The theme in the editor", ET-C): the same
 * files the worker hands Typst, from `@alloy-works/fonts`, emitted beside the renderer so a browser tab
 * and the Electron window, which loads the same renderer over `file://`, fetch them from nowhere else.
 * By file name here, and by hash below, which is how a theme names each.
 */
const BUNDLED: Readonly<Record<(typeof PINNED_FONT_FILES)[number]['file'], string>> = {
  'LiberationSerif-Bold.ttf': serifBold,
  'LiberationSerif-BoldItalic.ttf': serifBoldItalic,
  'LiberationSerif-Italic.ttf': serifItalic,
  'LiberationSerif-Regular.ttf': serifRegular,
  'LiberationMono-Bold.ttf': monoBold,
  'LiberationMono-BoldItalic.ttf': monoBoldItalic,
  'LiberationMono-Italic.ttf': monoItalic,
  'LiberationMono-Regular.ttf': monoRegular,
  'STIXTwoMath-Regular.otf': maths,
};

const BY_HASH: ReadonlyMap<string, string> = new Map(
  PINNED_FONT_FILES.map((each) => [each.sha256, BUNDLED[each.file]]),
);

/** Where the renderer holds the file a theme names by this hash; undefined for one it does not hold. */
export const faceUrl = (sha256: string): string | undefined => BY_HASH.get(sha256);
