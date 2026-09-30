export {
  CONNECTION_SCHEMA_VERSION,
  ConnectionRefused,
  checkConnection,
  connectionTarget,
  connectionSettingsSchema,
  connectorIdentities,
  parseConnection,
  parseConnectionForWrite,
} from './connection.js';
export type { ConnectionProblem, ConnectionSettings } from './connection.js';
export { dataFailure, dataFailureCodes, dataFailures } from './failures.js';
export type { Attribution, DataFailure, DataFailureCode } from './failures.js';
export { columnTypeSchema } from './columns.js';
export type { ColumnType } from './columns.js';
export {
  CONNECTOR_ANSWER_MAX_BYTES,
  MAX_COLUMNS,
  MAX_DESCRIBED_RELATIONS,
  SEALED,
  SEALED_MAX_BYTES,
  SECRET_MAX_BYTES,
  childRequestSchema,
  describeAnswerSchema,
  describeRequestSchema,
  relationSchema,
  sealAnswerSchema,
  sealRequestSchema,
  testAnswerSchema,
  testRequestSchema,
} from './protocol.js';
export type {
  ChildRequest,
  DescribeAnswer,
  DescribeRequest,
  Relation,
  SealAnswer,
  SealRequest,
  TestAnswer,
  TestFinding,
  TestRequest,
} from './protocol.js';
export { defaultLimits, limitCeilings } from './limits.js';
