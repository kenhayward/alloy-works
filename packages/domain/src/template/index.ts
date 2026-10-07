export {
  TEMPLATE_SCHEMA_VERSION,
  startingSectionSchema,
  templateAssignmentSchema,
  templateDefinitionSchema,
} from './definition.js';
export type { StartingSection, TemplateAssignment, TemplateDefinition } from './definition.js';
export { materialiseTemplate } from './materialise.js';
export type { MaterialisedTemplate } from './materialise.js';
export { resolveTemplate } from './resolve.js';
export type { ResolvedTemplate, TemplateReferences, UnresolvedReference } from './resolve.js';
export { missingSections, valueFailures } from './conformance.js';
export type { MissingSection, NodeFailure } from './conformance.js';
export {
  checkDocumentParameters,
  checkTemplateParameters,
  documentParametersSchema,
  MAX_TEMPLATE_PARAMETERS,
  seedable,
  seededValues,
  templateParameterSchema,
} from './parameters.js';
export type {
  DocumentParameters,
  ParameterValuesRefused,
  TemplateParameter,
  TemplateParameterProblem,
} from './parameters.js';
