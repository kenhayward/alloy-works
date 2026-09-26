export {
  TEMPLATE_SCHEMA_VERSION,
  startingSectionSchema,
  templateAssignmentSchema,
  templateDefinitionSchema,
} from './definition.js';
export type { StartingSection, TemplateAssignment, TemplateDefinition } from './definition.js';
export { resolveTemplate } from './resolve.js';
export type { ResolvedTemplate, TemplateReferences, UnresolvedReference } from './resolve.js';
