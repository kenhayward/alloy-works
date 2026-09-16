import type { DefinitionKind, Permission, PrincipalKind } from '@alloy-works/domain';
import type { ColumnType, Generated, Transaction } from 'kysely';
import type { ArtifactKind } from './artifact-kind.js';

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
  issuer: string;
  subject: string;
  email: string | null;
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
  secret_name: string;
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

export interface InvitationTable {
  email: string;
  principal_id: string | null;
  created_at: Generated<Date>;
  accepted_at: Date | null;
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
  id: ColumnType<string, never, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<ArtifactKind, ArtifactKind, never>;
  revision_no: ColumnType<number, number, never>;
  version_no: ColumnType<number, number, never>;
  author_id: ColumnType<string, string, never>;
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

export interface TenantTables {
  principal: PrincipalTable;
  profile: ProfileTable;
  identity_provider: IdentityProviderTable;
  sign_in_route: SignInRouteTable;
  sign_in_attempt: SignInAttemptTable;
  session: SessionTable;
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
  role: RoleTable;
  access_group: AccessGroupTable;
  group_member: GroupMemberTable;
  access_grant: AccessGrantTable;
}

/** A transaction inside withTenant: what every read and write of tenant data is given. */
export type TenantTransaction = Transaction<TenantTables>;
