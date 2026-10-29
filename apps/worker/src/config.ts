import { hostname } from 'node:os';
import type { StoreSettings } from '@alloy-works/objects';
import { z } from 'zod';
import { typstBinaryPath } from './typst.js';
import { VERAPDF_COMMAND } from './verapdf.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly objectStore: StoreSettings;
  /** The key that opens each tenant's sealed store secret. 32 bytes. */
  readonly objectStoreKey: Buffer;
  readonly typstBinary: string;
  /** veraPDF's launcher, which the worker keeps warm to check each publication's PDF (W14.1). */
  readonly verapdfCommand: string;
  /**
   * veraPDF's JVM options, `JAVA_OPTS`, where the deployment gives them: the worker adds a heap limit
   * where they name none (`javaOptionsWithHeapLimit`), and nothing else of its environment.
   */
  readonly verapdfJavaOptions?: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly sweepIntervalMs: number;
  readonly logLevel: LogLevel;
  /**
   * The connector, and the keys that open its embedding (the G7 plan, G7-E) and its webhook delivery
   * (the WB plan, WB-F) alone; none given, neither is done.
   */
  readonly connector?: {
    readonly url: string;
    readonly embedKey?: string;
    readonly deliverKey?: string;
    /** The key that opens its re-checks alone (the XR plan, XR-E). */
    readonly referenceKey?: string;
  };
  /** How often the webhook delivery loop runs, apart from the sweeps (WB-I). */
  readonly deliverIntervalMs: number;
  /**
   * The delivery store's owner URL, `SECRET_DELIVERED_URL`, as the service has it
   * (docs/design/ct-studio-sink.md, "Data tables"); none given, a data delivery is refused
   * `not_configured`.
   */
  readonly deliveredUrl?: string;
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
  VERAPDF_COMMAND: z.string().min(1).optional(),
  JAVA_OPTS: z.string().optional(),
  WORKER_ID: z.string().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  // How long a claimed job is held before another worker may take it; veraPDF's start and check are
  // each given a third of it (`veraPdfTimeouts`), so a check never outlives its job's lease.
  LEASE_MS: z.coerce.number().int().min(1000).default(120_000),
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(600_000),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default('info'),
  CONNECTOR_URL: z.url({ error: 'must be a URL' }).optional(),
  SECRET_CONNECTOR_EMBED_KEY: z.string().min(1).optional(),
  SECRET_CONNECTOR_DELIVER_KEY: z.string().min(1).optional(),
  SECRET_CONNECTOR_REFERENCE_KEY: z.string().min(1).optional(),
  DELIVER_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  SECRET_DELIVERED_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), { error: 'must be a postgres:// URL' })
    .optional(),
});

/** Read once, at start-up. Messages name the variable and the rule, never the value. */
export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const result = Environment.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new WorkerConfigError(`The worker cannot start:\n  ${problems.join('\n  ')}`);
  }
  const data = result.data;
  const keyed =
    data.SECRET_CONNECTOR_EMBED_KEY !== undefined ||
    data.SECRET_CONNECTOR_DELIVER_KEY !== undefined ||
    data.SECRET_CONNECTOR_REFERENCE_KEY !== undefined;
  if ((data.CONNECTOR_URL === undefined) === keyed) {
    throw new WorkerConfigError(
      'The worker cannot start:\n  CONNECTOR_URL is given with SECRET_CONNECTOR_EMBED_KEY, SECRET_CONNECTOR_DELIVER_KEY or SECRET_CONNECTOR_REFERENCE_KEY, or none of them',
    );
  }
  return {
    databaseUrl: data.DATABASE_URL,
    objectStore: {
      endpoint: data.OBJECT_STORE_ENDPOINT,
      region: data.OBJECT_STORE_REGION,
      bucket: data.OBJECT_STORE_BUCKET,
    },
    objectStoreKey: Buffer.from(data.SECRET_OBJECT_STORE_KEY, 'base64'),
    typstBinary: data.TYPST_BINARY ?? typstBinaryPath(),
    verapdfCommand: data.VERAPDF_COMMAND ?? VERAPDF_COMMAND,
    ...(data.JAVA_OPTS === undefined ? {} : { verapdfJavaOptions: data.JAVA_OPTS }),
    workerId: data.WORKER_ID ?? `${hostname()}-${process.pid}`,
    pollIntervalMs: data.POLL_INTERVAL_MS,
    leaseMs: data.LEASE_MS,
    sweepIntervalMs: data.SWEEP_INTERVAL_MS,
    logLevel: data.LOG_LEVEL,
    deliverIntervalMs: data.DELIVER_INTERVAL_MS,
    ...(data.SECRET_DELIVERED_URL === undefined ? {} : { deliveredUrl: data.SECRET_DELIVERED_URL }),
    ...(data.CONNECTOR_URL === undefined
      ? {}
      : {
          connector: {
            url: data.CONNECTOR_URL,
            ...(data.SECRET_CONNECTOR_EMBED_KEY === undefined
              ? {}
              : { embedKey: data.SECRET_CONNECTOR_EMBED_KEY }),
            ...(data.SECRET_CONNECTOR_DELIVER_KEY === undefined
              ? {}
              : { deliverKey: data.SECRET_CONNECTOR_DELIVER_KEY }),
            ...(data.SECRET_CONNECTOR_REFERENCE_KEY === undefined
              ? {}
              : { referenceKey: data.SECRET_CONNECTOR_REFERENCE_KEY }),
          },
        }),
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
    verapdfCommand: config.verapdfCommand,
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    leaseMs: config.leaseMs,
    logLevel: config.logLevel,
    connector: config.connector?.url ?? 'none',
    // Whether there is one, and nothing of where: its URL holds the owner's password.
    deliveredStore: config.deliveredUrl === undefined ? 'none' : 'set',
  };
}
