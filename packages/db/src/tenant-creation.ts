import { sql } from 'kysely';
import pg from 'pg';
import { asAdministrator } from './admin.js';
import { recordEvent, recordEventSql } from './audit.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { invitedAddress } from './invitations.js';
import { migrateTenant } from './migrate.js';
import { tenantNames } from './names.js';
import { provisionTenant, seedTenant, type Tenant } from './provision.js';
import { permitGoogleSignIn } from './sign-in.js';
import type { TenantTransaction } from './tables.js';

/**
 * **Creating a tenant** (tenant-lifecycle.md, TL-N). A request goes on a platform table, since no tenant
 * exists for a job to name, and the steward carries it out in stages that repeat safely. It gets its
 * address last, so nothing reaches a tenant still being made.
 */

export const REQUEST_ATTEMPTS = 10;

export type TenantRequestRefusal =
  'organisation.no_suffix' | 'organisation.bad_label' | 'organisation.address_taken';

const REFUSALS: Readonly<Record<string, TenantRequestRefusal>> = {
  AW003: 'organisation.no_suffix',
  AW004: 'organisation.bad_label',
  AW005: 'organisation.address_taken',
};

/** An organisation asks for a tenant beside it (IAM-068): its event now, and the new tenant's on creation. */
export async function requestTenant(
  trx: TenantTransaction,
  input: { readonly name: string; readonly label: string; readonly firstAdministrator: string },
): Promise<
  { readonly id: string; readonly hostname: string } | { readonly refused: TenantRequestRefusal }
> {
  let made: { id: string; hostname: string };
  try {
    const { rows } = await sql<{ id: string; hostname: string }>`
      select id, hostname from platform.request_tenant(
        ${input.name}, ${input.label}, ${invitedAddress(input.firstAdministrator)})`.execute(trx);
    made = rows[0]!;
  } catch (error) {
    const refused = REFUSALS[(error as { code?: string }).code ?? ''];
    if (!refused) throw error;
    return { refused };
  }
  await recordEvent(
    trx,
    {
      kind: 'organisation.changed',
      subject: { kind: 'tenant' },
      detail: { tenant: made.id, change: 'requested', by: 'organisation' },
    },
    [{ role: 'subject', text: input.name }],
  );
  return made;
}

export interface TenantRequestView {
  readonly id: string;
  readonly name: string;
  readonly hostname: string;
  readonly state: 'waiting' | 'failed';
  readonly createdAt: Date;
}

/** What the organisation asked for and does not have yet. The address is not among it. */
export async function tenantRequests(trx: TenantTransaction): Promise<TenantRequestView[]> {
  const { rows } = await sql<{
    id: string;
    name: string;
    hostname: string;
    state: 'waiting' | 'failed';
    created_at: Date;
  }>`select id, name, hostname, state, created_at from platform.organisation_tenant_requests()`.execute(
    trx,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    state: row.state,
    createdAt: row.created_at,
  }));
}

export async function hostnameSuffix(trx: TenantTransaction): Promise<string | null> {
  const { rows } = await sql<{ suffix: string | null }>`
    select platform.own_hostname_suffix() as suffix`.execute(trx);
  return rows[0]?.suffix ?? null;
}

/** The operator's request: an organisation's own tenant, and what its addresses end in (TL-P). */
export interface OrganisationRequest {
  readonly organisation: { readonly id: string; readonly name: string };
  readonly tenantId: string;
  readonly hostname: string;
  readonly suffix: string;
  readonly firstAdministrator: string;
  readonly google: boolean;
}

export interface TenantRequest {
  readonly id: string;
  readonly organisationId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly hostname: string;
  readonly kind: 'content' | 'organisation';
  readonly firstAdministrator: string | null;
  readonly google: boolean;
  readonly requestedBy: 'organisation' | 'operator';
  readonly attempts: number;
}

interface RequestRow {
  id: string;
  organisation_id: string;
  tenant_id: string;
  name: string;
  hostname: string;
  kind: 'content' | 'organisation';
  first_administrator: string | null;
  google: boolean;
  requested_by: 'organisation' | 'operator';
  attempts: number;
}

export interface TenantMaker {
  /** Asked by the operator: refused by the database if the address or the organisation's kind is taken. */
  requestOrganisation(request: OrganisationRequest): Promise<void>;
  /** The oldest request with no steward working on it, leased. */
  claim(leaseMs: number): Promise<TenantRequest | undefined>;
  /** Its roles, schema, rows and tables: repeated, what is done is passed over. */
  build(request: TenantRequest): Promise<Tenant>;
  /** Google where the operator asked, then the invitation. */
  invite(request: TenantRequest, tenant: Tenant): Promise<void>;
  /** Its first event and its address, and the request done, the person's address gone with it. */
  finish(request: TenantRequest, tenant: Tenant): Promise<void>;
  /** Again after the lease, until it has had its attempts; then it stops and forgets the address. */
  giveUpIfSpent(request: TenantRequest): Promise<boolean>;
  organisationOf(tenantId: string): Promise<string>;
  /** Tenants of the organisation a provider's copy goes to, and its own, if it has one. */
  family(organisationId: string): Promise<{
    readonly organisation: Tenant | undefined;
    readonly tenants: readonly Tenant[];
  }>;
  close(): Promise<void>;
}

