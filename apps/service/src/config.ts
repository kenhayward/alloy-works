import type { StoreSettings } from '@alloy-works/objects';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface GoogleSettings {
  /** Google's issuer; the stand-in's, in development and tests. */
  readonly issuer: string;
  readonly clientId: string;
  /** `signin.<domain>`: the one address Google returns to, with a port where it is not the default. */
  readonly signInHost: string;
}

export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
  readonly allowInsecureIssuers: boolean;
  /** Present only when the product's Google client is configured; without it, no Google route. */
  readonly google?: GoogleSettings;
  /** Present only when the object store is configured; without it, no samples. */
  readonly objectStore?: StoreSettings;
}

export class ConfigError extends Error {}

const Environment = z
  .object({
    DATABASE_URL: z
      .string({ error: 'is required' })
      .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
        error: 'must be a postgres:// URL',
      }),
    PORT: z.coerce
      .number({ error: 'must be a port number' })
      .int({ error: 'must be a port number' })
      .min(1, { error: 'must be a port number' })
      .max(65535, { error: 'must be a port number' })
      .default(8080),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
      .default('info'),
    ALLOW_INSECURE_ISSUERS: z
      .enum(['true', 'false'], { error: 'must be true or false' })
      .default('false'),
    GOOGLE_ISSUER: z.url({ error: 'must be a URL' }).default('https://accounts.google.com'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    SIGN_IN_HOST: z
      .string()
      .regex(/^[a-z0-9.-]+(:\d{1,5})?$/, {
        error: 'must be a lower-case hostname, with a port if needed',
      })
      .optional(),
    OBJECT_STORE_ENDPOINT: z.url({ error: 'must be a URL' }).optional(),
    OBJECT_STORE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{2,62}$/, { error: 'must be a bucket name' })
      .optional(),
    OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),
  })
  .refine((env) => (env.GOOGLE_CLIENT_ID === undefined) === (env.SIGN_IN_HOST === undefined), {
    error: 'must be set together, or neither: the Google route needs both',
    path: ['GOOGLE_CLIENT_ID and SIGN_IN_HOST'],
  })
  .refine(
    (env) => (env.OBJECT_STORE_ENDPOINT === undefined) === (env.OBJECT_STORE_BUCKET === undefined),
    {
      error: 'must be set together, or neither: the object store needs both',
      path: ['OBJECT_STORE_ENDPOINT and OBJECT_STORE_BUCKET'],
    },
  );

/**
 * Reads the service's configuration once, at start-up, and refuses to start on anything missing or
 * malformed. Messages name the variable and the rule, never the value - which may be a secret.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = Environment.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new ConfigError(`The service cannot start:\n  ${problems.join('\n  ')}`);
  }
  const {
    DATABASE_URL,
    PORT,
    HOST,
    LOG_LEVEL,
    ALLOW_INSECURE_ISSUERS,
    GOOGLE_ISSUER,
    GOOGLE_CLIENT_ID,
    SIGN_IN_HOST,
    OBJECT_STORE_ENDPOINT,
    OBJECT_STORE_BUCKET,
    OBJECT_STORE_REGION,
  } = result.data;
  return {
    databaseUrl: DATABASE_URL,
    port: PORT,
    host: HOST,
    logLevel: LOG_LEVEL,
    allowInsecureIssuers: ALLOW_INSECURE_ISSUERS === 'true',
    ...(GOOGLE_CLIENT_ID !== undefined && SIGN_IN_HOST !== undefined
      ? { google: { issuer: GOOGLE_ISSUER, clientId: GOOGLE_CLIENT_ID, signInHost: SIGN_IN_HOST } }
      : {}),
    ...(OBJECT_STORE_ENDPOINT !== undefined && OBJECT_STORE_BUCKET !== undefined
      ? {
          objectStore: {
            endpoint: OBJECT_STORE_ENDPOINT,
            region: OBJECT_STORE_REGION,
            bucket: OBJECT_STORE_BUCKET,
          },
        }
      : {}),
  };
}

/** The configuration as it may appear in a log: the database password replaced. */
export function describeConfig(config: Config): Record<string, string | number> {
  const database = new URL(config.databaseUrl);
  if (database.password) database.password = '***';
  return {
    databaseUrl: database.toString(),
    port: config.port,
    host: config.host,
    logLevel: config.logLevel,
    allowInsecureIssuers: String(config.allowInsecureIssuers),
    signInHost: config.google?.signInHost ?? 'none',
    objectStore: config.objectStore?.bucket ?? 'none',
  };
}
