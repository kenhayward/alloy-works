export { admit } from './admit.js';
export type {
  AdmissionInput,
  AdmissionOutcome,
  AdmissionRefusal,
  AdmissionRefused,
} from './admit.js';

export { readProductClipboard, writeProductClipboard } from './clipboard.js';
export type { ReaderResult } from './clipboard.js';

export { admissionLimits } from './limits.js';

export { equationAlternative } from './mathml.js';
export { admitTemmlMathml } from './temml.js';
export type { TemmlAdmission, TemmlRefusal } from './temml.js';

export type { Receiver } from './reidentify.js';

export { createReport, readerEntry } from './report.js';
export type { AdmissionStage, ReportAction, ReportCollector, ReportEntry } from './report.js';
