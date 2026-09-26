/**
 * The Word writer (docs/design/word-output.md; Word 1, ruling R6): a publication as a `.docx`, from
 * what `assemble` answers for Word, and the version a Word output records it was made by.
 */
export { writeDocx, WORD_WRITER_VERSION } from './write.js';
export type { WordWriting, WrittenDocx } from './write.js';
// The maths tree as OMML (Word 4, ruling R3): exported for the worker's check of it in Word's schema.
export { omml } from './omml.js';
export type { OmmlOptions } from './omml.js';
