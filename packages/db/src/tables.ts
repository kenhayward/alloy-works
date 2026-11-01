import type {
  DefinitionKind,
  Permission,
  PrincipalKind,
  SearchConfiguration,
  SearchKind,
} from '@alloy-works/domain';
import type { ColumnType, Generated, RawBuilder, Transaction } from 'kysely';
import type { ArtifactKind } from './artifact-kind.js';
import type {
  AssetRightsTable,
  AssetUploadTable,
  AssetDerivativeTable,
  AssetDerivativeWantedTable,
  ImagesPolicyTable,
  PublicationRequestRightsTable,
} from './assets-tables.js';
import type {
  ReviewRoundEventTable,
  ReviewRoundReviewerTable,
  ReviewRoundTable,
} from './rounds-tables.js';
import type {
  BaselineBindingTable,
  BaselinePinTable,
  BaselineSupersessionTable,
  BaselineTable,
} from './baselines-tables.js';
import type {
  NotificationHeldTable,
  NotificationPreferenceTable,
  NotificationTable,
  ThreadCommentTable,
  ThreadCommentTextTable,
  ThreadInternalTable,
  ThreadResolutionTable,
  ThreadTable,
} from './threads-tables.js';
import type { SuggestionResolutionTable, SuggestionTable } from './suggestions-tables.js';
import type {
  PublicationCheckGivenUpTable,
  PublicationCheckTable,
  PublicationInputTable,
  PublicationOutputTable,
  PublicationAssetTable,
  PublicationRequestAssetTable,
  PublicationRequestBindingTable,
  PublicationBindingTable,
  PublicationRequestOccurrenceTable,
  PublicationRequestTable,
  PublicationTable,
} from './publishing-tables.js';

// Written by hand while there are two tenant tables; generated from a migrated template schema once
// there are enough that keeping them in step by hand is a risk (service-foundations.md).

export interface OrganisationTable {
  id: string;
  name: string;
  created_at: ColumnType<Date, never, never>;
}

export interface TenantTable {
  id: string;
  organisation_id: string;
  name: string;
  schema_name: string;
  role_name: string;
  created_at: ColumnType<Date, never, never>;
}

export interface TenantHostnameTable {
  hostname: string;
  tenant_id: string;
}

export interface JobTable {
  id: Generated<string>;
  tenant_id: string;
  kind: string;
  subject_id: string | null;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Generated<Date>;
  locked_by: string | null;
  locked_until: Date | null;
  finished_at: Date | null;
  failed_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
}

export interface PlatformTables {
  'platform.organisation': OrganisationTable;
  'platform.tenant': TenantTable;
  'platform.tenant_hostname': TenantHostnameTable;
  'platform.job': JobTable;
}

export interface PrincipalTable {
  id: Generated<string>;
  /** Null, with the subject, for somebody invited by address who has not yet signed in. */
  issuer: string | null;
  subject: string | null;
  email: string | null;
  /** Whether the provider asserted `email` as verified, at the last sign-in. */
  email_verified: Generated<boolean>;
  display_name: string | null;
  created_at: Generated<Date>;
  kind: Generated<PrincipalKind>;
  /** When they were erased (0087; the ER plan, ER-A): their name the fixed word, their address gone. */
  erased_at: ColumnType<Date | null, never, Date | null>;
  /** Their interface language (0166; UI-E), null for their browser's; absent before 0166. */
  interface_language: ColumnType<string | null, never, string | null>;
}

export interface ProfileTable {
  singleton: Generated<boolean>;
  display_name: string;
  updated_at: Generated<Date>;
}

export interface IdentityProviderTable {
  singleton: Generated<boolean>;
  issuer: string;
  client_id: string;
  /**
   * The secret's name in the service's store, from a configuration written before 0042; null for one
   * written since. Kept to be read, never to sign in with: such an environment is configured again.
   */
  secret_name: string | null;
  /** The client secret, sealed to this tenant and to sign-in (0042); null only beside a name. */
  sealed_secret: string | null;
  /** The ID token claim carrying the provider's group values (0039): `groups` unless configured. */
  groups_claim: Generated<string>;
}

export interface SignInRouteTable {
  route: 'organisation' | 'google';
}

export interface SignInAttemptTable {
  id: Generated<string>;
  state_hash: string;
  nonce: string;
  code_verifier: string;
  route: 'organisation' | 'google';
  expires_at: Date;
}

export interface SessionTable {
  id: Generated<string>;
  token_hash: string;
  principal_id: string;
  route: 'organisation' | 'google';
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  idle_expires_at: Date;
  expires_at: Date;
}

/** A personal token, kept as its hash (0038); its scopes a mask over its principal's grants. */
/** An extension installed (0141; the EX plan, EX-B). */
export interface ExtensionTable {
  id: Generated<string>;
  url: string;
  installed_by: string | null;
  installed_at: Generated<Date>;
  removed_at: Date | null;
  removed_by: string | null;
}

/** Every manifest an extension has had, by its digest (0141; EX-C). */
export interface ExtensionVersionTable {
  id: Generated<string>;
  extension_id: string;
  digest: string;
  manifest: ColumnType<unknown, string, never>;
  fetched_by: string | null;
  fetched_at: Generated<Date>;
}

/** A webhook subscription (0139; the WB plan): never answered with its sealed secrets. */
export interface WebhookSubscriptionTable {
  id: Generated<string>;
  service_identity: string;
  url: string;
  description: Generated<string>;
  event_types: string[];
  sealed: string;
  sealed_previous: string | null;
  previous_until: Date | null;
  created_by: string | null;
  created_at: Generated<Date>;
  disabled_at: Date | null;
  disabled_reason: 'failing' | 'identity_disabled' | null;
  last_success_at: Date | null;
  failing_since: Date | null;
}

/** A delivery, queued by trigger (0139; WB-D). */
export interface WebhookDeliveryTable {
  id: string;
  subscription_id: string;
  type: string;
  sequence: string;
  artifact_id: string | null;
  payload: ColumnType<unknown, string, never>;
  state: Generated<'pending' | 'delivered' | 'given_up' | 'dropped'>;
  attempts: Generated<number>;
  next_at: Generated<Date>;
  locked_until: Date | null;
  first_attempt_at: Date | null;
  created_at: Generated<Date>;
}

/** One attempt at a delivery (0139; API-029). */
export interface WebhookAttemptTable {
  id: Generated<string>;
  delivery_id: string;
  at: Generated<Date>;
  status: number | null;
  latency_ms: number;
  failure: string | null;
  reply: string | null;
}

