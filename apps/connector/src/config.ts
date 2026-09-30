import { createHash } from 'node:crypto';
import { BlockList } from 'node:net';

import { sealingKey } from '@alloy-works/sealing';

/**
 * What the guard refuses whatever the deployment says (the D1 plan, D1-G): loopback, link-local, this
 * host, multicast and broadcast, in both families. A deployment adds its platform's ranges in
 * CONNECTOR_DENY; it cannot take these away.
 */
export const builtInDenied: readonly string[] = Object.freeze([
  '127.0.0.0/8',
  '::1/128',
  '169.254.0.0/16',
  'fe80::/10',
  '0.0.0.0/8',
  '::/128',
  '224.0.0.0/4',
  'ff00::/8',
  '255.255.255.255/32',
]);

export type LogLevel = 'silent' | 'error' | 'info';

export interface ConnectorConfig {
  readonly port: number;
  readonly host: string;
  /** SHA-256 of the key the service presents, compared with the presented key's by digest. */
  readonly keyDigest: Buffer;
  /** The key a credential is sealed and opened with, which the service never holds. */
  readonly sealingKey: Buffer;
  /** The deployment's own ranges, beside the built-in ones. */
  readonly deny: readonly string[];
  readonly maxChildren: number;
  readonly logLevel: LogLevel;
}

/** A configuration refused, naming the variable and never its value. */
export class ConfigurationRefused extends Error {}

const refuse = (variable: string, why: string): never => {
  throw new ConfigurationRefused(`${variable} ${why}`);
};

function key(env: Readonly<Record<string, string | undefined>>, variable: string): Buffer {
  const value = env[variable];
  if (!value) refuse(variable, 'is required: 32 bytes of base64');
  try {
    return sealingKey(value!);
  } catch {
    return refuse(variable, 'must be 32 bytes of base64');
  }
}

/** Whether a range is a CIDR range `net.BlockList` takes: an address of either family and a prefix. */
export function isRange(range: string): boolean {
  const match = /^([^/]+)\/(\d{1,3})$/.exec(range);
  if (!match) return false;
  const [, address, prefix] = match;
  const family = address!.includes(':') ? 'ipv6' : 'ipv4';
  if (Number(prefix) > (family === 'ipv6' ? 128 : 32)) return false;
  try {
    new BlockList().addSubnet(address!, Number(prefix), family);
    return true;
  } catch {
    return false;
  }
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: number,
  [low, high]: readonly [number, number],
): number {
  const value = env[variable];
  if (value === undefined || value === '') return fallback;
  const number = /^\d{1,6}$/.test(value) ? Number(value) : NaN;
  if (!(number >= low && number <= high))
    refuse(variable, `must be a whole number from ${low} to ${high}`);
  return number;
}

/**
 * The connector's configuration (D1-G), read once at start. Anything missing or malformed refuses to
 * start, naming the variable and never its value; `main.ts` deletes the two keys from the environment
 * once this has read them.
 */
export function loadConnectorConfig(
  env: Readonly<Record<string, string | undefined>>,
): ConnectorConfig {
  const service = key(env, 'CONNECTOR_KEY');
  const sealing = key(env, 'CONNECTOR_SEALING_KEY');
  if (service.equals(sealing))
    refuse('CONNECTOR_SEALING_KEY', 'must not be the same key as CONNECTOR_KEY');

  const listed = env.CONNECTOR_DENY?.trim();
  if (!listed) {
    refuse('CONNECTOR_DENY', "is required: the platform's CIDR ranges, comma-separated, or none");
  }
  const deny = listed === 'none' ? [] : listed!.split(',').map((each) => each.trim());
  if (deny.some((range) => !isRange(range))) {
    refuse('CONNECTOR_DENY', 'must be CIDR ranges, comma-separated, or none');
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['silent', 'error', 'info'].includes(logLevel))
    refuse('LOG_LEVEL', 'must be silent, error or info');

  return {
    port: integer(env, 'CONNECTOR_PORT', 8090, [1, 65535]),
    host: env.CONNECTOR_HOST || '0.0.0.0',
    keyDigest: createHash('sha256').update(env.CONNECTOR_KEY!, 'utf8').digest(),
    sealingKey: sealing,
    deny,
    maxChildren: integer(env, 'CONNECTOR_MAX_CHILDREN', 8, [1, 64]),
    logLevel: logLevel as LogLevel,
  };
}

/**
 * The configuration, read once, and the two keys deleted from the environment they were read from -
 * whether or not it was refused - so no child, dump or report of this process finds them there.
 */
export function takeConnectorConfig(env: Record<string, string | undefined>): ConnectorConfig {
  try {
    return loadConnectorConfig(env);
  } finally {
    delete env.CONNECTOR_KEY;
    delete env.CONNECTOR_SEALING_KEY;
  }
}

/** The ranges a production connector refuses: the built-in ones, and the deployment's. */
export function productionDeny(config: Pick<ConnectorConfig, 'deny'>): readonly string[] {
  return [...builtInDenied, ...config.deny];
}
