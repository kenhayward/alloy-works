import {
  cancelClosing,
  OrganisationRefused,
  resumeTenant,
  startClosing,
  suspendTenant,
  TenantStateRefused,
  type StewardDatabase,
  type TenantMaker,
  type TenantDatabase,
} from '@alloy-works/db';

/**
 * The operator's command line (tenant-lifecycle.md, TL-P), the only way to lift a suspension until an
 * organisation has a tenant of its own (TLd). It changes a tenant's state and reads no content, and each
 * act is an event in that tenant's log, naming the vendor (IAM-087).
 */
const USAGE =
  'steward organisation --id <id> --name <name> --tenant <new id> --hostname <its address> --suffix <.what its tenants end in> --first-administrator <address> [--google] | steward retry --tenant <id> [--first-administrator <address>] | steward suspend --tenant <id> --reason <why> | steward resume --tenant <id> | steward close --tenant <id> --notice <reference> | steward cancel --tenant <id> | steward report --tenant <id>';
const DONE: Readonly<Record<string, string>> = {
  suspend: 'suspended',
  resume: 'resumed',
  close: 'closing',
  cancel: 'its closure cancelled',
};
const OPERATOR = { actorKind: 'vendor' } as const;

const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};

const askForOrganisation = async (
  argv: readonly string[],
  deps: { readonly maker: TenantMaker; readonly out: (line: string) => void },
): Promise<number> => {
  const [organisationId, name, tenantId, hostname, suffix, address] = [
    'id',
    'name',
    'tenant',
    'hostname',
    'suffix',
    'first-administrator',
  ].map((each) => option(argv, each));
  if (!organisationId || !name || !tenantId || !hostname || !suffix || !address?.includes('@')) {
    deps.out(USAGE);
    return 2;
  }
  try {
    await deps.maker.requestOrganisation({
      organisation: { id: organisationId, name },
      tenantId,
      hostname,
      suffix,
      firstAdministrator: address,
      google: argv.includes('--google'),
    });
  } catch (error) {
    if (error instanceof OrganisationRefused) {
      deps.out(`Refused: ${error.refused}.`);
      return 1;
    }
    // Refused by the table: a suffix another organisation has, or a race for what was just checked.
    const code = (error as { code?: string }).code ?? '';
    if (!code.startsWith('23')) throw error;
    deps.out(`Refused: ${(error as { constraint?: string }).constraint ?? 'already taken'}.`);
    return 1;
  }
  deps.out(
    `${tenantId}: asked for. The steward's process makes it, and invites its first administrator.`,
  );
  return 0;
};

/** 0 done, 1 refused, 2 not understood. */
export async function runSteward(
  argv: readonly string[],
  deps: {
    readonly db: TenantDatabase;
    readonly steward: StewardDatabase;
    readonly maker: TenantMaker;
    readonly out: (line: string) => void;
  },
): Promise<number> {
  const [command] = argv;
  const id = option(argv, 'tenant');
  const reason = option(argv, 'reason');
  const notice = option(argv, 'notice');
  // An organisation's own tenant, before it has anybody to ask (TL-P): the steward's process makes it.
  if (command === 'organisation') return askForOrganisation(argv, deps);
  // One that could not be made, after what stopped it is put right; its address went when it failed.
  if (command === 'retry' && id !== undefined) {
    if (await deps.maker.retry(id, option(argv, 'first-administrator'))) {
      deps.out(`${id}: asked for again.`);
      return 0;
    }
    deps.out(`No request for ${id} has failed.`);
    return 1;
  }
  // What remains of a tenant, which may be no more than its record (TL-J).
  if (command === 'report' && id !== undefined) {
    const record = await deps.steward.record(id);
    if (!record) {
      deps.out(`There is no tenant ${id}.`);
      return 1;
    }
    deps.out(JSON.stringify(record));
    return 0;
  }
  if (
    id === undefined ||
    command === undefined ||
    DONE[command] === undefined ||
    (command === 'suspend' && (!reason || reason.length > 2000)) ||
    (command === 'close' && (!notice || notice.length > 2000))
  ) {
    deps.out(USAGE);
    return 2;
  }
  const tenant = await deps.db.tenant(id);
  if (!tenant) {
    deps.out(`There is no tenant ${id}.`);
    return 1;
  }
  try {
    await deps.db.withTenant(
      tenant,
      (trx) => {
        if (command === 'suspend') return suspendTenant(trx, tenant, reason as string);
        if (command === 'resume') return resumeTenant(trx, tenant);
        // The export is offered, not taken: those allowed in may take it for the 30 days (TL-P).
        if (command === 'close') return startClosing(trx, tenant, { notice: notice as string });
        return cancelClosing(trx, tenant);
      },
      OPERATOR,
    );
  } catch (error) {
    if (!(error instanceof TenantStateRefused)) throw error;
    deps.out(error.message);
    return 1;
  }
  deps.out(`${id}: ${DONE[command]}.`);
  return 0;
}