/** A service identity's own facts, beside its principal (0138; the G8 plan, G8-G). */
export interface ServiceIdentityTable {
  principal_id: string;
  description: Generated<string>;
  created_by: string | null;
  created_at: Generated<Date>;
  disabled_at: Date | null;
}

export interface ApiTokenTable {
  id: Generated<string>;
  principal_id: string;
  name: string;
  token_hash: string;
  scopes: string[];
  created_at: Generated<Date>;
  expires_at: Date;
  last_used_at: ColumnType<Date | null, never, Date>;
}

export interface InvitationTable {
  id: Generated<string>;
  email: string;
  /** The principal the invitation made, which its first sign-in becomes. */
  principal_id: string;
  invited_by: string | null;
  named_by: string | null;
  created_at: Generated<Date>;
  expires_at: Date | null;
  accepted_at: Date | null;
  accepted_through: 'organisation' | 'google' | null;
}

export interface GoogleDomainTable {
  domain: string;
}

export interface SignInHandoffTable {
  code_hash: string;
  principal_id: string;
  attempt_hash: string;
  expires_at: Date;
}

export interface ObjectStoreCredentialTable {
  singleton: Generated<boolean>;
  access_key_id: string;
  sealed_secret: string;
  created_at: Generated<Date>;
}

/** A window's presence (0068): unlogged, beaten every 20 seconds, absent after a minute. */
export interface PresenceTable {
  viewer: string;
  principal_id: string;
  document_id: string;
  component_id: string | null;
  mode: string;
  beat_at: Generated<Date>;
}

/** An export of the audit log (0066): its filters, the snapshot it reads as of, and where it is kept. */
export interface AuditExportTable {
  id: Generated<string>;
  requested_by: string | null;
  requested_at: Generated<Date>;
  filters: ColumnType<Record<string, string>, string, never>;
  snapshot: ColumnType<string, string, never>;
  newest: ColumnType<string | null, string | null, never>;
  state: Generated<'queued' | 'done' | 'failed'>;
  object_key: string | null;
  sha256: string | null;
  bytes: ColumnType<string | null, number | null, number | null>;
  events: number | null;
  finished_at: Date | null;
}

export interface SampleTable {
  id: Generated<string>;
  requested_by: string;
  requested_at: Generated<Date>;
  state: Generated<'queued' | 'done' | 'failed'>;
  object_key: string | null;
  sha256: string | null;
  bytes: number | null;
  engine: string | null;
  finished_at: Date | null;
}

export interface SpaceTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
  /** Both null while the space is live, both set once archived (0059; the SP1 plan, SP-C). */
  archived_at: ColumnType<Date | null, undefined, Date | null>;
  archived_by: ColumnType<string | null, undefined, string | null>;
}

/** No update: an artifact's identity does not change, and the runtime role holds no such grant. */
export interface ArtifactTable {
  id: ColumnType<string, string | undefined, never>;
  kind: ColumnType<ArtifactKind, ArtifactKind, never>;
  space_id: ColumnType<string | null, string | null, never>;
  created_at: ColumnType<Date, never, never>;
}

/**
 * Insert and read, nothing else (VER-008): every column's update type is `never`, as the grant is.
 * JSONB goes in as the text of a JSON document, because `pg` would send a JavaScript array as a
 * Postgres array rather than as JSON.
 */
export interface ArtifactVersionTable {
  /** The transaction that wrote it, which a listing's snapshot reads (0032); null from before. */
  written_by: ColumnType<string | null, never, never>;
  id: ColumnType<string, never, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<ArtifactKind, ArtifactKind, never>;
  revision_no: ColumnType<number, number, never>;
  version_no: ColumnType<number, number, never>;
  /** Null for a definition the environment itself started with (0015); never for a component. */
  author_id: ColumnType<string | null, string | null, never>;
  created_at: ColumnType<Date, never, never>;
  note: ColumnType<string | null, string | null, never>;
  schema_version: ColumnType<number, number, never>;
  content: ColumnType<unknown, string, never>;
  content_hash: ColumnType<string, string, never>;
  metadata_values: ColumnType<Record<string, unknown>, string, never>;
  not_carried: ColumnType<unknown[], string, never>;
  /** A document's parameters, by name (0057); null for every other kind, and for a document with none. */
  parameters: ColumnType<Record<string, unknown> | null, string | null | undefined, never>;
  component_type_version_id: ColumnType<string | null, string | null, never>;
  /** The earlier version of the same artifact a restore made this from (0082); null for any other. */
  restored_from: ColumnType<string | null, string | undefined, never>;
  /** Generated: `componentType` when the type is set, the key tying it to what the version records. */
  component_type_kind: ColumnType<'componentType' | null, never, never>;
  version_digest: ColumnType<string, string, never>;
  /** Its line (0112; ADR-0063), none for the main line; absent before 0112. */
  line_id: ColumnType<string | null, string | undefined, never>;
}

/** Insert and read, nothing else, on the same terms as the version row. */
export interface VersionDefinitionTable {
  version_id: ColumnType<string, string, never>;
  definition_version_id: ColumnType<string, string, never>;
  definition_artifact_id: ColumnType<string, string, never>;
  definition_kind: ColumnType<DefinitionKind, DefinitionKind, never>;
}

/** The environment's declared default component type (MET-042): one row, set by 0015. */
export interface ComponentTypeDefaultTable {
  singleton: ColumnType<boolean, boolean | undefined, never>;
  component_type_id: ColumnType<string, string, string>;
  component_type_kind: ColumnType<'componentType', never, never>;
  set_at: ColumnType<Date, never, Date>;
}

/** The environment's declared layout: one row, set by 0018. The runtime role reads it and nothing else. */
export interface LayoutDefaultTable {
  singleton: ColumnType<boolean, boolean | undefined, never>;
  layout_id: ColumnType<string, string, string>;
  layout_kind: ColumnType<'layout', never, never>;
  set_at: ColumnType<Date, never, Date>;
}

/** The environment's declared theme: one row, set by 0024. The runtime role reads it and nothing else. */
export interface ThemeDefaultTable {
  singleton: ColumnType<boolean, boolean | undefined, never>;
  theme_id: ColumnType<string, string, string>;
  theme_kind: ColumnType<'theme', never, never>;
  set_at: ColumnType<Date, never, Date>;
}

/** The tenant's declared default prompt library (0124): read, never written. */
export interface PromptLibraryDefaultTable {
  singleton: ColumnType<boolean, never, never>;
  library_id: ColumnType<string, never, never>;
  library_kind: ColumnType<'promptLibrary', never, never>;
}

