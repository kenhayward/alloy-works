import {
  cancelClosing,
  resumeTenant,
  startClosing,
  suspendTenant,
  TenantStateRefused,
  type StewardDatabase,
  type TenantDatabase,
} from '@alloy-works/db';

/**
 * The operator's command line (tenant-lifecycle.md, TL-P), the only way to lift a suspension until an
 * organisation has a tenant of its own (TLd). It changes a tenant's state and reads no content, and each
 * act is an event in that tenant's log, naming the vendor (IAM-087).
 */
const USAGE =
  'steward suspend --tenant <id> --reason <why> | steward resume --tenant <id> | steward close --tenant <id> --notice <reference> | steward cancel --tenant <id> | steward report --tenant <id>';
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

/** 0 done, 1 refused, 2 not understood. */
export async function runSteward(
  argv: readonly string[],
  deps: {
    readonly db: TenantDatabase;
    readonly steward: StewardDatabase;
    readonly out: (line: string) => void;
  },
): Promise<number> {
  const [command] = argv;
  const id = option(argv, 'tenant');
  const reason = option(argv, 'reason');
  const notice = option(argv, 'notice');
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
