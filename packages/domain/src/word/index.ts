/**
 * The Word writer (docs/design/word-output.md; Word 1, ruling R6): a publication as a `.docx`, from
 * what `assemble` answers for Word, and the version a Word output records it was made by.
 */
export { writeDocx, WORD_WRITER_VERSION } from './write.js';
export type { WordWriting, WrittenDocx } from './write.js';
