import { resumeTenant, suspendTenant, TenantStateRefused, type TenantDatabase } from '@alloy-works/db';

/**
 * The operator's command line (tenant-lifecycle.md, TL-P), the only way to lift a suspension until an
 * organisation has a tenant of its own (TLd). It changes a tenant's state and reads no content, and each
 * act is an event in that tenant's log, naming the vendor (IAM-087).
 */
const USAGE = 'steward suspend --tenant <id> --reason <why> | steward resume --tenant <id>';
const OPERATOR = { actorKind: 'vendor' } as const;

const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};

/** 0 done, 1 refused, 2 not understood. */
export async function runSteward(
  argv: readonly string[],
  deps: { readonly db: TenantDatabase; readonly out: (line: string) => void },
): Promise<number> {
  const [command] = argv;
  const id = option(argv, 'tenant');
  const reason = option(argv, 'reason');
  if (
    id === undefined ||
    (command !== 'suspend' && command !== 'resume') ||
    (command === 'suspend' && !reason)
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
      (trx) =>
        command === 'suspend'
          ? suspendTenant(trx, tenant, reason as string)
          : resumeTenant(trx, tenant),
      OPERATOR,
    );
  } catch (error) {
    if (!(error instanceof TenantStateRefused)) throw error;
    deps.out(error.message);
    return 1;
  }
  deps.out(`${id}: ${command === 'suspend' ? 'suspended' : 'resumed'}.`);
  return 0;
}
