// Receiving CT Studio's decomposed documents (docs/design/ct-studio-sink.md): the mapping of their
// blocks and inlines to the content model, and the identifiers it derives.
export { componentIdFor, elementIdFor } from './ids.js';
export { noteMarkers } from './markers.js';
export { CARRY_CODES, carry } from './report.js';
export type { CarryCode, CarryEntry } from './report.js';
export { mapBlocks, mapTitle } from './blocks.js';
export type { BlockContext, CrossTarget, DecomposedBlock, DecomposedNote } from './blocks.js';
export { mapDocument } from './document.js';
export type { MappedComponent, MappedDocument } from './document.js';
export { mapProperties } from './properties.js';
export type { DecomposedProperty } from './properties.js';
export { planTables } from './tables.js';
export type { ColumnType, PackageData, TablePlan, TablePlanRefusal } from './tables.js';
export { readBack } from './readback.js';
export type { ReadBack, WrittenDocument } from './readback.js';
