import type {
  DefinitionKind,
  Permission,
  PrincipalKind,
  SearchConfiguration,
  SearchKind,
} from '@alloy-works/domain';
import type { ColumnType, Generated, Transaction } from 'kysely';
import type { ArtifactKind } from './artifact-kind.js';
import type { AssetUploadTable } from './assets-tables.js';
import type {
  PublicationCheckGivenUpTable,
  PublicationCheckTable,
  PublicationInputTable,
  PublicationOutputTable,
  PublicationAssetTable,
  PublicationRequestAssetTable,
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
  component_type_version_id: ColumnType<string | null, string | null, never>;
  /** Generated: `componentType` when the type is set, the key tying it to what the version records. */
  component_type_kind: ColumnType<'componentType' | null, never, never>;
  version_digest: ColumnType<string, string, never>;
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

/** The tenant's one editing policy (0037): read, and its window changed, never inserted or removed. */
export interface EditingPolicyTable {
  singleton: ColumnType<boolean, never, never>;
  iteration_retention_days: ColumnType<number, never, number>;
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
export interface ComponentLockTable {
  artifact_id: string;
  kind: ColumnType<'component', never, never>;
  principal_id: string;
  session_id: string;
  claimed_at: ColumnType<Date, Date | undefined, Date>;
  expires_at: Date;
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
}

/** The template, and its version, a document was made from (0029): written once, never changed. */
export interface DocumentTemplateTable {
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  template_id: ColumnType<string, string, never>;
  template_version_id: ColumnType<string, string, never>;
  template_kind: ColumnType<'template', 'template' | undefined, never>;
}

/** A definition's name, folded, unique per kind (0030, MET-031); only `name_key` is ever updated. */
export interface DefinitionNameTable {
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<
    'field' | 'metadataSchema' | 'componentType',
    'field' | 'metadataSchema' | 'componentType',
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
  vector: ColumnType<string, never, never>;
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
  act: ColumnType<'resolve' | 'accept', 'resolve' | 'accept', never>;
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

export interface TenantTables {
  component_lock: ComponentLockTable;
  iteration: IterationTable;
  principal: PrincipalTable;
  profile: ProfileTable;
  identity_provider: IdentityProviderTable;
  sign_in_route: SignInRouteTable;
  sign_in_attempt: SignInAttemptTable;
  session: SessionTable;
  api_token: ApiTokenTable;
  invitation: InvitationTable;
  google_domain: GoogleDomainTable;
  sign_in_handoff: SignInHandoffTable;
  object_store_credential: ObjectStoreCredentialTable;
  sample: SampleTable;
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
  publication_request: PublicationRequestTable;
  publication_request_occurrence: PublicationRequestOccurrenceTable;
  publication: PublicationTable;
  publication_input: PublicationInputTable;
  publication_output: PublicationOutputTable;
  publication_check: PublicationCheckTable;
  publication_check_given_up: PublicationCheckGivenUpTable;
  document_template: DocumentTemplateTable;
  definition_name: DefinitionNameTable;
  publication_request_asset: PublicationRequestAssetTable;
  publication_asset: PublicationAssetTable;
  asset_upload: AssetUploadTable;
  search_entry: SearchEntryTable;
  search_text: SearchTextTable;
  idempotency_record: IdempotencyRecordTable;
  connection_credential: ConnectionCredentialTable;
  connection_test: ConnectionTestTable;
  data_policy: DataPolicyTable;
  dataset: DatasetTable;
  dataset_name: DatasetNameTable;
  binding_resolution: BindingResolutionTable;
  dataset_take: DatasetTakeTable;
}

/** A transaction inside withTenant: what every read and write of tenant data is given. */
export type TenantTransaction = Transaction<TenantTables>;
