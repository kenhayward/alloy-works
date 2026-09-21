export { markSchema, markTypes, allowedLinkSchemes } from './marks.js';
export type { Mark, MarkType } from './marks.js';

export { inlineNodeSchema, alternativeSchema } from './inline.js';
export type { InlineNode, Alternative } from './inline.js';

export { blockNodeSchema } from './blocks.js';
export type { BlockNode } from './blocks.js';

export { contentDocumentSchema, parseContentDocument, CURRENT_SCHEMA_VERSION } from './document.js';
export type { ContentDocument } from './document.js';

export { blockIdentifierFrom } from './identifier.js';

export { hasText } from './text.js';

export { forbiddenInPreformatted, isLanguageLabel, LANGUAGE_LABEL } from './preformatted.js';

export { canonicalise } from './canonical.js';
export { migrate, readContent } from './migrate.js';
export type { ReadOutcome } from './migrate.js';

export { outputMapping } from './mapping.js';
export type { OutputMapping } from './mapping.js';
