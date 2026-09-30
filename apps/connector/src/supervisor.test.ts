import { describe, expect, it } from 'vitest';

import {
  childSpawn,
  createSupervisor,
  runChild,
  type ChildOutcome,
  type ChildSpec,
  type SpawnChild,
} from './supervisor.js';
import {
  PASSWORDS,
  requestFor,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
} from './testing/source.js';

/** Every spelling of a key's bytes a child's input could carry. */
const spellings = (key: Buffer) => [
  key.toString('base64'),
  key.toString('base64url'),
  key.toString('hex'),
  key.toString('latin1'),
];

describe('the supervisor', () => {
  it("DAT-056 runs each request in a fresh process handed one opened credential, never the sealing key, and nothing of the supervisor's environment", async () => {
    const spec = childSpawn(suiteChild);
    expect(spec.file).toBe(process.execPath);
    expect(spec.env).toEqual({});
    expect(spec.args).toContain('--max-old-space-size=256');
    expect(spec.args.at(-1)).toBe(suiteChild.path);
    for (const arg of spec.args) {
      expect(arg).not.toContain(PASSWORDS.reader);
      for (const spelling of spellings(SEALING_KEY)) expect(arg).not.toContain(spelling);
    }
    // The production child: the built entry beside this module, nothing else on its command line.
    const production = childSpawn();
    expect(production.env).toEqual({});
    expect(production.args).toEqual(['--max-old-space-size=256', production.args.at(-1)]);
    expect(production.args.at(-1)).toMatch(/child\.js$/);

    const seen: { spec: ChildSpec; input: string; outcome: ChildOutcome }[] = [];
    const spawn: SpawnChild = async (given, input, deadlineMs) => {
      const outcome = await runChild(given, input, deadlineMs);
      seen.push({ spec: given, input, outcome });
      return outcome;
    };
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec,
      spawn,
    });
    const request = requestFor(settings(), PASSWORDS.reader);
    expect(await supervisor.run('test', request)).toEqual({ outcome: 'ok', findings: [] });
    expect(await supervisor.run('test', { ...request, requestId: crypto.randomUUID() })).toEqual({
      outcome: 'ok',
      findings: [],
    });

    expect(seen).toHaveLength(2);
    const [first, second] = seen;
    expect(first!.outcome.pid).toBeGreaterThan(0);
    expect(second!.outcome.pid).toBeGreaterThan(0);
    expect(first!.outcome.pid).not.toBe(second!.outcome.pid);
    expect(first!.outcome.pid).not.toBe(process.pid);
    for (const { spec: given, input } of seen) {
      expect(given.env).toEqual({});
      // The one opened credential, and never the key that opened it.
      expect(JSON.parse(input)).toMatchObject({ kind: 'test', secret: PASSWORDS.reader });
      for (const spelling of spellings(SEALING_KEY)) expect(input).not.toContain(spelling);
    }
  });

  it('kills a child past its deadline and answers timeout', async () => {
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec: { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
    });
    const started = Date.now();
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader, 1000))).toEqual({
      outcome: 'failed',
      failure: { code: 'timeout', attribution: 'connector' },
    });
    // Killed a second after the deadline, not sooner and not much later.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(supervisor.active()).toBe(0);
  });

  it('answers connector_error for a child that ends without an answer, or with one that does not parse', async () => {
    for (const script of [
      'process.exit(3)',
      'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))',
      'process.stdout.write("not json\\n"); process.exit(0)',
      'process.stdout.write(JSON.stringify({ outcome: "ok", findings: ["everything"] }) + "\\n")',
    ]) {
      const supervisor = createSupervisor({
        sealingKey: SEALING_KEY,
        deny: suiteDeny,
        maxChildren: 8,
        spec: { file: process.execPath, args: ['-e', script], env: {} },
      });
      expect(
        await supervisor.run('test', requestFor(settings(), PASSWORDS.reader)),
        script,
      ).toEqual({
        outcome: 'failed',
        failure: { code: 'connector_error', attribution: 'connector' },
      });
      expect(
        await supervisor.run('describe', requestFor(settings(), PASSWORDS.reader)),
        script,
      ).toEqual({
        failure: { code: 'connector_error', attribution: 'connector' },
      });
    }
  });

  it('refuses a request past its cap of children as busy, without starting one', async () => {
    let started = 0;
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 2,
      spec: { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
      spawn: (spec, input, deadlineMs) => {
        started += 1;
        return runChild(spec, input, deadlineMs);
      },
    });
    const running = [1, 2].map(() => supervisor.run('test', requestFor(settings(), 'x', 1000)));
    expect(await supervisor.run('test', requestFor(settings(), 'x', 1000))).toBe('busy');
    expect(started).toBe(2);
    await Promise.all(running);
    expect(supervisor.active()).toBe(0);
  });

  it('answers connection_failed, no sooner than the failure floor, for a credential that does not open', async () => {
    const supervisor = createSupervisor({
      sealingKey: Buffer.alloc(32, 9),
      deny: suiteDeny,
      maxChildren: 8,
      spec: childSpawn(suiteChild),
      failureFloorMs: 1500,
    });
    const started = Date.now();
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader))).toEqual({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450);
  });
});
