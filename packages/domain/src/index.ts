export * from './content/model/index.js';

// The admission pipeline: every paste, copy and import enters a component through it.
export * from './content/admission/index.js';

// Metadata: which fields apply to a component, what makes a value valid, and what a version records.
export * from './metadata/index.js';

// The whole version, as its digest serialises it (ADR-0024). The caller hashes.
export {
  canonicaliseVersion,
  canonicaliseVersionContent,
  componentTypeOf,
} from './version/substance.js';
export type {
  ComponentSubstance,
  DefinitionSubstance,
  DocumentSubstance,
  LayoutSubstance,
  AssetSubstance,
  ThemeSubstance,
  CatalogueSubstance,
  ConnectionSubstance,
  QueryDefinitionSubstance,
  DatasetSubstance,
  VersionSubstance,
} from './version/substance.js';

// Assets: an upload read from its bytes, and what an asset version records (docs/design/assets.md).
export * from './assets/index.js';

// Access: who may do what to which artifact, and why (docs/design/access.md). The caller loads facts.
export * from './access/index.js';

// The audit log: its closed list of kinds, their details, its context and labels (docs/design/audit.md).
export * from './audit/index.js';

// The document's outline: the tree, its parse, and the five operations over it.
export * from './structure/index.js';
export * from './template/index.js';
export * from './reuse/index.js';

// Scaffolding. This is NOT the content model - see docs/design/content-model.md for that.
// `apps/web` still uses it; retiring it is that app's change.
export {
  componentSchema,
  componentTypes,
  createComponent,
  parseComponent,
  nextVersion,
} from './component.js';

export type { Component, ComponentDraft, ComponentType } from './component.js';

// Publishing: the layout, the published document, its failures, and assemble
// (docs/design/publishing.md).
export * from './publishing/index.js';

// Themes: the stored shapes, the reader, the default theme and its projections
// (docs/design/themes.md; themes 1).
export * from './theme/index.js';

// The Word writer: a publication as a .docx (docs/design/word-output.md; Word 1).
export * from './word/index.js';

// Search's projection: what a version is found by, place by place (docs/design/search.md; W6).
export * from './search/index.js';

// Whether Postgres can store a value's every string, promoted so a route refuses what the store
// would fail on as the caller's content rather than as its own failure (issue #127).
export { storableEverywhere } from './stored/storable.js';

// Data, D1: a connection's settings and their check, the data failures and their attribution, the
// column types a describe proposes, the connector's protocol and the limits (docs/design/data.md).
export * from './data/index.js';
export * from './compare/index.js';
export * from './review/index.js';

// Workflow: a kind's states and transitions, validated, the seed, and the definition deciding a move
// (docs/design/workflow.md).
export * from './workflow/index.js';
// Translation: language lines and their status (docs/design/translation.md).
export * from './translation/index.js';
// Generation: model endpoints, and the connector's model call and its events (docs/design/generation.md).
export * from './generation/index.js';
// Citations: a bibliography entry, its key and its identities (docs/design/citations.md).
export * from './library/index.js';
// Import (the IM plan): a file read into a proposal of sections and components (docs/design/import.md).
export * from './import/index.js';
// Relationships (the R8 plan): declared types, and the ends a type permits.
export {
  endsRefused,
  relatableKinds,
  unrelatableKinds,
  type RelatableKind,
  relationshipTypeDefinitionSchema,
  type EndRefusal,
  type RelationshipEnd,
  type RelationshipTypeDefinition,
} from './relationships/type.js';

// Webhooks: the event types a subscription may want, and its secret's sealing (docs/design/webhooks.md).
export {
  childDeliverRequestSchema,
  deliverAnswerSchema,
  deliverRequestSchema,
  deliveryFailureCodes,
  DELIVERY_BODY_MOST,
  DELIVERY_DEADLINE_MS,
  DELIVERY_REPLY_MOST,
  secretKey,
  signatureHeader,
  signedContent,
  webhookAuditTypes,
  webhookEventTypes,
  webhookSealRequestSchema,
  webhookSecretContext,
  webhookSecretSchema,
  webhookUrlSchema,
  type ChildDeliverRequest,
  type DeliverAnswer,
  type DeliverRequest,
  type WebhookEventType,
  type WebhookSealRequest,
} from './webhooks/index.js';

// Extensions: a manifest, read strictly, and its fetch through the connector (docs/design/extensions.md).
export {
  childManifestRequestSchema,
  extensionCapabilitiesSchema,
  extensionManifestSchema,
  extensionSettingSchema,
  httpsUrl,
  manifestAnswerSchema,
  manifestDigestInput,
  manifestRequestSchema,
  MANIFEST_MOST_BYTES,
  readManifest,
  referenceManifestSchema,
  sourceManifestSchema,
  type ChildManifestRequest,
  type ExtensionCapabilities,
  type ExtensionManifest,
  type ReferenceManifest,
  type SourceManifest,
  type ExtensionSetting,
  type ManifestAnswer,
  type ManifestRequest,
} from './extensions/manifest.js';
