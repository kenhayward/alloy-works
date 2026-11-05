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
export interface StewardDeps {
  readonly db: TenantDatabase;
  readonly steward: StewardDatabase;
  readonly maker: TenantMaker;
  readonly out: (line: string) => void;
  /** A client secret, from standard input and nowhere else; empty from a terminal. */
  readonly readSecret: () => Promise<string>;
  /** The sealing key, which only a first way in needs. */
  readonly key: () => Buffer;
}

const USAGE =
  'steward organisation --id <id> --name <name> --tenant <new id> --hostname <its address> --suffix <.what its tenants end in> --first-administrator <address> [--google] | steward provider --tenant <id> --issuer <url> --client-id <id> [--name <shown>] [--first-administrator <address>], its client secret piped in | steward retry --tenant <id> [--first-administrator <address>] | steward suspend --tenant <id> --reason <why> | steward resume --tenant <id> | steward close --tenant <id> --notice <reference> | steward cancel --tenant <id> | steward report --tenant <id>';
const DONE: Readonly<Record<string, string>> = {
  suspend: 'suspended',
  resume: 'resumed',
  close: 'closing',
  cancel: 'its closure cancelled',
};
const OPERATOR = { actorKind: 'vendor' } as const;

const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  // The next option is not this one's value.
  const value = at < 0 ? undefined : argv[at + 1];
  return value?.startsWith('--') ? undefined : value;
};

/** What each refusal of a first way in says, for an operator rather than for somebody reading the code. */
const FIRST_PROVIDER: Readonly<Record<string, string>> = {
  no_tenant: 'There is no such tenant.',
  not_organisation: "Only an organisation's own tenant is given its first way in here.",
  being_made: 'That tenant is still being made, or could not be: see `steward retry`.',
  not_active: 'That tenant is not active.',
  in_use: 'Somebody has signed in there and holds access, so its sign-in is theirs to change.',
  no_invitation:
    'Nobody is invited there, so nobody could use it: give --first-administrator as well.',
  several_providers: 'That tenant has several providers already, which this does not choose among.',
  'first_administrator.signed_in':
    'That address has signed in already, and an invitation cannot reach them: use another.',
  'first_administrator.administrator_exists': 'That tenant has an administrator already.',
  'first_administrator.external': 'That address is somebody from outside the organisation.',
  'first_administrator.already_invited':
    'Somebody else is invited already. Leave out --first-administrator, or let their invitation lapse.',
  'first_administrator.no_administrator_role': 'That tenant has no Administrator role.',
};

/**
 * A secret's bytes as text. Windows' tools write a byte order mark, and PowerShell's `>` UTF-16, which
 * sealed as they came would be a wrong secret reported as done.
 */
export function decodedSecret(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  }
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return bytes.subarray(start).toString('utf8');
}

const HTTP_URL = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const giveFirstProvider = async (
  argv: readonly string[],
  id: string | undefined,
  deps: StewardDeps,
): Promise<number> => {
  const issuer = option(argv, 'issuer');
  const clientId = option(argv, 'client-id')?.trim();
  const name = option(argv, 'name');
  const address = option(argv, 'first-administrator');
  if (
    !id ||
    !issuer ||
    issuer.length > 2000 ||
    !HTTP_URL(issuer) ||
    !clientId ||
    clientId.length > 500 ||
    (name !== undefined && (name === '' || name !== name.trim() || name.length > 80)) ||
    (argv.includes('--first-administrator') && !/^[^@\s]+@[^@\s]+$/.test(address ?? ''))
  ) {
    deps.out(USAGE);
    return 2;
  }
  let key: Buffer;
  try {
    key = deps.key();
  } catch {
    deps.out('SECRET_OBJECT_STORE_KEY is missing or malformed.');
    return 1;
  }
  deps.out('Reading the client secret from standard input.');
  // Only line endings: a secret's own characters are its own.
  const clientSecret = (await deps.readSecret()).replace(/[\r\n]+$/, '');
  if (clientSecret === '') {
    deps.out('No client secret came on standard input: pipe it in.');
    return 1;
  }
  let refused: string | undefined;
  try {
    refused = await deps.maker.firstProvider(
      id,
      { issuer, clientId, clientSecret, ...(name === undefined ? {} : { name }) },
      key,
      address,
    );
  } catch (error) {
    // Its code alone: a driver's detail can quote the row, and the row holds what was sealed.
    deps.out(`It could not be done: ${(error as { code?: string }).code ?? 'unexpected'}.`);
    return 1;
  }
  if (refused !== undefined) {
    deps.out(FIRST_PROVIDER[refused] ?? `Refused: ${refused}.`);
    return 1;
  }
  deps.out(`${id}: its first way in is ${issuer}. Add its address to that provider's callbacks.`);
  return 0;
};

const askForOrganisation = async (
  argv: readonly string[],
  deps: Pick<StewardDeps, 'maker' | 'out'>,
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
  if (!argv.includes('--google')) {
    deps.out(`Nobody can sign in there until you run: steward provider --tenant ${tenantId} ...`);
  }
  return 0;
};

/** 0 done, 1 refused, 2 not understood. */
export async function runSteward(argv: readonly string[], deps: StewardDeps): Promise<number> {
  const [command] = argv;
  const id = option(argv, 'tenant');
  const reason = option(argv, 'reason');
  const notice = option(argv, 'notice');
  // An organisation's own tenant, before it has anybody to ask (TL-P): the steward's process makes it.
  if (command === 'organisation') return askForOrganisation(argv, deps);
  if (command === 'provider') return giveFirstProvider(argv, id, deps);
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
