import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
}

export class ConfigError extends Error {}

const Environment = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), { error: 'must be a postgres:// URL' }),
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
});

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
  const { DATABASE_URL, PORT, HOST, LOG_LEVEL } = result.data;
  return { databaseUrl: DATABASE_URL, port: PORT, host: HOST, logLevel: LOG_LEVEL };
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
  };
}
