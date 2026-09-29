/**
 * **The conformance kit** (the W15 plan's W15-C): what the editor and Word are both measured against
 * the PDF with, so that half a point means the same on both sides - W13.4's fixture and themes, the PDF
 * reader, the PDF's half of the measurement, the comparison and STY-060's lists of approved
 * deviations. Test-only: `tests/browser` imports it, and the worker's suite will.
 */
export * from './compare.js';
export * from './measure.js';
export * from './pdf.js';
export * from './styled.js';
export * from './themes.js';
