export {
  applyConditions,
  axisValues,
  AXIS_VOCABULARY_VALUES,
  conditionsIn,
  conditionAxisDefinitionSchema,
  profileSchema,
  selected as conditionsSelect,
  selectOutline,
  unsetAxes,
  storedProfileSchema,
  type AxisValue,
  type ConditionAxisDefinition,
  type Profile,
  type StoredProfile,
  type UnsetAxis,
} from './conditions.js';
export { referencesIn, type IndexedReference } from './references.js';
export {
  COMPONENT_GROUP_SCHEMA_VERSION,
  GROUP_MEMBERS_MOST,
  componentGroupSchema,
  groupMemberSchema,
  groupMembersSchema,
  groupTitleSchema,
  parseComponentGroup,
  type ComponentGroup,
  type GroupMember,
} from './group.js';
export { leaked, probesOf, PROBE_WORDS } from './scan.js';
export {
  printTitleVariables,
  printVariables,
  resolveVariable,
  variableDefinitionSchema,
  type PrintedVariable,
  type VariableContext,
  type VariableDefinition,
  type VariableForm,
  type VariableSource,
} from './variables.js';
