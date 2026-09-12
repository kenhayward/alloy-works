import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeWorkerConfig, loadWorkerConfig, WorkerConfigError } from './config.js';

const key = randomBytes(32).toString('base64');
const env = {
  DATABASE_URL: 'postgres://aw_worker:secret-pw@127.0.0.1:5432/alloy_dev',
  OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:8333',
  OBJECT_STORE_BUCKET: 'alloy-dev',
  SECRET_OBJECT_STORE_KEY: key,
};

describe("the worker's configuration", () => {
  it('reads what it needs and fills in the rest', () => {
    const config = loadWorkerConfig(env);
    expect(config).toMatchObject({
      objectStore: { endpoint: 'http://127.0.0.1:8333', region: 'us-east-1', bucket: 'alloy-dev' },
      pollIntervalMs: 5000,
      leaseMs: 120_000,
      logLevel: 'info',
    });
    expect(config.objectStoreKey).toHaveLength(32);
    expect(config.workerId).toMatch(/\S/);
  });

  it('refuses to start without somewhere to keep what it makes', () => {
    expect(() => loadWorkerConfig({ DATABASE_URL: env.DATABASE_URL })).toThrow(WorkerConfigError);
    expect(() => loadWorkerConfig({ ...env, SECRET_OBJECT_STORE_KEY: 'too-short' })).toThrow(
      /SECRET_OBJECT_STORE_KEY/,
    );
  });

  it('describes itself for a log without its secrets', () => {
    const described = JSON.stringify(describeWorkerConfig(loadWorkerConfig(env)));
    expect(described).not.toContain('secret-pw');
    expect(described).not.toContain(key);
    expect(described).toContain('alloy-dev');
  });
});
