import type { ColumnType, Generated, Transaction } from 'kysely';

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
}

/** A transaction inside withTenant: what every read and write of tenant data is given. */
export type TenantTransaction = Transaction<TenantTables>;
