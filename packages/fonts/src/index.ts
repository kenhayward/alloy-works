/**
 * The faces the product sets text in, pinned by hash (themes.md, TH-B and "The theme in the editor",
 * ET-C): the files, in `files/`, which the worker hands Typst and the renderer bundles for the editor;
 * the list of them; and what each family covers. Platform-free, so the renderer can import it; what
 * reads the files is `@alloy-works/fonts/node`.
 */
export { COVERAGE } from './coverage.js';
export { capHeightOfFile, covers, familyOfFile } from './covers.js';
export type { Ranges } from './covers.js';
export { PINNED_FONT_FILES } from './pinned.js';