/** The tenant's one editing policy (0037): read, and its window changed, never inserted or removed. */
export interface EditingPolicyTable {
  singleton: ColumnType<boolean, never, never>;
  iteration_retention_days: ColumnType<number, never, number>;
  lock_release_minutes: ColumnType<number, never, number>;
  lock_take_minutes: ColumnType<number, never, number>;
}

export interface AccessPolicyTable {
  singleton: Generated<boolean>;
  external_default_days: Generated<number>;
  external_cap_days: Generated<number>;
}

export interface RoleTable {
  id: Generated<string>;
  name: string;
  permissions: Permission[];
  created_at: Generated<Date>;
  /** The shared reader's alone (0114): refused change or removal. */
  fixed: Generated<boolean>;
}

export interface AccessGroupTable {
  id: Generated<string>;
  name: string;
  source: 'tenant' | 'provider';
  provider_value: string | null;
  created_at: Generated<Date>;
}

export interface GroupMemberTable {
  group_id: string;
  principal_id: string;
  asserted_at: Date | null;
}

/** Made and removed, never changed: every column's update type is `never`, as the grant is. */
export interface AccessGrantTable {
  id: ColumnType<string, string | undefined, never>;
  role_id: ColumnType<string, string, never>;
  principal_id: ColumnType<string | null, string | null | undefined, never>;
  group_id: ColumnType<string | null, string | null | undefined, never>;
  level: ColumnType<'tenant' | 'space' | 'artifact', 'tenant' | 'space' | 'artifact', never>;
  space_id: ColumnType<string | null, string | null | undefined, never>;
  artifact_id: ColumnType<string | null, string | null | undefined, never>;
  effect: ColumnType<'allow' | 'deny', 'allow' | 'deny', never>;
  expires_at: ColumnType<Date | null, Date | null | undefined, never>;
  extends: ColumnType<string | null, string | null | undefined, never>;
  granted_by: ColumnType<string, string, never>;
  granted_at: ColumnType<Date, never, never>;
}

/** Named by an administrator of the database; the runtime role records a claim and nothing else. */
export interface FirstAdministratorTable {
  id: ColumnType<string, never, never>;
  issuer: ColumnType<string, never, never>;
  subject: ColumnType<string, never, never>;
  role_id: ColumnType<string, never, never>;
  named_by: ColumnType<string, never, never>;
  named_at: ColumnType<Date, never, never>;
  claimed_at: ColumnType<Date | null, never, Date>;
  claimed_by: ColumnType<string | null, never, string>;
  outcome: ColumnType<
    'granted' | 'refused_administrator_exists' | null,
    never,
    'granted' | 'refused_administrator_exists'
  >;
}

/** Claimed, extended, moved and released: the runtime role may change it, and nothing else may. */
/** A person's unversioned work on a component, set aside up to a time by Discard (the R2 plan). */
export interface UnsavedDiscardedTable {
  artifact_id: string;
  kind: ColumnType<'component', never, never>;
  principal_id: string;
  up_to: Date;
}

export interface ComponentLockTable {
  artifact_id: string;
  kind: ColumnType<'component', never, never>;
  principal_id: string;
  session_id: string;
  claimed_at: ColumnType<Date, Date | undefined, Date>;
  active_at: ColumnType<Date, Date | undefined, Date>;
  expires_at: Date;
  taking_by: string | null;
  taking_session: string | null;
  taking_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
  taken_from: string | null;
  /** The line it is a lock on, null for the main line (0159; TR-H). */
  line_id: ColumnType<string | null, string | null | undefined, never>;
}

/**
 * Insert, read, and the sweep's delete (VER-001, VER-003): every column's update type is `never`, as
 * the grant is, and a delete is refused by trigger before the iteration's window has passed (0037).
 */
export interface IterationTable {
  id: ColumnType<string, never, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<'component', never, never>;
  principal_id: ColumnType<string, string, never>;
  session_id: ColumnType<string, string, never>;
  sequence: ColumnType<number, number, never>;
  opened_from: ColumnType<string, string, never>;
  created_at: ColumnType<Date, Date | undefined, never>;
  content: ColumnType<unknown, string, never>;
  metadata_values: ColumnType<Record<string, unknown>, string, never>;
  digest: ColumnType<string, string, never>;
  /** The divergent line edited (0113; the R16 final review), none for the main line; absent before. */
  line_id: ColumnType<string | null, string | undefined, never>;
}

/** The template, and its version, a document was made from (0029): written once, never changed. */
export interface DocumentTemplateTable {
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  template_id: ColumnType<string, string, never>;
  template_version_id: ColumnType<string, string, never>;
  template_kind: ColumnType<'template', 'template' | undefined, never>;
}

/** A cohort (0107; the R7 plan, R7-A): inserted whole, never changed. */
export interface CohortTable {
  id: ColumnType<string, never, never>;
  space_id: ColumnType<string, string, never>;
  template_id: ColumnType<string, string, never>;
  resolution: ColumnType<unknown, string, never>;
  title: ColumnType<string, string, never>;
  language: ColumnType<string, string, never>;
  direction: ColumnType<string, string, never>;
  source: ColumnType<unknown, string, never>;
  requested_by: ColumnType<string, string, never>;
  requested_at: ColumnType<Date, never, never>;
  /** What its run does at a failed row (0116; TPL-047). */
  on_failure: ColumnType<string, string | undefined, never>;
}

/** One row of a cohort (0107): its parameters fixed, its outcome written by the run (R7-E). */
export interface CohortRowTable {
  cohort_id: ColumnType<string, string, never>;
  row_no: ColumnType<number, number, never>;
  /** Corrected only on a failed row, by a rerun (R7-F). */
  parameters: ColumnType<unknown, string, string>;
  state: ColumnType<string, never, string>;
  document_id: ColumnType<string | null, never, string | null>;
  failure: ColumnType<unknown, never, string | null>;
  attempts: ColumnType<number, never, number>;
}

/** A definition's name, folded, unique per kind (0030, MET-031); only `name_key` is ever updated. */
export interface DefinitionNameTable {
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<
    | 'field'
    | 'metadataSchema'
    | 'componentType'
    | 'variable'
    | 'conditionAxis'
    | 'relationshipType'
    | 'vocabulary'
    | 'licence',
    | 'field'
    | 'metadataSchema'
    | 'componentType'
    | 'variable'
    | 'conditionAxis'
    | 'relationshipType'
    | 'vocabulary'
    | 'licence',
    never
  >;
  name_key: ColumnType<string, string, string>;
}

