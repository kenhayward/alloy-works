import { hostname } from 'node:os';
import type { StoreSettings } from '@alloy-works/objects';
import { z } from 'zod';
import { typstBinaryPath } from './typst.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly objectStore: StoreSettings;
  /** The key that opens each tenant's sealed store secret. 32 bytes. */
  readonly objectStoreKey: Buffer;
  readonly typstBinary: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly sweepIntervalMs: number;
  readonly logLevel: LogLevel;
}

export class WorkerConfigError extends Error {}

const Environment = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), { error: 'must be a postgres:// URL' }),
  OBJECT_STORE_ENDPOINT: z.url({ error: 'must be a URL' }),
  OBJECT_STORE_BUCKET: z
    .string({ error: 'is required' })
    .regex(/^[a-z0-9][a-z0-9.-]{2,62}$/, { error: 'must be a bucket name' }),
  OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),
  SECRET_OBJECT_STORE_KEY: z
    .string({ error: 'is required' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'must be 32 bytes of base64',
    }),
  TYPST_BINARY: z.string().min(1).optional(),
  WORKER_ID: z.string().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  LEASE_MS: z.coerce.number().int().min(1000).default(120_000),
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(600_000),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default('info'),
});

/** Read once, at start-up. Messages name the variable and the rule, never the value. */
export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const result = Environment.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new WorkerConfigError(`The worker cannot start:\n  ${problems.join('\n  ')}`);
  }
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    objectStore: {
      endpoint: data.OBJECT_STORE_ENDPOINT,
      region: data.OBJECT_STORE_REGION,
      bucket: data.OBJECT_STORE_BUCKET,
    },
    objectStoreKey: Buffer.from(data.SECRET_OBJECT_STORE_KEY, 'base64'),
    typstBinary: data.TYPST_BINARY ?? typstBinaryPath(),
    workerId: data.WORKER_ID ?? `${hostname()}-${process.pid}`,
    pollIntervalMs: data.POLL_INTERVAL_MS,
    leaseMs: data.LEASE_MS,
    sweepIntervalMs: data.SWEEP_INTERVAL_MS,
    logLevel: data.LOG_LEVEL,
  };
}

/** The configuration as it may appear in a log: no password, and no key. */
export function describeWorkerConfig(config: WorkerConfig): Record<string, string | number> {
  const database = new URL(config.databaseUrl);
  if (database.password) database.password = '***';
  return {
    databaseUrl: database.toString(),
    objectStore: `${config.objectStore.endpoint}/${config.objectStore.bucket}`,
    typstBinary: config.typstBinary,
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    leaseMs: config.leaseMs,
    logLevel: config.logLevel,
  };
}
