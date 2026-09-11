import type { ColumnType, Generated } from 'kysely';

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

export interface PlatformTables {
  'platform.organisation': OrganisationTable;
  'platform.tenant': TenantTable;
  'platform.tenant_hostname': TenantHostnameTable;
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

export interface TenantTables {
  principal: PrincipalTable;
  profile: ProfileTable;
}