export function createTenantMaker(stewardUrl: string): TenantMaker {
  const pool = new pg.Pool({ connectionString: stewardUrl, max: 2 });
  const named = (id: string): Tenant => {
    const names = tenantNames(id);
    return { id, schema: names.schema, role: names.role };
  };
  return {
    async requestOrganisation(request) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `insert into platform.organisation (id, name) values ($1, $2) on conflict (id) do nothing`,
          [request.organisation.id, request.organisation.name],
        );
        await client.query(`update platform.organisation set hostname_suffix = $2 where id = $1`, [
          request.organisation.id,
          request.suffix.toLowerCase(),
        ]);
        await client.query(
          `insert into platform.tenant_request
             (organisation_id, tenant_id, name, hostname, kind, first_administrator, google, requested_by)
           values ($1, $2, $3, $4, 'organisation', $5, $6, 'operator')`,
          [
            request.organisation.id,
            request.tenantId,
            request.organisation.name,
            request.hostname.toLowerCase(),
            invitedAddress(request.firstAdministrator),
            request.google,
          ],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async claim(leaseMs) {
      const { rows } = await pool.query<RequestRow>(
        `update platform.tenant_request
            set attempts = attempts + 1,
                locked_until = now() + make_interval(secs => $1::double precision)
          where id = (select id from platform.tenant_request
                       where state = 'waiting' and (locked_until is null or locked_until < now())
                       order by created_at, id
                       for update skip locked limit 1)
          returning id, organisation_id, tenant_id, name, hostname, kind, first_administrator,
                    google, requested_by, attempts`,
        [leaseMs / 1000],
      );
      const row = rows[0];
      return (
        row && {
          id: row.id,
          organisationId: row.organisation_id,
          tenantId: row.tenant_id,
          name: row.name,
          hostname: row.hostname,
          kind: row.kind,
          firstAdministrator: row.first_administrator,
          google: row.google,
          requestedBy: row.requested_by,
          attempts: row.attempts,
        }
      );
    },

    async build(request) {
      const tenant = named(request.tenantId);
      const input = { tenant: { id: request.tenantId, name: request.name }, kind: request.kind };
      const { rowCount } = await pool.query('select 1 from platform.tenant where id = $1', [
        request.tenantId,
      ]);
      if (!rowCount) {
        const { rows } = await pool.query<{ name: string }>(
          'select name from platform.organisation where id = $1',
          [request.organisationId],
        );
        await provisionTenant(stewardUrl, {
          ...input,
          organisation: { id: request.organisationId, name: rows[0]!.name },
          hostnames: [],
        });
      }
      await migrateTenant(stewardUrl, tenant);
      await asAdministrator(stewardUrl, tenant, (client, schema) =>
        seedTenant(client, schema, input),
      );
      return tenant;
    },

    async invite(request, tenant) {
      if (request.google && request.firstAdministrator) {
        const domain = request.firstAdministrator.split('@')[1]!;
        await permitGoogleSignIn(stewardUrl, tenant, { domains: [domain] });
      }
      if (!request.firstAdministrator) return;
      await inviteFirstAdministrator(stewardUrl, tenant, {
        email: request.firstAdministrator,
        namedBy: request.requestedBy,
      });
    },

    async finish(request, tenant) {
      await asAdministrator(stewardUrl, tenant, async (client) => {
        const { rowCount } = await client.query(
          `select 1 from audit_event where kind = 'tenant.created'`,
        );
        if (rowCount) return;
        await recordEventSql(client, {
          kind: 'tenant.created',
          detail: { by: request.requestedBy },
        });
      });
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `insert into platform.tenant_hostname (hostname, tenant_id) values ($1, $2)
           on conflict (hostname) do nothing`,
          [request.hostname, request.tenantId],
        );
        const held = await client.query<{ tenant_id: string }>(
          'select tenant_id from platform.tenant_hostname where hostname = $1',
          [request.hostname],
        );
        if (held.rows[0]?.tenant_id !== request.tenantId) {
          throw new Error(`The address of ${request.tenantId} is another tenant's`);
        }
        await client.query(
          `update platform.tenant_request
              set state = 'done', first_administrator = null, locked_until = null, finished_at = now()
            where id = $1`,
          [request.id],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async giveUpIfSpent(request) {
      if (request.attempts < REQUEST_ATTEMPTS) return false;
      await pool.query(
        `update platform.tenant_request
            set state = 'failed', first_administrator = null, locked_until = null, finished_at = now()
          where id = $1`,
        [request.id],
      );
      return true;
    },

    async organisationOf(tenantId) {
      const { rows } = await pool.query<{ organisation_id: string }>(
        'select organisation_id from platform.tenant where id = $1',
        [tenantId],
      );
      return rows[0]!.organisation_id;
    },

    async family(organisationId) {
      const { rows } = await pool.query<{ id: string; kind: string }>(
        `select t.id, t.kind from platform.tenant t
          where t.organisation_id = $1 and t.state not in ('deleting', 'deleted')
            and not exists (select from platform.tenant_request r
                             where r.tenant_id = t.id and r.state <> 'done')
          order by t.id`,
        [organisationId],
      );
      const own = rows.find((row) => row.kind === 'organisation');
      return {
        organisation: own && named(own.id),
        tenants: rows.filter((row) => row.kind !== 'organisation').map((row) => named(row.id)),
      };
    },

    close: () => pool.end(),
  };
}
