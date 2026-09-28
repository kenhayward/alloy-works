import { randomBytes } from 'node:crypto';
import { CHECK_WITHIN_MS, retryDelayMs } from '@alloy-works/db';
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

  it('sizes the defaults so a check whose first attempt fails still joins its publication within five minutes of its recording', () => {
    const { leaseMs, pollIntervalMs } = loadWorkerConfig(env);
    // A check queued as its publication is recorded wakes a free worker at once. Its first attempt
    // ends within its lease - veraPDF's start and check a third of it each - by throwing, or by its
    // worker dying and the lease running out; the queue then waits its first backoff (`fail`, read
    // from the queue itself), and an idle worker next asks within a poll. The second attempt ends
    // within its lease too.
    const firstBackoff = retryDelayMs(1);
    expect(leaseMs + firstBackoff + pollIntervalMs + leaseMs).toBeLessThanOrEqual(CHECK_WITHIN_MS);
  });

  it('runs veraPDF from where the image holds it, unless told where else', () => {
    expect(loadWorkerConfig(env).verapdfCommand).toBe('/opt/verapdf/verapdf');
    expect(
      loadWorkerConfig({ ...env, VERAPDF_COMMAND: '/usr/local/verapdf/verapdf' }).verapdfCommand,
    ).toBe('/usr/local/verapdf/verapdf');
    expect(describeWorkerConfig(loadWorkerConfig(env))).toMatchObject({
      verapdfCommand: '/opt/verapdf/verapdf',
    });
  });

  it("gives veraPDF's JVM the deployment's JAVA_OPTS, and none where it names none", () => {
    expect(loadWorkerConfig(env).verapdfJavaOptions).toBeUndefined();
    expect(loadWorkerConfig({ ...env, JAVA_OPTS: '-Xmx1g' }).verapdfJavaOptions).toBe('-Xmx1g');
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