/** Search's projection: one row per thing found (0031; docs/design/search.md). Derived, never a record. */
export interface SearchEntryTable {
  id: Generated<string>;
  artifact_id: string;
  kind: SearchKind;
  node: string | null;
  version_id: string;
  space_id: string | null;
  title: string;
  owner: string | null;
  changed_at: Date;
  component_type: string | null;
  field_values: ColumnType<Record<string, unknown>, string, string>;
  configuration: SearchConfiguration;
  body: string;
  /** Generated until 0089, which makes it plain and every writer set it (the SV plan, SV-L). */
  vector: ColumnType<string, string, string>;
  /** The thread a `thread` entry is (0089); null for every other kind, and none before 0089. */
  thread_id: ColumnType<string | null, string | null | undefined, never>;
  /** Its artifact archived (0083): left out of search, and set by the acts and by indexing. */
  archived: Generated<boolean>;
  /** Its artifact deleted (0085): left out of search, and set by the acts and by indexing. */
  deleted: Generated<boolean>;
  /**
   * Its artifact's workflow state (0095; WF-H), a section's its document's; null for every other kind,
   * and none before 0095. Set by indexing and by a move.
   */
  workflow_state: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * An earlier version's entry (0088; the SV plan, SV-A): a `search_entry` row moved here, its id and
 * vector kept, when its artifact gained a version. Only the two flags ever change.
 */
export interface SearchEarlierTable {
  id: string;
  artifact_id: string;
  kind: 'component' | 'document' | 'section' | 'asset';
  node: string | null;
  version_id: string;
  space_id: string | null;
  title: string;
  owner: string | null;
  changed_at: Date;
  component_type: string | null;
  field_values: ColumnType<Record<string, unknown>, string, never>;
  configuration: SearchConfiguration;
  body: string;
  vector: ColumnType<string, string, never>;
  archived: ColumnType<boolean, boolean | undefined, boolean>;
  deleted: ColumnType<boolean, boolean | undefined, boolean>;
}

/** An earlier entry's place and its words, as `search_text` held them (0088). */
export interface SearchEarlierTextTable {
  entry_id: string;
  place: string;
  body: string;
  configuration: SearchConfiguration;
  vector: ColumnType<string, string, never>;
}

/**
 * A place's words over every version (0091; the SV3 plan, SV3-I): one row per component, document and
 * section, its vector and body folded from every version, the rest the newest version holding it.
 */
export interface SearchHistoryTable {
  id: Generated<string>;
  artifact_id: string;
  kind: 'component' | 'document' | 'section';
  node: string | null;
  version_id: string;
  space_id: string | null;
  title: string;
  owner: string | null;
  changed_at: Date;
  component_type: string | null;
  field_values: ColumnType<Record<string, unknown>, string, string>;
  configuration: SearchConfiguration;
  body: string;
  vector: ColumnType<string, string, string>;
  /** Every version's titles' words, folded as `vector` is (0093; #608). */
  title_vector: ColumnType<string, string, string>;
  /** Every version's fields' words, all fields together, folded as `vector` is (0094; #610). */
  fields_vector: ColumnType<string, string, string>;
  archived: ColumnType<boolean, boolean | undefined, boolean>;
  deleted: ColumnType<boolean, boolean | undefined, boolean>;
  /** Its artifact's workflow state now (0095; WF-H). */
  workflow_state: ColumnType<string | null, string | null | undefined, string | null>;
}

/** A kind's workflow definition, a version per save, inserted and never changed (0095; WF-B). */
export interface WorkflowDefinitionTable {
  id: Generated<string>;
  kind: 'component' | 'document' | 'queryDefinition' | 'prompt' | 'term';
  version_no: number;
  body: ColumnType<unknown, string, never>;
  /** Null for the seed. */
  by: string | null;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** One move of a component or a document, inserted and never changed (0095; WF-D). */
export interface WorkflowTransitionTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document' | 'queryDefinition' | 'prompt' | 'term';
  /** The version current at the move; null for a creation's, made before its first version. */
  version_id: string | null;
  /** Null for a creation's and a save's of an approved artifact. */
  transition: string | null;
  from_state: string | null;
  to_state: string;
  definition_id: string;
  reason: string | null;
  /** Null where 0095 wrote it for an author unknown. */
  by: string | null;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
  /** A line's move (0112; R16-C), none for the main line's; absent before 0112. */
  line_id: ColumnType<string | null, string | undefined, never>;
}

/** One approval or rejection at a gate, inserted and never changed (0096; WF2-C). */
export interface WorkflowApprovalTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document' | 'queryDefinition' | 'prompt' | 'term';
  /** The move into the gate's from-state that began the round it counts in. */
  round: string;
  version_id: string;
  definition_id: string;
  transition: string;
  decision: 'approved' | 'rejected';
  /** A rejection's alone. */
  reason: string | null;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A revision: a version designated as a gate passed, inserted and never changed (0096; WF2-F). */
export interface RevisionDesignationTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document' | 'queryDefinition' | 'prompt' | 'term';
  version_id: string;
  revision_no: number;
  definition_id: string;
  transition: string;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/**
 * A component's or document's dates, as acts (0099; the WF5 plan, WF5-A). `review_by` is a `date`:
 * read it as text (`review_by::text`), which the driver would otherwise turn into a local midnight.
 */
export interface ArtifactDatesTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document';
  effective_at: Date | null;
  effective_offset: number | null;
  review_by: ColumnType<unknown, string | null, never>;
  owner: string | null;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A revision approved to take effect later, its date fixed as the gate passed (0099; WF5-B). */
/** A component's divergent line (0112; the R16 plan, R16-B). */
export interface ArtifactLineTable {
  id: ColumnType<string, never, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<'component', 'component', never>;
  ordinal: ColumnType<number, number, never>;
  name: ColumnType<string, string, never>;
  diverged_from: ColumnType<string, string, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
  /** A language line's BCP 47 tag, null for a divergent line (0159; TR-A). */
  language: ColumnType<string | null, string | null | undefined, never>;
}

/** What a version on a language line translates (0159; TR-C): insert-only, the newest a line's. */
export interface TranslationStateTable {
  id: ColumnType<string, never, never>;
  line_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  translates: ColumnType<string, string, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A translation job (0163; the XL plan, XL-D): a document's components sent to one language. */
export interface TranslationJobTable {
  id: ColumnType<string, string | undefined, never>;
  document_id: ColumnType<string, string, never>;
  document_version: ColumnType<string, string, never>;
  language: ColumnType<string, string, never>;
  vendor: ColumnType<string | null, string | null | undefined, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  closed_by: ColumnType<string | null, never, string | null>;
  closed_at: ColumnType<Date | null, never, Date | null>;
}

/** One component a job lists (0163; XL-D): what was sent, or why not; from XLb, what came back. */
export interface TranslationJobItemTable {
  job_id: ColumnType<string, string, never>;
  component_id: ColumnType<string, string, never>;
  position: ColumnType<number, number, never>;
  line_id: ColumnType<string | null, string | null, never>;
  source_version: ColumnType<string | null, string | null, never>;
  line_head: ColumnType<string | null, string | null, never>;
  not_sent: ColumnType<
    'needs_revision' | 'not_editable' | 'other_source' | null,
    string | null,
    never
  >;
  outcome: ColumnType<'returned' | 'held' | 'refused' | null, never, string | null>;
  version_id: ColumnType<string | null, never, string | null>;
  decided_by: ColumnType<string | null, never, string | null>;
  decided_at: ColumnType<Date | null, never, Date | null>;
  /** The return it came back in, and the words held for a person (0164; XL-G). */
  return_id: ColumnType<string | null, never, string | null>;
  held_content: ColumnType<unknown, never, string | null>;
}

/** A version a machine drafted (0165; XL-I), marked until a person with approve accepts its line. */
export interface MachineDraftTable {
  version_id: ColumnType<string, string, never>;
  line_id: ColumnType<string, string, never>;
  runs: ColumnType<string[], string[], never>;
  missed_terms: ColumnType<string[], string[] | undefined, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  accepted_by: ColumnType<string | null, never, string>;
  accepted_at: ColumnType<Date | null, never, Date>;
}

/** A delivery the bridge was asked for (0172; API-068): keyed while open or written, kept when refused. */
export interface BridgeDeliveryTable {
  id: Generated<string>;
  key: ColumnType<string | null, string, string | null>;
  space_id: ColumnType<string, string, never>;
  family: ColumnType<'document' | 'data', 'document' | 'data', never>;
  state: ColumnType<
    'running' | 'written' | 'refused',
    'running' | undefined,
    'written' | 'refused'
  >;
  token_id: ColumnType<string, string, never>;
  principal_id: ColumnType<string, string, never>;
  package_key: ColumnType<string | null, string | null, string | null>;
  persistent_id: ColumnType<string | null, string | null, string | null>;
  receipt: ColumnType<unknown, string | null | undefined, string | null>;
  refusal: ColumnType<unknown, string | null | undefined, string | null>;
  carried: ColumnType<unknown, string | undefined, string>;
  /** Gains what the job learns as it writes (unmapped properties, kept originals), never loses any. */
  provenance: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
  finished_at: ColumnType<Date | null, never, Date | null>;
}

/** The artifact a source document's element became, by the document's persistent identity (0172). */
export interface BridgeElementTable {
  persistent_id: ColumnType<string, string, never>;
  element: ColumnType<string, string, never>;
  artifact_id: ColumnType<string, string, string>;
  node: ColumnType<string | null, string | null, string | null>;
}

/** A target space's bridge settings (0172): what delivery makes there, and the fields it fills. */
export interface BridgeSettingsTable {
  space_id: ColumnType<string, string, never>;
  component_type: ColumnType<string | null, string | null, string | null>;
  template: ColumnType<string | null, string | null, string | null>;
  property_map: ColumnType<unknown, string | undefined, string>;
  connection_id: ColumnType<string | null, string | null, string | null>;
  table_schema: ColumnType<string | null, string | null, string | null>;
  changed_by: ColumnType<string, string, string>;
  changed_at: ColumnType<Date, Date | undefined, Date>;
}

/** The environment's one CT Studio: its identity, its token, and its hand-off's address and sink (0174). */
export interface CtStudioTable {
  singleton: ColumnType<boolean, boolean | undefined, never>;
  identity_id: ColumnType<string, string, string>;
  token_id: ColumnType<string | null, string | null | undefined, string | null>;
  address: ColumnType<string | null, string | null | undefined, string | null>;
  sink_id: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** A property delivered to a space that its property map does not name (0173). */
export interface BridgeUnlistedPropertyTable {
  space_id: ColumnType<string, string, never>;
  name: ColumnType<string, string, never>;
  first_delivered: ColumnType<Date, Date, never>;
  last_delivered: ColumnType<Date, Date, Date>;
  deliveries: ColumnType<number, number, number>;
}

/** A job's file returned (0164; XL-F): kept by its hash, read by the worker. */
export interface TranslationJobReturnTable {
  id: ColumnType<string, string | undefined, never>;
  job_id: ColumnType<string, string, never>;
  object_key: ColumnType<string, string, never>;
  sha256: ColumnType<string, string, never>;
  bytes: ColumnType<number, number, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  state: ColumnType<'reading' | 'read' | 'failed', never, 'read' | 'failed'>;
  failure: ColumnType<string | null, never, string | null>;
  returned: ColumnType<number | null, never, number>;
  held: ColumnType<number | null, never, number>;
  refused: ColumnType<number | null, never, number>;
  read_at: ColumnType<Date | null, never, Date>;
}

/** Whether a main-line version needs retranslating (0159; TR-D): insert-only, the newest a version's. */
export interface SourceChangeTable {
  id: ColumnType<string, never, never>;
  version_id: ColumnType<string, string, never>;
  retranslate: ColumnType<boolean, boolean, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A line brought back and closed (0112; R16-F, R16-G). */
export interface LineClosedTable {
  line_id: ColumnType<string, string, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** What bringing a line back carried across and left behind (0112; R16-F). */
export interface LineReturnTable {
  line_id: ColumnType<string, string, never>;
  from_version: ColumnType<string, string, never>;
  into_version: ColumnType<string, string, never>;
  carried: ColumnType<unknown, string, never>;
  left_behind: ColumnType<unknown, string, never>;
  written_by: ColumnType<string, never, never>;
}

/** A component's or document's scope, as an act (0111; the R15 plan, R15-B). */
export interface ArtifactScopeTable {
  id: ColumnType<string, never, never>;
  /** A line's scope (0112; R16-C), none for the main line's; absent before 0112. */
  line_id: ColumnType<string | null, string | undefined, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<'component' | 'document', 'component' | 'document', never>;
  scope: ColumnType<unknown, string, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A designated revision's scope, one row a value (0111). */
export interface RevisionScopeTable {
  version_id: ColumnType<string, string, never>;
  artifact_id: ColumnType<string, string, never>;
  axis: ColumnType<string, string, never>;
  value: ColumnType<string, string, never>;
  party_principal: ColumnType<string | null, string | null, never>;
  party_group: ColumnType<string | null, string | null, never>;
}

/** A revision accepted by its party in one scope (0111; R15-E). */
export interface RevisionAcceptanceTable {
  version_id: ColumnType<string, string, never>;
  axis: ColumnType<string, string, never>;
  value: ColumnType<string, string, never>;
  by: ColumnType<string, string, never>;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

export interface RevisionEffectiveTable {
  version_id: string;
  artifact_id: string;
  effective_at: Date;
  written_by: ColumnType<string, never, never>;
}

/** A revision taking effect, recorded once by the sweep (0099; WF5-D). */
export interface RevisionEffectedTable {
  version_id: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A review date passing unmet, acted on once (0099; WF5-G). `review_by` read as text. */
export interface ReviewLapseTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document';
  review_by: ColumnType<unknown, string, never>;
  action: 'visibility' | 'move' | 'escalate';
  escalated_to: string | null;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A document moved to a newer version of its template (0101; the WF6 plan, WF6-C). */
export interface DocumentTemplateMoveTable {
  id: ColumnType<string, never, never>;
  document_id: string;
  document_kind: ColumnType<'document', never, never>;
  template_id: string;
  from_version_id: string;
  to_version_id: string;
  version_id: string;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** One reference in an artifact's latest version (0102; the R2 plan, R2-A). */
export interface ReferenceTable {
  id: ColumnType<string, never, never>;
  from_id: string;
  from_version: string;
  node: string | null;
  to_id: string;
  to_kind: string;
  mode: 'latest' | 'approved' | 'pinned';
  to_version: string | null;
}

/** A bibliography entry's key, fixed at its first version, unique in its space (0145; LIB-046). */
export interface BibliographyKeyTable {
  entry_id: ColumnType<string, string, never>;
  entry_kind: ColumnType<'bibliographyEntry', never, never>;
  space_id: ColumnType<string, string, never>;
  key: ColumnType<string, string, never>;
}

/** One identity of an entry's latest version, a match is found by (0145; LIB-045). */
export interface BibliographyIdentityTable {
  entry_id: ColumnType<string, string, never>;
  space_id: ColumnType<string, string, never>;
  by: ColumnType<
    'doi' | 'pmid' | 'isbn' | 'issn' | 'work',
    'doi' | 'pmid' | 'isbn' | 'issn' | 'work',
    never
  >;
  value: ColumnType<string, string, never>;
}

/** A section the template requires, removed with a reason (0100; the WF6 plan, WF6-B). */
export interface SectionWaiverTable {
  id: ColumnType<string, never, never>;
  document_id: string;
  document_kind: ColumnType<'document', never, never>;
  key: string;
  reason: string;
  version_id: string;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** One archival act on a component or a document, inserted and never changed (0083; AH-C). */
export interface ArtifactArchivalTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document' | 'bibliographyEntry' | 'term';
  act: 'archived' | 'unarchived';
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** One deletion act on a component or a document, inserted and never changed (0085; DL-B). */
export interface ArtifactDeletionTable {
  id: ColumnType<string, never, never>;
  artifact_id: string;
  kind: 'component' | 'document';
  act: 'deleted' | 'undeleted';
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** A legal hold on an artifact or a space, inserted and never changed (0084; AH-F). */
export interface LegalHoldTable {
  id: ColumnType<string, never, never>;
  artifact_id: string | null;
  kind: 'component' | 'document' | 'publication' | 'asset' | null;
  space_id: string | null;
  reason: string;
  applied_by: string;
  applied_at: ColumnType<Date, never, never>;
}

/** A hold's release, once, with its own reason (0084; AH-F). */
export interface LegalHoldReleaseTable {
  hold_id: string;
  reason: string;
  released_by: string;
  released_at: ColumnType<Date, never, never>;
}

/** A retention keep's change, inserted and never changed (0086; DL-G): the latest per key in force. */
export interface RetentionKeepTable {
  id: ColumnType<string, never, never>;
  kind: 'component' | 'document' | null;
  space_id: string | null;
  days: number | null;
  by: string;
  at: ColumnType<Date, never, never>;
  written_by: ColumnType<string, never, never>;
}

/** One place in a search entry and its words; `vector` is generated from them (0031). */
export interface SearchTextTable {
  entry_id: string;
  place: string;
  body: string;
  configuration: SearchConfiguration;
  vector: ColumnType<string, never, never>;
}

/** A mutating request's answer against its idempotency key, kept a day (0033; API-008). */
export interface IdempotencyRecordTable {
  principal_id: string;
  key: string;
  operation: string;
  digest: string;
  status: number;
  body: ColumnType<unknown, string, string>;
  made_at: ColumnType<Date, Date | undefined, Date>;
}

/**
 * A connection's credential, sealed by the connector (0044; data.md, "The credential"): the latest row
 * by `id` is it. Insert-only, and never the time, which is the database's.
 */
export interface ConnectionCredentialTable {
  id: ColumnType<string, never, never>;
  connection_id: ColumnType<string, string, never>;
  connection_kind: ColumnType<'connection', 'connection' | undefined, never>;
  sealed: ColumnType<string, string, never>;
  set_by: ColumnType<string, string, never>;
  set_at: ColumnType<Date, never, never>;
  /** The digest of the target it was set for (0045); null on a row set before, bound to nothing. */
  target_digest: ColumnType<string | null, string, never>;
}

/** A test the connector answered, against the version it tested (0044; D1-N). Insert-only. */
export interface ConnectionTestTable {
  id: ColumnType<string, never, never>;
  connection_id: ColumnType<string, string, never>;
  connection_version_id: ColumnType<string, string, never>;
  connection_kind: ColumnType<'connection', 'connection' | undefined, never>;
  outcome: ColumnType<'ok' | 'failed', 'ok' | 'failed', never>;
  findings: ColumnType<string[], string[] | undefined, never>;
  failure: ColumnType<string | null, string | null, never>;
  tested_by: ColumnType<string, string, never>;
  tested_at: ColumnType<Date, never, never>;
  /** The credential row it was made with; null for a test recorded before migration 0045 named one. */
  credential_id: ColumnType<string | null, string, never>;
}

/**
 * The tenant's lowered limits (0046; the D2 plan, D2-N): one row, each limit null where not lowered.
 * The runtime role changes the three and nothing else.
 */
export interface DataPolicyTable {
  singleton: ColumnType<boolean, never, never>;
  rows: ColumnType<number | null, never, number | null>;
  bytes: ColumnType<number | null, never, number | null>;
  seconds: ColumnType<number | null, never, number | null>;
  /** The tenant's runs at once (0115; R18-A), null for the product's default. */
  concurrent_runs: ColumnType<number | null, never, number | null>;
}

/** A reference source an administrator switched (0149; the XR plan, XR-C); none is on. */
export interface ReferenceSourcePolicyTable {
  source: ColumnType<string, string, never>;
  enabled: ColumnType<boolean, boolean, boolean>;
}

/** A run's slot (0115; R18-B), leased for its deadline. */
export interface QuerySlotTable {
  id: Generated<string>;
  taken_at: Generated<Date>;
  lease_until: ColumnType<Date, Date | RawBuilder<Date>, never>;
}

/** A query run (0115; R18-D), insert-only and swept after 13 months. */
export interface QueryRunTable {
  id: Generated<string>;
  at: Generated<Date>;
  act: string;
  principal_id: string | null;
  connection_id: string | null;
  query_definition_id: string | null;
  document_id: string | null;
  duration_ms: number;
  row_count: number | null;
  bytes: ColumnType<string | number | null, number | null, never>;
  outcome: string;
  failure: string | null;
}

/** A dataset's identity (0047; the D3 plan, D3-A): the question its versions answer. Insert-only. */
export interface DatasetTable {
  artifact_id: ColumnType<string, string, never>;
  artifact_kind: ColumnType<'dataset', 'dataset' | undefined, never>;
  query_definition: ColumnType<string, string, never>;
  query_definition_kind: ColumnType<'queryDefinition', 'queryDefinition' | undefined, never>;
  parameters_digest: ColumnType<string, string, never>;
  identity_key: ColumnType<string, string, never>;
}

/** A dataset's names (0047; DAT-092): the latest row is the name. Insert-only. */
export interface DatasetNameTable {
  id: ColumnType<string, never, never>;
  dataset_id: ColumnType<string, string, never>;
  dataset_kind: ColumnType<'dataset', 'dataset' | undefined, never>;
  name: ColumnType<string, string, never>;
  named_by: ColumnType<string, string, never>;
  named_at: ColumnType<Date, never, never>;
}

/**
 * What a binding holds in a document (0047; DAT-093, DAT-037): the latest row for a document, a node
 * and a binding. Insert-only.
 */
export interface BindingResolutionTable {
  id: ColumnType<string, never, never>;
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  node_id: ColumnType<string, string, never>;
  binding_id: ColumnType<string, string, never>;
  binding_digest: ColumnType<string, string, never>;
  dataset_version: ColumnType<string, string, never>;
  dataset_id: ColumnType<string, string, never>;
  dataset_kind: ColumnType<'dataset', 'dataset' | undefined, never>;
  replaces: ColumnType<string | null, string | null, never>;
  act: ColumnType<'resolve' | 'accept' | 'confirm', 'resolve' | 'accept' | 'confirm', never>;
  resolved_by: ColumnType<string, string, never>;
  resolved_at: ColumnType<Date, never, never>;
}

/** A take's outcome on a dataset version, as derived data (0048; the B1 plan, B1-H). */
export interface DatasetTakeTable {
  dataset_version: ColumnType<string, string, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<'dataset', 'dataset' | undefined, never>;
  take_digest: ColumnType<string, string, never>;
  outcome: ColumnType<unknown, string, never>;
}

/** A result waiting on its images (0051; the D8 plan, D8-D and D8-E). */
export interface DatasetPendingTable {
  id: ColumnType<string, never, never>;
  act: ColumnType<'resolve' | 'session' | 'check', 'resolve' | 'session' | 'check', never>;
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  node_id: ColumnType<string, string, never>;
  binding_id: ColumnType<string, string, never>;
  binding_digest: ColumnType<string, string, never>;
  holding: ColumnType<string | null, string | null, never>;
  session: ColumnType<string | null, string | null, never>;
  definition_id: ColumnType<string, string, never>;
  definition_version: ColumnType<string, string, never>;
  definition_kind: ColumnType<'queryDefinition', 'queryDefinition' | undefined, never>;
  checksum: ColumnType<string, string, never>;
  /** JSONB in as the text of a JSON document. */
  provenance: ColumnType<unknown, string, never>;
  uploads: ColumnType<string[], string[], never>;
  requested_by: ColumnType<string, string, never>;
  state: ColumnType<'pending' | 'refused', never, 'refused'>;
  failure: ColumnType<unknown, never, string>;
  created_at: ColumnType<Date, never, never>;
  /** A resolve's decision over the revisions standing (0078; RV-D): JSONB in as text, or none. */
  revisions: ColumnType<unknown, string | null | undefined, never>;
}

/** A value revised by hand, in front of a resolution (0078; the RV plan, RV-A): insert and read. */
export interface BindingRevisionTable {
  id: ColumnType<string, never, never>;
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  node_id: ColumnType<string, string, never>;
  binding_id: ColumnType<string, string, never>;
  /** '' for an inline binding, else the cell's canonical JSON. */
  cell: ColumnType<string, string, never>;
  resolution: ColumnType<string, string, never>;
  act: ColumnType<'revise' | 'withdraw', 'revise' | 'withdraw', never>;
  /** JSONB in as the text of a JSON document; null exactly for a withdrawal. */
  value: ColumnType<unknown, string | null, never>;
  reason: ColumnType<string, string, never>;
  replaces: ColumnType<string | null, string | null, never>;
  revised_by: ColumnType<string, string, never>;
  revised_at: ColumnType<Date, never, never>;
}

/**
 * An audit event (0060; audit.md): written by `recordEvent` alone, never updated or deleted. The
 * sequence is a bigint, which pg reads as a string.
 */
export interface AuditEventTable {
  sequence: ColumnType<string, never, never>;
  at: ColumnType<Date, never, never>;
  xact: ColumnType<string, never, never>;
  kind: ColumnType<string, string, never>;
  actor_kind: ColumnType<string, string, never>;
  actor: ColumnType<string | null, string | null | undefined, never>;
  token: ColumnType<string | null, string | null | undefined, never>;
  subject_kind: ColumnType<string | null, string | null | undefined, never>;
  subject: ColumnType<string | null, string | null | undefined, never>;
  subject_version: ColumnType<string | null, string | null | undefined, never>;
  space: ColumnType<string | null, string | null | undefined, never>;
  outcome: ColumnType<'done' | 'refused', 'done' | 'refused', never>;
  detail: ColumnType<Record<string, unknown>, string, never>;
  trace_id: ColumnType<string | null, string | null | undefined, never>;
}

/** A label an event keeps (0060): changed only by `erase_labels`. */
export interface AuditLabelTable {
  sequence: ColumnType<string, string, never>;
  role: ColumnType<string, string, never>;
  text: ColumnType<string, string, never>;
  refers_to: ColumnType<string | null, string | null | undefined, never>;
  erased_at: ColumnType<Date | null, never, never>;
}

export interface TenantTables {
  audit_event: AuditEventTable;
  audit_label: AuditLabelTable;
  component_lock: ComponentLockTable;
  translation_state: TranslationStateTable;
  source_change: SourceChangeTable;
  translation_job: TranslationJobTable;
  translation_job_item: TranslationJobItemTable;
  translation_job_return: TranslationJobReturnTable;
  machine_draft: MachineDraftTable;
  bridge_delivery: BridgeDeliveryTable;
  bridge_element: BridgeElementTable;
  bridge_settings: BridgeSettingsTable;
  bridge_unlisted_property: BridgeUnlistedPropertyTable;
  ct_studio: CtStudioTable;
  unsaved_discarded: UnsavedDiscardedTable;
  iteration: IterationTable;
  principal: PrincipalTable;
  profile: ProfileTable;
  identity_provider: IdentityProviderTable;
  sign_in_route: SignInRouteTable;
  sign_in_attempt: SignInAttemptTable;
  session: SessionTable;
  api_token: ApiTokenTable;
  service_identity: ServiceIdentityTable;
  webhook_subscription: WebhookSubscriptionTable;
  extension: ExtensionTable;
  extension_version: ExtensionVersionTable;
  webhook_delivery: WebhookDeliveryTable;
  webhook_attempt: WebhookAttemptTable;
  invitation: InvitationTable;
  google_domain: GoogleDomainTable;
  sign_in_handoff: SignInHandoffTable;
  object_store_credential: ObjectStoreCredentialTable;
  sample: SampleTable;
  audit_export: AuditExportTable;
  presence: PresenceTable;
  space: SpaceTable;
  artifact: ArtifactTable;
  artifact_version: ArtifactVersionTable;
  version_definition: VersionDefinitionTable;
  access_policy: AccessPolicyTable;
  editing_policy: EditingPolicyTable;
  role: RoleTable;
  access_group: AccessGroupTable;
  group_member: GroupMemberTable;
  access_grant: AccessGrantTable;
  first_administrator: FirstAdministratorTable;
  component_type_default: ComponentTypeDefaultTable;
  layout_default: LayoutDefaultTable;
  theme_default: ThemeDefaultTable;
  prompt_library_default: PromptLibraryDefaultTable;
  publication_request: PublicationRequestTable;
  publication_request_occurrence: PublicationRequestOccurrenceTable;
  publication: PublicationTable;
  publication_input: PublicationInputTable;
  publication_output: PublicationOutputTable;
  publication_check: PublicationCheckTable;
  publication_check_given_up: PublicationCheckGivenUpTable;
  document_template: DocumentTemplateTable;
  cohort: CohortTable;
  cohort_row: CohortRowTable;
  definition_name: DefinitionNameTable;
  publication_request_asset: PublicationRequestAssetTable;
  publication_request_binding: PublicationRequestBindingTable;
  publication_binding: PublicationBindingTable;
  publication_asset: PublicationAssetTable;
  asset_upload: AssetUploadTable;
  asset_rights: AssetRightsTable;
  images_policy: ImagesPolicyTable;
  asset_derivative: AssetDerivativeTable;
  asset_derivative_wanted: AssetDerivativeWantedTable;
  publication_request_rights: PublicationRequestRightsTable;
  search_entry: SearchEntryTable;
  artifact_archival: ArtifactArchivalTable;
  artifact_deletion: ArtifactDeletionTable;
  legal_hold: LegalHoldTable;
  legal_hold_release: LegalHoldReleaseTable;
  retention_keep: RetentionKeepTable;
  workflow_definition: WorkflowDefinitionTable;
  workflow_transition: WorkflowTransitionTable;
  workflow_approval: WorkflowApprovalTable;
  revision_designation: RevisionDesignationTable;
  artifact_dates: ArtifactDatesTable;
  revision_effective: RevisionEffectiveTable;
  artifact_scope: ArtifactScopeTable;
  revision_scope: RevisionScopeTable;
  revision_acceptance: RevisionAcceptanceTable;
  artifact_line: ArtifactLineTable;
  line_closed: LineClosedTable;
  line_return: LineReturnTable;
  revision_effected: RevisionEffectedTable;
  review_lapse: ReviewLapseTable;
  section_waiver: SectionWaiverTable;
  document_template_move: DocumentTemplateMoveTable;
  reference: ReferenceTable;
  bibliography_key: BibliographyKeyTable;
  bibliography_identity: BibliographyIdentityTable;
  search_text: SearchTextTable;
  search_earlier: SearchEarlierTable;
  search_earlier_text: SearchEarlierTextTable;
  search_history: SearchHistoryTable;
  idempotency_record: IdempotencyRecordTable;
  connection_credential: ConnectionCredentialTable;
  connection_test: ConnectionTestTable;
  data_policy: DataPolicyTable;
  reference_source_policy: ReferenceSourcePolicyTable;
  query_slot: QuerySlotTable;
  query_run: QueryRunTable;
  dataset: DatasetTable;
  dataset_name: DatasetNameTable;
  binding_resolution: BindingResolutionTable;
  dataset_pending: DatasetPendingTable;
  binding_revision: BindingRevisionTable;
  dataset_take: DatasetTakeTable;
  baseline: BaselineTable;
  baseline_pin: BaselinePinTable;
  baseline_binding: BaselineBindingTable;
  baseline_supersession: BaselineSupersessionTable;
  thread: ThreadTable;
  suggestion: SuggestionTable;
  review_round: ReviewRoundTable;
  review_round_reviewer: ReviewRoundReviewerTable;
  review_round_event: ReviewRoundEventTable;
  suggestion_resolution: SuggestionResolutionTable;
  thread_comment: ThreadCommentTable;
  thread_comment_text: ThreadCommentTextTable;
  thread_resolution: ThreadResolutionTable;
  thread_internal: ThreadInternalTable;
  notification: NotificationTable;
  notification_held: NotificationHeldTable;
  notification_preference: NotificationPreferenceTable;
}

/** A transaction inside withTenant: what every read and write of tenant data is given. */
export type TenantTransaction = Transaction<TenantTables>;
